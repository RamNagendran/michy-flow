import os

# Must be set before anything imports app.core.config.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://localhost:5432/michy_flow_test"
)
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-use-0123456789")
os.environ["ENV_NAME"] = "test"
os.environ["RATE_LIMIT_ENABLED"] = "false"
# The test fixtures migrate the test database themselves.
os.environ["AUTO_MIGRATE"] = "false"
os.environ["ALLOW_SIGNUP"] = "true"

from collections.abc import AsyncIterator, Iterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.main import app  # noqa: E402

if "test" not in settings.DATABASE_URL.rsplit("/", 1)[-1]:
    raise RuntimeError("Refusing to run tests: database name must contain 'test'")

_TABLES = (
    "accounts",
    "catalog_items",
    "company_types",
    "users",
    "companies",
    "company_memberships",
    "operators",
    "machines",
    "audit_logs",
    "parties",
    "purchases",
    "sales",
    "production",
    "production_outputs",
    "entry_events",
    "entry_counters",
    "documents",
    "wastage_months",
    "wastage_adjustments",
    "wastage_month_events",
    "debit_notes",
    "stock_checks",
    "stock_check_lines",
    "email_otps",
)
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> Iterator[None]:
    cfg = Config(str(ALEMBIC_INI))
    command.upgrade(cfg, "head")
    yield
    command.downgrade(cfg, "base")


@pytest.fixture(autouse=True)
async def clean_tables() -> AsyncIterator[None]:
    yield
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(_TABLES)} RESTART IDENTITY CASCADE"))


@pytest.fixture(scope="session", autouse=True)
async def dispose_engine() -> AsyncIterator[None]:
    yield
    await engine.dispose()


# Shared with the signup() helper, which has no access to fixtures.
_SENT: list[dict] = []


@pytest.fixture(autouse=True)
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Mails the app would send, caught here instead of going to Brevo."""
    from app.services import email_service

    sent = _SENT
    sent.clear()

    async def fake_deliver(to: str, subject: str, html: str, text: str) -> None:
        sent.append({"to": to, "subject": subject, "html": html, "text": text})

    monkeypatch.setattr(email_service, "deliver", fake_deliver)
    return sent


def otp_from(outbox: list[dict], email: str) -> str:
    """The code in the latest code mail (sign-up or new person) sent to this address."""
    email = email.lower()
    mail = next(
        m for m in reversed(outbox) if m["to"].lower() == email and m["subject"].endswith(" code")
    )
    return mail["subject"].split(" ", 1)[0]


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def signup(client: AsyncClient, email: str = "priya@example.com", **extra: str) -> dict:
    res = await client.post("/auth/signup/otp", json={"email": email, "full_name": "Priya Sundar"})
    assert res.status_code == 202, res.text
    otp = otp_from(_SENT, email)
    body = {
        "account_name": "Acme Rubbers",
        "full_name": "Priya Sundar",
        "email": email,
        "password": "correct-horse-battery",
        "otp": otp,
        **extra,
    }
    res = await client.post("/auth/signup", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_gstin(seed: str, state: str = "33") -> str:
    """A GST number with a valid check digit, the same for the same seed."""
    import hashlib

    from app.core.gstin import _CHARS, checksum_ok

    h = hashlib.sha256(seed.encode()).digest()
    letters = "".join(chr(65 + b % 26) for b in h[:6])
    digits = "".join(str(b % 10) for b in h[6:10])
    body = f"{state}{letters[:5]}{digits}{letters[5]}1Z"
    gstin = next(body + c for c in _CHARS if checksum_ok(body + c))
    return gstin


async def create_company(client: AsyncClient, token: str, code: str = "MR", **extra: str) -> dict:
    from tests.bill_samples import OUR_GSTIN

    body = {
        "code": code,
        "name": f"Company {code}",
        "city": "Chennai",
        # "MR" is the company the sample bills are addressed to.
        "gstin": OUR_GSTIN if code == "MR" else make_gstin(f"company-{code}"),
        "category": "crumb",
        **extra,
    }
    res = await client.post("/companies", json=body, headers=bearer(token))
    assert res.status_code == 201, res.text
    return res.json()


async def create_user(client: AsyncClient, token: str, email: str, **access: object) -> dict:
    """Create a user as the Super Admin. Returns {"user": ..., "temporary_password": ...}."""
    name = email.split("@")[0].title()
    res = await client.post(
        "/users/otp", json={"email": email, "full_name": name}, headers=bearer(token)
    )
    assert res.status_code == 202, res.text
    body = {"email": email, "full_name": name, "otp": otp_from(_SENT, email), **access}
    res = await client.post("/users", json=body, headers=bearer(token))
    assert res.status_code == 201, res.text
    return res.json()


async def login_new_user(client: AsyncClient, created: dict) -> str:
    """Sign in with the temporary password, set a real one, and return a usable access token."""
    email, temp = created["user"]["email"], created["temporary_password"]
    res = await client.post("/auth/login", json={"email": email, "password": temp})
    assert res.status_code == 200, res.text
    res = await client.post(
        "/auth/change-password",
        json={"current_password": temp, "new_password": "a-proper-password"},
        headers=bearer(res.json()["access_token"]),
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]
