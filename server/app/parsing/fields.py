"""Pick the bill's fields out of its text lines with plain rules (no AI).

Each field carries a confidence (0–100) and where it came from, so the review screen can show
the person which values to look at closely. The e-invoice QR code, when present, wins.
"""

import bisect
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from app.core.clock import today
from app.parsing.numbers import numbers_in
from app.parsing.qr import EInvoice

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class Found:
    value: Any
    confidence: int
    source: str  # "qr" | "label" | "pattern" | "arithmetic"


@dataclass
class ParsedBill:
    party_name: Found | None = None
    invoice_no: Found | None = None
    invoice_date: Found | None = None
    item: Found | None = None
    item_text: str | None = None
    # Suggested grade: a sales bill for tyres is a re-sell (B), for products it is A.
    grade: str | None = None
    hsn: str | None = None
    qty_on_bill: Found | None = None
    unit_on_bill: str | None = None  # "KG" | "MT" | "L" | "KL"
    unit: str | None = None  # what qty and rate are in: "kg" (from KG / MT) or "L" (from L / KL)
    qty: Found | None = None
    rate_on_bill: Found | None = None
    rate: Found | None = None  # per kg or per litre
    taxable_amount: Found | None = None
    tax_amount: Found | None = None
    total: Found | None = None
    einvoice: bool = False
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

_INVOICE_NO = re.compile(
    r"(?:invoice|inv|bill|voucher)\s*(?:no|number|num|#)\.?\s*[:\-#.]?\s*([A-Z0-9][A-Z0-9/\-_.]{0,39})",
    re.I,
)
# "ER/26-27/0365", "SBT/2026-27/1418": financial-year invoice numbers, as most billing
# software prints them.
_FY_INVOICE_NO = re.compile(r"\b([A-Z]{1,10}[/\-](?:\d{2}|\d{4})-\d{2}[/\-][A-Z0-9]{1,10})\b", re.I)
# Numbers that sit next to an invoice-number label but are something else.
_NOT_INVOICE_NO = re.compile(r"e\s*-?\s*way\s*$|ack\.?\s*$", re.I)
_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}
_DATE_PATTERNS = [
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b"), "dmy"),
    (re.compile(r"\b(\d{1,2})[\s\-/]*([A-Za-z]{3,9})[\s\-/,]*(\d{4}|\d{2})\b"), "dMy"),
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "ymd"),
]
_DATE_LABEL = re.compile(r"\b(?:invoice\s*date|bill\s*date|date|dated|dt)\b\.?\s*[:\-]?", re.I)
_QTY = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*(kilo\s*lit(?:re|er)s?|kls?|kgs?|kilo(?:gram)?s?|m\.?t\.?s?|tonnes?"
    r"|tons?|tn|lit(?:re|er)s?|ltrs?|lt)\b",
    re.I,
)
# Unit on the bill → (the unit we keep, how many of it in one bill unit).
_UNITS = {"KG": ("kg", 1), "MT": ("kg", 1000), "L": ("L", 1), "KL": ("L", 1000)}
_PERCENT = re.compile(r"\d+(?:\.\d+)?\s*%")
_HSN = re.compile(r"\b(4004\d{0,4}|4012\d{0,4}|7204\d{0,4}|4011\d{0,4}|2710\d{0,4}|2803\d{0,4})\b")
_TAX = re.compile(r"\b(cgst|sgst|igst|utgst)\b", re.I)
# Most specific first: a bare "Total" line is often the quantity total.
_TOTAL_LABELS = [
    re.compile(r"grand\s*total", re.I),
    re.compile(r"(?:invoice|bill)\s*(?:total|value|amount)|total\s*invoice\s*value", re.I),
    re.compile(r"amount\s*payable|net\s*(?:amount|payable)|total\s*amount", re.I),
    re.compile(r"\btotal\b", re.I),
]
_TAXABLE = re.compile(
    r"taxable\s*(?:value|amount|amt)|sub\s*-?\s*total|amount\s*before\s*tax", re.I
)
# "Bill To:", "Buyer:", "Consignee:" ... in front of a name.
_NOT_A_NAME = re.compile(
    r"invoice|gst|bill\s*to|ship\s*to|buyer|consignee|date|phone|mobile|email|state|pan|original|copy",
    re.I,
)

