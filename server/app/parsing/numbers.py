"""Numbers as they appear on Indian bills, and GST numbers."""

import re
from decimal import Decimal, InvalidOperation

from app.core.gstin import SHAPE as _GSTIN_SHAPE
from app.core.gstin import checksum_ok

# 1,20,132.00 · 120132.00 · 8.460 · 14,200
NUMBER = re.compile(
    r"(?<![\w/])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\w/])|(?<![\w/])\d+(?:\.\d+)?(?![\w/])"
)


def to_decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def numbers_in(line: str) -> list[Decimal]:
    return [n for n in (to_decimal(m.group()) for m in NUMBER.finditer(line)) if n is not None]


# Positions that must be digits / letters in a GST number (0-based), for undoing OCR mix-ups.
_DIGIT_POS = {0, 1, 7, 8, 9, 10}
_LETTER_POS = {2, 3, 4, 5, 6, 11}
_TO_DIGIT = str.maketrans(
    {"O": "0", "D": "0", "Q": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
)
_TO_LETTER = str.maketrans({"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G"})
GSTIN_CANDIDATE = re.compile(r"[0-9OIL][0-9OIL][A-Z0-9]{5}[0-9A-Z]{4}[A-Z0-9][0-9A-Z]Z[0-9A-Z]")


def repair_gstin(raw: str) -> str | None:
    """Undo common OCR swaps (O↔0, S↔5, ...) using where digits and letters must be."""
    raw = raw.upper()
    if len(raw) != 15:
        return None
    fixed = "".join(
        ch.translate(_TO_DIGIT)
        if i in _DIGIT_POS
        else ch.translate(_TO_LETTER)
        if i in _LETTER_POS
        else ch
        for i, ch in enumerate(raw)
    )
    return fixed if _GSTIN_SHAPE.fullmatch(fixed) else None


def gstins_in(line: str) -> list[tuple[str, bool]]:
    """GST numbers on one line as (gstin, check digit passed). OCR often splits a GST number
    with spaces, but never across lines, so spaces are removed first."""
    found = []
    for match in GSTIN_CANDIDATE.finditer(line.upper().replace(" ", "")):
        gstin = repair_gstin(match.group())
        if gstin and all(g != gstin for g, _ in found):
            found.append((gstin, checksum_ok(gstin)))
    return found
