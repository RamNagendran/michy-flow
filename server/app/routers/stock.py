from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.errors import AppError
from app.schemas.stock import CompanyStock, CompanySummary
from app.services import stock_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["stock"])

# A year and a bit: enough for any report, small enough to keep the query cheap.
_MAX_RANGE_DAYS = 400


@router.get("/stock", response_model=CompanyStock)
async def stock(
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> CompanyStock:
    """Stock right now, per tyre type and per output product."""
    return await stock_service.company_stock(db, ctx.company.id)


@router.get("/summary", response_model=CompanySummary)
async def summary(
    date_from: date = Query(...),
    date_to: date = Query(...),
    # Money figures for the whole company: not for operators, who only see their own entries.
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_ALL_ENTRIES)),
    db: AsyncSession = Depends(get_db),
) -> CompanySummary:
    if date_to < date_from:
        raise AppError("date_to is before date_from")
    if (date_to - date_from).days > _MAX_RANGE_DAYS:
        raise AppError(f"Choose a range of at most {_MAX_RANGE_DAYS} days")
    return await stock_service.company_summary(db, ctx.company.id, date_from, date_to)
