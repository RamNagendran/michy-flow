from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.entries import QtyOrZero, Text

Pct = Annotated[Decimal, Field(gt=0, le=2, max_digits=4, decimal_places=2)]
Section = Literal["raw", "output", "resale"]


class AllowanceInput(BaseModel):
    month: date  # any day in the month
    pct: Pct
    note: Text = ""


class AllowanceRead(BaseModel):
    month: date
    pct: float
    note: str
    declared_by_name: str | None
    updated_at: datetime


class WastageMonth(BaseModel):
    """One month of production against the allowance."""

    month: date
    allowance_pct: float
    declared: bool  # False: the default hard limit applies
    runs: int
    processed_kg: float
    output_kg: float
    wastage_kg: float
    wastage_pct: float
    over_allowance: bool
    flagged_runs: int  # over the month's allowance
    high_runs: int  # over the hard limit (older runs; new runs use the fixed rate)


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
