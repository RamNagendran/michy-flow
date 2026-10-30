"""Debit notes against suppliers (see models/debit_note.py).

- Raised on a purchase by its in-charge or the Manager: any issue the team should know about.
  It is only a flag: it changes no stock and no amounts.
- Open until it is marked settled on a later purchase from the same supplier, when that
  purchase is entered or later from its drawer.
- If the bill it was settled on is rejected, or moved to another supplier, it opens again.
  A note on a rejected purchase is no longer open.
Every step is written to the purchases' history and to the audit log.
"""

from collections.abc import Iterable

from fastapi import Request
from sqlalchemy import Select, and_, case, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.permissions import CompanyPermission as P
from app.core.clock import now
from app.core.errors import ConflictError, ForbiddenError, InvalidError
from app.models import DebitNote, Party, Purchase, User
from app.models.catalog import LITRE, unit_of
from app.models.enums import EntryStatus, EntryType
from app.schemas.entries import DebitNoteInput, DebitNoteRead
from app.services import workflow_service
from app.services.access_service import CompanyContext

# Raised on a purchase that is still live.
_source = aliased(Purchase)
_adjusted = aliased(Purchase)


def _live(model: type[Purchase]) -> tuple:
    return (model.deleted_at.is_(None), model.status != EntryStatus.REJECTED)


def can_raise(ctx: CompanyContext, purchase: Purchase) -> bool:
    """The purchase in-charge (on purchases they can see) or the Manager; never on a rejected
    purchase."""
    return purchase.status != EntryStatus.REJECTED and (
        ctx.can(P.ENTER_PURCHASE) or ctx.can(P.APPROVE_ENTRY)
    )


def can_adjust(ctx: CompanyContext, purchase: Purchase) -> bool:
    """Marking a note as settled on this bill: by the same people, until Finance's final
    approval."""
    return purchase.status not in (EntryStatus.REJECTED, EntryStatus.VERIFIED) and (
        ctx.can(P.ENTER_PURCHASE) or ctx.can(P.APPROVE_ENTRY)
    )


def can_list(ctx: CompanyContext) -> bool:
    return ctx.can(P.VIEW_ALL_ENTRIES) or ctx.can(P.ENTER_PURCHASE)


def _open() -> tuple:
    return (DebitNote.adjusted_purchase_id.is_(None),)


def _query() -> Select:
    creator = aliased(User)
    adjuster = aliased(User)
    return (
        select(
            DebitNote,
            Party.name,
            _source.ref_no,
            _source.entry_date,
            _source.invoice_no,
            _adjusted.ref_no,
            creator.full_name,
            adjuster.full_name,
        )
        .join(_source, _source.id == DebitNote.purchase_id)
        .outerjoin(_adjusted, _adjusted.id == DebitNote.adjusted_purchase_id)
        .outerjoin(Party, Party.id == DebitNote.supplier_id)
        .outerjoin(creator, creator.id == DebitNote.created_by_id)
        .outerjoin(adjuster, adjuster.id == DebitNote.adjusted_by_id)
        .where(*_live(_source))
        .order_by(DebitNote.created_at, DebitNote.id)
    )


def _read(row) -> DebitNoteRead:  # noqa: ANN001
    n, supplier, ref_no, entry_date, invoice_no, adjusted_ref, by, adjusted_by = row
    return DebitNoteRead(
        id=n.id,
        note_no=n.note_no,
        supplier_id=n.supplier_id,
        supplier_name=supplier,
        purchase_id=n.purchase_id,
        purchase_ref_no=ref_no,
        purchase_date=entry_date,
        invoice_no=invoice_no,
        item=n.item,
        qty=n.qty_kg,
        unit=unit_of(n.item) if n.item else "kg",
        amount=n.amount,
        reason=n.reason,
        created_by_name=by,
        created_at=n.created_at,
        adjusted_purchase_id=n.adjusted_purchase_id,
        adjusted_ref_no=adjusted_ref,
        adjusted_by_name=adjusted_by,
        adjusted_at=n.adjusted_at,
        is_open=n.adjusted_purchase_id is None,
    )


