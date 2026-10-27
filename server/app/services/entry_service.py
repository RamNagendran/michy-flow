"""Create, edit and delete purchases, sales and production entries.

Every write in a company runs under that company's stock lock and ends with a stock check,
so entries can never take stock below zero, however many people save at once.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.auth.permissions import visible_entry_types
from app.core.clock import now
from app.core.errors import ConflictError, ForbiddenError, InvalidError, NotFoundError
from app.models import Production, ProductionOutput, Purchase, Sale, grades
from app.models.catalog import process_of, to_kg
from app.models.enums import EntrySource, EntryType, PartyKind
from app.schemas.entries import (
    ProductionInput,
    ProductionUpdate,
    PurchaseInput,
    PurchaseUpdate,
    SaleInput,
    SaleUpdate,
)
from app.services import (
    crew_service,
    document_service,
    party_service,
    stock_service,
    wastage_service,
    workflow_service,
)
from app.services.access_service import CompanyContext
from app.services.workflow_service import Entry


@dataclass(frozen=True, slots=True)
class Kind:
    model: type[Purchase] | type[Sale] | type[Production]
    prefix: str
    enter: P
    duplicate_message: str


KINDS: dict[EntryType, Kind] = {
    EntryType.PURCHASE: Kind(
        Purchase, "PUR", P.ENTER_PURCHASE, "This bill from this supplier is already entered"
    ),
    EntryType.SALE: Kind(Sale, "SAL", P.ENTER_SALES, "This invoice number is already used"),
    EntryType.PRODUCTION: Kind(Production, "PRD", P.ENTER_PRODUCTION, "Duplicate entry"),
}

_CENT = Decimal("0.01")
_PCT = Decimal("0.001")
_GRAM = Decimal("0.001")


async def next_ref(db: AsyncSession, ctx: CompanyContext, prefix: str) -> str:
    """PUR-MR-00042. One atomic upsert, so two saves never get the same number."""
    value = await db.scalar(
        text(
            "INSERT INTO entry_counters (company_id, prefix, value) VALUES (:c, :p, 1) "
            "ON CONFLICT (company_id, prefix) DO UPDATE SET value = entry_counters.value + 1 "
            "RETURNING value"
        ),
        {"c": ctx.company.id, "p": prefix},
    )
    return f"{prefix}-{ctx.company.code}-{value:05d}"


async def get_entry(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry_id: int
) -> Entry:
    """An entry the caller may see. Operators only see their own, of the kinds they may enter;
    anything else is 'not found'."""
    entry = await db.get(KINDS[entry_type].model, entry_id)
    if (
        not entry
        or entry.company_id != ctx.company.id
        or entry.deleted_at is not None
        or (not ctx.can(P.VIEW_ALL_ENTRIES) and entry.created_by_id != ctx.user.id)
        or entry_type not in visible_entry_types(ctx.permissions)
    ):
        raise NotFoundError("Entry not found")
    return entry


# ---------------------------------------------------------------------------
# Fields per kind
# ---------------------------------------------------------------------------


def _money(qty: Decimal, rate: Decimal) -> Decimal:
    return (qty * rate).quantize(_CENT, rounding=ROUND_HALF_UP)


async def _fields(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, data: Any, current: Entry | None
) -> dict[str, Any]:
    """Column values for an entry, with everything derived (amounts, wastage) worked out here."""
    common = {"entry_date": data.entry_date, "notes": data.notes}
    process = process_of(ctx.company)
    if entry_type == EntryType.PRODUCTION:
        grades.check_production(process, data.material, list(_outputs(data)))
        keep = frozenset(current.crew_ids) if isinstance(current, Production) else frozenset()
        await crew_service.require_crew(db, ctx.company.id, data.crew_ids, keep)
        # In-charges do not know exactly how much went in, only what came out. Stock goes down
        # by output + the wastage rate (to the nearest kg), and wastage is that rate of the
        # output. If they give a bigger total, it is used only to work out the wastage: it is
        # not saved and does not change the stock or the outputs. Anything put back into stock
        # is added back: stock goes down by the calculated weight minus the return.
        density = ctx.company.oil_density
        rate = wastage_service.HARD_LIMIT
        output = sum((_weight(p, q, density) for p, q in _outputs(data).items()), Decimal(0))
        calculated = calculated_input(output)
        basis = data.wastage_on_kg or output
        if data.wastage_on_kg is not None and data.wastage_on_kg < calculated:
            raise InvalidError(
                f"The total cannot be less than {calculated:,.0f} kg "
                f"(products {output:,.0f} kg + {rate.normalize():f}% wastage)",
                code="input_below_calculated",
            )
        if data.returned_kg >= calculated:
            raise InvalidError(
                f"Returned to stock must be less than {calculated:,.0f} kg",
                code="returned_too_much",
            )
        wastage = (basis * rate / 100).quantize(_GRAM, rounding=ROUND_HALF_UP)
        return {
            **common,
            "material": data.material,
            "input_kg": calculated,
            "returned_kg": data.returned_kg,
            "shift": data.shift,
            "crew_ids": data.crew_ids,
            "running_hours": data.running_hours,
            "output_kg": output,
            "calculated_input_kg": calculated,
            "wastage_kg": wastage,
            "wastage_pct": rate.quantize(_PCT, rounding=ROUND_HALF_UP),
        }
    is_purchase = entry_type == EntryType.PURCHASE
    party_field = "supplier_id" if is_purchase else "buyer_id"
    party_id = getattr(data, party_field)
    # Keeping the same, since-deactivated party on an edit is fine; choosing one is not.
    unchanged = current is not None and getattr(current, party_field) == party_id
    await party_service.require_party(
        db,
        ctx.company.id,
        party_id,
        PartyKind.SUPPLIER if is_purchase else PartyKind.BUYER,
        allow_inactive=unchanged,
    )
    item = data.material if is_purchase else data.product
    grades.check_item(entry_type, data.grade, item, process)
    return {
        **common,
        party_field: party_id,
        "grade": data.grade,
        ("material" if is_purchase else "product"): item,
        "qty": data.qty,
        "rate": data.rate,
        "amount": _money(data.qty, data.rate),
        "invoice_no": data.invoice_no,
    }


def calculated_input(output_kg: Decimal) -> Decimal:
    """What must have gone in for this output: output + the wastage rate, to the nearest kg."""
    total = output_kg * (1 + wastage_service.HARD_LIMIT / 100)
    return total.quantize(Decimal(1), rounding=ROUND_HALF_UP)


def _needs_note(fields: dict[str, Any]) -> bool:
    """A production run over the hard wastage limit, which must wait for a debit note."""
    return "wastage_pct" in fields and wastage_service.needs_debit_note(fields["wastage_pct"])


def _outputs(data: ProductionInput) -> dict[str, Decimal]:
    """{product: qty in its unit}, leaving out zeros."""
    return {o.product: o.qty for o in data.outputs if o.qty > 0}


def _output_row(product: str, qty: Decimal, density: Decimal) -> ProductionOutput:
    return ProductionOutput(product=product, qty=qty, qty_kg=_weight(product, qty, density))


def _weight(product: str, qty: Decimal, density: Decimal) -> Decimal:
    return to_kg(product, qty, density).quantize(_GRAM, rounding=ROUND_HALF_UP)


def _sync_outputs(entry: Production, wanted: dict[str, Decimal], density: Decimal) -> None:
    """Make the output rows match `wanted`, changing only what differs."""
    current = {o.product: o for o in entry.outputs}
    for product in current.keys() - wanted.keys():
        entry.outputs.remove(current[product])
    for product, qty in wanted.items():
        if product in current:
            current[product].qty = qty
            current[product].qty_kg = _weight(product, qty, density)
        else:
            entry.outputs.append(_output_row(product, qty, density))


async def _flush(db: AsyncSession, kind: Kind) -> None:
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(kind.duplicate_message, code="duplicate_entry") from exc


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


async def create(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    data: PurchaseInput | SaleInput | ProductionInput,
) -> Entry:
    kind = KINDS[entry_type]
    if not ctx.can(kind.enter):
        raise ForbiddenError("Not allowed")
    await stock_service.lock_company(db, ctx.company.id)
    fields = await _fields(db, ctx, entry_type, data, None)
    entry = kind.model(
        company_id=ctx.company.id,
        ref_no=await next_ref(db, ctx, kind.prefix),
        status=workflow_service.initial_status(ctx, _needs_note(fields)),
        created_by_id=ctx.user.id,
        **fields,
    )
    if isinstance(entry, Production):
        density = ctx.company.oil_density
        entry.outputs = [_output_row(p, q, density) for p, q in _outputs(data).items()]
    elif isinstance(data, PurchaseInput | SaleInput):
        # Made from an uploaded bill means "read from the bill"; otherwise as sent.
        entry.source = EntrySource.AI if data.document_id else data.source
    if entry.status == "approved":
        workflow_service.stamp_approval(entry, ctx.user)
    db.add(entry)
    await _flush(db, kind)
    if isinstance(data, PurchaseInput | SaleInput) and data.document_id:
        await document_service.attach(db, ctx, entry_type.value, data.document_id, entry)
    workflow_service.add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="created"
    )
    await stock_service.assert_stock_not_negative(db, ctx.company.id)
    await db.commit()
    return entry


def _as_json(value: Any) -> Any:
    return (
        str(value)
        if isinstance(value, Decimal)
        else value.isoformat()
        if hasattr(value, "isoformat")
        else value
    )


async def update(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    entry_id: int,
    data: PurchaseUpdate | SaleUpdate | ProductionUpdate,
) -> Entry:
    kind = KINDS[entry_type]
    entry = await get_entry(db, ctx, entry_type, entry_id)
    if not workflow_service.can_edit(ctx, entry):
        raise ForbiddenError("This entry can no longer be edited")
    await stock_service.lock_company(db, ctx.company.id)
    fields = await _fields(db, ctx, entry_type, data, entry)
    changes = {
        k: [_as_json(getattr(entry, k)), _as_json(v)]
        for k, v in fields.items()
        if getattr(entry, k) != v
    }
    if isinstance(entry, Production):
        before = {o.product: o.qty for o in entry.outputs}
        after = _outputs(data)
        if before != after:
            changes["outputs"] = [
                {k: str(v) for k, v in before.items()},
                {k: str(v) for k, v in after.items()},
            ]
            _sync_outputs(entry, after, ctx.company.oil_density)
    if not changes:
        return entry
    for key, value in fields.items():
        setattr(entry, key, value)
    workflow_service.reset_after_edit(ctx, entry, _needs_note(fields))
    await _flush(db, kind)
    workflow_service.add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action="edited",
        comment=data.comment,
        changes=changes,
    )
    await stock_service.assert_stock_not_negative(db, ctx.company.id)
    await db.commit()
    return entry


async def delete(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry_id: int, reason: str
) -> Entry:
    """Soft delete: the row stays for the audit trail but stops counting anywhere."""
    entry = await get_entry(db, ctx, entry_type, entry_id)
    if not workflow_service.can_delete(ctx, entry):
        raise ForbiddenError("This entry cannot be deleted")
    await stock_service.lock_company(db, ctx.company.id)
    entry.deleted_at = now()
    workflow_service.add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="deleted", comment=reason
    )
    await stock_service.assert_stock_not_negative(db, ctx.company.id)
    await db.commit()
    return entry
