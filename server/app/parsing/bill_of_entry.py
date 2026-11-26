"""Read an import's Bill of Entry (Indian Customs, ICEGATE print) with plain rules.

It is laid out nothing like a GST bill: the supplier is overseas and has no GST number, the
price is in the invoice's currency, and Customs prints the exchange rate it used. Quantities in
tonnes are turned into kg, and the price per tonne into a price per kg.
"""

import re
from decimal import Decimal

from app.parsing.fields import _HSN, _MATERIAL_WORDS, Found, ParsedBill, _parse_date
from app.parsing.numbers import gstins_in, to_decimal

_TITLE = re.compile(r"bill\s+of\s+entry", re.I)
# "INMAA1 5189281 20/11/2026 H": port code, BE number, BE date.
_BE = re.compile(r"^[A-Z]{5}\d\s+(\d{5,10})\s+(\d{1,2}/\d{1,2}/\d{4})\b")
# "1 INV26-0183 8729.7 USD": invoice number, its value and currency.
_INVOICE = re.compile(
    r"\b1\s+([A-Z0-9][A-Z0-9/\-_.]{1,39})\s+(\d[\d,]*(?:\.\d+)?)\s+([A-Z]{3})\s*$"
)
_FX = re.compile(r"\b1\s*([A-Z]{3})\s*=\s*(\d+(?:\.\d+)?)\s*INR", re.I)
# "... BALES - 105.000000 83.140000 MTS 8729.70": unit price, quantity, unit, amount.
_ITEM = re.compile(
    r"^(?:\d+\s+)?(?:\d{8}\s+)?(.*?)\s*-?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+"
    r"(MTS|MT|TNE|TON|TONS|KGS|KG)\s+(\d[\d,]*(?:\.\d+)?)\s*$",
    re.I,
)
_TONNES = {"MTS", "MT", "TNE", "TON", "TONS"}
_CONTAINER = re.compile(r"\b([A-Z]{4}\d{7})\b")
_SUPPLIER_LABELS = [
    re.compile(r"supplier\s*name", re.I),
    re.compile(r"third\s*party\s*name", re.I),
    re.compile(r"seller'?s\s*name", re.I),
]
_FIELD_LABEL = re.compile(r"^\s*\d+\s*\.")
# The "ASSESSED COPY" watermark leaves stray single letters at the ends of lines.
_STRAY = re.compile(r"\s+[A-Z]$")
_SIX = Decimal("0.000001")


def is_bill_of_entry(lines: list[str]) -> bool:
    return any(_TITLE.search(line) for line in lines[:15])


def _supplier(lines: list[str]) -> str | None:
    for label in _SUPPLIER_LABELS:
        for i, line in enumerate(lines[:-1]):
            if not label.search(line):
                continue
            name = _STRAY.sub("", lines[i + 1]).strip()
            if name and not _FIELD_LABEL.match(name) and re.search(r"[A-Za-z]{3}", name):
                return name
    return None


def _duty(lines: list[str]) -> Decimal | None:
    """Total duty: first figure under "14.TOTAL DUTY" in the summary, else the item's."""
    for i, line in enumerate(lines[:-1]):
        upper = line.upper()
        if "TOTAL DUTY" in upper and "TOT. AMOUNT" in upper:
            values = [to_decimal(v) for v in lines[i + 1].split()]
            if values and values[0] is not None:
                return values[0]
        if "30. TOTAL DUTY" in upper:
            values = [to_decimal(v) for v in lines[i + 1].split()]
            numbers = [v for v in values if v is not None]
            if numbers:
                return numbers[-1]
    return None


