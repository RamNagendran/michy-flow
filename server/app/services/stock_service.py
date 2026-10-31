"""Stock and period totals, worked out in the database from the entries themselves.

Stock is kept per grade (see models/grades.py): Grade A raw material and products, Grade B
re-sell material, and the Grade C book stock. Quantities are in each item's unit (litres for
oil, kg for the rest; see models/catalog.py). Two figures for every item:
- provisional: every entry the Manager has approved (approved_at is set), including ones still
  waiting for Finance. Entries waiting for the Manager do not count yet. This is what new
  entries and approvals are checked against.
- confirmed: only entries Finance has approved (verified). This is the finalised inventory.
Rejected (and older deleted) entries never count.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import Select, String, case, cast, func, literal, null, or_, select, text, union_all
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
    WastageAdjustment,
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


Model = type[Purchase] | type[Sale] | type[Production]


def _in_stock(model: Model, also: tuple[Model, int] | None = None):  # noqa: ANN202
    """Entries that move stock: live and approved by the Manager. `also` counts one more
    entry as if approved, to check a new entry before it waits for the Manager."""
    approved = model.approved_at.is_not(None)
    if also is not None and also[0] is model:
        approved = or_(approved, model.id == also[1])
    return (*_live(model), approved)


def _is_verified(model: type[Purchase] | type[Sale] | type[Production]):  # noqa: ANN202
    return model.status == EntryStatus.VERIFIED


Key = tuple[str, str]  # (grade, item)
Sums = dict[Key, tuple[Decimal, Decimal]]


def _fold(rows: list) -> Sums:
    """Rows of (grade, item, status, qty) → {(grade, item): (provisional, confirmed)}."""
    totals: dict[Key, list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for grade, item, status, qty in rows:
        totals[(grade, item)][0] += qty
        if status == EntryStatus.VERIFIED:
            totals[(grade, item)][1] += qty
    return {k: (v[0], v[1]) for k, v in totals.items()}


def _lines(
    grade: Grade,
    wanted: tuple[str, ...],
    ins: Sums,
    outs: Sums,
    counted: dict[str, Decimal] | None = None,
    wasted: dict[str, Decimal] | None = None,
) -> list[StockLine]:
    """One line per item: the company's configured items, plus any other item that has moved
    in this grade (so nothing in stock is ever hidden). Weighed waste is never stocked.
    `counted` holds stock-check differences (book − counted) for this section, which the Manager
    verified, so they apply to both figures. `wasted` holds raw stock moved by the Super Admin's
    approved wastage changes (positive: taken out), which apply to both figures too."""
    counted, wasted = counted or {}, wasted or {}
    moved = {item for g, item in (*ins, *outs) if g == grade} | counted.keys() | wasted.keys()
    shown = set(wanted) | moved
    zero = (Decimal(0), Decimal(0))
    lines = []
    for item in STOCKED_ITEMS:
        if item not in shown:
            continue
        (pi, ci), (po, co) = ins.get((grade, item), zero), outs.get((grade, item), zero)
        count_adj, waste_adj = counted.get(item, Decimal(0)), wasted.get(item, Decimal(0))
        adj = count_adj + waste_adj
        lines.append(
            StockLine(
                item=item,
                grade=grade,
                unit=unit_of(item),
                counted_adjustment=count_adj,
                wastage_adjustment=waste_adj,
                provisional=StockFigures(in_qty=pi, out_qty=po + adj, balance=pi - po - adj),
                confirmed=StockFigures(in_qty=ci, out_qty=co + adj, balance=ci - co - adj),
            )
        )
    return lines


async def _check_schedule(db: AsyncSession, company: Company) -> dict:
    """When the Manager last counted the stock, and when the next count is due."""
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


async def company_stock(
    db: AsyncSession, company_id: int, also: tuple[Model, int] | None = None
) -> CompanyStock:
    company = await db.get(Company, company_id)
    assert company is not None
    process = process_of(company)

    def grouped(kind: str, model, grade, item, qty_col, *joins) -> Select:  # noqa: ANN001
        """(kind, grade, item, status, qty) per item and status. Production has no grade
        column: it is always Grade A."""
        group = (item,) if isinstance(grade, str) else (grade, item)
        query = select(
            literal(kind, String).label("kind"),
            literal(grade, String) if isinstance(grade, str) else grade,
            item,
            cast(model.status, String),
            func.sum(qty_col),
        )
        for target, on in joins:
            query = query.join(target, on)
        return query.where(model.company_id == company_id, *_in_stock(model, also)).group_by(
            *group, model.status
        )

    # Every movement, stock-check difference and approved wastage change in one round trip.
    # Stock-check lines carry their section ("raw", "output", "resale") in the grade column and
    # no status; wastage changes are always Grade A raw material.
    rows = await db.execute(
        union_all(
            grouped("bought", Purchase, Purchase.grade, Purchase.material, Purchase.qty),
            grouped("sold", Sale, Sale.grade, Sale.product, Sale.qty),
            # What production used is what went in less what was put back.
            grouped(
                "used",
                Production,
                Grade.A.value,
                Production.material,
                Production.input_kg - Production.returned_kg,
            ),
            grouped(
                "produced",
                Production,
                Grade.A.value,
                ProductionOutput.product,
                ProductionOutput.qty,
                (ProductionOutput, ProductionOutput.production_id == Production.id),
            ),
            select(
                literal("counted", String),
                cast(StockCheckLine.section, String),
                StockCheckLine.item,
                cast(null(), String),
                func.sum(StockCheckLine.difference),
            )
            .where(StockCheckLine.company_id == company_id)
            .group_by(StockCheckLine.section, StockCheckLine.item),
            select(
                literal("wasted", String),
                literal("raw", String),
                WastageAdjustment.item,
                cast(null(), String),
                func.sum(WastageAdjustment.qty),
            )
            .where(WastageAdjustment.company_id == company_id)
            .group_by(WastageAdjustment.item),
        )
    )
    by_kind: dict[str, list] = defaultdict(list)
    for kind, *row in rows:
        by_kind[kind].append(row)
    bought, sold, used, produced = (
        _fold(by_kind[k]) for k in ("bought", "sold", "used", "produced")
    )
    counted: dict[str, dict[str, Decimal]] = defaultdict(dict)
    for section, item, _, diff in by_kind["counted"]:
        counted[section][item] = diff
    wasted = {item: qty for _, item, _, qty in by_kind["wasted"]}
    return CompanyStock(
        company_id=company_id,
        raw=_lines(Grade.A, process.inputs, bought, used, counted.get("raw"), wasted),
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


async def assert_stock_not_negative(
    db: AsyncSession, company_id: int, also: tuple[Model, int] | None = None
) -> None:
    """Call after a change, inside the same locked transaction. Refuses the change if it
    would leave any item in any grade below zero (selling more than you have, processing
    tyres that were bought to re-sell, rejecting a purchase that was already used, ...).
    `also` counts a new entry that is still waiting for the Manager."""
    await db.flush()
    stock = await company_stock(db, company_id, also)
    for line in [*stock.raw, *stock.output, *stock.resale, *stock.books]:
        if line.provisional.balance < 0:
            raise ConflictError(
                f"Not enough Grade {line.grade} {line.item} in stock: this would leave "
                f"{line.provisional.balance:,.3f} {'litres' if line.unit == LITRE else 'kg'}."
                f"{_SHORT_HINT[line.grade]}",
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


def _money_rows(side: str, model, item_col, cid: int, d_from: date, d_to: date) -> Select:  # noqa: ANN001
    """(side, grade, item, count, qty, amount, verified amount) per grade and item."""
    return (
        select(
            literal(side, String),
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


def _money_totals(rows: list) -> MoneyTotals:
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


# Marks the open-debit-note count among the status rows in _queue.
_DEBIT_ROW = "_debit_notes"


async def _queue(db: AsyncSession, cid: int) -> QueueCounts:
    from app.services import (
        debit_note_service,
    )  # local: it imports entry_service, which imports this module

    # Entries per status and escalation in all three kinds, and the open debit notes (as a
    # row of its own), in one round trip.
    per_kind = [
        select(cast(model.status, String), cast(model.escalated_to, String), func.count())
        .where(model.company_id == cid, model.deleted_at.is_(None))
        .group_by(model.status, model.escalated_to)
        for model in (Purchase, Sale, Production)
    ]
    debit = debit_note_service.open_count_query(cid)
    rows = await db.execute(
        union_all(
            *per_kind,
            select(literal(_DEBIT_ROW, String), cast(null(), String), debit.scalar_subquery()),
        )
    )
    counts: dict[str, int] = defaultdict(int)
    escalated: dict[str | None, int] = defaultdict(int)
    for status, to, n in rows:
        counts[status] += n
        if status != _DEBIT_ROW:
            escalated[to] += n
    return QueueCounts(
        pending=counts[EntryStatus.PENDING],
        approved=counts[EntryStatus.APPROVED],
        change_requested=counts[EntryStatus.CHANGE_REQUESTED],
        escalated_to_incharge=escalated["incharge"],
        escalated_to_manager=escalated["manager"],
        open_debit_notes=counts[_DEBIT_ROW],
    )


async def company_summary(db: AsyncSession, cid: int, d_from: date, d_to: date) -> CompanySummary:
    money: dict[str, list] = defaultdict(list)
    for side, *row in await db.execute(
        union_all(
            _money_rows("purchases", Purchase, Purchase.material, cid, d_from, d_to),
            _money_rows("sales", Sale, Sale.product, cid, d_from, d_to),
        )
    ):
        money[side].append(row)
    return CompanySummary(
        company_id=cid,
        date_from=d_from,
        date_to=d_to,
        purchases=_money_totals(money["purchases"]),
        production=await _production_totals(db, cid, d_from, d_to),
        sales=_money_totals(money["sales"]),
        queue=await _queue(db, cid),
    )
