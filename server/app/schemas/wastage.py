from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.entries import QtyOrZero, Text

Section = Literal["raw", "output", "resale"]
# open: the month is still running; pending: waiting for the Super Admin; escalated: waiting
# for the Manager; approved: final, and production in that month is locked.
MonthStatus = Literal["open", "pending", "escalated", "approved"]
# Trimmed first, so a comment of only spaces is refused.
Comment = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class StockShare(BaseModel):
    """How a changed month moves one raw material's stock, by its share of the processing."""

    item: str
    processed_kg: float
    share_pct: float
    qty: float  # positive: taken out of stock; negative: put back
    stock_now: float | None = None  # only on the detail, while the month is not approved
    stock_after: float | None = None


class WastageMonth(BaseModel):
    month: date
    status: MonthStatus
    runs: int
    processed_kg: float
    output_kg: float
    calculated_kg: float  # what the production entries add up to (2% of each run's output)
    wastage_kg: float  # the figure for the month: the Super Admin's own, if they changed it
    wastage_pct: float  # of the processed weight
    changed: bool  # the Super Admin's figure differs from the production total
    adjustments: list[StockShare]
    escalated_at: datetime | None
    approved_by_name: str | None
    approved_at: datetime | None
    updated_at: datetime | None  # None until someone acts on the month


class WastageEventRead(BaseModel):
    id: int
    action: str
    comment: str
    changes: dict | None
    actor_name: str | None
    created_at: datetime


class WastageMonthDetail(WastageMonth):
    actions: list[str]  # what this person may do now
    events: list[WastageEventRead]


class WastageComment(BaseModel):
    comment: Comment


class WastageChange(BaseModel):
    wastage_kg: QtyOrZero
    comment: Comment


class MonthApproval(BaseModel):
    month: date
    # The figure the Super Admin saw. If production changed since, nothing is approved.
    wastage_kg: QtyOrZero


class WastageApproval(BaseModel):
    months: list[MonthApproval] = Field(min_length=1, max_length=36)
    comment: Text = ""

    @model_validator(mode="after")
    def _each_month_once(self) -> "WastageApproval":
        months = [m.month.replace(day=1) for m in self.months]
        if len(months) != len(set(months)):
            raise ValueError("each month can be approved only once")
        return self


class WastageQueue(BaseModel):
    company_id: int
    to_approve: int  # months waiting for the Super Admin
    escalated: int  # months waiting for the Manager


class CountLine(BaseModel):
    section: Section
    item: str = Field(min_length=1, max_length=20)
    counted_qty: QtyOrZero


class StockCheckInput(BaseModel):
    counted_on: date
    note: Text = ""
    lines: list[CountLine] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _one_line_per_item(self) -> "StockCheckInput":
        keys = [(line.section, line.item) for line in self.lines]
        if len(keys) != len(set(keys)):
            raise ValueError("each item can be counted only once")
        return self


class CountLineRead(BaseModel):
    section: Section
    grade: str
    item: str
    unit: str
    book_qty: float
    counted_qty: float
    difference: float  # book − counted: positive is a shortage


class StockCheckRead(BaseModel):
    id: int
    counted_on: date
    note: str
    counted_by_name: str | None
    created_at: datetime
    lines: list[CountLineRead]
