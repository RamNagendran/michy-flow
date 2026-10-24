"""Numbers as they appear on Indian bills, and GSTIN checks."""

import re
from decimal import Decimal, InvalidOperation

# 1,20,132.00 · 120132.00 · 8.460 · 14,200
NUMBER = re.compile(
    r"(?<![\w/])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\w/])|(?<![\w/])\d+(?:\.\d+)?(?![\w/])"
)

_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_GSTIN_SHAPE = re.compile(r"^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
# Positions that must be digits / letters in a GSTIN (0-based), for undoing OCR mix-ups.
_DIGIT_POS = {0, 1, 7, 8, 9, 10}
_LETTER_POS = {2, 3, 4, 5, 6, 11}
_TO_DIGIT = str.maketrans(
    {"O": "0", "D": "0", "Q": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
)
_TO_LETTER = str.maketrans({"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G"})
GSTIN_CANDIDATE = re.compile(r"\b[0-9OIL][0-9OIL][A-Z0-9]{5}[0-9A-Z]{4}[A-Z0-9][0-9A-Z]Z[0-9A-Z]\b")


def to_decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def numbers_in(line: str) -> list[Decimal]:
    return [n for n in (to_decimal(m.group()) for m in NUMBER.finditer(line)) if n is not None]


def gstin_checksum_ok(gstin: str) -> bool:
    """The 15th character is a mod-36 check over the first 14 (GSTN's published scheme)."""
    total = 0
    for i, ch in enumerate(gstin[:14]):
        product = _GSTIN_CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36] == gstin[14]


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


def find_gstins(text: str) -> list[tuple[str, bool]]:
    """Every GSTIN on the bill, in order, as (gstin, checksum passed). Duplicates dropped."""
    seen: dict[str, bool] = {}
    # Per line, spaces removed: OCR often splits a GSTIN, but never across lines.
    for line in text.upper().splitlines():
        for match in GSTIN_CANDIDATE.finditer(line.replace(" ", "")):
            gstin = repair_gstin(match.group())
            if gstin and gstin not in seen:
                seen[gstin] = gstin_checksum_ok(gstin)
    return list(seen.items())
