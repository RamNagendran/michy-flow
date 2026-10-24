from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.errors import InvalidError
from app.models.catalog import INPUT_CHOICES
from app.routers._range import Range, report_range
from app.schemas.analytics import OilKpi, PriceHistory, ProductionReport, TrendPoint
from app.services import analytics_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["analytics"])


@router.get("/trends", response_model=list[TrendPoint])
async def trends(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_ALL_ENTRIES)),
    db: AsyncSession = Depends(get_db),
) -> list[TrendPoint]:
    """Purchases, sales, production and wastage per day, week or month."""
    return await analytics_service.trends(db, ctx.company.id, r.date_from, r.date_to, r.bucket)


@router.get("/oil-kpi", response_model=OilKpi)
async def oil_kpi(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_OIL_KPI)),
    db: AsyncSession = Depends(get_db),
) -> OilKpi:
    """Oil production % of the weight processed. Only the CEO and Managers (and Super Admin)."""
    return await analytics_service.oil_kpi(db, ctx.company, r.date_from, r.date_to, r.bucket)


@router.get("/prices", response_model=PriceHistory)
async def prices(
    item: str = Query(..., max_length=20),
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_FINANCE)),
    db: AsyncSession = Depends(get_db),
) -> PriceHistory:
    """What each supplier charged for one item, against the average, over time."""
    if item not in INPUT_CHOICES:
        raise InvalidError("Unknown item")
    return await analytics_service.prices(
        db, ctx.company.id, item, r.date_from, r.date_to, r.bucket
    )


@router.get("/production-report", response_model=ProductionReport)
async def production_report(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_ALL_ENTRIES)),
    db: AsyncSession = Depends(get_db),
) -> ProductionReport:
    """Running hours and throughput per shift and per operator."""
    return await analytics_service.production_report(db, ctx.company.id, r.date_from, r.date_to)
