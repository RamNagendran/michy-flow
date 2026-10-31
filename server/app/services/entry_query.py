"""Reading entries: one list across purchases, sales and production, and one entry in detail."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Integer,
    Numeric,
    String,
    and_,
    cast,
    false,
    func,
    literal,
    null,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.permissions import CompanyPermission as P
from app.auth.permissions import visible_entry_types
from app.core.config import settings
from app.models import Company, Party, Production, Purchase, Sale, User
from app.models.catalog import unit_of
from app.models.enums import EntrySource, EntryStatus, EntryType, Grade
from app.schemas.common import Paginated
from app.schemas.entries import (
    CrewMember,
    EntryDetail,
    EntryRow,
    EventRead,
    OutputRead,
    StatusCount,
)
from app.services import crew_service, debit_note_service, workflow_service
from app.services.access_service import CompanyContext, accessible_companies, permissions_in
from app.services.workflow_service import Entry


@dataclass(frozen=True, slots=True)
class EntryFilters:
    types: set[EntryType]
    statuses: set[EntryStatus]
    grades: set[Grade]
    company_ids: set[int]
    date_from: date | None
    date_to: date | None
    item: str | None
    q: str | None
    escalated: bool | None = None
    escalated_to: str | None = None
    party_id: int | None = None


def _rows_purchases():  # noqa: ANN202
    return select(
        literal(EntryType.PURCHASE.value, String).label("type"),
        Purchase.id, Purchase.company_id, Purchase.ref_no, Purchase.entry_date, Purchase.status,
        Purchase.grade, Party.name.label("party_name"), Purchase.material.label("item"),
        Purchase.qty.label("qty"), Purchase.rate, Purchase.amount, Purchase.invoice_no,
        cast(null(), Numeric).label("output_kg"), cast(null(), Numeric).label("wastage_pct"),
        Purchase.source, Purchase.created_by_id, Purchase.created_at,
        Purchase.escalated_at.is_not(None).label("escalated"),
        Purchase.escalated_to,
        Purchase.supplier_id.label("party_id"),
        debit_note_service.open_count_column(Purchase).label("open_debit_notes"),
    ).join(Party, Party.id == Purchase.supplier_id).where(
        Purchase.deleted_at.is_(None)
    )  # fmt: skip


def _rows_sales():  # noqa: ANN202
    return select(
        literal(EntryType.SALE.value, String).label("type"),
        Sale.id, Sale.company_id, Sale.ref_no, Sale.entry_date, Sale.status,
        Sale.grade, Party.name.label("party_name"), Sale.product.label("item"), Sale.qty,
        Sale.rate, Sale.amount, Sale.invoice_no,
        cast(null(), Numeric).label("output_kg"), cast(null(), Numeric).label("wastage_pct"),
        Sale.source, Sale.created_by_id, Sale.created_at,
        Sale.escalated_at.is_not(None).label("escalated"),
        Sale.escalated_to,
        Sale.buyer_id.label("party_id"),
        literal(0, Integer).label("open_debit_notes"),
    ).join(Party, Party.id == Sale.buyer_id).where(Sale.deleted_at.is_(None))  # fmt: skip


def _rows_production():  # noqa: ANN202
    return select(
        literal(EntryType.PRODUCTION.value, String).label("type"),
        Production.id, Production.company_id, Production.ref_no, Production.entry_date,
        Production.status, literal(Grade.A.value, String).label("grade"),
        cast(null(), String).label("party_name"),
        Production.material.label("item"), Production.input_kg.label("qty"),
        cast(null(), Numeric).label("rate"), cast(null(), Numeric).label("amount"),
        cast(null(), String).label("invoice_no"), Production.output_kg, Production.wastage_pct,
        literal(EntrySource.MANUAL.value, String).label("source"),
        Production.created_by_id, Production.created_at,
        Production.escalated_at.is_not(None).label("escalated"),
        Production.escalated_to,
        cast(null(), Integer).label("party_id"),
        literal(0, Integer).label("open_debit_notes"),
    ).where(Production.deleted_at.is_(None))  # fmt: skip


_BUILDERS = {
    EntryType.PURCHASE: _rows_purchases,
    EntryType.SALE: _rows_sales,
    EntryType.PRODUCTION: _rows_production,
}


async def _visibility(
    db: AsyncSession, user: User, wanted: set[int]
) -> list[tuple[int, bool, frozenset[EntryType]]]:
    """(company_id, own_entries_only, entry_types) for every company the caller may read
    entries in: all entries where they hold VIEW_ALL_ENTRIES; elsewhere (operators) only their
    own, and only of the kinds they may enter."""
    scopes = []
    for company in await accessible_companies(db, user):
        if wanted and company.id not in wanted:
            continue
        perms = permissions_in(user, company)
        types = visible_entry_types(perms)
        if P.VIEW in perms and types:
            scopes.append((company.id, P.VIEW_ALL_ENTRIES not in perms, types))
    return scopes


async def _filtered(db: AsyncSession, user: User, f: EntryFilters):  # noqa: ANN202
    """The union of the asked-for entry types, and the WHERE clauses for visibility and
    filters. Shared by the list and the status summary, so both always agree."""
    types = f.types or set(EntryType)
    rows = union_all(*(_BUILDERS[t]() for t in sorted(types))).subquery("entries")
    scopes = await _visibility(db, user, f.company_ids)
    visible = [
        and_(
            rows.c.company_id == cid,
            rows.c.created_by_id == user.id,
            rows.c.type.in_([t.value for t in kinds]),
        )
        if own_only
        else rows.c.company_id == cid
        for cid, own_only, kinds in scopes
    ]
    where = [or_(*visible) if visible else false()]
    if f.statuses:
        where.append(rows.c.status.in_(f.statuses))
    if f.grades:
        where.append(rows.c.grade.in_(f.grades))
    if f.date_from:
        where.append(rows.c.entry_date >= f.date_from)
    if f.date_to:
        where.append(rows.c.entry_date <= f.date_to)
    if f.item:
        where.append(rows.c.item == f.item)
    if f.escalated is not None:
        where.append(rows.c.escalated.is_(f.escalated))
    if f.escalated_to:
        where.append(rows.c.escalated_to == f.escalated_to)
    if f.party_id:
        where.append(rows.c.party_id == f.party_id)
    if f.q:
        # Escape LIKE wildcards so a search for "50%" means the text "50%".
        needle = "%" + f.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append(
            or_(
                rows.c.ref_no.ilike(needle),
                rows.c.invoice_no.ilike(needle),
                rows.c.party_name.ilike(needle),
            )
        )
    return rows, where


async def status_summary(db: AsyncSession, user: User, f: EntryFilters) -> list[StatusCount]:
    """Count and value of the visible entries in each status (rejected included). Operators
    see only their own, so a purchase in-charge sees how their bills are getting on."""
    rows, where = await _filtered(db, user, f)
    result = await db.execute(
        select(rows.c.status, func.count(), func.coalesce(func.sum(rows.c.amount), 0))
        .where(*where)
        .group_by(rows.c.status)
    )
    found = {status: (n, amount) for status, n, amount in result}
    return [
        StatusCount(status=s, count=found.get(s, (0, 0))[0], amount=found.get(s, (0, 0))[1])
        for s in EntryStatus
    ]


async def list_entries(
    db: AsyncSession, user: User, f: EntryFilters, page: int, page_size: int
) -> Paginated[EntryRow]:
    rows, where = await _filtered(db, user, f)
    creator = aliased(User)
    # The total comes with the page (a window count), saving a second round trip.
    result = await db.execute(
        select(
            rows, Company.code, Company.name, creator.full_name, func.count().over().label("total")
        )
        .join(Company, Company.id == rows.c.company_id)
        .outerjoin(creator, creator.id == rows.c.created_by_id)
        .where(*where)
        .order_by(rows.c.entry_date.desc(), rows.c.created_at.desc(), rows.c.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    found = result.all()
    if found:
        total = found[0].total
    elif page == 1:
        total = 0
    else:  # past the last page: the window had no rows to count
        total = await db.scalar(select(func.count()).select_from(rows).where(*where)) or 0
    items = [
        EntryRow(
            **{k: v for k, v in r._mapping.items() if k in EntryRow.model_fields},
            unit=unit_of(r.item),
            company_code=r.code,
            company_name=r.name,
            created_by_name=r.full_name,
        )
        for r in found
    ]
    return Paginated(items=items, total=total, page=page, page_size=page_size)


async def _names(db: AsyncSession, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all())


async def _production_extras(db: AsyncSession, run: Production) -> dict:
    """The crew and efficiency."""
    crew = await crew_service.names(db, run.crew_ids)
    processed = run.input_kg - run.returned_kg
    hours = run.running_hours
    return {
        "crew": [CrewMember(id=i, name=crew[i]) for i in run.crew_ids if i in crew],
        "running_hours": hours,
        "efficiency_pct": round(hours / Decimal(str(settings.SHIFT_HOURS)) * 100, 1)
        if hours
        else None,
        "kg_per_hour": round(processed / hours, 1) if hours else None,
    }


async def detail(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    entry: Entry,
    *,
    just_loaded: bool = False,
) -> EntryDetail:
    """`just_loaded`: the entry was read in this request and not changed, so it (and a
    production run's outputs) need no reload. After a change, server-set values such as
    updated_at must be read back."""
    if not just_loaded:
        await db.refresh(entry)
    names = await _names(db, {entry.created_by_id, entry.approved_by_id, entry.verified_by_id})
    events = [
        EventRead(
            id=e.id,
            action=e.action,
            comment=e.comment,
            changes=e.changes,
            actor_name=name,
            created_at=e.created_at,
        )
        for e, name in await workflow_service.events_for(db, entry_type, entry.id)
    ]
    base = {
        "type": entry_type,
        "id": entry.id,
        "company_id": entry.company_id,
        "ref_no": entry.ref_no,
        "entry_date": entry.entry_date,
        "status": entry.status,
        "grade": getattr(entry, "grade", Grade.A),
        "escalated_at": entry.escalated_at,
        "escalated_to": entry.escalated_to,
        "notes": entry.notes,
        "created_by_name": names.get(entry.created_by_id),
        "approved_by_name": names.get(entry.approved_by_id),
        "approved_at": entry.approved_at,
        "verified_by_name": names.get(entry.verified_by_id),
        "verified_at": entry.verified_at,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "actions": workflow_service.allowed_actions(ctx, entry),
        "events": events,
    }
    if isinstance(entry, Production):
        if not just_loaded:
            await db.refresh(entry, ["outputs"])
        return EntryDetail(
            **base,
            item=entry.material,
            qty=entry.input_kg,
            unit=unit_of(entry.material),
            shift=entry.shift,
            returned_kg=entry.returned_kg,
            processed_kg=entry.input_kg - entry.returned_kg,
            calculated_input_kg=entry.calculated_input_kg,
            output_kg=entry.output_kg,
            wastage_kg=entry.wastage_kg,
            wastage_pct=entry.wastage_pct,
            **await _production_extras(db, entry),
            outputs=[
                OutputRead(product=o.product, qty=o.qty, unit=unit_of(o.product), qty_kg=o.qty_kg)
                for o in entry.outputs
            ],
        )
    party = await db.get(
        Party, entry.supplier_id if isinstance(entry, Purchase) else entry.buyer_id
    )
    item = entry.material if isinstance(entry, Purchase) else entry.product
    notes: dict = {}
    if isinstance(entry, Purchase):
        notes = await debit_note_service.for_purchase(db, entry)
        if debit_note_service.can_raise(ctx, entry):
            base["actions"].append("debit_note")
        if notes["supplier_open_debit_notes"] and debit_note_service.can_adjust(ctx, entry):
            base["actions"].append("adjust_debit_note")
    return EntryDetail(
        **base,
        **notes,
        party_id=party.id if party else None,
        party_name=party.name if party else None,
        item=item,
        qty=entry.qty,
        unit=unit_of(item),
        rate=entry.rate,
        amount=entry.amount,
        invoice_no=entry.invoice_no,
        vehicle_nos=entry.vehicle_nos if isinstance(entry, Purchase) else [],
        source=entry.source,
        document_id=entry.document_id,
    )
