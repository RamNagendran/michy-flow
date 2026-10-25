"""Numbers as they appear on Indian bills."""

import re
from decimal import Decimal, InvalidOperation

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
