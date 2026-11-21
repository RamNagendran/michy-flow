from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.models import AuditLog, EmailOtp
from tests.conftest import otp_from, signup

EMAIL = "meena@example.com"
BODY = {
    "account_name": "Meena Rubbers",
    "full_name": "Meena Raj",
    "email": EMAIL,
    "password": "correct-horse-battery",
}


async def _ask(client: AsyncClient, email: str = EMAIL) -> int:
    res = await client.post("/auth/signup/otp", json={"email": email, "full_name": "Meena Raj"})
    return res.status_code


async def test_otp_mail_then_signup_sends_welcome(client: AsyncClient, outbox: list[dict]) -> None:
    assert await _ask(client) == 202
    assert len(outbox) == 1
    mail = outbox[0]
    code = otp_from(outbox, EMAIL)
    assert mail["to"] == EMAIL and code in mail["html"] and code in mail["text"]
    assert "Hi Meena," in mail["text"]

    res = await client.post("/auth/signup", json={**BODY, "otp": code})
    assert res.status_code == 201, res.text
    welcome = outbox[-1]
    assert welcome["subject"] == "Welcome to Michy Group of Companies"
    assert "Meena Rubbers" in welcome["html"] and "/login" in welcome["text"]

    async with SessionLocal() as db:
        # The code is used up, and the sign-up is logged as verified.
        assert await db.scalar(select(EmailOtp)) is None
        log = await db.scalar(select(AuditLog).where(AuditLog.action == "signup"))
        assert log is not None and log.details == {"email_verified": True}


async def test_code_is_stored_only_as_hash(client: AsyncClient, outbox: list[dict]) -> None:
    await _ask(client)
    async with SessionLocal() as db:
        row = await db.scalar(select(EmailOtp))
    assert row is not None and otp_from(outbox, EMAIL) not in row.code_hash


async def test_wrong_code_rejected_and_locks_after_five(
    client: AsyncClient, outbox: list[dict]
) -> None:
    await _ask(client)
    code = otp_from(outbox, EMAIL)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        res = await client.post("/auth/signup", json={**BODY, "otp": wrong})
        assert res.status_code == 400
    # Even the right code no longer works after five wrong tries.
    res = await client.post("/auth/signup", json={**BODY, "otp": code})
    assert res.status_code == 400


async def test_expired_code_rejected(client: AsyncClient, outbox: list[dict]) -> None:
    await _ask(client)
    async with SessionLocal() as db:
        await db.execute(
            update(EmailOtp).values(expires_at=EmailOtp.expires_at - timedelta(hours=1))
        )
        await db.commit()
    res = await client.post("/auth/signup", json={**BODY, "otp": otp_from(outbox, EMAIL)})
    assert res.status_code == 400


async def test_signup_without_asking_for_code_rejected(client: AsyncClient) -> None:
    res = await client.post("/auth/signup", json={**BODY, "otp": "123456"})
    assert res.status_code == 400


async def test_resend_waits_a_minute_then_replaces_code(
    client: AsyncClient, outbox: list[dict]
) -> None:
    await _ask(client)
    first = otp_from(outbox, EMAIL)
    assert await _ask(client) == 429
    async with SessionLocal() as db:
        await db.execute(update(EmailOtp).values(sent_at=EmailOtp.sent_at - timedelta(minutes=2)))
        await db.commit()
    assert await _ask(client) == 202
    second = otp_from(outbox, EMAIL)
    if first != second:
        res = await client.post("/auth/signup", json={**BODY, "otp": first})
        assert res.status_code == 400
    res = await client.post("/auth/signup", json={**BODY, "otp": second})
    assert res.status_code == 201


async def test_no_code_for_registered_email(client: AsyncClient, outbox: list[dict]) -> None:
    await signup(client, email=EMAIL)
    sent = len(outbox)
    assert await _ask(client, "MEENA@example.com") == 409
    assert len(outbox) == sent


async def test_otp_request_closed_with_signup(client: AsyncClient) -> None:
    from app.core.config import settings

    settings.ALLOW_SIGNUP = False
    try:
        assert await _ask(client) == 403
    finally:
        settings.ALLOW_SIGNUP = True
