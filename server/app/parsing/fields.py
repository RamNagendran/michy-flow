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
from app.parsing.numbers import find_gstins, numbers_in
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
    party_gstin: Found | None = None
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
    addressed_to_us: bool | None = None
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

_INVOICE_NO = re.compile(
    r"(?:invoice|inv|bill|voucher)\s*(?:no|number|num|#)\.?\s*[:\-#.]?\s*([A-Z0-9][A-Z0-9/\-_.]{0,39})",
    re.I,
)
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
_PARTY_LABEL = re.compile(
    r"^\s*(?:bill(?:ed)?\s*to|ship(?:ped)?\s*to|sold\s*to|buyer|consignee|customer|party|supplier|seller|from|to)\b\s*[:\-]?\s*",
    re.I,
)
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


def _party(
    bill: ParsedBill,
    lines: list[str],
    conf: list[float],
    kind: str,
    own_gstin: str | None,
    qr: EInvoice | None,
) -> None:
    text = "\n".join(lines)
    gstins = find_gstins(text)
    found = [g for g, _ in gstins]
    if own_gstin:
        bill.addressed_to_us = own_gstin in found or (
            qr is not None and own_gstin in (qr.seller_gstin, qr.buyer_gstin)
        )
    others = [(g, ok) for g, ok in gstins if g != own_gstin]

    if qr:
        party = qr.seller_gstin if kind == "purchase" else qr.buyer_gstin
        if party:
            bill.party_gstin = Found(party, 99, "qr")
    elif others:
        gstin, checksum_ok = others[0]
        bill.party_gstin = Found(gstin, 92 if checksum_ok else 65, "pattern")
        if not checksum_ok:
            bill.warnings.append(f"GSTIN {gstin} fails its check digit — it may be misread")

    # The party's name: text before "GSTIN" on its line, or the nearest name-like line above.
    if bill.party_gstin:
        target = bill.party_gstin.value
        for i, line in enumerate(lines):
            if target in line.upper().replace(" ", ""):
                before = re.split(r"gstin|gst\s*no", line, flags=re.I)[0].strip(" :-,")
                before = _PARTY_LABEL.sub("", before).strip(" :-,")
                if len(before) >= 4 and not _NOT_A_NAME.search(before):
                    bill.party_name = Found(before, _scale(70, conf[i]), "pattern")
                    return
                for j in range(i - 1, max(i - 4, -1), -1):
                    # Another GSTIN above means we have walked into the other party's block.
                    if find_gstins(lines[j]):
                        break
                    candidate = _PARTY_LABEL.sub("", lines[j]).strip(" :-,")
                    if (
                        len(candidate) >= 4
                        and re.search(r"[A-Za-z]{3}", candidate)
                        and not _NOT_A_NAME.search(candidate)
                    ):
                        bill.party_name = Found(candidate, _scale(60, conf[j]), "pattern")
                        return
    if not bill.party_name and kind == "purchase" and lines and not _NOT_A_NAME.search(lines[0]):
        # The seller's name is normally the bill's heading.
        bill.party_name = Found(lines[0].strip(), _scale(50, conf[0]), "pattern")


def _invoice(bill: ParsedBill, lines: list[str], conf: list[float], qr: EInvoice | None) -> None:
    if qr and qr.invoice_no:
        bill.invoice_no = Found(qr.invoice_no, 99, "qr")
    else:
        for i, line in enumerate(lines):
            if m := _INVOICE_NO.search(line):
                value = m.group(1).rstrip(".-/")
                if any(ch.isdigit() for ch in value):
                    bill.invoice_no = Found(value, _scale(88, conf[i]), "label")
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
        values = [v for v in numbers_in(_PERCENT.sub(" ", lines[idx])) if str(v) != hsn]
        if pair := find_rate_and_amount(qty, values):
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
    for i, line in enumerate(lines):
        if _TAX.search(line) and (amount := _last_amount(line)) is not None:
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
            bill.warnings.append("Amount + GST does not add up to the total read from the bill")


def parse_lines(
    lines: list[str], conf: list[float], kind: str, own_gstin: str | None, qr: EInvoice | None
) -> ParsedBill:
    bill = ParsedBill(einvoice=qr is not None)
    _party(bill, lines, conf, kind, own_gstin, qr)
    _invoice(bill, lines, conf, qr)
    _goods(bill, lines, conf, kind, qr)
    _money(bill, lines, conf, qr)
    if bill.addressed_to_us is False:
        bill.warnings.append(
            "Your company's GSTIN is not on this bill — check it is the right bill"
        )
    if not lines:
        bill.warnings.append("No text could be read from this file")
    return bill
