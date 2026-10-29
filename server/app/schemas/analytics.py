from datetime import date
from typing import Literal

from pydantic import BaseModel

Bucket = Literal["day", "week", "month", "year"]


class TrendPoint(BaseModel):
    """One day, week or month. Empty periods are included as zeros, so charts are continuous."""

    period: date
    purchase_amount: float
    purchase_kg: float
    sales_amount: float
    sales_kg: float
    sales_l: float
    processed_kg: float
    output_kg: float
    wastage_kg: float
    wastage_pct: float


class OilPoint(BaseModel):
    period: date
    oil_l: float
    oil_kg: float
    processed_kg: float
    pct: float


class OilKpi(BaseModel):
    """Oil out as a share of the weight processed. Green at or over 40%, red under 39%."""

    applicable: bool  # the company makes oil
    oil_l: float
    oil_kg: float
    processed_kg: float
    pct: float
    status: Literal["green", "amber", "red", "none"]
    green_at: float
    red_below: float
    series: list[OilPoint]


class SupplierPrice(BaseModel):
    supplier_id: int
    name: str
    bills: int
    qty: float
    amount: float
    avg_rate: float
    min_rate: float
    max_rate: float
    last_rate: float
    last_date: date
    diff_pct: float  # vs the overall average: negative is cheaper
    saving: float  # (average − theirs) × quantity: positive means they cost less
    roi_pct: float  # saving as a share of what was paid them


class PricePoint(BaseModel):
    period: date
    avg_rate: float | None  # weighted by quantity; None when nothing was bought
    qty: float
    suppliers: dict[int, float]  # supplier id → their weighted rate in the period


class PriceHistory(BaseModel):
    item: str
    unit: str
    avg_rate: float | None
    min_rate: float | None
    max_rate: float | None
    qty: float
    amount: float
    suppliers: list[SupplierPrice]  # cheapest first
    series: list[PricePoint]


class ShiftRow(BaseModel):
    shift: int | None
    runs: int
    hours: float
    processed_kg: float
    output_kg: float
    wastage_kg: float
    kg_per_hour: float | None
    efficiency_pct: float | None  # running hours / planned hours of the runs that logged hours


class OperatorRow(BaseModel):
    user_id: int
    name: str
    runs: int
    hours: float
    processed_kg: float
    kg_per_hour: float | None


class ProductionReport(BaseModel):
    shift_hours: float
    by_shift: list[ShiftRow]
    by_operator: list[OperatorRow]


# ---------------------------------------------------------------------------
# Trade analysis (purchases or sales)
#
# Every row holds sums (bills, quantity, amount) and the lowest and highest single rate, never
# an average: averages are amount ÷ quantity, worked out by the reader, so rows from several
# companies can be added together without weighting mistakes.
# ---------------------------------------------------------------------------


class TradeTotals(BaseModel):
    bills: int
    qty_kg: float
    qty_l: float
    amount: float
    parties: int


class TradePeriod(BaseModel):
    """One period, all items together. Empty periods are included as zeros."""

    period: date
    bills: int
    qty_kg: float
    qty_l: float
    amount: float


class TradeItem(BaseModel):
    item: str
    unit: str
    bills: int
    qty: float  # in the item's own unit
    amount: float
    min_rate: float
    max_rate: float


class TradeItemPeriod(TradeItem):
    period: date


class TradeParty(BaseModel):
    party_id: int
    name: str
    gstin: str | None
    city: str
    bills: int
    qty_kg: float
    qty_l: float
    amount: float
    # Rates only when one item is chosen: across items they would mix tyres and steel.
    min_rate: float | None
    max_rate: float | None
    last_rate: float | None
    first_date: date
    last_date: date


class TradePartyPeriod(BaseModel):
    period: date
    party_id: int
    bills: int
    qty: float  # in the chosen item's unit; kg + litres are never mixed (see qty_kg/qty_l)
    qty_kg: float
    qty_l: float
    amount: float
    min_rate: float | None
    max_rate: float | None


class TradeGrade(BaseModel):
    grade: str
    bills: int
    qty_kg: float
    qty_l: float
    amount: float


class TradeBill(BaseModel):
    """One bill of the chosen item, for the rate-by-bill chart."""

    entry_date: date
    party_id: int
    ref_no: str
    qty: float
    rate: float
    amount: float


class TradeAnalysis(BaseModel):
    side: Literal["purchase", "sale"]
    item: str | None
    unit: str | None  # the chosen item's unit
    date_from: date
    date_to: date
    bucket: Bucket
    totals: TradeTotals
    # The same number of days just before date_from, for "vs previous period".
    previous: TradeTotals
    previous_from: date
    previous_to: date
    series: list[TradePeriod]
    items: list[TradeItem]  # biggest amount first
    item_series: list[TradeItemPeriod]  # only periods with bills
    parties: list[TradeParty]  # biggest amount first
    party_series: list[TradePartyPeriod]  # only periods with bills
    grades: list[TradeGrade]  # A, B, C, always all three
    bills: list[TradeBill]  # only with an item chosen; the latest BILL_LIMIT
    bills_truncated: bool
