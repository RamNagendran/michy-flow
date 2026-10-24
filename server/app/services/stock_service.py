"""Stock and period totals, worked out in the database from the entries themselves.

Stock is kept per grade (see models/grades.py): Grade A raw material and products, Grade B
re-sell material, and the Grade C book stock. Quantities are in each item's unit (litres for
oil, kg for the rest; see models/catalog.py). Two figures for every item:
- provisional: every live entry, including ones still waiting for approval. Stock moves the
  moment something is recorded, and this is what new entries are checked against.
- confirmed: only entries Finance has verified. This is the finalised inventory.
Rejected and deleted entries never count.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import Select, case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import add_months, today
from app.core.config import settings
from app.core.errors import ConflictError
from app.models import (
    Company,
    Production,
    ProductionOutput,
    Purchase,
    Sale,
    StockCheck,
    StockCheckLine,
)
from app.models.catalog import LITRE, STOCKED_ITEMS, process_of, unit_of
from app.models.enums import EntryStatus, Grade
from app.schemas.stock import (
    CompanyStock,
    CompanySummary,
    GradeTotal,
    ItemTotal,
    MoneyTotals,
    ProductionTotals,
    QueueCounts,
    StockFigures,
    StockLine,
)

# Namespace for pg_advisory_xact_lock(namespace, company_id).
_STOCK_LOCK = 1


async def lock_company(db: AsyncSession, company_id: int) -> None:
    """Serialise stock-changing writes in one company until the transaction ends, so two
    people selling the last 500 kg at the same moment cannot both succeed."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :id)"), {"ns": _STOCK_LOCK, "id": company_id}
    )


def _live(model: type[Purchase] | type[Sale] | type[Production]):  # noqa: ANN202
    return (model.deleted_at.is_(None), model.status != EntryStatus.REJECTED)


def _is_verified(model: type[Purchase] | type[Sale] | type[Production]):  # noqa: ANN202
    return model.status == EntryStatus.VERIFIED


Key = tuple[str, str]  # (grade, item)
Sums = dict[Key, tuple[Decimal, Decimal]]


