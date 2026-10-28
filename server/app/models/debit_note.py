"""Debit notes against suppliers.

A debit note is a flag raised on a purchase about its supplier: any issue the team should
know about next time (e.g. 150 kg of a 1,000 kg load was useless). It changes nothing by
itself: no stock, no amounts. It is shown wherever that supplier's purchases are entered or
approved, until someone marks it settled on a later purchase from that supplier.

Older notes were raised on production runs over the hard wastage limit (production_id). They
are kept as they were but are no longer shown or made.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entries import KG, MONEY


class DebitNote(Base):
    __tablename__ = "debit_notes"
    __table_args__ = (
        UniqueConstraint("company_id", "note_no", name="uq_debit_notes_company_note"),
        CheckConstraint("num_nonnulls(production_id, purchase_id) = 1", name="one_entry"),
        Index("ix_debit_notes_company_supplier", "company_id", "supplier_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    note_no: Mapped[str] = mapped_column(String(50))
    # The purchase it was raised on.
    purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchases.id", ondelete="CASCADE"), index=True
    )
    # Older notes only.
    production_id: Mapped[int | None] = mapped_column(
        ForeignKey("production.id", ondelete="CASCADE"), unique=True
    )
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="RESTRICT"))
    item: Mapped[str | None] = mapped_column(String(20))
    # Optional, for the record only: in the item's unit (litres for oil).
    qty_kg: Mapped[Decimal | None] = mapped_column(KG)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    reason: Mapped[str] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    # The later purchase from the same supplier it was settled on. NULL: still open.
    adjusted_purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchases.id", ondelete="SET NULL")
    )
    adjusted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    adjusted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
