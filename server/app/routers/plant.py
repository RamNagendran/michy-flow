"""Operators and machines. The Manager keeps the lists; the production in-charge picks from them."""

from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.models import Machine, Operator
from app.realtime import events
from app.schemas.operator import MachineInput, MachineRead, OperatorInput, OperatorRead
from app.services import operator_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["plant"])

# The in-charge reads the active ones to fill the production form; the Manager (and the Super
# Admin, who only looks) reads them all.
_read = require_company_permission(P.ENTER_PRODUCTION, P.MANAGE_PLANT, P.VIEW_PLANT_ANALYTICS)
_manage = require_company_permission(P.MANAGE_PLANT)


@router.get("/operators", response_model=list[OperatorRead])
async def list_operators(
    ctx: CompanyContext = Depends(_read), db: AsyncSession = Depends(get_db)
) -> list[Operator]:
    """Active operators; the Manager also sees the inactive ones."""
    return await operator_service.list_operators(
        db,
        ctx.company.id,
        include_inactive=ctx.can(P.MANAGE_PLANT) or ctx.can(P.VIEW_PLANT_ANALYTICS),
    )


@router.post("/operators", response_model=OperatorRead, status_code=status.HTTP_201_CREATED)
async def create_operator(
    request: Request,
    data: OperatorInput,
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Operator:
    operator = await operator_service.save_operator(db, ctx, data, request=request)
    await events.plant_changed(ctx.company, ctx.user)
    return operator


@router.put("/operators/{operator_id}", response_model=OperatorRead)
async def update_operator(
    request: Request,
    data: OperatorInput,
    operator_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Operator:
    operator = await operator_service.save_operator(db, ctx, data, operator_id, request)
    await events.plant_changed(ctx.company, ctx.user)
    return operator


@router.get("/machines", response_model=list[MachineRead])
async def list_machines(
    ctx: CompanyContext = Depends(_read), db: AsyncSession = Depends(get_db)
) -> list[Machine]:
    """Active machines; the Manager also sees the inactive ones."""
    return await operator_service.list_machines(
        db,
        ctx.company.id,
        include_inactive=ctx.can(P.MANAGE_PLANT) or ctx.can(P.VIEW_PLANT_ANALYTICS),
    )


@router.post("/machines", response_model=MachineRead, status_code=status.HTTP_201_CREATED)
async def create_machine(
    request: Request,
    data: MachineInput,
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Machine:
    machine = await operator_service.save_machine(db, ctx, data, request=request)
    await events.plant_changed(ctx.company, ctx.user)
    return machine


@router.put("/machines/{machine_id}", response_model=MachineRead)
async def update_machine(
    request: Request,
    data: MachineInput,
    machine_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> Machine:
    machine = await operator_service.save_machine(db, ctx, data, machine_id, request)
    await events.plant_changed(ctx.company, ctx.user)
    return machine
