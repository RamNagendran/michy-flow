from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import settings

TokenType = Literal["access", "refresh"]

# Compared against when the email doesn't exist, so a failed login takes the same time either way.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode()


class InvalidTokenError(Exception):
    pass


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), (password_hash or _DUMMY_HASH).encode())
    except ValueError:
        return False


def create_token(
    *, user_id: int, account_id: int, token_version: int, token_type: TokenType
) -> str:
    now = datetime.now(UTC)
    lifetime = (
        timedelta(hours=settings.JWT_EXPIRE_HOURS)
        if token_type == "access"
        else timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    )
    payload = {
        "user_id": user_id,
        "account_id": account_id,
        # Compared with users.token_version on every request; see User.revoke_sessions.
        "tv": token_version,
        "type": token_type,
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["exp", "user_id", "account_id", "tv", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    if payload.get("type") != expected_type:
        raise InvalidTokenError("wrong token type")
    return payload
