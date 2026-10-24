from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_system_permission
from app.auth.permissions import SystemPermission
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.models import User
from app.realtime import events
from app.schemas.user import AccessInput, UserAdminRead, UserCreate, UserUpdate, UserWithPassword
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])

_manage = require_system_permission(SystemPermission.MANAGE_USERS)
_UserId = Path(gt=0)


@router.get("", response_model=list[UserAdminRead])
async def list_users(actor: User = Depends(_manage), db: AsyncSession = Depends(get_db)) -> list:
    return await user_service.list_users(db, actor.account_id)


@router.post("", response_model=UserWithPassword, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/hour")
async def create_user(
    request: Request,
    data: UserCreate,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> UserWithPassword:
    """The temporary password is shown once here. The person must change it at first sign-in."""
    user, password = await user_service.create(db, actor, data, request)
    return UserWithPassword(user=UserAdminRead.model_validate(user), temporary_password=password)


@router.patch("/{user_id}", response_model=UserAdminRead)
async def update_user(
    request: Request,
    data: UserUpdate,
    user_id: int = _UserId,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await user_service.update(db, actor, user_id, data, request)
    await events.access_changed(actor.account_id, [user.id])
    return user


@router.put("/{user_id}/access", response_model=UserAdminRead)
async def set_user_access(
    request: Request,
    data: AccessInput,
    user_id: int = _UserId,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Replace the person's global role and company memberships. Signs them out everywhere."""
    user = await user_service.set_access(db, actor, user_id, data, request)
    await events.access_changed(actor.account_id, [user.id])
    return user


@router.post("/{user_id}/reset-password", response_model=UserWithPassword)
@limiter.limit("30/hour")
async def reset_password(
    request: Request,
    user_id: int = _UserId,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
) -> UserWithPassword:
    user, password = await user_service.reset_password(db, actor, user_id, request)
    await events.access_changed(actor.account_id, [user.id])
    return UserWithPassword(user=UserAdminRead.model_validate(user), temporary_password=password)
