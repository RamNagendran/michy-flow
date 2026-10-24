from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_system_permission
from app.auth.permissions import SystemPermission
from app.core.db import get_db
from app.models import User
from app.schemas.audit import AuditLogRead
from app.schemas.common import Paginated
from app.services import audit_service

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", response_model=Paginated[AuditLogRead])
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    company_id: int | None = Query(None, gt=0),
    entity_type: str | None = Query(None, max_length=50),
    actor: User = Depends(require_system_permission(SystemPermission.VIEW_AUDIT)),
    db: AsyncSession = Depends(get_db),
) -> Paginated[AuditLogRead]:
    """Everything that happened in the organisation, newest first."""
    return await audit_service.list_logs(
        db,
        account_id=actor.account_id,
        page=page,
        page_size=page_size,
        company_id=company_id,
        entity_type=entity_type,
    )