async def list_notes(
    db: AsyncSession, company_id: int, supplier_id: int | None = None, only_open: bool = False
) -> list[DebitNoteRead]:
    q = _query().where(DebitNote.company_id == company_id)
    if supplier_id:
        q = q.where(DebitNote.supplier_id == supplier_id)
    if only_open:
        q = q.where(*_open())
    return [_read(r) for r in await db.execute(q.limit(500))]


async def for_purchase(db: AsyncSession, purchase: Purchase) -> dict[str, list[DebitNoteRead]]:
    """What a purchase's drawer shows: notes raised on it, notes it took off, and the
    supplier's other open notes."""
    rows = [
        _read(r)
        for r in await db.execute(
            _query().where(
                DebitNote.company_id == purchase.company_id,
                or_(
                    DebitNote.purchase_id == purchase.id,
                    DebitNote.adjusted_purchase_id == purchase.id,
                    and_(DebitNote.supplier_id == purchase.supplier_id, *_open()),
                ),
            )
        )
    ]
    return {
        "debit_notes": [n for n in rows if n.purchase_id == purchase.id],
        "adjusted_debit_notes": [n for n in rows if n.adjusted_purchase_id == purchase.id],
        "supplier_open_debit_notes": [
            n for n in rows if n.is_open and n.purchase_id != purchase.id
        ],
    }


def open_count_column(purchase: type[Purchase]):  # noqa: ANN201
    """Per purchase row still being approved: the supplier's open notes raised on other
    purchases. Final and rejected bills show none, so old bills are not flagged."""
    count = (
        select(func.count(DebitNote.id))
        .join(_source, _source.id == DebitNote.purchase_id)
        .where(
            DebitNote.company_id == purchase.company_id,
            DebitNote.supplier_id == purchase.supplier_id,
            DebitNote.purchase_id != purchase.id,
            *_open(),
            *_live(_source),
        )
        .correlate(purchase)
        .scalar_subquery()
    )
    done = purchase.status.in_([EntryStatus.VERIFIED, EntryStatus.REJECTED])
    return case((done, 0), else_=count)


def open_count_query(company_id: int) -> Select:
    """How many notes are open in the company (raised on live purchases)."""
    return (
        select(func.count(DebitNote.id))
        .join(_source, _source.id == DebitNote.purchase_id)
        .where(DebitNote.company_id == company_id, *_open(), *_live(_source))
    )


async def count_open(db: AsyncSession, company_id: int) -> int:
    return await db.scalar(open_count_query(company_id)) or 0


async def _next_no(db: AsyncSession, ctx: CompanyContext) -> str:
    from app.services.entry_service import next_ref  # local: entry_service imports this module

    return await next_ref(db, ctx, "DN")


async def raise_note(
    db: AsyncSession,
    ctx: CompanyContext,
    purchase: Purchase,
    data: DebitNoteInput,
    request: Request | None = None,
) -> DebitNote:
    if not can_raise(ctx, purchase):
        raise ForbiddenError("A debit note cannot be added to this purchase")
    if data.qty is not None and data.qty > purchase.qty:
        raise InvalidError(
            f"The quantity cannot be more than the {purchase.qty:,.3f} bought",
            code="debit_note_too_much",
        )
    note = DebitNote(
        company_id=ctx.company.id,
        note_no=data.note_no or await _next_no(db, ctx),
        purchase_id=purchase.id,
        supplier_id=purchase.supplier_id,
        item=purchase.material,
        qty_kg=data.qty,
        amount=data.amount,
        reason=data.reason,
        created_by_id=ctx.user.id,
    )
    db.add(note)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "This debit note number is already used", code="duplicate_debit_note"
        ) from exc
    unit = unit_of(purchase.material)
    extra = []
    if data.qty is not None:
        extra.append(f"{data.qty.normalize():,f} {'litres' if unit == LITRE else 'kg'}")
    if data.amount is not None:
        extra.append(f"₹{data.amount:,.2f}")
    workflow_service.add_event(
        db,
        entry_type=EntryType.PURCHASE,
        entry=purchase,
        actor=ctx.user,
        action="debit_note",
        request=request,
        comment=f"Debit note {note.note_no}"
        + (f" ({', '.join(extra)})" if extra else "")
        + f": {data.reason}",
    )
    await db.commit()
    return note


