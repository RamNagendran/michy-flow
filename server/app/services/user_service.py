"""People management for the Super Admin: create, edit, change access, reset passwords."""

import secrets
import string

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import hash_password
from app.models import CompanyMembership, User
from app.models.enums import GlobalRole
from app.schemas.user import AccessInput, MembershipInput, UserCreate, UserUpdate
from app.services import audit_service, company_service
from app.services.auth_service import normalize_email

# No look-alike characters (0/O, 1/l/I), so a password read out over the phone is typed right.
_PASSWORD_ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")
_PASSWORD_LENGTH = 14


def generate_temporary_password() -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(_PASSWORD_LENGTH))


async def list_users(db: AsyncSession, account_id: int) -> list[User]:
    rows = await db.scalars(
        select(User).where(User.account_id == account_id).order_by(func.lower(User.full_name))
    )
    return list(rows.all())


async def get_in_account(db: AsyncSession, account_id: int, user_id: int) -> User:
    user = await db.get(User, user_id)
    if not user or user.account_id != account_id:
        raise NotFoundError("User not found")
    return user


async def _check_companies(db: AsyncSession, account_id: int, items: list[MembershipInput]) -> None:
    wanted = {m.company_id for m in items}
    if missing := wanted - await company_service.ids_in_account(db, account_id, wanted):
        raise AppError(f"Unknown company id(s): {sorted(missing)}", code="unknown_company")


async def _other_active_super_admins(db: AsyncSession, user: User) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.account_id == user.account_id,
                User.global_role == GlobalRole.SUPER_ADMIN,
                User.is_active,
                User.id != user.id,
            )
        )
        or 0
    )


async def _keep_one_super_admin(db: AsyncSession, user: User) -> None:
    """Refuse a change that would leave the organisation without an active Super Admin."""
    if user.global_role == GlobalRole.SUPER_ADMIN and not await _other_active_super_admins(
        db, user
    ):
        raise ConflictError("The organisation needs at least one active Super Admin")


def _sync_memberships(user: User, items: list[MembershipInput]) -> None:
    """Make the user's memberships match `items`, changing only what differs (hash-map diff)."""
    current = {m.company_id: m for m in user.memberships}
    wanted = {m.company_id: m for m in items}
    for company_id in current.keys() - wanted.keys():
        user.memberships.remove(current[company_id])
    for company_id, item in wanted.items():
        existing = current.get(company_id)
        if existing is None:
            user.memberships.append(
                CompanyMembership(company_id=company_id, role=item.role, duties=list(item.duties))
            )
        else:
            existing.role = item.role
            existing.duties = list(item.duties)  # new list, so SQLAlchemy sees the change


def _access_summary(data: AccessInput) -> dict:
    return {
        "global_role": data.global_role,
        "memberships": [m.model_dump(mode="json") for m in data.memberships],
    }


async def _commit_and_reload(db: AsyncSession, user: User) -> User:
    await db.commit()
    await db.refresh(user, ["memberships"])
    return user


async def create(
    db: AsyncSession, actor: User, data: UserCreate, request: Request | None = None
) -> tuple[User, str]:
    await _check_companies(db, actor.account_id, data.memberships)
    password = generate_temporary_password()
    user = User(
        account_id=actor.account_id,
        email=normalize_email(data.email),
        full_name=data.full_name,
        password_hash=hash_password(password),
        global_role=data.global_role,
        must_change_password=True,
        memberships=[],
    )
    _sync_memberships(user, data.memberships)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("A user with this email already exists") from exc
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="user_created",
        entity_type="user",
        entity_id=user.id,
        details={"email": user.email, **_access_summary(data)},
        request=request,
    )
    return await _commit_and_reload(db, user), password


async def update(
    db: AsyncSession, actor: User, user_id: int, data: UserUpdate, request: Request | None = None
) -> User:
    user = await get_in_account(db, actor.account_id, user_id)
    changes = {
        k: v
        for k, v in data.model_dump(exclude_unset=True).items()
        if v is not None and getattr(user, k) != v
    }
    if not changes:
        return user
    if changes.get("is_active") is False:
        if user.id == actor.id:
            raise ForbiddenError("You cannot deactivate your own account")
        await _keep_one_super_admin(db, user)
    if "full_name" in changes:
        changes["full_name"] = changes["full_name"].strip()
    for key, value in changes.items():
        setattr(user, key, value)
    if "is_active" in changes:
        user.revoke_sessions()
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="user_updated",
        entity_type="user",
        entity_id=user.id,
        details={"changes": changes},
        request=request,
    )
    return await _commit_and_reload(db, user)


async def set_access(
    db: AsyncSession, actor: User, user_id: int, data: AccessInput, request: Request | None = None
) -> User:
    user = await get_in_account(db, actor.account_id, user_id)
    if user.id == actor.id:
        # Stops a Super Admin from locking themselves (and possibly everyone) out by mistake.
        raise ForbiddenError("Ask another Super Admin to change your own access")
    if data.global_role != GlobalRole.SUPER_ADMIN:
        await _keep_one_super_admin(db, user)
    await _check_companies(db, actor.account_id, data.memberships)
    user.global_role = data.global_role
    _sync_memberships(user, data.memberships)
    user.revoke_sessions()
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="user_access_changed",
        entity_type="user",
        entity_id=user.id,
        details=_access_summary(data),
        request=request,
    )
    return await _commit_and_reload(db, user)


async def reset_password(
    db: AsyncSession, actor: User, user_id: int, request: Request | None = None
) -> tuple[User, str]:
    user = await get_in_account(db, actor.account_id, user_id)
    if user.id == actor.id:
        raise ForbiddenError("Use 'Change password' to change your own password")
    password = generate_temporary_password()
    user.password_hash = hash_password(password)
    user.must_change_password = True
    user.revoke_sessions()
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action="password_reset",
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    return await _commit_and_reload(db, user), password
