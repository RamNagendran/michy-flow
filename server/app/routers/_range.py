"""Shared query parameters for reports: a date range and how to group it."""

from dataclasses import dataclass
from datetime import date

from fastapi import Query

from app.core.errors import InvalidError

# Day points for up to four months, weeks for a little over a year, months for three years,
# years for ten.
_MAX_DAYS = {"day": 120, "week": 400, "month": 1100, "year": 3660}


@dataclass(frozen=True, slots=True)
class Range:
    date_from: date
    date_to: date
    bucket: str


def _auto_bucket(days: int) -> str:
    if days <= 45:
        return "day"
    if days <= 200:
        return "week"
    return "month" if days <= _MAX_DAYS["month"] else "year"


def report_range(
    date_from: date = Query(...),
    date_to: date = Query(...),
    bucket: str | None = Query(None, pattern="^(day|week|month|year)$"),
) -> Range:
    """Validated range. Without a bucket, one is picked so charts have a sensible point count."""
    if date_to < date_from:
        raise InvalidError("date_to is before date_from")
    days = (date_to - date_from).days
    unit = bucket or _auto_bucket(days)
    if days > _MAX_DAYS[unit]:
        raise InvalidError(f"Choose at most {_MAX_DAYS[unit]} days when grouping by {unit}")
    return Range(date_from, date_to, unit)
