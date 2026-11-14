"""Create and edit purchases, sales and production entries.

Every write in a company runs under that company's stock lock and ends with a stock check,
so entries can never take stock below zero, however many people save at once.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.auth.permissions import visible_entry_types
from app.core.errors import ConflictError, ForbiddenError, InvalidError, NotFoundError
from app.models import Production, ProductionMaterial, ProductionOutput, Purchase, Sale, grades
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
    debit_note_service,
    document_service,
    operator_service,
    party_service,
    stock_service,
    wastage_month_service,
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
        for material in _material_names(data):
            grades.check_production(process, material, list(_outputs(data)))
        keep = frozenset(current.crew_ids) if isinstance(current, Production) else frozenset()
        await operator_service.require_crew(db, ctx.company.id, data.crew_ids, keep)
        # In-charges do not know exactly how much went in, only what came out, plus any
        # wastage they saw. Stock goes down by output + wastage; the wastage is not an output.
        # Anything put back into stock is added back: stock goes down by that minus the return.
        factors = ctx.company.kg_per_litre
        output = sum((_weight(p, q, factors) for p, q in _outputs(data).items()), Decimal(0))
        wastage = data.wastage_kg or Decimal(0)
        calculated = output + wastage
        if data.returned_kg >= calculated:
            raise InvalidError(
                f"Returned to stock must be less than {calculated:,.0f} kg",
                code="returned_too_much",
            )
        lines = _materials(data, calculated - data.returned_kg)
        return {
            **common,
            # The biggest share; the first one on a tie.
            "material": max(lines, key=lines.__getitem__),
            "input_kg": calculated,
            "returned_kg": data.returned_kg,
            "shift": data.shift,
            "crew_ids": data.crew_ids,
            "running_hours": data.running_hours,
            "output_kg": output,
            "calculated_input_kg": calculated,
            "wastage_kg": wastage,
            "wastage_type": data.wastage_type,
            "wastage_pct": (wastage / calculated * 100).quantize(_PCT, rounding=ROUND_HALF_UP),
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
        **({"vehicle_nos": data.vehicle_nos} if is_purchase else {}),
    }


def _outputs(data: ProductionInput) -> dict[str, Decimal]:
    """{product: qty in its unit}, leaving out zeros."""
    return {o.product: o.qty for o in data.outputs if o.qty > 0}


def _material_names(data: ProductionInput) -> list[str]:
    return [m.material for m in data.materials] or [data.material]  # type: ignore[list-item]


def _materials(data: ProductionInput, stock_out: Decimal) -> dict[str, Decimal]:
    """{raw material: kg stock goes down by}. The lines are typed in whole kg, so they must add
    up to the stock out to within a kg; that part of a kg goes to the biggest line, so they add
    up exactly."""
    if not data.materials:
        return {data.material: stock_out}  # type: ignore[dict-item]
    lines = {m.material: m.kg for m in data.materials}
    gap = stock_out - sum(lines.values(), Decimal(0))
    if abs(gap) >= 1:
        raise InvalidError(
            f"The raw materials must add up to {stock_out:,.0f} kg", code="materials_mismatch"
        )
    biggest = max(lines, key=lines.__getitem__)
    lines[biggest] += gap
    return lines


def _sync_materials(entry: Production, wanted: dict[str, Decimal]) -> None:
    """Make the raw material rows match `wanted`, changing only what differs."""
    current = {m.material: m for m in entry.materials}
    for material in current.keys() - wanted.keys():
        entry.materials.remove(current[material])
    for material, kg in wanted.items():
        if material in current:
            current[material].qty_kg = kg
        else:
            entry.materials.append(ProductionMaterial(material=material, qty_kg=kg))


def _output_row(product: str, qty: Decimal, factors: dict[str, str]) -> ProductionOutput:
    return ProductionOutput(product=product, qty=qty, qty_kg=_weight(product, qty, factors))


def _weight(product: str, qty: Decimal, factors: dict[str, str]) -> Decimal:
    """`factors`: the company's own kg per litre (companies.kg_per_litre)."""
    return to_kg(product, qty, factors).quantize(_GRAM, rounding=ROUND_HALF_UP)


