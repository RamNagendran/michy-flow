from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel


class ParsedValue(BaseModel):
    value: Any
    confidence: int  # 0–100
    source: Literal["qr", "label", "pattern", "arithmetic"]


class ParsedBillRead(BaseModel):
    party_name: ParsedValue | None = None
    invoice_no: ParsedValue | None = None
    invoice_date: ParsedValue | None = None
    item: ParsedValue | None = None
    item_text: str | None = None
    grade: Literal["A", "B", "C"] | None = None
    hsn: str | None = None
    qty_on_bill: ParsedValue | None = None
    unit_on_bill: str | None = None  # KG, MT, L or KL as printed
    unit: Literal["kg", "L"] | None = None  # what qty and rate are in
    qty: ParsedValue | None = None
    rate_on_bill: ParsedValue | None = None
    rate: ParsedValue | None = None  # per kg or per litre
    taxable_amount: ParsedValue | None = None
    tax_amount: ParsedValue | None = None
    total: ParsedValue | None = None
    einvoice: bool = False
    warnings: list[str] = []


class DocumentRead(BaseModel):
    id: int
    company_id: int
    kind: Literal["purchase", "sale"]
    filename: str
    content_type: str
    size_bytes: int
    pages: int
    method: str
    created_at: datetime
    parsed: ParsedBillRead
    lines: list[str]
    # The supplier / buyer in this company whose name matches the one read from the bill.
    party_id: int | None
    # Set when this exact file is already the bill of a live entry.
    duplicate_of: str | None


def to_json(value: Any) -> Any:
    """Parsed values as plain JSON for storage (Decimal → float, date → ISO)."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, date):
        return value.isoformat()
    return value
