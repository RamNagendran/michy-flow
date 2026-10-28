from datetime import date

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.models.enums import EntryType
from app.realtime import events
from app.routers._range import Range, report_range
from app.schemas.entries import EntryDetail
from app.schemas.wastage import (
    AllowanceInput,
    AllowanceRead,
    DebitNoteInput,
    PendingDebitNote,
    StockCheckInput,
    StockCheckRead,
    WastageMonth,
)
from app.services import entry_query, wastage_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["wastage"])

_see = require_company_permission(P.VIEW_ALL_ENTRIES)
_manage = require_company_permission(P.ADJUST_WASTAGE)


@router.get("/wastage", response_model=list[WastageMonth])
async def wastage_by_month(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(_see),
    db: AsyncSession = Depends(get_db),
) -> list[WastageMonth]:
    return await wastage_service.monthly(db, ctx.company.id, r.date_from, r.date_to)


@router.get("/wastage/allowances", response_model=list[AllowanceRead])
async def list_allowances(
    ctx: CompanyContext = Depends(_see), db: AsyncSession = Depends(get_db)
) -> list[AllowanceRead]:
    return await wastage_service.list_allowances(db, ctx.company.id)


@router.put("/wastage/allowances", status_code=status.HTTP_204_NO_CONTENT)
async def declare_allowance(
    data: AllowanceInput,
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> None:
    """The Manager declares the month's allowed wastage (up to 2%)."""
    await wastage_service.declare(db, ctx, data)
    await events.company_changed(ctx.company)


@router.get("/debit-notes/pending", response_model=list[PendingDebitNote])
async def pending_debit_notes(
    ctx: CompanyContext = Depends(_see), db: AsyncSession = Depends(get_db)
) -> list[PendingDebitNote]:
    return await wastage_service.pending_notes(db, ctx.company.id)


@router.post(
    "/production/{production_id}/debit-note",
    response_model=EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
async def add_debit_note(
    data: DebitNoteInput,
    production_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    run = await wastage_service.add_note(db, ctx, production_id, data)
    detail = await entry_query.detail(db, ctx, EntryType.PRODUCTION, run)
    await events.entry_changed(EntryType.PRODUCTION, run, "debit_note", ctx.user)
    return detail


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
