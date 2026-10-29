"""Grouping dates into days, weeks, months and years, the same way in SQL and in Python."""

from datetime import date, timedelta

from sqlalchemy import Date, cast, func, literal_column
from sqlalchemy.sql.elements import ColumnElement

from app.core.clock import add_months

UNITS = ("day", "week", "month", "year")


def truncate(column: ColumnElement, unit: str) -> ColumnElement[date]:
    """date_trunc as a date. The unit is inlined (not a bound parameter) so the same
    expression can appear in SELECT and GROUP BY; it is whitelisted, so nothing is injected."""
    if unit not in UNITS:
        raise ValueError(f"unknown period unit {unit!r}")
    return cast(func.date_trunc(literal_column(f"'{unit}'"), column), Date)


def start_of(d: date, unit: str) -> date:
    """Python's twin of truncate(): weeks start on Monday, like Postgres."""
    if unit == "week":
        return d - timedelta(days=d.weekday())
    if unit == "month":
        return d.replace(day=1)
    if unit == "year":
        return d.replace(month=1, day=1)
    return d


def periods(d_from: date, d_to: date, unit: str) -> list[date]:
    """Every period start from d_from's period up to d_to, so empty periods show as zeros."""
    out, d = [], start_of(d_from, unit)
    while d <= d_to:
        out.append(d)
        if unit in ("month", "year"):
            d = add_months(d, 12 if unit == "year" else 1)
        else:
            d += timedelta(days=7 if unit == "week" else 1)
    return out
