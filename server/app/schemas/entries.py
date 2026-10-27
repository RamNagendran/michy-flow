from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.clock import today
from app.models import grades
from app.models.enums import (
    EntrySource,
    EntryStatus,
    EntryType,
    Grade,
    Material,
    OutputProduct,
)

# Limits match the database columns (see models/entries.py), so nothing is silently rounded.
Kg = Annotated[Decimal, Field(gt=0, le=10_000_000, max_digits=14, decimal_places=3)]
KgOrZero = Annotated[Decimal, Field(ge=0, le=10_000_000, max_digits=14, decimal_places=3)]
# A quantity in the item's own unit: kg, or litres for oil.
Qty = Kg
QtyOrZero = KgOrZero
Rate = Annotated[Decimal, Field(ge=0, le=1_000_000, max_digits=12, decimal_places=4)]
Text = Annotated[str, Field(max_length=2000)]
# Any catalogue item. Which ones a purchase or sale may carry depends on its grade.
Item = Material | OutputProduct

Action = Literal["approve", "reject", "verify", "hold"]
EARLIEST_DATE = date(2000, 1, 1)


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


class EntryInput(BaseModel):
    entry_date: date
    notes: Text = ""

    @field_validator("entry_date")
    @classmethod
    def _sensible_date(cls, value: date) -> date:
        # One day of slack for people entering near midnight in another time zone.
        if value > today() + timedelta(days=1):
            raise ValueError("the date cannot be in the future")
        if value < EARLIEST_DATE:
            raise ValueError("the date is too far in the past")
        return value

    @field_validator("notes")
    @classmethod
    def _strip_notes(cls, value: str) -> str:
        return value.strip()


class _Invoice(BaseModel):
    invoice_no: str = Field(min_length=1, max_length=50)

    @field_validator("invoice_no")
    @classmethod
    def _clean_invoice(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("enter the bill / invoice number")
        return value


class PurchaseInput(EntryInput, _Invoice):
    supplier_id: int = Field(gt=0)
    # A: tyres for production (the default), B: tyres to re-sell, C: invoice only.
    # Which items a grade may carry depends on the company type: checked in entry_service.
    grade: Grade = Grade.A
    material: Item
    qty: Qty
    rate: Rate  # per unit of the item
    source: EntrySource = EntrySource.MANUAL
    # The uploaded bill this was read from (POST /companies/{id}/documents).
    document_id: int | None = Field(default=None, gt=0)


class SaleInput(EntryInput, _Invoice):
    buyer_id: int = Field(gt=0)
    # Left out: A for a product, B for tyres. Grade C must be chosen.
    grade: Grade | None = None
    product: Item
    qty: Qty
    rate: Rate  # per unit of the item
    source: EntrySource = EntrySource.MANUAL
    document_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _default_grade(self) -> "SaleInput":
        if self.grade is None:
            self.grade = grades.default_sale_grade(self.product)
        return self


class OutputInput(BaseModel):
    product: OutputProduct
    qty: QtyOrZero  # in the product's unit: litres for oil, kg for the rest


class ProductionInput(EntryInput):
    """What went in and what came out. The server works out the weight balance and wastage
    (oil needs the company's density, so that check is in entry_service), and which materials
    and outputs are allowed comes from the company's configuration."""

    material: Item
    # Stock goes down by the outputs + 2%, worked out by the server. A bigger total entered by
    # the in-charge is used only to work out the wastage; it is not saved.
    wastage_on_kg: Kg | None = None
    # Raw material put back into stock after the run; stock goes down by outputs + 2% minus this.
    returned_kg: KgOrZero = Decimal(0)
    shift: int | None = Field(default=None, ge=1, le=3)
    # Operators on the shift (user ids), picked by the production in-charge.
    crew_ids: list[int] = Field(default_factory=list, max_length=50)
    running_hours: Decimal | None = Field(default=None, gt=0, le=24, max_digits=5, decimal_places=2)
    outputs: list[OutputInput] = Field(min_length=1, max_length=len(OutputProduct))

    @field_validator("crew_ids")
    @classmethod
    def _unique_crew(cls, value: list[int]) -> list[int]:
        if any(v <= 0 for v in value):
            raise ValueError("unknown operator")
        return sorted(set(value))

    @model_validator(mode="after")
    def _outputs_fit_input(self) -> "ProductionInput":
        products = [o.product for o in self.outputs]
        if len(products) != len(set(products)):
            raise ValueError("each output can appear only once")
        if not any(o.qty > 0 for o in self.outputs):
            raise ValueError("enter at least one output")
        return self


class EditReason(BaseModel):
    comment: Text = ""


class PurchaseUpdate(PurchaseInput, EditReason):
    # Required on edits, so leaving it out never quietly moves an entry to another grade.
    grade: Grade


class SaleUpdate(SaleInput, EditReason):
    grade: Grade  # type: ignore[assignment]


class ProductionUpdate(ProductionInput, EditReason):
    pass


class ActionRequest(BaseModel):
    comment: Text = ""

    @field_validator("comment")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class CommentRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=2000)

    @field_validator("comment")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("write a comment")
        return value.strip()


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


