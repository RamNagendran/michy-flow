"""Reports worked out in the database: trends over time, the oil KPI, purchase price history
and production efficiency. Every query groups in SQL and returns a handful of rows per period;
Python only folds them together (dicts keyed by period, so merging is linear).

Rejected and deleted entries never count; pending ones do, like the rest of the reports.
"""

from collections import defaultdict
from datetime import date
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
