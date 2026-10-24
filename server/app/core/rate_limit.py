from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# The one Limiter for the whole app. Routers import it to add per-route limits.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.RATE_LIMIT_DEFAULT],
    enabled=settings.RATE_LIMIT_ENABLED,
)