class EntryRow(BaseModel):
    """One line in any entry list. The same shape for purchases, sales and production."""

    type: EntryType
    id: int
    company_id: int
    company_code: str
    company_name: str
    ref_no: str
    entry_date: date
    status: EntryStatus
    grade: Grade  # always A for production
    escalated: bool  # Finance raised a mismatch with the operations team
    party_name: str | None
    item: str  # material for purchases and production, product for sales
    qty: float  # in `unit`; the input weight for production
    unit: str  # "kg" or "L"
    rate: float | None
    amount: float | None
    invoice_no: str | None
    output_kg: float | None
    wastage_pct: float | None
    source: EntrySource
    created_by_name: str | None
    created_at: datetime


class StatusCount(BaseModel):
    status: EntryStatus
    count: int
    amount: float  # 0 for production


class EventRead(BaseModel):
    id: int
    action: str
    comment: str
    changes: dict | None
    actor_name: str | None
    created_at: datetime


class OutputRead(BaseModel):
    product: OutputProduct
    qty: float
    unit: str
    qty_kg: float  # its weight


class CrewMember(BaseModel):
    id: int
    name: str


class DebitNoteRead(BaseModel):
    id: int
    note_no: str
    supplier_id: int | None
    supplier_name: str | None
    qty_kg: float
    amount: float
    reason: str
    created_by_name: str | None
    created_at: datetime


class EntryDetail(BaseModel):
    """Everything about one entry, its history, and which buttons the caller may press."""

    type: EntryType
    id: int
    company_id: int
    ref_no: str
    entry_date: date
    status: EntryStatus
    grade: Grade
    escalated_at: datetime | None = None
    notes: str
    created_by_name: str | None
    approved_by_name: str | None
    approved_at: datetime | None
    verified_by_name: str | None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime
    actions: list[str]
    events: list[EventRead]
    # Purchase / sale
    party_id: int | None = None
    party_name: str | None = None
    item: str
    qty: float  # in `unit`; the input weight for production
    unit: str
    rate: float | None = None  # per unit
    amount: float | None = None
    invoice_no: str | None = None
    source: EntrySource = EntrySource.MANUAL
    document_id: int | None = None
    # Production
    shift: int | None = None
    returned_kg: float | None = None
    processed_kg: float | None = None
    # Products + the wastage rate: what stock went down by. NULL on runs saved before this rule.
    calculated_input_kg: float | None = None
    output_kg: float | None = None
    wastage_kg: float | None = None
    wastage_pct: float | None = None
    wastage_flagged: bool = False  # over the month's declared allowance
    wastage_allowance_pct: float | None = None
    # Over the hard limit: a high alert, and the Admin cannot approve without a debit note.
    debit_note_required: bool = False
    debit_note: "DebitNoteRead | None" = None
    crew: list[CrewMember] = []
    running_hours: float | None = None
    efficiency_pct: float | None = None  # running hours / shift hours
    kg_per_hour: float | None = None  # processed weight per running hour
    outputs: list[OutputRead] = []
