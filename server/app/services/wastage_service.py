"""Wastage control: the fixed wastage rate and the Manager's stock checks.

- Every production run counts WASTAGE_ALERT_PCT of its output as wastage (entry_service).
  Each month's total goes to the Super Admin for approval (wastage_month_service).
- Stock checks: every 1 or 3 months the Manager counts the physical stock; each difference from
  the book stock is recorded and adjusts the stock from then on.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import today
from app.core.config import settings
from app.core.errors import ForbiddenError, InvalidError
from app.models import StockCheck, StockCheckLine, User
from app.models.catalog import unit_of
from app.schemas.wastage import (
    CountLineRead,
    StockCheckInput,
    StockCheckRead,
)
from app.services import stock_service
from app.services.access_service import CompanyContext

HARD_LIMIT = Decimal(str(settings.WASTAGE_ALERT_PCT))
_GRADE_OF_SECTION = {"raw": "A", "output": "A", "resale": "B"}


def _require(ctx: CompanyContext) -> None:
    if not ctx.can(P.ADJUST_WASTAGE):
        raise ForbiddenError("Only the Manager manages wastage")


# ---------------------------------------------------------------------------
# Stock checks
# ---------------------------------------------------------------------------


async def record_check(db: AsyncSession, ctx: CompanyContext, data: StockCheckInput) -> StockCheck:
    """Compare the Manager's physical count with the book stock and record the differences."""
    _require(ctx)
    if data.counted_on > today():
        raise InvalidError("The count date cannot be in the future")
    await stock_service.lock_company(db, ctx.company.id)
    stock = await stock_service.company_stock(db, ctx.company.id)
    book = {
        (section, line.item): Decimal(str(line.provisional.balance))
        for section in ("raw", "output", "resale")
        for line in getattr(stock, section)
    }
    check = StockCheck(
        company_id=ctx.company.id,
        counted_on=data.counted_on,
        note=data.note,
        counted_by_id=ctx.user.id,
    )
    for line in data.lines:
        key = (line.section, line.item)
        if key not in book:
            raise InvalidError(f"{line.item} is not kept in this stock", code="unknown_item")
        check.lines.append(
            StockCheckLine(
                company_id=ctx.company.id,
                grade=_GRADE_OF_SECTION[line.section],
                section=line.section,
                item=line.item,
                book_qty=book[key],
                counted_qty=line.counted_qty,
                difference=book[key] - line.counted_qty,
            )
        )
    db.add(check)
    await stock_service.assert_stock_not_negative(db, ctx.company.id)
    await db.commit()
    return check


async def list_checks(db: AsyncSession, company_id: int, limit: int = 24) -> list[StockCheckRead]:
    rows = await db.execute(
        select(StockCheck, User.full_name)
        .outerjoin(User, User.id == StockCheck.counted_by_id)
        .where(StockCheck.company_id == company_id)
        .order_by(StockCheck.counted_on.desc(), StockCheck.id.desc())
        .limit(limit)
    )
    return [
        StockCheckRead(
            id=c.id,
            counted_on=c.counted_on,
            note=c.note,
            counted_by_name=name,
            created_at=c.created_at,
            lines=[
                CountLineRead(
                    section=line.section,
                    grade=line.grade,
                    item=line.item,
                    unit=unit_of(line.item),
                    book_qty=line.book_qty,
                    counted_qty=line.counted_qty,
                    difference=line.difference,
                )
                for line in c.lines
            ],
        )
        for c, name in rows
    ]