_MATERIAL_WORDS = [
    (
        "twowheeler",
        re.compile(r"two\s*-?\s*wheeler|2\s*-?\s*wheeler|\bbike\b|scooter|motor\s*cycle", re.I),
    ),
    (
        "otr",
        re.compile(r"\botr\b|earth\s*-?\s*mover|off\s*-?\s*the\s*-?\s*road|mining", re.I),
    ),
    ("tractor", re.compile(r"tractor|\bagri", re.I)),
    ("scrap_steel", re.compile(r"(?:scrap|waste)\s*steel|steel\s*scrap|ms\s*scrap", re.I)),
    ("truck", re.compile(r"\btbr\b|truck|\bbus\b|lorry|heavy", re.I)),
    ("car", re.compile(r"\bpcr\b|\bcar\b|passenger", re.I)),
]
_PRODUCT_WORDS = [
    ("oil", re.compile(r"pyrolysis\s*oil|\b(?:tyre|tire|fuel|furnace)\s*oil|\bl\.?d\.?o\b", re.I)),
    ("carbon", re.compile(r"carbon(?:\s*black|\s*powder)?|\bcbp\b", re.I)),
    ("rubber", re.compile(r"crumb|rubber\s*(?:granule|powder|crumb)|\bmesh\b|granule", re.I)),
    ("steel", re.compile(r"steel|\bwire\b|bead", re.I)),
    ("other", re.compile(r"fabric|fluff|fib(?:re|er)|nylon", re.I)),
]
# A purchase is of raw material. A sale is of products (Grade A) or re-sold material (Grade B).
_WORDS = {"purchase": _MATERIAL_WORDS, "sale": _PRODUCT_WORDS + _MATERIAL_WORDS}
_PRODUCT_ITEMS = frozenset(item for item, _ in _PRODUCT_WORDS)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scale(confidence: int, line_conf: float) -> int:
    return max(1, round(confidence * line_conf))


def _parse_date(text: str) -> date | None:
    for pattern, order in _DATE_PATTERNS:
        for m in pattern.finditer(text):
            a, b, c = m.groups()
            try:
                if order == "ymd":
                    d = date(int(a), int(b), int(c))
                elif order == "dMy":
                    month = _MONTHS.get(b[:3].lower())
                    if not month:
                        continue
                    d = date(int(c) + (2000 if len(c) == 2 else 0), month, int(a))
                else:
                    d = date(int(c) + (2000 if len(c) == 2 else 0), int(b), int(a))
            except ValueError:
                continue
            if date(2000, 1, 1) <= d <= today():
                return d
    return None


def _last_amount(line: str) -> Decimal | None:
    values = numbers_in(_PERCENT.sub(" ", line))
    return values[-1] if values else None


def _close(a: Decimal, b: Decimal, tolerance: Decimal = Decimal("0.005")) -> bool:
    return b != 0 and abs(a - b) <= abs(b) * tolerance + Decimal("1")


def find_rate_and_amount(qty: Decimal, values: list[Decimal]) -> tuple[Decimal, Decimal] | None:
    """Among the numbers on the item line, the (rate, amount) pair with qty × rate ≈ amount.
    Amounts are put in a sorted list so each rate is checked with one binary search:
    O(n log n) instead of trying every pair."""
    amounts = sorted(v for v in values if v > 0)
    for rate in values:
        if rate <= 0 or rate == qty:
            continue
        target = qty * rate
        i = bisect.bisect_left(amounts, target - abs(target) * Decimal("0.005") - 1)
        if i < len(amounts) and _close(amounts[i], target):
            return rate, amounts[i]
    return None


# ---------------------------------------------------------------------------
# Field finders
# ---------------------------------------------------------------------------


