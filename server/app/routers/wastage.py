from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.models import User
from app.realtime import events
from app.routers._range import Range, report_range
from app.schemas.wastage import (
    StockCheckInput,
    StockCheckRead,
    WastageApproval,
    WastageChange,
    WastageComment,
    WastageMonth,
    WastageMonthDetail,
    WastageQueue,
)
from app.services import wastage_month_service, wastage_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["wastage"])
queue_router = APIRouter(tags=["wastage"])

_see = require_company_permission(P.VIEW_ALL_ENTRIES)
_manage = require_company_permission(P.ADJUST_WASTAGE)
_approve = require_company_permission(P.APPROVE_WASTAGE)
_talk = require_company_permission(P.APPROVE_WASTAGE, P.ADJUST_WASTAGE)

_STEPS = {
    "escalate": wastage_month_service.escalate,
    "resend": wastage_month_service.resend,
    "comment": wastage_month_service.comment,
}
_EVENT = {"escalate": "escalated", "resend": "resent", "comment": "commented"}


@router.get("/wastage", response_model=list[WastageMonth])
async def wastage_by_month(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(_see),
    db: AsyncSession = Depends(get_db),
) -> list[WastageMonth]:
    """Each month's wastage and where it is in the Super Admin's approval."""
    return await wastage_month_service.months(db, ctx.company.id, r.date_from, r.date_to)


@router.get("/wastage/months/{month}", response_model=WastageMonthDetail)
async def wastage_month(
    month: date, ctx: CompanyContext = Depends(_see), db: AsyncSession = Depends(get_db)
) -> WastageMonthDetail:
    return await wastage_month_service.detail(db, ctx, month)


async def _done(
    db: AsyncSession,
    ctx: CompanyContext,
    record,
    action: str,  # noqa: ANN001
) -> WastageMonthDetail:
    await events.wastage_changed(ctx.company, record.month, action, ctx.user)
    return await wastage_month_service.detail(db, ctx, record.month)


@router.post("/wastage/months/{month}/actions/{action}", response_model=WastageMonthDetail)
async def act_on_month(
    month: date,
    action: Literal["escalate", "resend", "comment"],
    data: WastageComment,
    request: Request,
    ctx: CompanyContext = Depends(_talk),
    db: AsyncSession = Depends(get_db),
) -> WastageMonthDetail:
    """escalate: Super Admin → Manager. resend: Manager → Super Admin. comment: either."""
    step = _STEPS[action]
    record = await step(db, ctx, month, data.comment, request)
    return await _done(db, ctx, record, _EVENT[action])


@router.put("/wastage/months/{month}", response_model=WastageMonthDetail)
async def change_month(
    month: date,
    data: WastageChange,
    request: Request,
    ctx: CompanyContext = Depends(_approve),
    db: AsyncSession = Depends(get_db),
) -> WastageMonthDetail:
    """Only the Super Admin changes a month's wastage. Stock moves when they approve it."""
    record = await wastage_month_service.change(db, ctx, month, data, request)
    return await _done(db, ctx, record, "changed")


@router.post("/wastage/approve", response_model=list[WastageMonth])
async def approve_months(
    data: WastageApproval,
    request: Request,
    ctx: CompanyContext = Depends(_approve),
    db: AsyncSession = Depends(get_db),
) -> list[WastageMonth]:
    """The Super Admin approves one month or several at once."""
    records = await wastage_month_service.approve(db, ctx, data, request)
    for record in records:
        await events.wastage_changed(ctx.company, record.month, "approved", ctx.user)
    first, last = records[0].month, records[-1].month
    return await wastage_month_service.months(db, ctx.company.id, first, last)


@queue_router.get("/wastage/queue", response_model=list[WastageQueue])
async def wastage_queue(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[WastageQueue]:
    """Months waiting on the caller, per company."""
    return await wastage_month_service.queue(db, user)


@router.get("/stock-checks", response_model=list[StockCheckRead])
async def list_stock_checks(
    ctx: CompanyContext = Depends(_see), db: AsyncSession = Depends(get_db)
) -> list[StockCheckRead]:
    return await wastage_service.list_checks(db, ctx.company.id)


@router.post("/stock-checks", status_code=status.HTTP_201_CREATED)
async def record_stock_check(
    data: StockCheckInput,
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int | date]:
    """The Manager's physical count. Differences from the book stock adjust it from now on."""
    check = await wastage_service.record_check(db, ctx, data)
    await events.stock_checked(ctx.company, ctx.user)
    return {"id": check.id, "counted_on": check.counted_on}
