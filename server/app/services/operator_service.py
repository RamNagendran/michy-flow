"""Operators: plant workers put on a production shift. Just a name and a shift, no login."""

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidError
from app.models import Operator
from app.schemas.operator import OperatorInput
from app.services import audit_service
from app.services.access_service import CompanyContext


async def list_operators(db: AsyncSession, company_id: int) -> list[Operator]:
    """The company's active operators, by shift then name."""
    return list(
        (
            await db.scalars(
                select(Operator)
                .where(Operator.company_id == company_id, Operator.is_active.is_(True))
                .order_by(Operator.shift.nulls_last(), func.lower(Operator.name))
            )
        ).all()
    )


async def create(
    db: AsyncSession, ctx: CompanyContext, data: OperatorInput, request: Request | None = None
) -> Operator:
    same = await db.scalar(
        select(Operator.id).where(
            Operator.company_id == ctx.company.id,
            func.lower(func.trim(Operator.name)) == data.name.lower(),
        )
    )
    if same:
        raise ConflictError(f"An operator called {data.name} already exists")
    operator = Operator(
        company_id=ctx.company.id, name=data.name, shift=data.shift, created_by_id=ctx.user.id
    )
    db.add(operator)
    await db.flush()
    audit_service.record(
        db,
        account_id=ctx.user.account_id,
        actor=ctx.user,
        action="operator_created",
        entity_type="operator",
        entity_id=operator.id,
        company_id=ctx.company.id,
        details={"name": data.name, "shift": data.shift},
        request=request,
    )
    await db.commit()
    return operator


async def require_crew(
    db: AsyncSession, company_id: int, ids: list[int], keep: frozenset[int] = frozenset()
) -> None:
    """Every id must be an active operator here. `keep` are ids already on the entry, which
    stay allowed on an edit even if that operator has since been removed."""
    if not ids:
        return
    known = await db.scalars(
        select(Operator.id).where(
            Operator.company_id == company_id,
            Operator.is_active.is_(True),
            Operator.id.in_(ids),
        )
    )
    if unknown := set(ids) - set(known) - keep:
        raise InvalidError(
            f"{len(unknown)} of the chosen people are not operators in this company",
            code="unknown_operator",
        )


async def names(db: AsyncSession, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await db.execute(select(Operator.id, Operator.name).where(Operator.id.in_(ids)))
    return dict(rows.all())