# Labels that introduce the other party on a bill: the seller on a purchase, the buyer on a sale.
_SELLER_LABEL = re.compile(r"^\s*(?:supplier|seller|sold\s*by|from)\b\s*[:\-]?\s*", re.I)
# Not "Buyer's Order No." or "Customer's Seal", which are other fields.
_BILL_TO = re.compile(
    r"^\s*(?:bill(?:ed)?\s*to|sold\s*to|buyer|customer)\b(?!'s)\s*[:\-]?\s*", re.I
)
_SHIP_TO = re.compile(r"^\s*(?:consignee|ship(?:ped)?\s*to)\b\s*[:\-]?\s*", re.I)
# Right-hand column labels that a PDF's text runs onto the end of a name, e.g.
# "Rathi Green Energy Private Limited Terms of Delivery".
_COLUMN_TAIL = re.compile(
    r"\s+(?:terms\s+of\s+(?:delivery|payment)|invoice\s*no|e\s*-?\s*way\s+bill|dated\b"
    r"|delivery\s+note|dispatch(?:ed)?\s+(?:doc|through)|destination|reference\s+no"
    r"|buyer'?s\s+order|mode\s*/\s*terms|other\s+references|motor\s+vehicle|bill\s+of\s+lading).*$",
    re.I,
)
# "for ESTHELL RUBBERS" beside "Authorised Signatory": the seller, as billing software prints it.
_FOR_NAME = re.compile(r"\bfor\s+([A-Za-z0-9&.,'()\- ]{4,80}?)\s*$", re.I)
_SIGNATORY = re.compile(r"authori[sz]ed\s+signator", re.I)


def _clean_name(text: str) -> str:
    # Bills print the tax number after the name on the same line; keep only the name.
    text = re.split(r"\bgst", text, flags=re.I)[0]
    return _COLUMN_TAIL.sub("", text).strip(" :-,")


def _name_like(text: str) -> bool:
    chars = sum(not ch.isspace() for ch in text)
    letters = sum(ch.isalpha() for ch in text)
    return (
        len(text) >= 4
        and ":" not in text
        and chars > 0
        and letters / chars >= 0.7  # not an IRN, code or address number
        and bool(re.search(r"[A-Za-z]{3}", text))
        and not _NOT_A_NAME.search(text)
    )


def _after_label(
    lines: list[str], conf: list[float], label: re.Pattern[str], same_line_only: bool = False
) -> Found | None:
    """The name after a label on the same line, or on one of the next two lines."""
    for i, line in enumerate(lines):
        if not (m := label.match(line)):
            continue
        rest = _clean_name(line[m.end() :])
        if _name_like(rest):
            return Found(rest, _scale(75, conf[i]), "label")
        if same_line_only:
            continue
        for j in range(i + 1, min(i + 3, len(lines))):
            candidate = _clean_name(lines[j])
            if _name_like(candidate):
                return Found(candidate, _scale(65, conf[j]), "label")
    return None


def _signatory(lines: list[str], conf: list[float]) -> Found | None:
    for i, line in enumerate(lines):
        if (m := _FOR_NAME.search(line)) and any(
            _SIGNATORY.search(near) for near in lines[max(0, i - 2) : i + 3]
        ):
            name = _clean_name(m.group(1))
            if _name_like(name):
                return Found(name, _scale(80, conf[i]), "pattern")
    return None


def _heading(lines: list[str], conf: list[float]) -> Found | None:
    """The seller's name is normally the first real line at the top of the bill."""
    for i, line in enumerate(lines[:8]):
        candidate = _clean_name(line)
        if _name_like(candidate):
            return Found(candidate, _scale(55, conf[i]), "pattern")
    return None