async def _sum_by_key(db: AsyncSession, query: Select, grade: str | None = None) -> Sums:
    """Rows of ([grade,] item, status, qty) → {(grade, item): (provisional, confirmed)}.
    `grade` fixes the grade for queries without one (production is always Grade A)."""
    totals: dict[Key, list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for *key, status, kg in await db.execute(query):
        k = (grade, key[0]) if grade else (key[0], key[1])
        totals[k][0] += kg
        if status == EntryStatus.VERIFIED:
            totals[k][1] += kg
    return {k: (v[0], v[1]) for k, v in totals.items()}


def _lines(
    grade: Grade,
    wanted: tuple[str, ...],
    ins: Sums,
    outs: Sums,
    counted: dict[str, Decimal] | None = None,
) -> list[StockLine]:
    """One line per item: the company's configured items, plus any other item that has moved
    in this grade (so nothing in stock is ever hidden). Weighed waste is never stocked.
    `counted` holds stock-check differences (book − counted) for this section, which the Admin
    verified, so they apply to both figures."""
    counted = counted or {}
    moved = {item for g, item in (*ins, *outs) if g == grade} | counted.keys()
    shown = set(wanted) | moved
    zero = (Decimal(0), Decimal(0))
    lines = []
    for item in STOCKED_ITEMS:
        if item not in shown:
            continue
        (pi, ci), (po, co) = ins.get((grade, item), zero), outs.get((grade, item), zero)
        adj = counted.get(item, Decimal(0))
        lines.append(
            StockLine(
                item=item,
                grade=grade,
                unit=unit_of(item),
                counted_adjustment=adj,
                provisional=StockFigures(in_qty=pi, out_qty=po + adj, balance=pi - po - adj),
                confirmed=StockFigures(in_qty=ci, out_qty=co + adj, balance=ci - co - adj),
            )
        )
    return lines


async def _counted(db: AsyncSession, company_id: int) -> dict[str, dict[str, Decimal]]:
    """{section: {item: total difference}} from every stock check."""
    rows = await db.execute(
        select(StockCheckLine.section, StockCheckLine.item, func.sum(StockCheckLine.difference))
        .where(StockCheckLine.company_id == company_id)
        .group_by(StockCheckLine.section, StockCheckLine.item)
    )
    out: dict[str, dict[str, Decimal]] = defaultdict(dict)
    for section, item, diff in rows:
        out[section][item] = diff
    return out


async def _check_schedule(db: AsyncSession, company: Company) -> dict:
    """When the Admin last counted the stock, and when the next count is due."""
    last = await db.scalar(
        select(func.max(StockCheck.counted_on)).where(StockCheck.company_id == company.id)
    )
    since = last or company.created_at.date()
    due = add_months(since, company.stock_check_months)
    return {
        "check_every_months": company.stock_check_months,
        "last_check_on": last,
        "next_check_due": due,
        "check_overdue": today() > due,
    }


async def company_stock(db: AsyncSession, company_id: int) -> CompanyStock:
    company = await db.get(Company, company_id)
    assert company is not None
    process = process_of(company)

    def grouped(model, cols, qty_col, *joins) -> Select:  # noqa: ANN001
        query = select(*cols, model.status, func.sum(qty_col))
        for target, on in joins:
            query = query.join(target, on)
        return query.where(model.company_id == company_id, *_live(model)).group_by(
            *cols, model.status
        )

    bought = await _sum_by_key(
        db, grouped(Purchase, (Purchase.grade, Purchase.material), Purchase.qty)
    )
    sold = await _sum_by_key(db, grouped(Sale, (Sale.grade, Sale.product), Sale.qty))
    # What production used is what went in less what was put back.
    used = await _sum_by_key(
        db,
        grouped(Production, (Production.material,), Production.input_kg - Production.returned_kg),
        Grade.A,
    )
    produced = await _sum_by_key(
        db,
        grouped(
            Production,
            (ProductionOutput.product,),
            ProductionOutput.qty,
            (ProductionOutput, ProductionOutput.production_id == Production.id),
        ),
        Grade.A,
    )
    counted = await _counted(db, company_id)
    return CompanyStock(
        company_id=company_id,
        raw=_lines(Grade.A, process.inputs, bought, used, counted.get("raw")),
        output=_lines(Grade.A, process.products, produced, sold, counted.get("output")),
        resale=_lines(Grade.B, process.inputs, bought, sold, counted.get("resale")),
        books=_lines(Grade.C, (), bought, sold),
        **await _check_schedule(db, company),
    )


_SHORT_HINT = {
    Grade.A: "",
    Grade.B: " Grade B stock comes only from Grade B purchases.",
    Grade.C: " Grade C is a separate book stock, filled only by Grade C purchases.",
}


async def assert_stock_not_negative(db: AsyncSession, company_id: int) -> None:
    """Call after a change, inside the same locked transaction. Refuses the change if it
    would leave any item in any grade below zero (selling more than you have, processing
    tyres that were bought to re-sell, rejecting a purchase that was already used, ...)."""
    await db.flush()
    stock = await company_stock(db, company_id)
    for line in [*stock.raw, *stock.output, *stock.resale, *stock.books]:
        if line.provisional.balance < 0:
            raise ConflictError(
                f"Not enough Grade {line.grade} {line.item} in stock: this would leave "
                f"{line.provisional.balance:,.3f} {line.unit}.{_SHORT_HINT[line.grade]}",
                code="insufficient_stock",
            )


# ---------------------------------------------------------------------------
# Period summary
# ---------------------------------------------------------------------------


class _Tally:
    """Running count, weight, volume and value for one bucket (an item or a grade)."""

    __slots__ = ("amount", "count", "kg", "litres")

    def __init__(self) -> None:
        self.count, self.kg, self.litres, self.amount = 0, Decimal(0), Decimal(0), Decimal(0)

    def add(self, n: int, unit: str, qty: Decimal, amount: Decimal) -> None:
        self.count += n
        self.amount += amount
        if unit == LITRE:
            self.litres += qty
        else:
            self.kg += qty


async def _money_totals(db: AsyncSession, model, item_col, cid, d_from, d_to) -> MoneyTotals:  # noqa: ANN001
    rows = await db.execute(
        select(
            model.grade,
            item_col,
            func.count(),
            func.sum(model.qty),
            func.sum(model.amount),
            func.sum(case((_is_verified(model), model.amount), else_=0)),
        )
        .where(model.company_id == cid, model.entry_date.between(d_from, d_to), *_live(model))
        .group_by(model.grade, item_col)
    )
    by_item: dict[str, _Tally] = defaultdict(_Tally)
    by_grade: dict[str, _Tally] = {g.value: _Tally() for g in Grade}
    total, verified = _Tally(), Decimal(0)
    for grade, item, n, qty, amount, item_verified in rows:
        unit = unit_of(item)
        for tally in (by_item[item], by_grade[grade], total):
            tally.add(n, unit, qty, amount)
        verified += item_verified
    return MoneyTotals(
        count=total.count,
        qty_kg=total.kg,
        qty_l=total.litres,
        amount=total.amount,
        verified_amount=verified,
        by_item=[
            ItemTotal(item=i, unit=unit_of(i), qty=t.litres or t.kg, amount=t.amount)
            for i, t in by_item.items()
        ],
        by_grade=[
            GradeTotal(grade=g, count=t.count, qty_kg=t.kg, qty_l=t.litres, amount=t.amount)
            for g, t in by_grade.items()
        ],
    )


async def _production_totals(
    db: AsyncSession, cid: int, d_from: date, d_to: date
) -> ProductionTotals:
    in_period = (
        Production.company_id == cid,
        Production.entry_date.between(d_from, d_to),
        *_live(Production),
    )
    count, input_kg, returned_kg, output_kg, wastage_kg, flagged = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(Production.input_kg), 0),
                func.coalesce(func.sum(Production.returned_kg), 0),
                func.coalesce(func.sum(Production.output_kg), 0),
                func.coalesce(func.sum(Production.wastage_kg), 0),
                func.count().filter(Production.wastage_pct > settings.WASTAGE_ALERT_PCT),
            ).where(*in_period)
        )
    ).one()
    by_product = await db.execute(
        select(ProductionOutput.product, func.sum(ProductionOutput.qty))
        .join(Production, Production.id == ProductionOutput.production_id)
        .where(*in_period)
        .group_by(ProductionOutput.product)
    )
    return ProductionTotals(
        count=count,
        input_kg=input_kg,
        returned_kg=returned_kg,
        processed_kg=input_kg - returned_kg,
        output_kg=output_kg,
        wastage_kg=wastage_kg,
        flagged_count=flagged,
        by_item=[ItemTotal(item=p, unit=unit_of(p), qty=q, amount=0) for p, q in by_product],
    )


