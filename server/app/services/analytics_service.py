"""Reports worked out in the database: trends over time, the oil KPI, purchase price history,
purchase and sales analysis, and production efficiency. Every query groups in SQL and returns
a handful of rows per period; Python only folds them together (dicts keyed by period, so
merging is linear).

Rejected and deleted entries never count; pending ones do, like the rest of the reports.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.periods import periods, truncate
from app.models import Company, Party, Production, ProductionOutput, Purchase, Sale, User
from app.models.catalog import LITRE, process_of, unit_of
from app.models.enums import EntryStatus, Grade, OutputProduct
from app.schemas.analytics import (
    OilKpi,
    OilPoint,
    OperatorRow,
    PriceHistory,
    PricePoint,
    ProductionReport,
    ShiftRow,
    SupplierPrice,
    TradeAnalysis,
    TradeBill,
    TradeGrade,
    TradeItem,
    TradeItemPeriod,
    TradeParty,
    TradePartyPeriod,
    TradePeriod,
    TradeTotals,
    TrendPoint,
)

OIL_GREEN_AT = Decimal("40")
OIL_RED_BELOW = Decimal("39")
_ZERO = Decimal(0)


def _live(model) -> tuple:  # noqa: ANN001
    return (model.deleted_at.is_(None), model.status != EntryStatus.REJECTED)


def _in(model, company_id: int, d_from: date, d_to: date) -> tuple:  # noqa: ANN001
    return (model.company_id == company_id, model.entry_date.between(d_from, d_to), *_live(model))


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    return (part / whole * 100).quantize(Decimal("0.01")) if whole else _ZERO


# ---------------------------------------------------------------------------
# Trends
# ---------------------------------------------------------------------------


async def trends(
    db: AsyncSession, company_id: int, d_from: date, d_to: date, unit: str
) -> list[TrendPoint]:
    acc: dict[date, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))

    for model, item_col, prefix in (
        (Purchase, Purchase.material, "purchase"),
        (Sale, Sale.product, "sales"),
    ):
        period = truncate(model.entry_date, unit)
        rows = await db.execute(
            select(period, item_col, func.sum(model.qty), func.sum(model.amount))
            .where(*_in(model, company_id, d_from, d_to))
            .group_by(period, item_col)
        )
        for p, item, qty, amount in rows:
            acc[p][f"{prefix}_amount"] += amount
            # Litres and kilograms are never added together.
            acc[p][f"{prefix}_{'l' if unit_of(item) == LITRE else 'kg'}"] += qty

    period = truncate(Production.entry_date, unit)
    rows = await db.execute(
        select(
            period,
            func.sum(Production.input_kg - Production.returned_kg),
            func.sum(Production.output_kg),
            func.sum(Production.wastage_kg),
        )
        .where(*_in(Production, company_id, d_from, d_to))
        .group_by(period)
    )
    for p, processed, output, wastage in rows:
        acc[p]["processed_kg"] += processed
        acc[p]["output_kg"] += output
        acc[p]["wastage_kg"] += wastage

    out = []
    for p in periods(d_from, d_to, unit):
        a = acc.get(p, {})
        out.append(
            TrendPoint(
                period=p,
                purchase_amount=a.get("purchase_amount", _ZERO),
                purchase_kg=a.get("purchase_kg", _ZERO),
                sales_amount=a.get("sales_amount", _ZERO),
                sales_kg=a.get("sales_kg", _ZERO),
                sales_l=a.get("sales_l", _ZERO),
                processed_kg=a.get("processed_kg", _ZERO),
                output_kg=a.get("output_kg", _ZERO),
                wastage_kg=a.get("wastage_kg", _ZERO),
                wastage_pct=_pct(a.get("wastage_kg", _ZERO), a.get("processed_kg", _ZERO)),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Oil KPI
# ---------------------------------------------------------------------------


def oil_status(pct: Decimal, has_data: bool) -> str:
    if not has_data:
        return "none"
    if pct >= OIL_GREEN_AT:
        return "green"
    return "red" if pct < OIL_RED_BELOW else "amber"


async def oil_kpi(
    db: AsyncSession, company: Company, d_from: date, d_to: date, unit: str
) -> OilKpi:
    """Oil out (by weight) as a share of the weight processed, over all runs in the period."""
    period = truncate(Production.entry_date, unit)
    processed = dict(
        (
            await db.execute(
                select(period, func.sum(Production.input_kg - Production.returned_kg))
                .where(*_in(Production, company.id, d_from, d_to))
                .group_by(period)
            )
        ).all()
    )
    oil = {
        p: (litres, kg)
        for p, litres, kg in await db.execute(
            select(period, func.sum(ProductionOutput.qty), func.sum(ProductionOutput.qty_kg))
            .join(Production, Production.id == ProductionOutput.production_id)
            .where(
                *_in(Production, company.id, d_from, d_to),
                ProductionOutput.product == OutputProduct.OIL,
            )
            .group_by(period)
        )
    }
    series = []
    for p in periods(d_from, d_to, unit):
        litres, kg = oil.get(p, (_ZERO, _ZERO))
        done = processed.get(p, _ZERO)
        series.append(
            OilPoint(period=p, oil_l=litres, oil_kg=kg, processed_kg=done, pct=_pct(kg, done))
        )
    total_l = sum((v[0] for v in oil.values()), _ZERO)
    total_kg = sum((v[1] for v in oil.values()), _ZERO)
    total_processed = sum(processed.values(), _ZERO)
    pct = _pct(total_kg, total_processed)
    return OilKpi(
        applicable=OutputProduct.OIL in process_of(company).outputs,
        oil_l=total_l,
        oil_kg=total_kg,
        processed_kg=total_processed,
        pct=pct,
        status=oil_status(pct, total_processed > 0),
        green_at=OIL_GREEN_AT,
        red_below=OIL_RED_BELOW,
        series=series,
    )


# ---------------------------------------------------------------------------
# Purchase price history
# ---------------------------------------------------------------------------


async def prices(
    db: AsyncSession, company_id: int, item: str, d_from: date, d_to: date, unit: str
) -> PriceHistory:
    """What each supplier charged for one item over time, against the weighted average.
    Grade C (invoice-only) purchases are left out: they are not real buying prices."""
    where = (
        *_in(Purchase, company_id, d_from, d_to),
        Purchase.material == item,
        Purchase.grade != Grade.C,
    )
    period = truncate(Purchase.entry_date, unit)
    grouped = await db.execute(
        select(
            period,
            Purchase.supplier_id,
            func.count(),
            func.sum(Purchase.qty),
            func.sum(Purchase.amount),
            func.min(Purchase.rate),
            func.max(Purchase.rate),
        )
        .where(*where)
        .group_by(period, Purchase.supplier_id)
    )
    by_period: dict[date, dict[int, tuple[Decimal, Decimal]]] = defaultdict(dict)
    per_supplier: dict[int, list] = {}  # id → [bills, qty, amount, min, max]
    for p, sid, n, qty, amount, low, high in grouped:
        by_period[p][sid] = (qty, amount)
        s = per_supplier.setdefault(sid, [0, _ZERO, _ZERO, low, high])
        s[0], s[1], s[2] = s[0] + n, s[1] + qty, s[2] + amount
        s[3], s[4] = min(s[3], low), max(s[4], high)

    # The most recent bill per supplier, in one query (DISTINCT ON).
    last = {
        sid: (rate, day)
        for sid, rate, day in await db.execute(
            select(Purchase.supplier_id, Purchase.rate, Purchase.entry_date)
            .where(*where)
            .ext(distinct_on(Purchase.supplier_id))
            .order_by(Purchase.supplier_id, Purchase.entry_date.desc(), Purchase.id.desc())
        )
    }
    names = (
        dict(
            (await db.execute(select(Party.id, Party.name).where(Party.id.in_(per_supplier)))).all()
        )
        if per_supplier
        else {}
    )

    total_qty = sum((s[1] for s in per_supplier.values()), _ZERO)
    total_amount = sum((s[2] for s in per_supplier.values()), _ZERO)
    avg = (total_amount / total_qty) if total_qty else None
    suppliers = []
    for sid, (bills, qty, amount, low, high) in per_supplier.items():
        rate = amount / qty
        saving = (avg - rate) * qty if avg is not None else _ZERO
        suppliers.append(
            SupplierPrice(
                supplier_id=sid,
                name=names.get(sid, "—"),
                bills=bills,
                qty=qty,
                amount=amount,
                avg_rate=round(rate, 4),
                min_rate=low,
                max_rate=high,
                last_rate=last[sid][0],
                last_date=last[sid][1],
                diff_pct=round((rate - avg) / avg * 100, 2) if avg else 0,
                saving=round(saving, 2),
                roi_pct=round(saving / amount * 100, 2) if amount else 0,
            )
        )
    suppliers.sort(key=lambda s: s.avg_rate)

    series = []
    for p in periods(d_from, d_to, unit):
        bucket = by_period.get(p, {})
        qty = sum((q for q, _ in bucket.values()), _ZERO)
        amount = sum((a for _, a in bucket.values()), _ZERO)
        series.append(
            PricePoint(
                period=p,
                avg_rate=round(amount / qty, 4) if qty else None,
                qty=qty,
                suppliers={sid: round(a / q, 4) for sid, (q, a) in bucket.items() if q},
            )
        )
    return PriceHistory(
        item=item,
        unit=unit_of(item),
        avg_rate=round(avg, 4) if avg is not None else None,
        min_rate=min((s.min_rate for s in suppliers), default=None),
        max_rate=max((s.max_rate for s in suppliers), default=None),
        qty=total_qty,
        amount=total_amount,
        suppliers=suppliers,
        series=series,
    )


# ---------------------------------------------------------------------------
# Purchase and sales analysis
# ---------------------------------------------------------------------------

# Most bills returned for the rate-by-bill chart (the latest ones).
BILL_LIMIT = 1500


def _side(side: str) -> tuple:  # noqa: ANN401
    """The model, its item column and its party column for one side of trade."""
    if side == "purchase":
        return Purchase, Purchase.material, Purchase.supplier_id
    return Sale, Sale.product, Sale.buyer_id


def _split(item: str, qty: Decimal) -> tuple[Decimal, Decimal]:
    """(kg, litres): litres and kilograms are never added together."""
    return (_ZERO, qty) if unit_of(item) == LITRE else (qty, _ZERO)


async def trade_analysis(
    db: AsyncSession,
    company_id: int,
    side: str,
    d_from: date,
    d_to: date,
    unit: str,
    *,
    item: str | None = None,
    grades: tuple[str, ...] = (Grade.A, Grade.B),
    party_ids: tuple[int, ...] = (),
) -> TradeAnalysis:
    """What was bought (or sold): per period, item, supplier (or buyer) and grade, with the
    lowest and highest rate in each group. Grade C is left out unless asked for, because
    bill-only entries are not real prices. The grade split ignores the grade filter, so the
    whole mix is always visible."""
    model, item_col, party_col = _side(side)

    def where(d0: date, d1: date, *, by_grade: bool = True) -> tuple:
        out = [*_in(model, company_id, d0, d1)]
        if by_grade:
            out.append(model.grade.in_(grades))
        if item:
            out.append(item_col == item)
        if party_ids:
            out.append(party_col.in_(party_ids))
        return tuple(out)

    current = where(d_from, d_to)
    period = truncate(model.entry_date, unit)
    grouped = await db.execute(
        select(
            period,
            item_col,
            party_col,
            func.count(),
            func.sum(model.qty),
            func.sum(model.amount),
            func.min(model.rate),
            func.max(model.rate),
            func.min(model.entry_date),
            func.max(model.entry_date),
        )
        .where(*current)
        .group_by(period, item_col, party_col)
    )

    series: dict[date, list] = defaultdict(lambda: [0, _ZERO, _ZERO, _ZERO])  # bills kg L ₹
    items: dict[str, list] = {}  # item → [bills, qty, amount, min, max]
    item_series: dict[tuple[date, str], list] = {}
    parties: dict[int, list] = {}  # id → [bills, kg, L, amount, min, max, first, last]
    party_series: dict[tuple[date, int], list] = {}  # → [bills, kg, L, amount, min, max]

    def fold(acc: list, n: int, amount: Decimal, low: Decimal, high: Decimal, qty: int) -> None:
        """Adds bills and amount, and widens the rate range. `qty` is where amount sits."""
        acc[0] += n
        acc[qty] += amount
        acc[qty + 1] = min(acc[qty + 1], low)
        acc[qty + 2] = max(acc[qty + 2], high)

    for p, it, pid, n, qty, amount, low, high, first, last in grouped:
        kg, litres = _split(it, qty)
        s = series[p]
        s[0], s[1], s[2], s[3] = s[0] + n, s[1] + kg, s[2] + litres, s[3] + amount

        i = items.setdefault(it, [0, _ZERO, _ZERO, low, high])
        i[1] += qty
        fold(i, n, amount, low, high, 2)
        ip = item_series.setdefault((p, it), [0, _ZERO, _ZERO, low, high])
        ip[1] += qty
        fold(ip, n, amount, low, high, 2)

        pa = parties.setdefault(pid, [0, _ZERO, _ZERO, _ZERO, low, high, first, last])
        pa[1], pa[2] = pa[1] + kg, pa[2] + litres
        fold(pa, n, amount, low, high, 3)
        pa[6], pa[7] = min(pa[6], first), max(pa[7], last)
        pp = party_series.setdefault((p, pid), [0, _ZERO, _ZERO, _ZERO, low, high])
        pp[1], pp[2] = pp[1] + kg, pp[2] + litres
        fold(pp, n, amount, low, high, 3)

    names = (
        {
            pid: (name, gstin, city)
            for pid, name, gstin, city in await db.execute(
                select(Party.id, Party.name, Party.gstin, Party.city).where(Party.id.in_(parties))
            )
        }
        if parties
        else {}
    )

    # Rates per supplier or buyer only mean something for one item.
    last_rate: dict[int, Decimal] = {}
    bills: list[TradeBill] = []
    truncated = False
    if item:
        last_rate = dict(
            (
                await db.execute(
                    select(party_col, model.rate)
                    .where(*current)
                    .ext(distinct_on(party_col))
                    .order_by(party_col, model.entry_date.desc(), model.id.desc())
                )
            ).all()
        )
        rows = (
            await db.execute(
                select(
                    model.entry_date, party_col, model.ref_no, model.qty, model.rate, model.amount
                )
                .where(*current)
                .order_by(model.entry_date.desc(), model.id.desc())
                .limit(BILL_LIMIT + 1)
            )
        ).all()
        truncated = len(rows) > BILL_LIMIT
        bills = [
            TradeBill(entry_date=d, party_id=pid, ref_no=ref, qty=q, rate=r, amount=a)
            for d, pid, ref, q, r, a in reversed(rows[:BILL_LIMIT])
        ]

    grade_acc: dict[str, list] = {g.value: [0, _ZERO, _ZERO, _ZERO] for g in Grade}
    for g, it, n, qty, amount in await db.execute(
        select(model.grade, item_col, func.count(), func.sum(model.qty), func.sum(model.amount))
        .where(*where(d_from, d_to, by_grade=False))
        .group_by(model.grade, item_col)
    ):
        kg, litres = _split(it, qty)
        a = grade_acc[g]
        a[0], a[1], a[2], a[3] = a[0] + n, a[1] + kg, a[2] + litres, a[3] + amount

    # The same number of days just before this range.
    days = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    prev = [0, _ZERO, _ZERO, _ZERO]
    prev_parties: set[int] = set()
    for it, pid, n, qty, amount in await db.execute(
        select(item_col, party_col, func.count(), func.sum(model.qty), func.sum(model.amount))
        .where(*where(prev_from, prev_to))
        .group_by(item_col, party_col)
    ):
        kg, litres = _split(it, qty)
        prev[0], prev[1], prev[2], prev[3] = (
            prev[0] + n,
            prev[1] + kg,
            prev[2] + litres,
            prev[3] + amount,
        )
        prev_parties.add(pid)

    def totals(bills_n: int, kg: Decimal, litres: Decimal, amount: Decimal, n: int) -> TradeTotals:
        return TradeTotals(bills=bills_n, qty_kg=kg, qty_l=litres, amount=amount, parties=n)

    in_unit = (lambda kg, litres: litres if unit_of(item) == LITRE else kg) if item else None
    empty = [0, _ZERO, _ZERO, _ZERO]
    return TradeAnalysis(
        side=side,
        item=item,
        unit=unit_of(item) if item else None,
        date_from=d_from,
        date_to=d_to,
        bucket=unit,
        totals=totals(
            sum(s[0] for s in series.values()),
            sum((s[1] for s in series.values()), _ZERO),
            sum((s[2] for s in series.values()), _ZERO),
            sum((s[3] for s in series.values()), _ZERO),
            len(parties),
        ),
        previous=totals(*prev, len(prev_parties)),
        previous_from=prev_from,
        previous_to=prev_to,
        series=[
            TradePeriod(period=p, bills=s[0], qty_kg=s[1], qty_l=s[2], amount=s[3])
            for p in periods(d_from, d_to, unit)
            for s in [series.get(p, empty)]
        ],
        items=sorted(
            (
                TradeItem(
                    item=it,
                    unit=unit_of(it),
                    bills=v[0],
                    qty=v[1],
                    amount=v[2],
                    min_rate=v[3],
                    max_rate=v[4],
                )
                for it, v in items.items()
            ),
            key=lambda r: -r.amount,
        ),
        item_series=sorted(
            (
                TradeItemPeriod(
                    period=p,
                    item=it,
                    unit=unit_of(it),
                    bills=v[0],
                    qty=v[1],
                    amount=v[2],
                    min_rate=v[3],
                    max_rate=v[4],
                )
                for (p, it), v in item_series.items()
            ),
            key=lambda r: (r.period, r.item),
        ),
        parties=sorted(
            (
                TradeParty(
                    party_id=pid,
                    name=names.get(pid, ("—", None, ""))[0],
                    gstin=names.get(pid, ("—", None, ""))[1],
                    city=names.get(pid, ("—", None, ""))[2],
                    bills=v[0],
                    qty_kg=v[1],
                    qty_l=v[2],
                    amount=v[3],
                    min_rate=v[4] if item else None,
                    max_rate=v[5] if item else None,
                    last_rate=last_rate.get(pid),
                    first_date=v[6],
                    last_date=v[7],
                )
                for pid, v in parties.items()
            ),
            key=lambda r: -r.amount,
        ),
        party_series=sorted(
            (
                TradePartyPeriod(
                    period=p,
                    party_id=pid,
                    bills=v[0],
                    qty=in_unit(v[1], v[2]) if in_unit else v[1] + v[2],
                    qty_kg=v[1],
                    qty_l=v[2],
                    amount=v[3],
                    min_rate=v[4] if item else None,
                    max_rate=v[5] if item else None,
                )
                for (p, pid), v in party_series.items()
            ),
            key=lambda r: (r.period, r.party_id),
        ),
        grades=[
            TradeGrade(grade=g, bills=a[0], qty_kg=a[1], qty_l=a[2], amount=a[3])
            for g, a in grade_acc.items()
        ],
        bills=bills,
        bills_truncated=truncated,
    )


# ---------------------------------------------------------------------------
# Production efficiency
# ---------------------------------------------------------------------------


async def production_report(
    db: AsyncSession, company_id: int, d_from: date, d_to: date
) -> ProductionReport:
    shift_hours = Decimal(str(settings.SHIFT_HOURS))
    where = _in(Production, company_id, d_from, d_to)
    processed = Production.input_kg - Production.returned_kg
    shifts = await db.execute(
        select(
            Production.shift,
            func.count(),
            func.coalesce(func.sum(Production.running_hours), 0),
            func.count(Production.running_hours),
            func.sum(processed),
            func.sum(Production.output_kg),
            func.sum(Production.wastage_kg),
            # Throughput only over runs that logged hours, so missing hours don't inflate it.
            func.coalesce(func.sum(processed).filter(Production.running_hours.is_not(None)), 0),
        )
        .where(*where)
        .group_by(Production.shift)
        .order_by(Production.shift.nulls_last())
    )
    by_shift = [
        ShiftRow(
            shift=shift,
            runs=runs,
            hours=hours,
            processed_kg=done,
            output_kg=output,
            wastage_kg=wastage,
            kg_per_hour=round(timed / hours, 1) if hours else None,
            efficiency_pct=round(hours / (logged * shift_hours) * 100, 1) if logged else None,
        )
        for shift, runs, hours, logged, done, output, wastage, timed in shifts
    ]

    # Every operator on a run is credited with the whole run: join each run to its crew array.
    # FROM production, unnest(production.crew_ids) AS crew(member): implicitly lateral.
    crew = (
        func.unnest(Production.crew_ids)
        .table_valued("member", joins_implicitly=True)
        .render_derived(name="crew")
    )
    member = crew.c.member
    people = await db.execute(
        select(
            member,
            func.count(),
            func.coalesce(func.sum(Production.running_hours), 0),
            func.sum(processed),
            func.coalesce(func.sum(processed).filter(Production.running_hours.is_not(None)), 0),
        )
        .select_from(Production)
        .where(*where)
        .group_by(member)
    )
    rows = list(people)
    names = (
        dict(
            (
                await db.execute(
                    select(User.id, User.full_name).where(User.id.in_([r[0] for r in rows]))
                )
            ).all()
        )
        if rows
        else {}
    )
    by_operator = sorted(
        (
            OperatorRow(
                user_id=uid,
                name=names.get(uid, "Former operator"),
                runs=runs,
                hours=hours,
                processed_kg=done,
                kg_per_hour=round(timed / hours, 1) if hours else None,
            )
            for uid, runs, hours, done, timed in rows
        ),
        key=lambda r: -r.processed_kg,
    )
    return ProductionReport(shift_hours=shift_hours, by_shift=by_shift, by_operator=by_operator)
