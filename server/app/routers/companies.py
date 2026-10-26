from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import (
    get_current_user,
    require_company_permission,
    require_system_permission,
)
from app.auth.permissions import CompanyPermission, SystemPermission
from app.core.db import get_db
from app.models import Company, User
from app.realtime import events
from app.schemas.audit import AuditLogRead
from app.schemas.common import Paginated
from app.schemas.company import CompanyConfig, CompanyCreate, CompanyRead, CompanyUpdate
from app.schemas.entries import CrewMember
from app.services import audit_service, company_service, crew_service
from app.services.access_service import CompanyContext, accessible_companies

router = APIRouter(prefix="/companies", tags=["companies"])

_manage = require_system_permission(SystemPermission.MANAGE_COMPANIES)


@router.get("", response_model=list[CompanyRead])
async def list_companies(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[Company]:
    """Companies the caller can open. The Super Admin also sees deactivated ones."""
    return await accessible_companies(db, user)


@router.post("", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
async def create_company(
    request: Request,
    data: CompanyCreate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Company:
    company = await company_service.create(db, actor, data, request)
    await events.company_changed(company)
    return company


@router.get("/{company_id}", response_model=CompanyRead)
async def get_company(
    ctx: CompanyContext = Depends(require_company_permission(CompanyPermission.VIEW)),
) -> Company:
    return ctx.company


@router.patch("/{company_id}", response_model=CompanyRead)
async def update_company(
    request: Request,
    company_id: int,
    data: CompanyUpdate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Company:
    company = await company_service.update(db, actor, company_id, data, request)
    await events.company_changed(company)
    return company


@router.put("/{company_id}/config", response_model=CompanyRead)
async def configure_company(
    request: Request,
    company_id: int,
    data: CompanyConfig,
    actor: User = Depends(require_system_permission(SystemPermission.MANAGE_CONFIG)),
    db: AsyncSession = Depends(get_db),
) -> Company:
    """Inventory configuration: input and output items, oil density, stock-check cycle."""
    company = await company_service.configure(db, actor, company_id, data, request)
    await events.company_changed(company)
    return company


@router.get("/{company_id}/crew", response_model=list[CrewMember])
async def list_crew(
    ctx: CompanyContext = Depends(require_company_permission(CompanyPermission.ENTER_PRODUCTION)),
    db: AsyncSession = Depends(get_db),
) -> list[CrewMember]:
    """Shift workers the production in-charge can put on a shift (names only)."""
    people = await crew_service.operators(db, ctx.company.id)
    return [CrewMember(id=i, name=n) for i, n in people.items()]


@router.get("/{company_id}/audit-logs", response_model=Paginated[AuditLogRead])
async def company_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    ctx: CompanyContext = Depends(require_company_permission(CompanyPermission.VIEW_AUDIT)),
    db: AsyncSession = Depends(get_db),
) -> Paginated[AuditLogRead]:
    """The company Admin's view of who did what in their company."""
    return await audit_service.list_logs(
        db,
        account_id=ctx.user.account_id,
        company_id=ctx.company.id,
        page=page,
        page_size=page_size,
    )
