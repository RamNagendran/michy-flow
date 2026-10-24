from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int | None
    actor_name: str | None
    company_id: int | None
    action: str
    entity_type: str
    entity_id: int | None
    details: dict[str, Any]
    ip_address: str | None
    created_at: datetime
