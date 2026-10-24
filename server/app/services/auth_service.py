from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    InvalidTokenError,
    create_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import Account, User
from app.models.enums import GlobalRole
from app.schemas.user import SignupRequest, TokenResponse
from app.services import audit_service
from app.services.access_service import build_user_read


class InvalidCredentialsError(Exception):
    pass


class EmailAlreadyRegisteredError(Exception):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def issue_tokens(db: AsyncSession, user: User) -> TokenResponse:
    claims = {
        "user_id": user.id,
        "account_id": user.account_id,
        "token_version": user.token_version,
    }
    return TokenResponse(
        access_token=create_token(**claims, token_type="access"),
        refresh_token=create_token(**claims, token_type="refresh"),
        expires_in=settings.JWT_EXPIRE_HOURS * 3600,
        user=await build_user_read(db, user),
    )


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == normalize_email(email)))


async def signup(db: AsyncSession, data: SignupRequest, request: Request | None = None) -> User:
    """Create a new organisation (account) with the signing-up person as its Super Admin."""
    account = Account(name=data.account_name.strip())
    user = User(
        account=account,
        email=normalize_email(data.email),
        full_name=data.full_name.strip(),
        password_hash=hash_password(data.password),
        global_role=GlobalRole.SUPER_ADMIN,
    )
    db.add(account)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise EmailAlreadyRegisteredError from exc
    audit_service.record(
        db,
        account_id=account.id,
        actor=user,
        action="signup",
        entity_type="account",
        entity_id=account.id,
        request=request,
    )
    await db.commit()
    await db.refresh(user, ["account", "memberships"])
    return user


async def authenticate(
    db: AsyncSession, email: str, password: str, request: Request | None = None
) -> User:
    user = await get_by_email(db, email)
    # verify_password runs even when the user is missing, so timing doesn't reveal the email.
    password_ok = verify_password(password, user.password_hash if user else None)
    if not user or not password_ok or not user.is_active:
        if user:
            audit_service.record(
                db,
                account_id=user.account_id,
                actor=user,
                action="login_failed",
                entity_type="user",
                entity_id=user.id,
                request=request,
            )
            await db.commit()
        raise InvalidCredentialsError
    user.last_login_at = datetime.now(UTC)
    audit_service.record(
        db,
        account_id=user.account_id,
        actor=user,
        action="login",
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    await db.commit()
    await db.refresh(user, ["account", "memberships"])
    return user


async def user_from_refresh_token(db: AsyncSession, refresh_token: str) -> User:
    try:
        payload = decode_token(refresh_token, "refresh")
    except InvalidTokenError as exc:
        raise InvalidCredentialsError from exc
    user = await db.get(User, payload["user_id"])
    if (
        not user
        or not user.is_active
        or user.account_id != payload["account_id"]
        or user.token_version != payload["tv"]
    ):
        raise InvalidCredentialsError
    return user


async def change_password(
    db: AsyncSession,
    user: User,
    current_password: str,
    new_password: str,
    request: Request | None = None,
) -> User:
    """Replace the password and end every other session. The caller issues fresh tokens."""
    if not verify_password(current_password, user.password_hash):
        raise InvalidCredentialsError
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.revoke_sessions()
    audit_service.record(
        db,
        account_id=user.account_id,
        actor=user,
        action="password_changed",
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    await db.commit()
    await db.refresh(user, ["account", "memberships"])
    return user
