"""Wastage control.

- Allowance: the Manager declares the wastage % acceptable for a month, up to the hard limit
  (WASTAGE_ALERT_PCT). Months without a declaration use the hard limit.
- A run whose missing weight is over the month's allowance is flagged. Over the hard limit it
  raises a high alert and cannot be approved or verified until a debit note is recorded.
- Stock checks: every 1 or 3 months the Manager counts the physical stock; each difference from
  the book stock is recorded and adjusts the stock from then on.
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import add_months, month_start, today
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, InvalidError, NotFoundError
from app.core.periods import truncate
from app.models import (
    DebitNote,
    Party,
    Production,
    StockCheck,
    StockCheckLine,
    User,
    WastageAllowance,
)
from app.models.catalog import unit_of
from app.models.enums import EntryStatus, EntryType, PartyKind
from app.schemas.entries import DebitNoteRead
from app.schemas.wastage import (
    AllowanceInput,
    AllowanceRead,
    CountLineRead,
    DebitNoteInput,
    PendingDebitNote,
    StockCheckInput,
    StockCheckRead,
    WastageMonth,
)
from app.services import party_service, stock_service
from app.services.access_service import CompanyContext

HARD_LIMIT = Decimal(str(settings.WASTAGE_ALERT_PCT))
_GRADE_OF_SECTION = {"raw": "A", "output": "A", "resale": "B"}


def needs_debit_note(wastage_pct: Decimal) -> bool:
    return wastage_pct > HARD_LIMIT


def _require(ctx: CompanyContext) -> None:
    if not ctx.can(P.ADJUST_WASTAGE):
        raise ForbiddenError("Only the Manager manages wastage")


def _live_production(company_id: int) -> tuple:
    return (
        Production.company_id == company_id,
        Production.deleted_at.is_(None),
        Production.status != EntryStatus.REJECTED,
    )


# ---------------------------------------------------------------------------
# Allowances
# ---------------------------------------------------------------------------


async def allowances(
    db: AsyncSession, company_id: int, months: Iterable[date]
) -> dict[date, Decimal]:
    """{month: declared %} for the months asked about that have a declaration. One query."""
    wanted = {month_start(m) for m in months}
    if not wanted:
        return {}
    rows = await db.execute(
        select(WastageAllowance.month, WastageAllowance.pct).where(
            WastageAllowance.company_id == company_id, WastageAllowance.month.in_(wanted)
        )
    )
    return dict(rows.all())


async def allowance_for(db: AsyncSession, company_id: int, day: date) -> Decimal:
    return (await allowances(db, company_id, [day])).get(month_start(day), HARD_LIMIT)


async def declare(db: AsyncSession, ctx: CompanyContext, data: AllowanceInput) -> None:
    _require(ctx)
    month = month_start(data.month)
    if month > add_months(month_start(today()), 1):
        raise InvalidError("Declare the allowance at most one month ahead")
    current = await db.scalar(
        select(WastageAllowance).where(
            WastageAllowance.company_id == ctx.company.id, WastageAllowance.month == month
        )
    )
    if current:
        current.pct, current.note, current.declared_by_id = data.pct, data.note, ctx.user.id
    else:
        db.add(
            WastageAllowance(
                company_id=ctx.company.id,
                month=month,
                pct=data.pct,
                note=data.note,
                declared_by_id=ctx.user.id,
            )
        )
    await db.commit()


async def list_allowances(db: AsyncSession, company_id: int) -> list[AllowanceRead]:
    rows = await db.execute(
        select(WastageAllowance, User.full_name)
        .outerjoin(User, User.id == WastageAllowance.declared_by_id)
        .where(WastageAllowance.company_id == company_id)
        .order_by(WastageAllowance.month.desc())
        .limit(36)
    )
    return [
        AllowanceRead(
            month=a.month, pct=a.pct, note=a.note, declared_by_name=name, updated_at=a.updated_at
        )
        for a, name in rows
    ]


# ---------------------------------------------------------------------------
# Monthly report
# ---------------------------------------------------------------------------


async def monthly(
    db: AsyncSession, company_id: int, d_from: date, d_to: date
) -> list[WastageMonth]:
    """Each month in the range with production, against its allowance. The per-run flags need
    each month's allowance, so runs are grouped by month and percentage band in SQL and the
    bands are compared in Python (a few rows per month)."""
    month = truncate(Production.entry_date, "month")
    noted = select(DebitNote.production_id).where(DebitNote.company_id == company_id)
    rows = (
        await db.execute(
            select(
                month,
                Production.wastage_pct,
                func.count(),
                func.sum(Production.input_kg - Production.returned_kg),
                func.sum(Production.output_kg),
                func.sum(Production.wastage_kg),
                func.count().filter(Production.id.not_in(noted)),
            )
            .where(*_live_production(company_id), Production.entry_date.between(d_from, d_to))
            .group_by(month, Production.wastage_pct)
        )
    ).all()
    declared = await allowances(db, company_id, (r[0] for r in rows))
    acc: dict[date, dict] = defaultdict(
        lambda: {
            "runs": 0,
            "p": Decimal(0),
            "o": Decimal(0),
            "w": Decimal(0),
            "f": 0,
            "h": 0,
            "m": 0,
        }
    )
    for key, pct, n, processed, output, wastage, without_note in rows:
        allowance = declared.get(key, HARD_LIMIT)
        a = acc[key]
        a["runs"] += n
        a["p"] += processed
        a["o"] += output
        a["w"] += wastage
        if pct > allowance:
            a["f"] += n
        if needs_debit_note(pct):
            a["h"] += n
            a["m"] += without_note
    out = []
    for key in sorted(acc):
        a = acc[key]
        allowance = declared.get(key, HARD_LIMIT)
        pct = a["w"] / a["p"] * 100 if a["p"] else Decimal(0)
        out.append(
            WastageMonth(
                month=key,
                allowance_pct=allowance,
                declared=key in declared,
                runs=a["runs"],
                processed_kg=a["p"],
                output_kg=a["o"],
                wastage_kg=a["w"],
                wastage_pct=round(pct, 3),
                over_allowance=pct > allowance,
                flagged_runs=a["f"],
                high_runs=a["h"],
                notes_missing=a["m"],
            )
        )
    return out


# ---------------------------------------------------------------------------
# Debit notes
# ---------------------------------------------------------------------------


async def notes_for(db: AsyncSession, production_ids: list[int]) -> dict[int, DebitNoteRead]:
    if not production_ids:
        return {}
    creator = select(User.full_name).where(User.id == DebitNote.created_by_id).scalar_subquery()
    rows = await db.execute(
        select(DebitNote, Party.name, creator)
        .outerjoin(Party, Party.id == DebitNote.supplier_id)
        .where(DebitNote.production_id.in_(production_ids))
    )
    return {
        n.production_id: DebitNoteRead(
            id=n.id,
            note_no=n.note_no,
            supplier_id=n.supplier_id,
            supplier_name=supplier,
            qty_kg=n.qty_kg,
            amount=n.amount,
            reason=n.reason,
            created_by_name=by,
            created_at=n.created_at,
        )
        for n, supplier, by in rows
    }


async def has_note(db: AsyncSession, production_id: int) -> bool:
    found = await db.scalar(select(DebitNote.id).where(DebitNote.production_id == production_id))
    return found is not None


async def add_note(
    db: AsyncSession, ctx: CompanyContext, production_id: int, data: DebitNoteInput
) -> Production:
    _require(ctx)
    run = await db.get(Production, production_id)
    if not run or run.company_id != ctx.company.id or run.deleted_at is not None:
        raise NotFoundError("Production entry not found")
    if run.status == EntryStatus.REJECTED:
        raise ConflictError("This run was rejected", code="invalid_status")
    if not needs_debit_note(run.wastage_pct):
        raise ConflictError(
            f"This run's wastage is within {HARD_LIMIT}%; no debit note is needed",
            code="debit_note_not_needed",
        )
    if data.supplier_id:
        await party_service.require_party(
            db, ctx.company.id, data.supplier_id, PartyKind.SUPPLIER, allow_inactive=True
        )
    db.add(
        DebitNote(
            company_id=ctx.company.id,
            production_id=run.id,
            created_by_id=ctx.user.id,
            **data.model_dump(),
        )
    )
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "This run already has a debit note, or the note number is used",
            code="duplicate_debit_note",
        ) from exc
    from app.services import workflow_service  # local: workflow_service imports this module

    workflow_service.add_event(
        db,
        entry_type=EntryType.PRODUCTION,
        entry=run,
        actor=ctx.user,
        action="debit_note",
        comment=f"Debit note {data.note_no}: {data.reason}",
    )
    await db.commit()
    return run


async def pending_notes(db: AsyncSession, company_id: int) -> list[PendingDebitNote]:
    noted = select(DebitNote.production_id).where(DebitNote.company_id == company_id)
    rows = await db.scalars(
        select(Production)
        .where(
            *_live_production(company_id),
            Production.wastage_pct > HARD_LIMIT,
            Production.id.not_in(noted),
        )
        .order_by(Production.entry_date.desc(), Production.id.desc())
        .limit(200)
    )
    return [
        PendingDebitNote(
            production_id=r.id,
            ref_no=r.ref_no,
            entry_date=r.entry_date,
            material=r.material,
            processed_kg=r.input_kg - r.returned_kg,
            wastage_kg=r.wastage_kg,
            wastage_pct=r.wastage_pct,
            status=r.status,
        )
        for r in rows
    ]


async def count_pending_notes(db: AsyncSession, company_id: int) -> int:
    noted = select(DebitNote.production_id).where(DebitNote.company_id == company_id)
    return (
        await db.scalar(
            select(func.count()).where(
                *_live_production(company_id),
                Production.wastage_pct > HARD_LIMIT,
                Production.id.not_in(noted),
            )
        )
        or 0
    )


# ---------------------------------------------------------------------------
# Stock checks
# ---------------------------------------------------------------------------


async def record_check(db: AsyncSession, ctx: CompanyContext, data: StockCheckInput) -> StockCheck:
    """Compare the Manager's physical count with the book stock and record the differences."""
    _require(ctx)
    if data.counted_on > today():
        raise InvalidError("The count date cannot be in the future")
    await stock_service.lock_company(db, ctx.company.id)
    stock = await stock_service.company_stock(db, ctx.company.id)
    book = {
        (section, line.item): Decimal(str(line.provisional.balance))
        for section in ("raw", "output", "resale")
        for line in getattr(stock, section)
    }
    check = StockCheck(
        company_id=ctx.company.id,
        counted_on=data.counted_on,
        note=data.note,
        counted_by_id=ctx.user.id,
    )
    for line in data.lines:
        key = (line.section, line.item)
        if key not in book:
            raise InvalidError(f"{line.item} is not kept in this stock", code="unknown_item")
        check.lines.append(
            StockCheckLine(
                company_id=ctx.company.id,
                grade=_GRADE_OF_SECTION[line.section],
                section=line.section,
                item=line.item,
                book_qty=book[key],
                counted_qty=line.counted_qty,
                difference=book[key] - line.counted_qty,
            )
        )
    db.add(check)
    await stock_service.assert_stock_not_negative(db, ctx.company.id)
    await db.commit()
    return check


async def list_checks(db: AsyncSession, company_id: int, limit: int = 24) -> list[StockCheckRead]:
    rows = await db.execute(
        select(StockCheck, User.full_name)
        .outerjoin(User, User.id == StockCheck.counted_by_id)
        .where(StockCheck.company_id == company_id)
        .order_by(StockCheck.counted_on.desc(), StockCheck.id.desc())
        .limit(limit)
    )
    return [
        StockCheckRead(
            id=c.id,
            counted_on=c.counted_on,
            note=c.note,
            counted_by_name=name,
            created_at=c.created_at,
            lines=[
                CountLineRead(
                    section=line.section,
                    grade=line.grade,
                    item=line.item,
                    unit=unit_of(line.item),
                    book_qty=line.book_qty,
                    counted_qty=line.counted_qty,
                    difference=line.difference,
                )
                for line in c.lines
            ],
        )
        for c, name in rows
    ]
