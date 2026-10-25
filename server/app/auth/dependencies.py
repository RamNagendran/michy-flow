from collections.abc import Awaitable, Callable

from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission, SystemPermission, system_permissions
from app.core.db import get_db
from app.core.errors import ForbiddenError, NotFoundError
from app.core.security import InvalidTokenError, decode_token
from app.models import Company, User
from app.services.access_service import CompanyContext, permissions_in

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_user_allow_password_change(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """The signed-in user, even if they still have to replace a temporary password.
    Only /auth/me and /auth/change-password use this directly."""
    if credentials is None:
        raise _UNAUTHORIZED
    try:
        payload = decode_token(credentials.credentials, "access")
    except InvalidTokenError as exc:
        raise _UNAUTHORIZED from exc
    user = await db.get(User, payload["user_id"])
    if (
        not user
        or not user.is_active
        or user.account_id != payload["account_id"]
        or user.token_version != payload["tv"]
    ):
        raise _UNAUTHORIZED
    return user


async def get_current_user(user: User = Depends(get_user_allow_password_change)) -> User:
    if user.must_change_password:
        raise ForbiddenError(
            "Please set a new password before continuing", code="password_change_required"
        )
    return user


def require_system_permission(permission: SystemPermission) -> Callable[..., Awaitable[User]]:
    """Dependency factory: `Depends(require_system_permission(SystemPermission.MANAGE_USERS))`."""

    async def checker(user: User = Depends(get_current_user)) -> User:
        if permission not in system_permissions(user.global_role):
            raise ForbiddenError("Not allowed")
        return user

    return checker


def require_company_permission(
    *permissions: CompanyPermission,
) -> Callable[..., Awaitable[CompanyContext]]:
    """Dependency factory for routes under /companies/{company_id}/...

    Passes when the caller holds at least one of `permissions` in that company.

    A company the caller cannot see answers 404, the same as one that does not exist,
    so ids from other accounts or companies cannot be probed.
    """

    async def checker(
        company_id: int = Path(gt=0),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> CompanyContext:
        company = await db.get(Company, company_id)
        perms = permissions_in(user, company) if company else frozenset()
        if not company or not perms:
            raise NotFoundError("Company not found")
        if perms.isdisjoint(permissions):
            raise ForbiddenError("Not allowed")
        return CompanyContext(user=user, company=company, permissions=perms)

    return checker
