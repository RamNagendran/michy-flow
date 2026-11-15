from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.errors import InvalidError
from app.models.catalog import input_choices, is_item, output_choices
from app.models.enums import Grade
from app.routers._range import Range, report_range
from app.schemas.analytics import (
    OilKpi,
    PlantReport,
    PriceHistory,
    ProductionReport,
    TradeAnalysis,
    TrendPoint,
)
from app.services import analytics_service, plant_report_service, price_service
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
    side: Literal["purchase", "sale"] = Query("purchase"),
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_FINANCE)),
    db: AsyncSession = Depends(get_db),
) -> PriceHistory:
    """What each supplier charged (or each buyer paid) for one item, against the average."""
    if item not in (input_choices() if side == "purchase" else output_choices() | input_choices()):
        raise InvalidError("Unknown item")
    return await price_service.prices(
        db, ctx.company.id, side, item, r.date_from, r.date_to, r.bucket
    )


@router.get("/trade-analysis", response_model=TradeAnalysis)
async def trade_analysis(
    side: Literal["purchase", "sale"] = Query(...),
    item: str | None = Query(None, max_length=20),
    grade: list[Grade] = Query([Grade.A, Grade.B]),
    party_id: list[int] = Query([], max_length=50),
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_FINANCE)),
    db: AsyncSession = Depends(get_db),
) -> TradeAnalysis:
    """Purchases or sales per period, item, supplier or buyer and grade, with rate ranges.
    Grade C is left out unless asked for."""
    if item is not None and not is_item(item):
        raise InvalidError("Unknown item")
    return await analytics_service.trade_analysis(
        db,
        ctx.company.id,
        side,
        r.date_from,
        r.date_to,
        r.bucket,
        item=item,
        grades=tuple(dict.fromkeys(grade)) or (Grade.A, Grade.B),
        party_ids=tuple(party_id),
    )


@router.get("/production-report", response_model=ProductionReport)
async def production_report(
    r: Range = Depends(report_range),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_ALL_ENTRIES)),
    db: AsyncSession = Depends(get_db),
) -> ProductionReport:
    """Running hours and throughput per shift and per operator."""
    return await analytics_service.production_report(db, ctx.company.id, r.date_from, r.date_to)


@router.get("/plant-report", response_model=PlantReport)
async def plant_report(
    r: Range = Depends(report_range),
    shift: list[int] = Query(default=[], max_length=3),
    machine_id: list[int] = Query(default=[], max_length=50),
    operator_id: list[int] = Query(default=[], max_length=50),
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW_PLANT_ANALYTICS)),
    db: AsyncSession = Depends(get_db),
) -> PlantReport:
    """How each operator and machine performed: runs, hours, kg, wastage, kg per hour and
    efficiency, and the trend over the period. Manager and Super Admin only."""
    if any(s not in (1, 2, 3) for s in shift):
        raise InvalidError("Shift must be 1, 2 or 3")
    filters = plant_report_service.PlantFilters(
        shifts=tuple(shift), machine_ids=tuple(machine_id), operator_ids=tuple(operator_id)
    )
    return await plant_report_service.plant_report(
        db, ctx.company.id, r.date_from, r.date_to, r.bucket, filters
    )
