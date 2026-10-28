from datetime import date

from pydantic import BaseModel

from app.models.enums import Grade


class StockFigures(BaseModel):
    """In the line's unit: kg, or litres for oil."""

    in_qty: float
    out_qty: float
    balance: float


class StockLine(BaseModel):
    item: str
    grade: Grade
    unit: str  # "kg" or "L"
    # Total of the Manager's stock-check differences (book − counted), already in out / balance.
    counted_adjustment: float = 0
    # Every live entry, including ones still waiting for approval.
    provisional: StockFigures
    # Only entries Finance has verified: the finalised inventory.
    confirmed: StockFigures


class CompanyStock(BaseModel):
    """Stock per grade. The grades never mix: each has its own ins and outs."""

    company_id: int
    # Lines follow the company type, plus any other item that has stock or movement.
    raw: list[StockLine]  # Grade A raw material: in by Grade A purchases, out into production
    output: list[StockLine]  # Grade A products: in from production, out by Grade A sales
    resale: list[StockLine]  # Grade B raw material: bought and re-sold as it is
    books: list[StockLine]  # Grade C book stock (no goods move): only items that moved
    # The Manager's physical stock check, every 1 or 3 months.
    check_every_months: int
    last_check_on: date | None
    next_check_due: date
    check_overdue: bool


class ItemTotal(BaseModel):
    item: str
    unit: str
    qty: float
    amount: float


class GradeTotal(BaseModel):
    grade: Grade
    count: int
    qty_kg: float  # items measured in kg
    qty_l: float  # items measured in litres (oil)
    amount: float


class MoneyTotals(BaseModel):
    count: int
    qty_kg: float  # items measured in kg
    qty_l: float  # items measured in litres (oil)
    amount: float
    verified_amount: float
    by_item: list[ItemTotal]
    by_grade: list[GradeTotal]  # always A, B and C, in that order


class ProductionTotals(BaseModel):
    count: int
    input_kg: float
    returned_kg: float  # put back into stock unprocessed
    processed_kg: float
    output_kg: float  # weight of everything that came out (oil by its density)
    wastage_kg: float
    flagged_count: int  # entries with wastage over the alert threshold
    by_item: list[ItemTotal]  # output per product in its unit (amount is always 0)


class QueueCounts(BaseModel):
    """Entries waiting on someone, across purchases, sales and production (any date)."""

    pending: int
    approved: int
    change_requested: int  # the Manager asked the Super Admin to edit or reject
    escalated_to_incharge: int  # the Manager is waiting on an in-charge
    escalated_to_manager: int  # Finance is waiting on the Manager
    open_debit_notes: int  # purchase debit notes not yet settled


class CompanySummary(BaseModel):
    """Period totals. Rejected and deleted entries are left out; pending ones are included."""

    company_id: int
    date_from: date
    date_to: date
    purchases: MoneyTotals
    production: ProductionTotals
    sales: MoneyTotals
    queue: QueueCounts