def parse_bill_of_entry(lines: list[str], conf: list[float]) -> ParsedBill:
    bill = ParsedBill(origin="import")
    for line in lines:
        if bill.be_no is None and (m := _BE.search(line)):
            bill.be_no = Found(m.group(1), 90, "pattern")
            if d := _parse_date(m.group(2)):
                bill.be_date = Found(d, 90, "pattern")
        if bill.invoice_no is None and (m := _INVOICE.search(line)) and m.group(3) != "INR":
            bill.invoice_no = Found(m.group(1), 85, "pattern")
            bill.currency = m.group(3)
            if (amount := to_decimal(m.group(2))) is not None:
                bill.foreign_amount = Found(amount, 85, "pattern")
        if bill.fx_rate is None and (m := _FX.search(line)):
            bill.currency = bill.currency or m.group(1).upper()
            bill.fx_rate = Found(Decimal(m.group(2)), 90, "label")
        if bill.qty is None and (m := _ITEM.search(line)):
            _item(bill, m)
            if hsn := _HSN.search(line):
                bill.hsn = hsn.group(1)
        for gstin, _ok in gstins_in(line):
            if gstin not in bill.gstins:
                bill.gstins.append(gstin)
        for container in _CONTAINER.findall(line):
            if container not in bill.containers:
                bill.containers.append(container)
    if bill.gstins:
        # Only the importer (us) has a GST number on a Bill of Entry.
        bill.buyer_gstin = Found(bill.gstins[0], 90, "label")
    if bill.invoice_no:
        bill.invoice_date = _invoice_date(lines, bill.invoice_no.value)
    if name := _supplier(lines):
        bill.party_name = Found(name, 60, "label")
    if (duty := _duty(lines)) is not None:
        bill.customs_duty = Found(duty, 80, "label")
    if bill.foreign_rate and bill.fx_rate:
        rupees = (bill.foreign_rate.value * bill.fx_rate.value).quantize(Decimal("0.0001"))
        bill.rate = Found(rupees, min(bill.foreign_rate.confidence, 90), "arithmetic")
    for missing, label in (
        (bill.fx_rate, "exchange rate"),
        (bill.qty, "quantity"),
        (bill.be_no, "Bill of Entry number"),
    ):
        if missing is None:
            bill.warnings.append(f"Could not read the {label} from the Bill of Entry")
    return bill


def _item(bill: ParsedBill, m: re.Match) -> None:
    text, price, qty, unit, amount = m.groups()
    price_d, qty_d, amount_d = Decimal(price), Decimal(qty), to_decimal(amount)
    unit = unit.upper()
    per_bill_unit = Decimal(1000) if unit in _TONNES else Decimal(1)
    bill.item_text = text.strip(" -") or None
    bill.unit_on_bill = "MT" if unit in _TONNES else "KG"
    bill.unit = "kg"
    bill.qty_on_bill = Found(qty_d, 85, "pattern")
    bill.qty = Found((qty_d * per_bill_unit).quantize(Decimal("0.001")), 85, "pattern")
    bill.rate_on_bill = Found(price_d, 85, "pattern")
    sure = 90 if amount_d is not None and abs(price_d * qty_d - amount_d) <= 1 else 60
    bill.foreign_rate = Found((price_d / per_bill_unit).quantize(_SIX), sure, "pattern")
    for item, pattern in _MATERIAL_WORDS:
        if bill.item_text and pattern.search(bill.item_text):
            bill.item = Found(item, 70, "pattern")
            break


def _invoice_date(lines: list[str], invoice_no: str) -> Found | None:
    """The date under "INVOICE NO. & DT." in the invoice part, next to the number."""
    for i, line in enumerate(lines):
        if re.search(r"invoice\s*no\.?\s*&\s*dt", line, re.I):
            for nearby in lines[i + 1 : i + 7]:
                if d := _parse_date(nearby.replace(invoice_no, " ")):
                    return Found(d, 80, "label")
    for i, line in enumerate(lines):
        if invoice_no in line:
            for nearby in lines[i : i + 4]:
                if d := _parse_date(nearby.replace(invoice_no, " ")):
                    return Found(d, 75, "pattern")
    return None
