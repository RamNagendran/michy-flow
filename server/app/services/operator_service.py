"""Operators and machines: the Manager keeps each company's list, and the production in-charge
picks from it. Operators have no login."""

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidError, NotFoundError
from app.models import Machine, Operator
from app.schemas.operator import MachineInput, OperatorInput
from app.services import audit_service
from app.services.access_service import CompanyContext


async def list_operators(
    db: AsyncSession, company_id: int, *, include_inactive: bool = False
) -> list[Operator]:
    """The company's operators, by shift then name. Only active ones unless asked."""
    query = select(Operator).where(Operator.company_id == company_id)
    if not include_inactive:
        query = query.where(Operator.is_active.is_(True))
    order = (Operator.shift.nulls_last(), func.lower(Operator.name))
    return list((await db.scalars(query.order_by(*order))).all())


async def list_machines(
    db: AsyncSession, company_id: int, *, include_inactive: bool = False
) -> list[Machine]:
    """The company's machines, by number. Only active ones unless asked."""
    query = select(Machine).where(Machine.company_id == company_id)
    if not include_inactive:
        query = query.where(Machine.is_active.is_(True))
    return list((await db.scalars(query.order_by(func.lower(Machine.code)))).all())


async def _save(
    db: AsyncSession,
    ctx: CompanyContext,
    model: type[Operator] | type[Machine],
    row_id: int | None,
    values: dict,
    label: str,
    request: Request | None,
) -> Operator | Machine:
    """Add or change one operator or machine, with an audit row for what changed."""
    kind = "operator" if model is Operator else "machine"
    if row_id is None:
        row = model(company_id=ctx.company.id, created_by_id=ctx.user.id, **values)
        db.add(row)
        changes = dict(values)
    else:
        row = await db.get(model, row_id)
        if not row or row.company_id != ctx.company.id:
            raise NotFoundError(f"{kind.title()} not found")
        changes = audit_service.changes_of(row, values)
        for key in changes:
            setattr(row, key, values[key])
    await db.flush()
    if changes:
        audit_service.record(
            db,
            account_id=ctx.user.account_id,
            actor=ctx.user,
            action=f"{kind}_{'created' if row_id is None else 'updated'}",
            entity_type=kind,
            entity_id=row.id,
            company_id=ctx.company.id,
            details={"name": label, "changes": changes},
            request=request,
        )
    await db.commit()
    return row


async def save_operator(
    db: AsyncSession,
    ctx: CompanyContext,
    data: OperatorInput,
    operator_id: int | None = None,
    request: Request | None = None,
) -> Operator:
    same = await db.scalar(
        select(Operator.id).where(
            Operator.company_id == ctx.company.id,
            func.lower(func.trim(Operator.name)) == data.name.lower(),
            Operator.id != (operator_id or 0),
        )
    )
    if same:
        raise ConflictError(f"An operator called {data.name} already exists")
    values = data.model_dump()
    return await _save(db, ctx, Operator, operator_id, values, data.name, request)  # type: ignore[return-value]


async def save_machine(
    db: AsyncSession,
    ctx: CompanyContext,
    data: MachineInput,
    machine_id: int | None = None,
    request: Request | None = None,
) -> Machine:
    same = await db.scalar(
        select(Machine.name).where(
            Machine.company_id == ctx.company.id,
            func.lower(func.trim(Machine.code)) == data.code.lower(),
            Machine.id != (machine_id or 0),
        )
    )
    if same:
        raise ConflictError(f"Machine number {data.code} is already used by {same}")
    label = f"{data.code} {data.name}"
    return await _save(db, ctx, Machine, machine_id, data.model_dump(), label, request)  # type: ignore[return-value]


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


async def require_machine(
    db: AsyncSession, company_id: int, machine_id: int, *, allow_inactive: bool
) -> Machine:
    """The machine a run names: this company's, and active for new choices."""
    machine = await db.get(Machine, machine_id)
    if not machine or machine.company_id != company_id:
        raise InvalidError("Choose a machine from this company's list", code="unknown_machine")
    if not machine.is_active and not allow_inactive:
        raise InvalidError(f"{machine.name} is no longer in use", code="inactive_machine")
    return machine


async def names(db: AsyncSession, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await db.execute(select(Operator.id, Operator.name).where(Operator.id.in_(ids)))
    return dict(rows.all())
