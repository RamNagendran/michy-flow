"""The shift workers a production in-charge can put on a shift."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidError
from app.models import CompanyMembership, User
from app.models.enums import CompanyRole, Duty


async def operators(db: AsyncSession, company_id: int) -> dict[int, str]:
    """{user id: name} of the company's active operators ticked as shift workers, in name order."""
    rows = await db.execute(
        select(User.id, User.full_name)
        .join(CompanyMembership, CompanyMembership.user_id == User.id)
        .where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.role == CompanyRole.OPERATOR,
            CompanyMembership.duties.contains([Duty.SHIFT.value]),
            User.is_active.is_(True),
        )
        .order_by(User.full_name, User.id)
    )
    return dict(rows.all())


async def require_crew(
    db: AsyncSession, company_id: int, ids: list[int], keep: frozenset[int] = frozenset()
) -> None:
    """Every id must be an active shift worker here. `keep` are ids already on the entry, which
    stay allowed on an edit even if that person has since left."""
    if not ids:
        return
    known = await operators(db, company_id)
    if unknown := set(ids) - known.keys() - keep:
        raise InvalidError(
            f"{len(unknown)} of the chosen people are not shift workers in this company",
            code="unknown_operator",
        )


async def names(db: AsyncSession, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return dict(rows.all())
