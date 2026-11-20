"""Sends mail through Brevo's HTTP API. Runs as a background task after the response, so a slow
or failed send never holds up the request; failures are logged."""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger("app.email")

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


async def deliver(to: str, subject: str, html: str, text: str) -> None:
    if not settings.BREVO_API_KEY:
        # Local development without a key: show the mail in the log instead.
        logger.warning("Mail not sent (no BREVO_API_KEY) to=%s subject=%s\n%s", to, subject, text)
        return
    body = {
        "sender": {"email": settings.MAIL_FROM_EMAIL, "name": settings.MAIL_FROM_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                BREVO_URL, json=body, headers={"api-key": settings.BREVO_API_KEY}
            )
        if res.status_code >= 300:
            logger.error(
                "Brevo rejected mail to=%s status=%s body=%s", to, res.status_code, res.text[:300]
            )
    except httpx.HTTPError:
        logger.exception("Could not reach Brevo to send mail to=%s", to)
