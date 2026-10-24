from datetime import date
from typing import Literal

from pydantic import BaseModel

Bucket = Literal["day", "week", "month"]


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
