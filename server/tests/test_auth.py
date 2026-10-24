from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import require_system_permission
from app.auth.permissions import SystemPermission
from app.core.rate_limit import limiter
from app.core.security import decode_token
from app.models import User
from tests.conftest import bearer, signup


async def test_signup_creates_account_super_admin_and_tokens(client: AsyncClient) -> None:
    data = await signup(client, email="Priya@Example.com")
    assert data["user"]["email"] == "priya@example.com"
    assert data["user"]["global_role"] == "super_admin"
    assert data["user"]["account"]["name"] == "Acme Rubbers"
    assert "manage_users" in data["user"]["system_permissions"]
    assert data["user"]["companies"] == []
    claims = decode_token(data["access_token"], "access")
    assert claims["user_id"] == data["user"]["id"]
    assert claims["account_id"] == data["user"]["account_id"]
    assert claims["tv"] == 0
    # Personal data and roles stay out of the token; access is looked up on every request.
    assert "email" not in claims and "role" not in claims


async def test_signup_duplicate_email_conflicts(client: AsyncClient) -> None:
    await signup(client)
    res = await client.post(
        "/auth/signup",
        json={
            "account_name": "Other",
            "full_name": "X",
            "email": "PRIYA@example.com",
            "password": "another-password",
        },
    )
    assert res.status_code == 409


async def test_signup_rejects_short_password(client: AsyncClient) -> None:
    res = await client.post(
        "/auth/signup",
        json={"account_name": "A", "full_name": "B", "email": "a@example.com", "password": "short"},
    )
    assert res.status_code == 422


async def test_login_and_me(client: AsyncClient) -> None:
    await signup(client)
    res = await client.post(
        "/auth/login", json={"email": "priya@example.com", "password": "correct-horse-battery"}
    )
    assert res.status_code == 200
    token = res.json()["access_token"]
    me = await client.get("/auth/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["email"] == "priya@example.com"
    assert me.json()["last_login_at"] is not None


async def test_login_errors_are_generic(client: AsyncClient) -> None:
    await signup(client)
    wrong_pw = await client.post(
        "/auth/login", json={"email": "priya@example.com", "password": "nope-nope-nope"}
    )
    no_user = await client.post(
        "/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"}
    )
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()


async def test_me_requires_valid_access_token(client: AsyncClient) -> None:
    data = await signup(client)
    assert (await client.get("/auth/me")).status_code == 401
    assert (await client.get("/auth/me", headers=bearer("garbage"))).status_code == 401
    # A refresh token must not work as an access token.
    assert (await client.get("/auth/me", headers=bearer(data["refresh_token"]))).status_code == 401


async def test_refresh(client: AsyncClient) -> None:
    data = await signup(client)
    res = await client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert res.status_code == 200
    assert (await client.get("/auth/me", headers=bearer(res.json()["access_token"]))).is_success
    bad = await client.post("/auth/refresh", json={"refresh_token": data["access_token"]})
    assert bad.status_code == 401


async def test_change_password(client: AsyncClient) -> None:
    data = await signup(client)
    headers = bearer(data["access_token"])
    wrong = await client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": "wrong-password", "new_password": "brand-new-password"},
    )
    assert wrong.status_code == 400
    ok = await client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": "correct-horse-battery", "new_password": "brand-new-password"},
    )
    assert ok.status_code == 200
    # The old session is signed out; the new tokens work.
    assert (await client.get("/auth/me", headers=headers)).status_code == 401
    assert (await client.get("/auth/me", headers=bearer(ok.json()["access_token"]))).is_success
    old = await client.post(
        "/auth/login", json={"email": "priya@example.com", "password": "correct-horse-battery"}
    )
    new = await client.post(
        "/auth/login", json={"email": "priya@example.com", "password": "brand-new-password"}
    )
    assert old.status_code == 401
    assert new.status_code == 200


async def test_require_system_permission() -> None:
    from app.core.errors import AppError, app_error_handler
    from app.main import app

    probe = FastAPI()
    probe.add_exception_handler(AppError, app_error_handler)
    manage = require_system_permission(SystemPermission.MANAGE_USERS)

    @probe.get("/manage-users")
    async def manage_users(user: User = Depends(manage)) -> dict[str, int]:
        return {"id": user.id}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as main:
        token = (await signup(main))["access_token"]
    async with AsyncClient(transport=ASGITransport(app=probe), base_url="http://test") as c:
        assert (await c.get("/manage-users", headers=bearer(token))).status_code == 200
        assert (await c.get("/manage-users")).status_code == 401


async def test_login_is_rate_limited(client: AsyncClient) -> None:
    limiter.enabled = True
    limiter.reset()
    try:
        body = {"email": "ghost@example.com", "password": "nope-nope-nope"}
        codes = [(await client.post("/auth/login", json=body)).status_code for _ in range(6)]
    finally:
        limiter.enabled = False
        limiter.reset()
    assert codes[:5] == [401] * 5
    assert codes[5] == 429


async def test_signup_can_be_closed(client: AsyncClient) -> None:
    from app.core.config import settings

    settings.ALLOW_SIGNUP = False
    try:
        res = await client.post(
            "/auth/signup",
            json={
                "account_name": "A",
                "full_name": "B",
                "email": "a@example.com",
                "password": "long-enough",
            },
        )
    finally:
        settings.ALLOW_SIGNUP = True
    assert res.status_code == 403


async def test_change_password_rejects_same_password(client: AsyncClient) -> None:
    data = await signup(client)
    res = await client.post(
        "/auth/change-password",
        headers=bearer(data["access_token"]),
        json={"current_password": "correct-horse-battery", "new_password": "correct-horse-battery"},
    )
    assert res.status_code == 422