def _sync_outputs(entry: Production, wanted: dict[str, Decimal], factors: dict[str, str]) -> None:
    """Make the output rows match `wanted`, changing only what differs."""
    current = {o.product: o for o in entry.outputs}
    for product in current.keys() - wanted.keys():
        entry.outputs.remove(current[product])
    for product, qty in wanted.items():
        if product in current:
            current[product].qty = qty
            current[product].qty_kg = _weight(product, qty, factors)
        else:
            entry.outputs.append(_output_row(product, qty, factors))


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
    request: Request | None = None,
) -> Entry:
    kind = KINDS[entry_type]
    if not ctx.can(kind.enter):
        raise ForbiddenError("Not allowed")
    await stock_service.lock_company(db, ctx.company.id)
    if entry_type == EntryType.PRODUCTION:
        await wastage_month_service.assert_month_open(db, ctx.company.id, data.entry_date)
    fields = await _fields(db, ctx, entry_type, data, None)
    entry = kind.model(
        company_id=ctx.company.id,
        ref_no=await next_ref(db, ctx, kind.prefix),
        status=workflow_service.initial_status(),
        created_by_id=ctx.user.id,
        **fields,
    )
    if isinstance(entry, Production):
        factors = ctx.company.kg_per_litre
        entry.outputs = [_output_row(p, q, factors) for p, q in _outputs(data).items()]
        stock_out = entry.input_kg - entry.returned_kg
        entry.materials = [
            ProductionMaterial(material=m, qty_kg=kg)
            for m, kg in _materials(data, stock_out).items()
        ]
    elif isinstance(data, PurchaseInput | SaleInput):
        # Made from an uploaded bill means "read from the bill"; otherwise as sent.
        entry.source = EntrySource.AI if data.document_id else data.source
    db.add(entry)
    await _flush(db, kind)
    workflow_service.add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="created", request=request
    )
    if isinstance(data, PurchaseInput | SaleInput) and data.document_id:
        corrected = await document_service.attach(
            db,
            ctx,
            entry_type.value,
            data.document_id,
            entry,
            confirmed=(data.bill_company_gstin, data.bill_party_gstin),
        )
        for side, change in corrected.items():
            who = (
                "our"
                if side == "company"
                else ("supplier's" if entry_type == EntryType.PURCHASE else "buyer's")
            )
            workflow_service.add_event(
                db,
                entry_type=entry_type,
                entry=entry,
                actor=ctx.user,
                action="gstin_corrected",
                request=request,
                comment=f"Bill was read as {change['read'] or 'no number'} for the {who} GST "
                f"number; corrected to {change['entered']}",
            )
    if isinstance(data, PurchaseInput) and data.debit_note_ids:
        await debit_note_service.adjust(
            db, ctx, entry, data.debit_note_ids, commit=False, request=request
        )
    # It does not count in stock until the Manager approves, but it must fit in stock now.
    await stock_service.assert_stock_not_negative(db, ctx.company.id, (kind.model, entry.id))
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
    request: Request | None = None,
) -> Entry:
    kind = KINDS[entry_type]
    entry = await get_entry(db, ctx, entry_type, entry_id)
    if not workflow_service.can_edit(ctx, entry):
        raise ForbiddenError("Only the Super Admin can edit entries")
    await stock_service.lock_company(db, ctx.company.id)
    if isinstance(entry, Production):
        # Neither the month it was in nor the month it moves to may be approved.
        await wastage_month_service.assert_month_open(
            db, ctx.company.id, entry.entry_date, data.entry_date
        )
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
            _sync_outputs(entry, after, ctx.company.kg_per_litre)
        before = {m.material: m.qty_kg for m in entry.materials}
        after = _materials(data, fields["input_kg"] - fields["returned_kg"])
        if before != after:
            changes["materials"] = [
                {k: str(v) for k, v in before.items()},
                {k: str(v) for k, v in after.items()},
            ]
            _sync_materials(entry, after)
    if not changes:
        return entry
    for key, value in fields.items():
        setattr(entry, key, value)
    workflow_service.reset_after_edit(entry)
    await _flush(db, kind)
    if isinstance(entry, Purchase) and "supplier_id" in changes:
        await debit_note_service.supplier_changed(db, ctx, entry)
    workflow_service.add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action="edited",
        comment=data.comment,
        changes=changes,
        request=request,
    )
    also = None if entry.approved_at else (kind.model, entry.id)
    await stock_service.assert_stock_not_negative(db, ctx.company.id, also)
    await db.commit()
    return entry
