"""The monthly wastage approval.

    Month running   → open: a running total, nothing to approve yet
    Month ends      → pending: sent to the Super Admin, without anyone pressing a button
    Super Admin     → approve (one month or several at once; final, and locks the month)
                      or escalate to the Manager with a comment (→ escalated)
                      or change the month's wastage figure (the status stays as it is)
    Manager         → comment, and send it back (→ pending)

No month waits on another: February is worked out and sent whether January is approved or not.

Until approval the figures are worked out live from production, so a late January entry still
lands in January. Approval saves them and locks the month: production dated in an approved
month cannot be added, changed or rejected.

When the Super Admin changes the figure, the difference from the production total is spread
over the raw materials processed that month, by their share of the processed weight. It is
shown on the month before approval, and approval takes it out of (or puts it back into) Grade A
raw stock. Every step goes to the month's history and the company audit log.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy import String, and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import add_months, month_start, now, today
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, InvalidError, NotFoundError
from app.core.periods import truncate
from app.models import (
    Production,
    User,
    WastageAdjustment,
    WastageMonthEvent,
    WastageMonthRecord,
)
from app.models.enums import EntryStatus
from app.schemas.wastage import (
    StockShare,
    WastageApproval,
    WastageChange,
    WastageEventRead,
    WastageMonth,
    WastageMonthDetail,
    WastageQueue,
)
from app.services import audit_service, stock_service
from app.services.access_service import CompanyContext, accessible_companies, permissions_in

OPEN, PENDING, ESCALATED, APPROVED = "open", "pending", "escalated", "approved"
Record = WastageMonthRecord
_GRAM = Decimal("0.001")
_ZERO = Decimal(0)


def _month_end(month: date) -> date:
    return add_months(month, 1) - timedelta(days=1)


def _live(company_id: int) -> tuple:
    return (
        Production.company_id == company_id,
        Production.deleted_at.is_(None),
        Production.status != EntryStatus.REJECTED,
    )


# ---------------------------------------------------------------------------
# Working out a month
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _Totals:
    runs: int = 0
    processed: Decimal = _ZERO
    output: Decimal = _ZERO
    wastage: Decimal = _ZERO
    shares: dict[str, Decimal] = field(default_factory=dict)  # raw material → processed kg


async def _totals(db: AsyncSession, company_id: int, first: date, last: date) -> dict:
    """{month: _Totals} for every month from `first` to `last` with production. One query,
    grouped by month and raw material, on the (company, date) index."""
    month = truncate(Production.entry_date, "month")
    rows = await db.execute(
        select(
            month,
            Production.material,
            func.count(),
            func.sum(Production.input_kg - Production.returned_kg),
            func.sum(Production.output_kg),
            func.sum(Production.wastage_kg),
        )
        .where(*_live(company_id), Production.entry_date.between(first, _month_end(last)))
        .group_by(month, Production.material)
    )
    out: dict[date, _Totals] = defaultdict(_Totals)
    for key, material, runs, processed, output, wastage in rows:
        t = out[key]
        t.runs += runs
        t.processed += processed
        t.output += output
        t.wastage += wastage
        t.shares[material] = t.shares.get(material, _ZERO) + processed
    return out


def _spread(delta: Decimal, shares: dict[str, Decimal]) -> list[tuple[str, Decimal, Decimal]]:
    """Split `delta` kg over the raw materials by processed weight: (item, processed, qty).
    Rounded to the gram; the biggest share takes the rounding, so the lines add up exactly."""
    total = sum(shares.values(), _ZERO)
    if not delta or not total:
        return []
    ordered = sorted(shares.items(), key=lambda kv: (-kv[1], kv[0]))
    rest = [
        (item, kg, (delta * kg / total).quantize(_GRAM, rounding=ROUND_HALF_UP))
        for item, kg in ordered[1:]
    ]
    first, kg = ordered[0]
    return [(first, kg, delta - sum((q for *_, q in rest), _ZERO)), *rest]


def _share(item: str, kg: Decimal, total: Decimal, qty: Decimal) -> StockShare:
    pct = float(round(kg / total * 100, 2)) if total else 0.0
    return StockShare(item=item, processed_kg=kg, share_pct=pct, qty=qty)


def _view(
    month: date, totals: _Totals | None, record: Record | None, approver: str | None
) -> WastageMonth:
    if record is not None and record.status == APPROVED:
        runs, processed, output = record.runs or 0, record.processed_kg, record.output_kg
        calculated, final = record.calculated_kg, record.approved_kg
        total = sum((a.processed_kg for a in record.adjustments), _ZERO)
        shares = [_share(a.item, a.processed_kg, total, a.qty) for a in record.adjustments]
    else:
        t = totals or _Totals()
        runs, processed, output, calculated = t.runs, t.processed, t.output, t.wastage
        target = record.target_kg if record is not None else None
        final = calculated if target is None else target
        shares = [
            _share(item, kg, t.processed, qty)
            for item, kg, qty in _spread(final - calculated, t.shares)
        ]
    if record is not None:
        status = record.status
    else:
        status = OPEN if month >= month_start(today()) else PENDING
    return WastageMonth(
        month=month,
        status=status,
        runs=runs,
        processed_kg=processed or _ZERO,
        output_kg=output or _ZERO,
        calculated_kg=calculated or _ZERO,
        wastage_kg=final or _ZERO,
        wastage_pct=round(final / processed * 100, 3) if processed else 0,
        changed=final != calculated,
        adjustments=shares,
        escalated_at=record.escalated_at if record else None,
        approved_by_name=approver,
        approved_at=record.approved_at if record else None,
        updated_at=record.updated_at if record else None,
    )


async def _records(db: AsyncSession, company_id: int, first: date, last: date) -> dict:
    """{month: (record, approver's name)} for the months from `first` to `last`."""
    rows = await db.execute(
        select(Record, User.full_name)
        .outerjoin(User, User.id == Record.approved_by_id)
        .where(Record.company_id == company_id, Record.month.between(first, last))
    )
    return {r.month: (r, name) for r, name in rows}


async def months(db: AsyncSession, company_id: int, d_from: date, d_to: date) -> list[WastageMonth]:
    """Every month in the range with production (or a record), oldest first. Two queries."""
    first, last = month_start(d_from), month_start(d_to)
    totals = await _totals(db, company_id, first, last)
    records = await _records(db, company_id, first, last)
    return [
        _view(m, totals.get(m), *records.get(m, (None, None)))
        for m in sorted(totals.keys() | records.keys())
    ]


# ---------------------------------------------------------------------------
# One month: detail and history
# ---------------------------------------------------------------------------


def allowed_actions(ctx: CompanyContext, status: str) -> list[str]:
    """The buttons the client should show. The same checks run again when one is pressed."""
    talks = ctx.can(P.APPROVE_WASTAGE) or ctx.can(P.ADJUST_WASTAGE)
    if status == OPEN:
        return []
    if status == APPROVED:
        return ["comment"] if talks else []
    actions = []
    if ctx.can(P.APPROVE_WASTAGE):
        actions += ["approve", "change"] + (["escalate"] if status == PENDING else [])
    elif status == ESCALATED and ctx.can(P.ADJUST_WASTAGE):
        actions.append("resend")
    return actions + (["comment"] if talks else [])


def _sent_at(month: date) -> datetime:
    """When a month was sent: midnight at its end, where the business runs."""
    return datetime.combine(add_months(month, 1), time(), ZoneInfo(settings.TIMEZONE))


async def detail(db: AsyncSession, ctx: CompanyContext, month: date) -> WastageMonthDetail:
    month = month_start(month)
    cid = ctx.company.id
    record, approver = (await _records(db, cid, month, month)).get(month, (None, None))
    totals = (await _totals(db, cid, month, month)).get(month)
    if totals is None and record is None:
        raise NotFoundError("No production in this month")
    view = _view(month, totals, record, approver)
    if view.status != APPROVED and view.adjustments:
        # Show what each line does to the stock now, so it can be checked before approving.
        stock = await stock_service.company_stock(db, cid)
        balance = {line.item: line.provisional.balance for line in stock.raw}
        for share in view.adjustments:
            share.stock_now = balance.get(share.item, 0.0)
            share.stock_after = round(share.stock_now - share.qty, 3)
    events = []
    if view.status != OPEN:
        sent = WastageEventRead(
            id=0,
            action="sent",
            comment="",
            changes=None,
            actor_name=None,
            created_at=_sent_at(month),
        )
        events.append(sent)
    if record is not None:
        rows = await db.execute(
            select(WastageMonthEvent, User.full_name)
            .outerjoin(User, User.id == WastageMonthEvent.actor_id)
            .where(WastageMonthEvent.record_id == record.id)
            .order_by(WastageMonthEvent.created_at, WastageMonthEvent.id)
        )
        events += [
            WastageEventRead(
                id=e.id,
                action=e.action,
                comment=e.comment,
                changes=e.changes,
                actor_name=name,
                created_at=e.created_at,
            )
            for e, name in rows
        ]
    return WastageMonthDetail(
        **view.model_dump(), actions=allowed_actions(ctx, view.status), events=events
    )


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


async def _record_for(db: AsyncSession, ctx: CompanyContext, month: date) -> Record:
    """The month's row, made on its first action. Call with the company locked, so two people
    acting at once cannot both make it."""
    if month >= month_start(today()):
        raise InvalidError(
            "This month is still running. It goes for approval when it ends.", code="month_open"
        )
    cid = ctx.company.id
    record = await db.scalar(select(Record).where(Record.company_id == cid, Record.month == month))
    if record is not None:
        return record
    found = await db.scalar(
        select(Production.id)
        .where(*_live(cid), Production.entry_date.between(month, _month_end(month)))
        .limit(1)
    )
    if found is None:
        raise NotFoundError("No production in this month")
    # An empty list, not unloaded: approval sets it without a lazy load.
    record = Record(company_id=cid, month=month, status=PENDING, adjustments=[])
    db.add(record)
    await db.flush()
    return record


async def _locked(db: AsyncSession, ctx: CompanyContext, month: date) -> Record:
    await stock_service.lock_company(db, ctx.company.id)
    return await _record_for(db, ctx, month_start(month))


def _event(
    db: AsyncSession,
    ctx: CompanyContext,
    record: Record,
    action: str,
    comment: str = "",
    changes: dict | None = None,
    request: Request | None = None,
) -> None:
    """Write one step to the month's history and to the company audit log."""
    db.add(
        WastageMonthEvent(
            record_id=record.id,
            company_id=record.company_id,
            actor_id=ctx.user.id,
            action=action,
            comment=comment,
            changes=changes,
        )
    )
    details: dict = {"month": record.month.isoformat(), "status": record.status}
    if comment:
        details["comment"] = comment
    if changes:
        details["changes"] = changes
    audit_service.record(
        db,
        account_id=ctx.user.account_id,
        actor=ctx.user,
        action=f"wastage.{action}",
        entity_type="wastage_month",
        entity_id=record.id,
        company_id=record.company_id,
        details=details,
        request=request,
    )


def _status_error(record: Record, what: str) -> InvalidError:
    return InvalidError(
        f"{record.month:%B %Y} is {record.status}; it cannot be {what} now", code="invalid_status"
    )


async def escalate(
    db: AsyncSession, ctx: CompanyContext, month: date, comment: str, request: Request | None
) -> Record:
    """The Super Admin asks the Manager about a month."""
    if not ctx.can(P.APPROVE_WASTAGE):
        raise ForbiddenError("Only the Super Admin escalates wastage")
    record = await _locked(db, ctx, month)
    if record.status != PENDING:
        raise _status_error(record, "escalated")
    record.status, record.escalated_at = ESCALATED, now()
    _event(db, ctx, record, "escalated", comment, request=request)
    await db.commit()
    return record


async def resend(
    db: AsyncSession, ctx: CompanyContext, month: date, comment: str, request: Request | None
) -> Record:
    """The Manager answers an escalation and sends the month back to the Super Admin."""
    if not ctx.can(P.ADJUST_WASTAGE):
        raise ForbiddenError("Only the Manager answers a wastage escalation")
    record = await _locked(db, ctx, month)
    if record.status != ESCALATED:
        raise _status_error(record, "sent back")
    record.status, record.escalated_at = PENDING, None
    _event(db, ctx, record, "resent", comment, request=request)
    await db.commit()
    return record


async def comment(
    db: AsyncSession, ctx: CompanyContext, month: date, text: str, request: Request | None
) -> Record:
    if not (ctx.can(P.APPROVE_WASTAGE) or ctx.can(P.ADJUST_WASTAGE)):
        raise ForbiddenError("Not allowed")
    record = await _locked(db, ctx, month)
    _event(db, ctx, record, "commented", text, request=request)
    await db.commit()
    return record


async def change(
    db: AsyncSession,
    ctx: CompanyContext,
    month: date,
    data: WastageChange,
    request: Request | None,
) -> Record:
    """The Super Admin sets the month's wastage. Only they can; nothing moves in stock until
    they approve the month."""
    if not ctx.can(P.APPROVE_WASTAGE):
        raise ForbiddenError("Only the Super Admin can change wastage")
    record = await _locked(db, ctx, month)
    if record.status == APPROVED:
        raise _status_error(record, "changed")
    calculated = (
        (await _totals(db, ctx.company.id, record.month, record.month))
        .get(record.month, _Totals())
        .wastage
    )
    old = calculated if record.target_kg is None else record.target_kg
    new = data.wastage_kg.quantize(_GRAM)
    if new == old:
        raise InvalidError(f"Wastage is already {new:,.3f} kg", code="no_change")
    record.target_kg = None if new == calculated else new
    changes = {"wastage_kg": [str(old), str(new)], "production_kg": str(calculated)}
    _event(db, ctx, record, "changed", data.comment, changes, request)
    await db.commit()
    return record


async def approve(
    db: AsyncSession, ctx: CompanyContext, data: WastageApproval, request: Request | None
) -> list[Record]:
    """The Super Admin approves one month or several in one go. Each month's figure must still
    be the one they saw; any stock a changed figure moves must be in stock. All or nothing."""
    if not ctx.can(P.APPROVE_WASTAGE):
        raise ForbiddenError("Only the Super Admin approves wastage")
    cid = ctx.company.id
    await stock_service.lock_company(db, cid)
    wanted = {month_start(m.month): m.wastage_kg for m in data.months}
    totals = await _totals(db, cid, min(wanted), max(wanted))
    approved = []
    for month in sorted(wanted):
        record = await _record_for(db, ctx, month)
        if record.status == APPROVED:
            raise _status_error(record, "approved")
        t = totals.get(month, _Totals())
        final = t.wastage if record.target_kg is None else record.target_kg
        if abs(final - wanted[month]) >= _GRAM:
            raise ConflictError(
                f"{month:%B %Y} changed since you opened it: wastage is now {final:,.3f} kg. "
                "Please check it again.",
                code="wastage_changed",
            )
        record.runs, record.processed_kg, record.output_kg = t.runs, t.processed, t.output
        record.calculated_kg, record.approved_kg = t.wastage, final
        record.status, record.escalated_at = APPROVED, None
        record.approved_by_id, record.approved_at = ctx.user.id, now()
        moved = _spread(final - t.wastage, t.shares)
        record.adjustments = [
            WastageAdjustment(company_id=cid, item=item, processed_kg=kg, qty=qty)
            for item, kg, qty in moved
        ]
        changes: dict = {"wastage_kg": str(final), "production_kg": str(t.wastage)}
        if moved:
            changes["stock_kg"] = {item: str(-qty) for item, _, qty in moved}
        _event(db, ctx, record, "approved", data.comment, changes, request)
        approved.append(record)
    await stock_service.assert_stock_not_negative(db, cid)
    await db.commit()
    return approved


async def assert_month_open(db: AsyncSession, company_id: int, *days: date) -> None:
    """Refuse a production change dated in a month whose wastage is approved."""
    locked = await db.scalar(
        select(Record.month)
        .where(
            Record.company_id == company_id,
            Record.month.in_({month_start(d) for d in days}),
            Record.status == APPROVED,
        )
        .order_by(Record.month)
        .limit(1)
    )
    if locked is not None:
        raise ConflictError(
            f"{locked:%B %Y} wastage is approved by the Super Admin, so production for that "
            "month is locked.",
            code="month_locked",
        )


# ---------------------------------------------------------------------------
# What waits on whom, across companies
# ---------------------------------------------------------------------------


async def queue(db: AsyncSession, user: User) -> list[WastageQueue]:
    """Per company: months waiting for this person. The Super Admin approves every ended month
    not yet approved or escalated; the Manager answers escalations. One round trip."""
    approver, answerer = [], []
    for company in await accessible_companies(db, user):
        perms = permissions_in(user, company)
        if P.APPROVE_WASTAGE in perms:
            approver.append(company.id)
        elif P.ADJUST_WASTAGE in perms:
            answerer.append(company.id)
    if not approver and not answerer:
        return []
    month = truncate(Production.entry_date, "month").label("month")
    ended = (
        select(Production.company_id.label("cid"), month)
        .where(
            Production.company_id.in_(approver),
            Production.deleted_at.is_(None),
            Production.status != EntryStatus.REJECTED,
            Production.entry_date < month_start(today()),
        )
        .distinct()
        .subquery()
    )
    to_approve = (
        select(literal("approve", String), ended.c.cid, func.count())
        .outerjoin(Record, and_(Record.company_id == ended.c.cid, Record.month == ended.c.month))
        .where(or_(Record.id.is_(None), Record.status == PENDING))
        .group_by(ended.c.cid)
    )
    escalated = (
        select(literal("escalated", String), Record.company_id, func.count())
        .where(Record.company_id.in_(answerer), Record.status == ESCALATED)
        .group_by(Record.company_id)
    )
    counts: dict[int, dict[str, int]] = defaultdict(lambda: {"approve": 0, "escalated": 0})
    for kind, cid, n in await db.execute(union_all(to_approve, escalated)):
        counts[cid][kind] = n
    return [
        WastageQueue(company_id=cid, to_approve=c["approve"], escalated=c["escalated"])
        for cid, c in counts.items()
    ]
