"""Import every model here so Base.metadata is complete for Alembic autogenerate."""

from app.models.account import Account
from app.models.audit_log import AuditLog
from app.models.base import Base
from app.models.company import Company
from app.models.debit_note import DebitNote
from app.models.document import Document
from app.models.entries import (
    EntryCounter,
    EntryEvent,
    Production,
    ProductionOutput,
    Purchase,
    Sale,
)
from app.models.membership import CompanyMembership
from app.models.party import Party
from app.models.user import User
from app.models.wastage import (
    StockCheck,
    StockCheckLine,
    WastageAdjustment,
    WastageMonthEvent,
    WastageMonthRecord,
)

__all__ = [
    "Account",
    "AuditLog",
    "Base",
    "Company",
    "CompanyMembership",
    "DebitNote",
    "Document",
    "EntryCounter",
    "EntryEvent",
    "Party",
    "Production",
    "ProductionOutput",
    "Purchase",
    "Sale",
    "StockCheck",
    "StockCheckLine",
    "User",
    "WastageAdjustment",
    "WastageMonthEvent",
    "WastageMonthRecord",
]
