from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User
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


async def list_logs(
    db: AsyncSession,
    *,
    account_id: int,
    page: int,
    page_size: int,
    company_id: int | None = None,
    entity_type: str | None = None,
) -> Paginated[AuditLogRead]:
    filters = [AuditLog.account_id == account_id]
    if company_id is not None:
        filters.append(AuditLog.company_id == company_id)
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = await db.execute(
        select(AuditLog, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        AuditLogRead.model_validate({**_as_dict(log), "actor_name": name}) for log, name in rows
    ]
    return Paginated(items=items, total=total, page=page, page_size=page_size)


def _as_dict(log: AuditLog) -> dict[str, Any]:
    return {c.key: getattr(log, c.key) for c in AuditLog.__table__.columns}
