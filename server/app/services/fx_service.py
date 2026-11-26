"""Today's exchange rate to rupees, for filling in an import purchase.

Only a suggestion for the form: the person can change it, the rate on a Bill of Entry wins,
and the rate used is saved with the entry, so later rate changes never touch old entries.
Rates are kept for an hour, so the rate site is asked at most once an hour per currency.
"""

import logging
import time
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from app.core.config import settings
from app.core.errors import AppError

logger = logging.getLogger("app.fx")

_KEEP_SECONDS = 3600
_cache: dict[str, tuple[float, Decimal, datetime]] = {}


class RateUnavailableError(AppError):
    status_code = 503
    code = "fx_unavailable"


async def _fetch(currency: str) -> tuple[Decimal, datetime]:
    """(rupees for one unit, when the rate site last updated it)."""
    url = settings.FX_RATE_URL.format(currency=currency)
    async with httpx.AsyncClient(timeout=8) as client:
        res = await client.get(url)
    res.raise_for_status()
    body = res.json()
    inr = body.get("rates", {}).get("INR")
    if body.get("result") != "success" or not inr:
        raise ValueError(f"no INR rate in the reply for {currency}")
    updated = body.get("time_last_update_unix")
    as_of = datetime.fromtimestamp(updated, UTC) if updated else datetime.now(UTC)
    return Decimal(str(inr)).quantize(Decimal("0.0001")), as_of


async def rate_to_inr(currency: str) -> tuple[Decimal, datetime]:
    if currency == "INR":
        return Decimal(1), datetime.now(UTC)
    if not settings.FX_RATE_URL:
        raise RateUnavailableError("Live rates are turned off. Type the exchange rate.")
    kept = _cache.get(currency)
    if kept and time.monotonic() - kept[0] < _KEEP_SECONDS:
        return kept[1], kept[2]
    try:
        rate, as_of = await _fetch(currency)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.exception("Could not get the live rate for %s", currency)
        raise RateUnavailableError(
            "Could not get the live rate now. Type the exchange rate from the bill or bank."
        ) from None
    _cache[currency] = (time.monotonic(), rate, as_of)
    return rate, as_of
