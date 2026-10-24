"""Resolves what a person may do in each company. Routers and /auth/me both go through here."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import (
    CompanyPermission,
    global_company_permissions,
    membership_permissions,
    system_permissions,
)
from app.models import Company, User
from app.models.enums import GlobalRole
from app.schemas.company import CompanyRead
from app.schemas.user import AccountRead, CompanyAccess, UserRead


@dataclass(frozen=True, slots=True)
class CompanyContext:
    """The caller, the company in the URL, and what the caller may do there."""

    user: User
    company: Company
    permissions: frozenset[CompanyPermission]

    def can(self, permission: CompanyPermission) -> bool:
        return permission in self.permissions


def permissions_in(user: User, company: Company) -> frozenset[CompanyPermission]:
    """Empty when the person has no access to this company at all."""
    if company.account_id != user.account_id:
        return frozenset()
    if user.global_role:
        # A deactivated company stays visible only to the Super Admin, who can re-activate it.
        if not company.is_active and user.global_role != GlobalRole.SUPER_ADMIN:
            return frozenset()
        return global_company_permissions(user.global_role)
    if not company.is_active:
        return frozenset()
    membership = next((m for m in user.memberships if m.company_id == company.id), None)
    return membership_permissions(membership.role, membership.duties) if membership else frozenset()


async def accessible_companies(db: AsyncSession, user: User) -> list[Company]:
    """Companies the person can open, ordered by code. Inactive ones only for the Super Admin."""
    if user.global_role:
        query = select(Company).where(Company.account_id == user.account_id)
        if user.global_role != GlobalRole.SUPER_ADMIN:
            query = query.where(Company.is_active)
        return list((await db.scalars(query.order_by(Company.code))).all())
    companies = [m.company for m in user.memberships if m.company.is_active]
    return sorted(companies, key=lambda c: c.code)


async def build_user_read(db: AsyncSession, user: User) -> UserRead:
    by_company = {m.company_id: m for m in user.memberships}
    companies: list[CompanyAccess] = []
    for company in await accessible_companies(db, user):
        membership = by_company.get(company.id)
        perms = permissions_in(user, company)
        companies.append(
            CompanyAccess(
                company=CompanyRead.model_validate(company),
                role=membership.role if membership and not user.global_role else None,
                duties=membership.duties if membership and not user.global_role else [],
                permissions=sorted(perms),
            )
        )
    return UserRead(
        id=user.id,
        account_id=user.account_id,
        account=AccountRead.model_validate(user.account),
        email=user.email,
        full_name=user.full_name,
        global_role=user.global_role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        system_permissions=sorted(system_permissions(user.global_role)),
        companies=companies,
    )
