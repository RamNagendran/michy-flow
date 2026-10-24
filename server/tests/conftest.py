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
    "users",
    "companies",
    "company_memberships",
    "audit_logs",
    "parties",
    "purchases",
    "sales",
    "production",
    "production_outputs",
    "entry_events",
    "entry_counters",
    "documents",
    "wastage_allowances",
    "debit_notes",
    "stock_checks",
    "stock_check_lines",
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


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def signup(client: AsyncClient, email: str = "priya@example.com", **extra: str) -> dict:
    body = {
        "account_name": "Acme Rubbers",
        "full_name": "Priya Sundar",
        "email": email,
        "password": "correct-horse-battery",
        **extra,
    }
    res = await client.post("/auth/signup", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def create_company(client: AsyncClient, token: str, code: str = "MR", **extra: str) -> dict:
    body = {
        "code": code,
        "name": f"Company {code}",
        "city": "Chennai",
        "category": "crumb",
        **extra,
    }
    res = await client.post("/companies", json=body, headers=bearer(token))
    assert res.status_code == 201, res.text
    return res.json()


async def create_user(client: AsyncClient, token: str, email: str, **access: object) -> dict:
    """Create a user as the Super Admin. Returns {"user": ..., "temporary_password": ...}."""
    body = {"email": email, "full_name": email.split("@")[0].title(), **access}
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
