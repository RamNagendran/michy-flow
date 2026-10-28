"""Tell connected clients that something changed. Call only after the change is committed.

A failure here is logged and swallowed: live updates must never break a save.
"""

import logging
from typing import Any

from app.models import Company, Party, User
from app.models.enums import EntryType
from app.realtime.hub import hub

logger = logging.getLogger(__name__)


async def _publish(event: dict[str, Any]) -> None:
    try:
        await hub.publish(event)
    except Exception:  # noqa: BLE001
        logger.exception("Publishing a realtime event failed")


async def entry_changed(
    entry_type: EntryType, entry: Any, action: str, actor: User, alert: str | None = None
) -> None:
    """`alert` marks events that need attention now, e.g. "escalated"."""
    await _publish(
        {
            "alert": alert,
            "type": "entry",
            "action": action,
            "account_id": actor.account_id,
            "company_id": entry.company_id,
            "entry_type": entry_type.value,
            "entry_id": entry.id,
            "ref_no": entry.ref_no,
            "status": entry.status,
            "created_by_id": entry.created_by_id,
            "actor_id": actor.id,
            "actor_name": actor.full_name,
        }
    )


async def party_changed(party: Party, actor: User) -> None:
    await _publish(
        {
            "type": "party",
            "account_id": actor.account_id,
            "company_id": party.company_id,
            "party_id": party.id,
        }
    )


async def company_changed(company: Company) -> None:
    await _publish({"type": "company", "account_id": company.account_id, "company_id": company.id})


async def access_changed(account_id: int, user_ids: list[int]) -> None:
    """These people's access changed; their open sessions are no longer valid."""
    await _publish({"type": "access", "account_id": account_id, "user_ids": user_ids})


async def stock_checked(company: Company, actor: User) -> None:
    """Book stock changed after the Manager's count: everyone viewing stock refreshes."""
    await _publish(
        {
            "type": "stock",
            "account_id": company.account_id,
            "company_id": company.id,
            "actor_id": actor.id,
        }
    )
