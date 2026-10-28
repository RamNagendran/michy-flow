"""GST numbers (GSTIN): state code, PAN, entity number, "Z", then a check character."""

import re

_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SHAPE = re.compile(r"^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def checksum_ok(gstin: str) -> bool:
    """The 15th character is a mod-36 check over the first 14 (GSTN's published scheme)."""
    total = 0
    for i, ch in enumerate(gstin[:14]):
        product = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return _CHARS[(36 - total % 36) % 36] == gstin[14]


def clean(value: str | None) -> str | None:
    """A typed GST number, upper-cased and checked. Empty means none."""
    if value is None or not value.strip():
        return None
    value = re.sub(r"\s+", "", value).upper()
    if not SHAPE.fullmatch(value) or not checksum_ok(value):
        raise ValueError("this GST number is not correct, please check it")
    return value