async def _queue(db: AsyncSession, cid: int) -> QueueCounts:
    from app.services import wastage_service  # local: wastage_service imports this module

    counts: dict[str, int] = defaultdict(int)
    escalated = 0
    for model in (Purchase, Sale, Production):
        rows = await db.execute(
            select(model.status, func.count(), func.count(model.escalated_at))
            .where(model.company_id == cid, model.deleted_at.is_(None))
            .group_by(model.status)
        )
        for status, n, open_escalations in rows:
            counts[status] += n
            escalated += open_escalations
    return QueueCounts(
        pending=counts[EntryStatus.PENDING],
        approved=counts[EntryStatus.APPROVED],
        on_hold=counts[EntryStatus.ON_HOLD],
        escalated=escalated,
        debit_notes_due=await wastage_service.count_pending_notes(db, cid),
    )


async def company_summary(db: AsyncSession, cid: int, d_from: date, d_to: date) -> CompanySummary:
    return CompanySummary(
        company_id=cid,
        date_from=d_from,
        date_to=d_to,
        purchases=await _money_totals(db, Purchase, Purchase.material, cid, d_from, d_to),
        production=await _production_totals(db, cid, d_from, d_to),
        sales=await _money_totals(db, Sale, Sale.product, cid, d_from, d_to),
        queue=await _queue(db, cid),
    )