async def adjust(
    db: AsyncSession,
    ctx: CompanyContext,
    purchase: Purchase,
    note_ids: Iterable[int],
    *,
    commit: bool = True,
    request: Request | None = None,
) -> None:
    """Mark these open notes of the purchase's supplier as settled on this bill."""
    ids = list(dict.fromkeys(note_ids))
    if not ids:
        return
    if not can_adjust(ctx, purchase):
        raise ForbiddenError("Debit notes cannot be reduced on this purchase now")
    notes = list(
        await db.scalars(
            select(DebitNote)
            .join(_source, _source.id == DebitNote.purchase_id)
            .where(
                DebitNote.id.in_(ids),
                DebitNote.company_id == purchase.company_id,
                DebitNote.supplier_id == purchase.supplier_id,
                DebitNote.purchase_id != purchase.id,
                *_open(),
                *_live(_source),
            )
            .with_for_update(of=DebitNote)
        )
    )
    if len(notes) != len(ids):
        raise InvalidError(
            "A debit note is not open for this supplier any more. Please refresh and choose again",
            code="debit_note_not_open",
        )
    sources = {
        p.id: p
        for p in await db.scalars(
            select(Purchase).where(Purchase.id.in_({n.purchase_id for n in notes}))
        )
    }
    for n in notes:
        n.adjusted_purchase_id, n.adjusted_by_id, n.adjusted_at = purchase.id, ctx.user.id, now()
        what = f"Debit note {n.note_no}"
        workflow_service.add_event(
            db,
            entry_type=EntryType.PURCHASE,
            entry=purchase,
            actor=ctx.user,
            action="debit_note_adjusted",
            request=request,
            comment=f"{what} from {sources[n.purchase_id].ref_no} is settled on this bill",
        )
        workflow_service.add_event(
            db,
            entry_type=EntryType.PURCHASE,
            entry=sources[n.purchase_id],
            actor=ctx.user,
            action="debit_note_adjusted",
            request=request,
            comment=f"{what} is settled on {purchase.ref_no} (bill {purchase.invoice_no})",
        )
    if commit:
        await db.commit()


async def reopen_for(db: AsyncSession, ctx: CompanyContext, purchase: Purchase, why: str) -> None:
    """The bill these notes were settled on no longer counts (rejected, or now another
    supplier's): they are open again. Called inside the caller's transaction."""
    notes = list(
        await db.scalars(select(DebitNote).where(DebitNote.adjusted_purchase_id == purchase.id))
    )
    if not notes:
        return
    await db.execute(
        update(DebitNote)
        .where(DebitNote.id.in_([n.id for n in notes]))
        .values(adjusted_purchase_id=None, adjusted_by_id=None, adjusted_at=None)
    )
    workflow_service.add_event(
        db,
        entry_type=EntryType.PURCHASE,
        entry=purchase,
        actor=ctx.user,
        action="debit_note_reopened",
        comment=f"Debit note {', '.join(n.note_no for n in notes)} is open again: {why}",
    )


async def supplier_changed(db: AsyncSession, ctx: CompanyContext, purchase: Purchase) -> None:
    """After a Super Admin edit moves a purchase to another supplier: its own notes follow it,
    and notes settled on it (the old supplier's) open again."""
    await db.execute(
        update(DebitNote)
        .where(DebitNote.purchase_id == purchase.id)
        .values(supplier_id=purchase.supplier_id)
    )
    await reopen_for(db, ctx, purchase, "the bill is now from another supplier")
