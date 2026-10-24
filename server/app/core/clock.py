from calendar import monthrange
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def now() -> datetime:
    return datetime.now(UTC)


def today() -> date:
    """Today's date where the business runs, not where the server happens to be."""
    return datetime.now(ZoneInfo(settings.TIMEZONE)).date()


def add_months(d: date, months: int) -> date:
    """The same day `months` later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb)."""
    index = d.month - 1 + months
    year, month = d.year + index // 12, index % 12 + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))


def month_start(d: date) -> date:
    return d.replace(day=1)
