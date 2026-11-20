"""Sign-up codes mailed to the email address. Codes are 6 digits, stored only as a keyed hash,
work for a few minutes, and stop working after a few wrong tries."""

import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import now
from app.core.config import settings
from app.models import EmailOtp

OTP_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_SECONDS = 60


class OtpCooldownError(Exception):
    def __init__(self, wait_seconds: int) -> None:
        self.wait_seconds = wait_seconds


class InvalidOtpError(Exception):
    pass


def _hash(email: str, code: str) -> str:
    return hmac.new(
        settings.JWT_SECRET.encode(), f"{email}:{code}".encode(), hashlib.sha256
    ).hexdigest()


async def issue(db: AsyncSession, email: str) -> str:
    """Make a new code for this email, replacing any earlier one. Returns the code to mail."""
    current = await db.scalar(select(EmailOtp).where(EmailOtp.email == email))
    if current:
        waited = (now() - current.sent_at).total_seconds()
        if waited < RESEND_SECONDS:
            raise OtpCooldownError(int(RESEND_SECONDS - waited) + 1)
    code = f"{secrets.randbelow(1_000_000):06d}"
    values = {
        "code_hash": _hash(email, code),
        "expires_at": now() + timedelta(minutes=OTP_MINUTES),
        "attempts": 0,
        "sent_at": now(),
    }
    await db.execute(
        insert(EmailOtp)
        .values(email=email, **values)
        .on_conflict_do_update(index_elements=[EmailOtp.email], set_=values)
    )
    await db.commit()
    return code


async def check(db: AsyncSession, email: str, code: str) -> None:
    """Raise InvalidOtpError unless the code is right. A wrong try is counted and saved at once.
    The caller deletes the code (consume) in the same transaction that creates the account."""
    row = await db.scalar(select(EmailOtp).where(EmailOtp.email == email).with_for_update())
    if not row or row.expires_at < now() or row.attempts >= MAX_ATTEMPTS:
        raise InvalidOtpError
    if not hmac.compare_digest(row.code_hash, _hash(email, code)):
        row.attempts += 1
        await db.commit()
        raise InvalidOtpError


async def consume(db: AsyncSession, email: str) -> None:
    await db.execute(delete(EmailOtp).where(EmailOtp.email == email))