def _party(bill: ParsedBill, lines: list[str], conf: list[float], kind: str) -> None:
    """The supplier on a purchase bill, or the buyer on a sales invoice."""
    if kind == "purchase":
        # "Supplier: X" on one line is explicit. A label with the name on the next line is
        # tried last: in two-column layouts that line often holds both parties.
        bill.party_name = (
            _after_label(lines, conf, _SELLER_LABEL, same_line_only=True)
            or _signatory(lines, conf)
            or _heading(lines, conf)
            or _after_label(lines, conf, _SELLER_LABEL)
        )
    else:
        bill.party_name = _after_label(lines, conf, _BILL_TO) or _after_label(lines, conf, _SHIP_TO)


def _invoice(bill: ParsedBill, lines: list[str], conf: list[float], qr: EInvoice | None) -> None:
    if qr and qr.invoice_no:
        bill.invoice_no = Found(qr.invoice_no, 99, "qr")
    else:
        for i, line in enumerate(lines):
            for m in _INVOICE_NO.finditer(line):
                value = m.group(1).rstrip(".-/")
                if _NOT_INVOICE_NO.search(line[: m.start()]) or not any(
                    ch.isdigit() for ch in value
                ):
                    continue
                bill.invoice_no = Found(value, _scale(88, conf[i]), "label")
                break
            if bill.invoice_no:
                break
        if not bill.invoice_no:
            # Labels and values in separate table rows: fall back to the usual number shape.
            for i, line in enumerate(lines):
                if m := _FY_INVOICE_NO.search(line):
                    bill.invoice_no = Found(m.group(1), _scale(80, conf[i]), "pattern")
                    break
    if qr and qr.invoice_date:
        bill.invoice_date = Found(qr.invoice_date, 99, "qr")
        return
    # A date right after a "Date" label first; otherwise the first sensible date anywhere.
    for i, line in enumerate(lines):
        if m := _DATE_LABEL.search(line):
            if d := _parse_date(line[m.end() :]):
                bill.invoice_date = Found(d, _scale(90, conf[i]), "label")
                return
    for i, line in enumerate(lines):
        if d := _parse_date(line):
            bill.invoice_date = Found(d, _scale(65, conf[i]), "pattern")
            return


def _item_line(lines: list[str], kind: str) -> int | None:
    """The line describing the goods: has an HSN code, or a quantity with a unit, or keywords."""
    words = _WORDS[kind]
    scored = []
    for i, line in enumerate(lines):
        if _TAX.search(line) or any(p.search(line) for p in _TOTAL_LABELS[:3]):
            continue
        score = (
            bool(_HSN.search(line)) * 3
            + bool(_QTY.search(line)) * 2
            + any(w.search(line) for _, w in words) * 2
        )
        score += len(numbers_in(line)) >= 3
        if score >= 3:
            scored.append((score, -i, i))
    return max(scored)[2] if scored else None


def _bill_unit(text: str) -> str:
    t = re.sub(r"[\s.]", "", text.lower())
    if t.startswith(("kilol", "kl")):
        return "KL"
    if t.startswith("k"):
        return "KG"
    if t.startswith("l"):
        return "L"
    return "MT"


