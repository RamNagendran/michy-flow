"""Price history for one item: what each supplier charged (purchases) or each buyer paid
(sales), against the weighted average, over time.

Grade C (invoice-only) bills are left out: they are not real buying or selling prices.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.periods import periods, truncate
from app.models import Party, Purchase, Sale
from app.models.catalog import unit_of
from app.models.enums import EntryStatus, Grade
from app.schemas.analytics import PriceHistory, PricePoint, SupplierPrice

Side = Literal["purchase", "sale"]
_ZERO = Decimal(0)


async def prices(
    db: AsyncSession, company_id: int, side: Side, item: str, d_from: date, d_to: date, unit: str
) -> PriceHistory:
    """For purchases a lower rate is better: saving = (average − theirs) × qty, cheapest first.
    For sales a higher rate is better: saving = (theirs − average) × qty, best payer first."""
    model = Purchase if side == "purchase" else Sale
    party = Purchase.supplier_id if side == "purchase" else Sale.buyer_id
    item_col = Purchase.material if side == "purchase" else Sale.product
    where = (
        model.company_id == company_id,
        model.entry_date.between(d_from, d_to),
        model.deleted_at.is_(None),
        model.status != EntryStatus.REJECTED,
        item_col == item,
        model.grade != Grade.C,
    )
    period = truncate(model.entry_date, unit)
    grouped = await db.execute(
        select(
            period,
            party,
            func.count(),
            func.sum(model.qty),
            func.sum(model.amount),
            func.min(model.rate),
            func.max(model.rate),
        )
        .where(*where)
        .group_by(period, party)
    )
    by_period: dict[date, dict[int, tuple[Decimal, Decimal]]] = defaultdict(dict)
    per_party: dict[int, list] = {}  # id → [bills, qty, amount, min, max]
    for p, pid, n, qty, amount, low, high in grouped:
        by_period[p][pid] = (qty, amount)
        s = per_party.setdefault(pid, [0, _ZERO, _ZERO, low, high])
        s[0], s[1], s[2] = s[0] + n, s[1] + qty, s[2] + amount
        s[3], s[4] = min(s[3], low), max(s[4], high)

    # The most recent bill per party, in one query (DISTINCT ON).
    last = {
        pid: (rate, day)
        for pid, rate, day in await db.execute(
            select(party, model.rate, model.entry_date)
            .where(*where)
            .ext(distinct_on(party))
            .order_by(party, model.entry_date.desc(), model.id.desc())
        )
    }
    names = (
        dict((await db.execute(select(Party.id, Party.name).where(Party.id.in_(per_party)))).all())
        if per_party
        else {}
    )

    sign = 1 if side == "purchase" else -1
    total_qty = sum((s[1] for s in per_party.values()), _ZERO)
    total_amount = sum((s[2] for s in per_party.values()), _ZERO)
    avg = (total_amount / total_qty) if total_qty else None
    parties = []
    for pid, (bills, qty, amount, low, high) in per_party.items():
        rate = amount / qty
        saving = sign * (avg - rate) * qty if avg is not None else _ZERO
        parties.append(
            SupplierPrice(
                supplier_id=pid,
                name=names.get(pid, "—"),
                bills=bills,
                qty=qty,
                amount=amount,
                avg_rate=round(rate, 4),
                min_rate=low,
                max_rate=high,
                last_rate=last[pid][0],
                last_date=last[pid][1],
                diff_pct=round((rate - avg) / avg * 100, 2) if avg else 0,
                saving=round(saving, 2),
                roi_pct=round(saving / amount * 100, 2) if amount else 0,
            )
        )
    parties.sort(key=lambda s: sign * s.avg_rate)

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
                suppliers={pid: round(a / q, 4) for pid, (q, a) in bucket.items() if q},
            )
        )
    return PriceHistory(
        side=side,
        item=item,
        unit=unit_of(item),
        avg_rate=round(avg, 4) if avg is not None else None,
        min_rate=min((s.min_rate for s in parties), default=None),
        max_rate=max((s.max_rate for s in parties), default=None),
        qty=total_qty,
        amount=total_amount,
        suppliers=parties,
        series=series,
    )
