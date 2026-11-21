from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import AuditLog, EmailOtp
from tests.conftest import bearer, create_user, otp_from, signup

EMAIL = "ravi@example.com"
BODY = {"email": EMAIL, "full_name": "Ravi Kumar", "global_role": "ceo"}


async def _admin(client: AsyncClient) -> str:
    return (await signup(client))["access_token"]


async def _send(client: AsyncClient, token: str, email: str = EMAIL) -> int:
    res = await client.post(
        "/users/otp", json={"email": email, "full_name": "Ravi Kumar"}, headers=bearer(token)
    )
    return res.status_code


async def test_code_then_create_sends_welcome_with_password(
    client: AsyncClient, outbox: list[dict]
) -> None:
    admin = await _admin(client)
    assert await _send(client, admin) == 202
    mail = outbox[-1]
    code = otp_from(outbox, EMAIL)
    assert mail["to"] == EMAIL and mail["subject"].endswith("verification code")
    # The person is told who is adding them and to which organisation.
    assert "Priya Sundar" in mail["text"] and "Acme Rubbers" in mail["text"]

    res = await client.post("/users", json={**BODY, "otp": code}, headers=bearer(admin))
    assert res.status_code == 201, res.text
    password = res.json()["temporary_password"]
    welcome = outbox[-1]
    assert welcome["to"] == EMAIL
    assert welcome["subject"] == "Welcome to Acme Rubbers on Michy Group of Companies"
    assert password in welcome["html"] and password in welcome["text"]

    async with SessionLocal() as db:
        assert await db.scalar(select(EmailOtp)) is None
        actions = (await db.scalars(select(AuditLog.action).order_by(AuditLog.id))).all()
        created = await db.scalar(select(AuditLog).where(AuditLog.action == "user_created"))
    assert "user_code_sent" in actions
    assert created is not None and created.details["email_verified"] is True
    # Neither the code nor the password is written to the log.
    assert code not in str(created.details) and password not in str(created.details)


async def test_wrong_code_rejected(client: AsyncClient, outbox: list[dict]) -> None:
    admin = await _admin(client)
    await _send(client, admin)
    code = otp_from(outbox, EMAIL)
    wrong = "000000" if code != "000000" else "111111"
    res = await client.post("/users", json={**BODY, "otp": wrong}, headers=bearer(admin))
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_otp"


async def test_create_without_code_rejected(client: AsyncClient) -> None:
    admin = await _admin(client)
    res = await client.post("/users", json={**BODY, "otp": "123456"}, headers=bearer(admin))
    assert res.status_code == 400


async def test_no_code_for_existing_user(client: AsyncClient, outbox: list[dict]) -> None:
    admin = await _admin(client)
    await create_user(client, admin, EMAIL, global_role="ceo")
    sent = len(outbox)
    assert await _send(client, admin, "RAVI@example.com") == 409
    assert len(outbox) == sent


async def test_resend_waits_a_minute(client: AsyncClient) -> None:
    admin = await _admin(client)
    assert await _send(client, admin) == 202
    assert await _send(client, admin) == 429


async def test_only_user_managers_can_send_codes(client: AsyncClient) -> None:
    admin = await _admin(client)
    created = await create_user(client, admin, "ceo@example.com", global_role="ceo")
    res = await client.post(
        "/auth/login",
        json={"email": "ceo@example.com", "password": created["temporary_password"]},
    )
    assert await _send(client, res.json()["access_token"]) == 403
