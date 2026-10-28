from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core import gstin as gst
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

Action = Literal["approve", "request_change", "verify", "reject"]
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


class _BillGstins(BaseModel):
    """GST numbers on the uploaded bill as the person confirmed them: what was read, or what
    they typed when it was read wrong. Only used with a document; a correction is logged."""

    bill_company_gstin: str | None = Field(default=None, max_length=20)
    bill_party_gstin: str | None = Field(default=None, max_length=20)

    @field_validator("bill_company_gstin", "bill_party_gstin")
    @classmethod
    def _gstin(cls, value: str | None) -> str | None:
        return gst.clean(value)


class PurchaseInput(EntryInput, _Invoice, _BillGstins):
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
    # The supplier's open debit notes settled on this bill.
    debit_note_ids: list[Annotated[int, Field(gt=0)]] = Field(default=[], max_length=50)

    @field_validator("debit_note_ids")
    @classmethod
    def _unique_notes(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class SaleInput(EntryInput, _Invoice, _BillGstins):
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
    # Debit notes are reduced on a bill from its drawer, not by editing it.
    debit_note_ids: list[int] = Field(default=[], max_length=0)


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


class DebitNoteInput(BaseModel):
    """A flag about the supplier for the team: any issue with this purchase. It changes
    nothing by itself; quantity and amount are only for the record."""

    # Left blank, the next number is given (DN-MR-00001).
    note_no: str = Field(default="", max_length=50)
    qty: Qty | None = None  # in the purchased item's unit
    amount: (
        Annotated[Decimal, Field(ge=0, le=100_000_000, max_digits=16, decimal_places=2)] | None
    ) = None
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("note_no", "reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        if not value:
            raise ValueError("write what happened")
        return value


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
    escalated: bool  # an open escalation (see escalated_to)
    escalated_to: str | None  # "incharge" (Manager asked) or "manager" (Finance asked)
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
    # Purchases: the supplier's debit notes still waiting to come off a bill.
    open_debit_notes: int = 0


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
    # The purchase it was raised on.
    purchase_id: int
    purchase_ref_no: str
    purchase_date: date
    invoice_no: str
    item: str | None
    qty: float | None
    unit: str
    amount: float | None
    reason: str
    created_by_name: str | None
    created_at: datetime
    # The later bill it was settled on; all None while the note is open.
    adjusted_purchase_id: int | None
    adjusted_ref_no: str | None
    adjusted_by_name: str | None
    adjusted_at: datetime | None
    is_open: bool


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
    escalated_to: str | None = None
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
    # Purchase: debit notes raised on this bill, those this bill took off, and the
    # supplier's other notes still open (shown to everyone who enters or approves).
    debit_notes: list[DebitNoteRead] = []
    adjusted_debit_notes: list[DebitNoteRead] = []
    supplier_open_debit_notes: list[DebitNoteRead] = []
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
    crew: list[CrewMember] = []
    running_hours: float | None = None
    efficiency_pct: float | None = None  # running hours / shift hours
    kg_per_hour: float | None = None  # processed weight per running hour
    outputs: list[OutputRead] = []