def _goods(
    bill: ParsedBill, lines: list[str], conf: list[float], kind: str, qr: EInvoice | None
) -> None:
    words = _WORDS[kind]
    idx = _item_line(lines, kind)
    # Descriptions are sometimes on the line above the numbers.
    context = [lines[idx]] + ([lines[idx - 1]] if idx else []) if idx is not None else lines
    line_conf = conf[idx] if idx is not None else 1.0
    if idx is not None:
        bill.item_text = lines[idx]
    for item, pattern in words:
        if any(pattern.search(t) for t in context):
            bill.item = Found(item, _scale(85 if idx is not None else 60, line_conf), "pattern")
            if kind == "sale":
                bill.grade = "A" if item in _PRODUCT_ITEMS else "B"
            break
    if m := _HSN.search(" ".join(context)):
        bill.hsn = m.group(1)
    elif qr and qr.hsn:
        bill.hsn = qr.hsn

    qty_match = next((m for t in context if (m := _QTY.search(t))), None) or next(
        (m for t in lines if (m := _QTY.search(t))), None
    )
    if not qty_match:
        return
    qty = numbers_in(qty_match.group(1))[0]
    unit = _bill_unit(qty_match.group(2))
    bill.unit_on_bill = unit
    bill.unit, factor = _UNITS[unit]
    scale = Decimal(factor)
    bill.qty_on_bill = Found(qty, _scale(85, line_conf), "pattern")
    bill.qty = Found(qty * scale, bill.qty_on_bill.confidence, "pattern")

    if idx is not None:
        hsn = bill.hsn
        line = _PERCENT.sub(" ", lines[idx])

        def candidates(text: str) -> list[Decimal]:
            return [v for v in numbers_in(text) if str(v) != hsn]

        # Rate and amount come after the quantity on the line; the serial number before it
        # ("1 ... 11,060 KGS") would otherwise pass as a rate of 1.
        on_line = _QTY.search(line)
        pair = find_rate_and_amount(qty, candidates(line[on_line.end() :])) if on_line else None
        if pair or (pair := find_rate_and_amount(qty, candidates(line))):
            rate, amount = pair
            bill.rate_on_bill = Found(rate, _scale(92, line_conf), "arithmetic")
            bill.rate = Found(
                (rate / scale).quantize(Decimal("0.0001")),
                bill.rate_on_bill.confidence,
                "arithmetic",
            )
            bill.taxable_amount = Found(amount, _scale(92, line_conf), "arithmetic")
            # Quantity, rate and amount agreeing is strong evidence all three were read right.
            bill.qty_on_bill.confidence = bill.qty.confidence = max(
                bill.qty.confidence, _scale(95, line_conf)
            )


def _money(bill: ParsedBill, lines: list[str], conf: list[float], qr: EInvoice | None) -> None:
    tax = Decimal(0)
    tax_conf = 100
    seen: set[str] = set()
    for i, line in enumerate(lines):
        kinds = {k.lower() for k in _TAX.findall(line)}
        # One line per tax (CGST, SGST, ...), counted once: summary tables and the e-way bill
        # repeat the same figures, and a line naming several taxes is one of those summaries.
        if len(kinds) == 1 and not (kinds & seen) and (amount := _last_amount(line)) is not None:
            seen |= kinds
            tax += amount
            tax_conf = min(tax_conf, _scale(85, conf[i]))
        elif not bill.taxable_amount and _TAXABLE.search(line) and (amount := _last_amount(line)):
            bill.taxable_amount = Found(amount, _scale(85, conf[i]), "label")
    if tax:
        bill.tax_amount = Found(tax, tax_conf, "label")

    if qr and qr.total is not None:
        bill.total = Found(qr.total, 99, "qr")
    else:
        for pattern in _TOTAL_LABELS:
            hits = [
                (amount, i)
                for i, line in enumerate(lines)
                if pattern.search(line) and (amount := _last_amount(line))
            ]
            if hits:
                amount, i = max(hits)
                bill.total = Found(amount, _scale(85, conf[i]), "label")
                break

    # Rate from the taxable value when the item line did not give a clean rate.
    if bill.qty and not bill.rate and bill.taxable_amount and bill.qty.value:
        rate = (bill.taxable_amount.value / bill.qty.value).quantize(Decimal("0.0001"))
        bill.rate = Found(rate, 60, "arithmetic")

    if bill.taxable_amount and bill.total:
        expected = bill.taxable_amount.value + (bill.tax_amount.value if bill.tax_amount else 0)
        if _close(expected, bill.total.value, Decimal("0.002")):
            bill.total.confidence = max(bill.total.confidence, 95)
        else:
            bill.warnings.append("Amount + tax does not add up to the total read from the bill")


def parse_lines(lines: list[str], conf: list[float], kind: str, qr: EInvoice | None) -> ParsedBill:
    bill = ParsedBill(einvoice=qr is not None)
    _party(bill, lines, conf, kind)
    _invoice(bill, lines, conf, qr)
    _goods(bill, lines, conf, kind, qr)
    _money(bill, lines, conf, qr)
    if not lines:
        bill.warnings.append("No text could be read from this file")
    return bill
