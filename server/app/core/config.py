from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOCAL_DEV_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Required: Settings() raises at startup if either is missing or empty.
    DATABASE_URL: str
    JWT_SECRET: str

    ENV_NAME: str = "development"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 12
    JWT_REFRESH_EXPIRE_DAYS: int = 14
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    FRONTEND_BASE_URL: str = "http://localhost:3000"
    RATE_LIMIT_DEFAULT: str = "300/minute"
    RATE_LIMIT_ENABLED: bool = True
    ENCRYPTION_KEY: str = ""
    # Public signup creates a new organisation with its first Super Admin.
    # Turn it off once the organisation exists; further people are added by the Super Admin.
    ALLOW_SIGNUP: bool = True
    # Create missing tables and apply pending migrations when the app starts.
    AUTO_MIGRATE: bool = True
    # Business time zone: decides what "today" is for entry dates.
    TIMEZONE: str = "Asia/Kolkata"
    # Hard wastage limit (% of the processed weight). Over it a run raises a high alert and
    # needs a debit note; it is also the most a Manager may declare as a monthly allowance.
    WASTAGE_ALERT_PCT: float = 2.0
    # Planned hours in one of the three daily shifts, for production efficiency.
    SHIFT_HOURS: float = 8.0
    # Optional. Set when running more than one API instance, so live updates reach everyone.
    # Must allow LISTEN: on Supabase the direct or session-pooler URL (port 5432), not 6543.
    REALTIME_LISTEN_URL: str = ""

    @field_validator("DATABASE_URL", "JWT_SECRET")
    @classmethod
    def _not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()

    @field_validator("DATABASE_URL")
    @classmethod
    def _use_asyncpg(cls, value: str) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    @property
    def allowed_origins(self) -> list[str]:
        """Browser origins allowed to call the API (CORS and the WebSocket origin check).
        In development the local Vite app is always allowed, so a production-only
        ALLOWED_ORIGINS in .env cannot lock out the developer."""
        origins = [o.strip().rstrip("/") for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]
        if self.is_development:
            origins += [o for o in _LOCAL_DEV_ORIGINS if o not in origins]
        return origins

    @property
    def is_development(self) -> bool:
        return self.ENV_NAME == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
