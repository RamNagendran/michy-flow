"""Wastage control: the Super Admin's stock checks.

- Each production run's wastage is entered by the in-charge; each month's total goes to the
  Super Admin for approval (wastage_month_service).
- Stock checks: every 1 or 3 months the Super Admin counts the physical stock; each difference
  from the book stock is recorded and corrects the stock at once. Raw material found missing is
  also added to the month's wastage (without moving stock again), so the Super Admin does not
  take it out a second time when approving the month.
- A count is only for today, and only when no entry is waiting for the Manager: their goods may
  already have moved while the stock does not show them yet, so they would be counted twice.
"""

from decimal import Decimal

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import today
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, InvalidError
from app.models import StockCheck, StockCheckLine, User
from app.models.catalog import unit_of
from app.schemas.wastage import (
    CountLineRead,
    StockCheckInput,
    StockCheckRead,
)
from app.services import audit_service, stock_service
from app.services.access_service import CompanyContext

HARD_LIMIT = Decimal(str(settings.WASTAGE_ALERT_PCT))
_GRADE_OF_SECTION = {"raw": "A", "output": "A", "resale": "B"}


def _require(ctx: CompanyContext) -> None:
    if not ctx.can(P.COUNT_STOCK):
        raise ForbiddenError("Only the Super Admin can count the stock")


# ---------------------------------------------------------------------------
# Stock checks
# ---------------------------------------------------------------------------


async def record_check(
    db: AsyncSession, ctx: CompanyContext, data: StockCheckInput, request: Request | None = None
) -> StockCheck:
    """Compare the Super Admin's physical count with the book stock and record the differences."""
    _require(ctx)
    counted_on = data.counted_on or today()
    if counted_on != today():
        raise InvalidError("A stock count can only be for today", code="count_not_today")
    await stock_service.lock_company(db, ctx.company.id)
    if waiting := await stock_service.entries_waiting(db, ctx.company.id):
        raise ConflictError(
            f"{waiting} entr{'y is' if waiting == 1 else 'ies are'} waiting for the Manager. "
            "Approve or reject them first, then count the stock.",
            code="entries_waiting",
        )
    stock = await stock_service.stock_lines(db, ctx.company)
    book = {
        (section, line.item): Decimal(str(line.provisional.balance))
        for section in ("raw", "output", "resale")
        for line in stock[section]
    }
    check = StockCheck(
        company_id=ctx.company.id,
        counted_on=counted_on,
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
    await db.flush()
    audit_service.record(
        db,
        account_id=ctx.user.account_id,
        actor=ctx.user,
        action="stock_counted",
        entity_type="stock_check",
        entity_id=check.id,
        company_id=ctx.company.id,
        details={
            "counted_on": counted_on.isoformat(),
            "note": data.note,
            # Only the items whose count differs from the book.
            "differences": {
                ln.item: [str(ln.book_qty), str(ln.counted_qty)]
                for ln in check.lines
                if ln.difference
            },
        },
        request=request,
    )
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
