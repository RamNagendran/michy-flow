from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import AuditLog, Company, User
from app.schemas.audit import AuditLogRead
from app.schemas.common import Paginated


def client_ip(request: Request | None) -> str | None:
    # Behind a proxy, run uvicorn with --proxy-headers so this is the real client address.
    return request.client.host if request and request.client else None


def record(
    db: AsyncSession,
    *,
    account_id: int,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    company_id: int | None = None,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Add an audit row to the current transaction. It is saved by the caller's commit,
    so the log entry and the change it describes succeed or fail together."""
    db.add(
        AuditLog(
            account_id=account_id,
            actor_id=actor.id if actor else None,
            company_id=company_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
            ip_address=client_ip(request),
        )
    )


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, date | datetime):
        return value.isoformat()
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    return getattr(value, "value", value)  # enums


def changes_of(obj: object, values: dict[str, Any]) -> dict[str, list]:
    """{field: [old, new]} for each value that differs from obj, ready for `details`.
    Call it before the new values are set on obj."""
    return {
        k: [_plain(getattr(obj, k)), _plain(v)] for k, v in values.items() if getattr(obj, k) != v
    }


# Areas of the audit page: each is a set of entity types, or of actions.
_SIGN_IN = ("login", "login_failed", "password_changed", "password_reset")
AREAS: dict[str, Any] = {
    "entries": AuditLog.entity_type.in_(("purchase", "sale", "production")),
    "wastage": AuditLog.entity_type.in_(("wastage_month", "stock_check")),
    "parties": AuditLog.entity_type == "party",
    "documents": AuditLog.entity_type == "document",
    "people": AuditLog.entity_type.in_(("user", "operator", "account"))
    & AuditLog.action.not_in(_SIGN_IN),
    "sign_in": AuditLog.action.in_(_SIGN_IN),
    "companies": AuditLog.entity_type == "company",
    "items": AuditLog.entity_type.in_(("item", "company_type")),
}


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time.min, ZoneInfo(settings.TIMEZONE))


async def list_logs(
    db: AsyncSession,
    *,
    account_id: int,
    page: int,
    page_size: int,
    company_id: int | None = None,
    entity_type: str | None = None,
    area: str | None = None,
    actor_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
) -> Paginated[AuditLogRead]:
    filters = [AuditLog.account_id == account_id]
    if company_id is not None:
        filters.append(AuditLog.company_id == company_id)
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if area in AREAS:
        filters.append(AREAS[area])
    if actor_id is not None:
        filters.append(AuditLog.actor_id == actor_id)
    # Days are the business's days, not the server's.
    if date_from:
        filters.append(AuditLog.created_at >= _start_of(date_from))
    if date_to:
        filters.append(AuditLog.created_at < _start_of(date_to + timedelta(days=1)))
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(cast(AuditLog.details, String).ilike(like), AuditLog.ip_address == q))

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = await db.execute(
        select(AuditLog, User.full_name, Company.name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .outerjoin(Company, Company.id == AuditLog.company_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        AuditLogRead.model_validate({**_as_dict(log), "actor_name": name, "company_name": company})
        for log, name, company in rows
    ]
    return Paginated(items=items, total=total, page=page, page_size=page_size)


def _as_dict(log: AuditLog) -> dict[str, Any]:
    return {c.key: getattr(log, c.key) for c in AuditLog.__table__.columns}
