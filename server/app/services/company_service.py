from fastapi import Request
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models import Company, Production, Purchase, Sale, User
from app.models.catalog import defaults_for
from app.schemas.company import CompanyConfig, CompanyCreate, CompanyUpdate
from app.services import audit_service

_DUPLICATE_CODE = "Another company already uses this code"


async def get_in_account(db: AsyncSession, account_id: int, company_id: int) -> Company:
    company = await db.get(Company, company_id)
    if not company or company.account_id != account_id:
        raise NotFoundError("Company not found")
    return company


async def ids_in_account(db: AsyncSession, account_id: int, ids: set[int]) -> set[int]:
    """Which of `ids` are companies in this account. One query, whatever the size of `ids`."""
    if not ids:
        return set()
    rows = await db.scalars(
        select(Company.id).where(Company.account_id == account_id, Company.id.in_(ids))
    )
    return set(rows.all())


async def _has_entries(db: AsyncSession, company_id: int) -> bool:
    """Any purchase, sale or production at all, including deleted and rejected ones."""
    for model in (Purchase, Sale, Production):
        if await db.scalar(select(exists().where(model.company_id == company_id))):
            return True
    return False


async def create(
    db: AsyncSession, actor: User, data: CompanyCreate, request: Request | None = None
) -> Company:
    defaults = defaults_for(data.category)
    company = Company(
        account_id=actor.account_id,
        input_items=list(defaults.inputs),
        output_items=list(defaults.outputs),
        **data.model_dump(),
    )
    db.add(company)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(_DUPLICATE_CODE) from exc
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="company_created",
        entity_type="company",
        entity_id=company.id,
        company_id=company.id,
        details=data.model_dump(),
        request=request,
    )
    await db.commit()
    return company


async def update(
    db: AsyncSession,
    actor: User,
    company_id: int,
    data: CompanyUpdate,
    request: Request | None = None,
) -> Company:
    company = await get_in_account(db, actor.account_id, company_id)
    # An explicit null means "leave as is".
    changes = {
        key: value
        for key, value in data.model_dump(exclude_unset=True).items()
        if value is not None and getattr(company, key) != value
    }
    if not changes:
        return company
    if "category" in changes and await _has_entries(db, company.id):
        # Its stock and history are in the old type's items; changing would strand them.
        raise ConflictError(
            "The company type cannot change once it has entries", code="category_locked"
        )
    if "category" in changes:
        # A new type starts from its own default inputs and outputs.
        defaults = defaults_for(changes["category"])
        company.input_items, company.output_items = list(defaults.inputs), list(defaults.outputs)
    for key, value in changes.items():
        setattr(company, key, value)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(_DUPLICATE_CODE) from exc
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="company_updated",
        entity_type="company",
        entity_id=company.id,
        company_id=company.id,
        details={"changes": changes},
        request=request,
    )
    await db.commit()
    return company


async def configure(
    db: AsyncSession,
    actor: User,
    company_id: int,
    data: CompanyConfig,
    request: Request | None = None,
) -> Company:
    """Set what the company processes and makes, the oil density and the stock-check cycle.
    Entries already saved keep their items and weights; only new entries follow the change."""
    company = await get_in_account(db, actor.account_id, company_id)
    values = data.model_dump(exclude_none=True)
    changes = {k: v for k, v in values.items() if getattr(company, k) != v}
    if not changes:
        return company
    for key, value in changes.items():
        setattr(company, key, value)
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="company_configured",
        entity_type="company",
        entity_id=company.id,
        company_id=company.id,
        details={
            "changes": {k: str(v) if not isinstance(v, list) else v for k, v in changes.items()}
        },
        request=request,
    )
    await db.commit()
    return company
