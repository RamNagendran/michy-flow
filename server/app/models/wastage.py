"""Wastage control: the monthly wastage approval and the Manager's physical stock checks."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.entries import QTY


class WastageMonthRecord(TimestampMixin, Base):
    """One month's wastage on its way to the Super Admin (see services/wastage_month_service).

    A month with production is sent for approval when it ends; the row is made on the first
    action (a comment, an escalation, a change or the approval). Until it is approved the
    totals are worked out live from production; approval saves them here and locks the month.
    """

    __tablename__ = "wastage_months"
    __table_args__ = (
        UniqueConstraint("company_id", "month", name="uq_wastage_months_company_month"),
        CheckConstraint("status IN ('pending', 'escalated', 'approved')", name="status"),
        CheckConstraint("target_kg IS NULL OR target_kg >= 0", name="target_kg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    month: Mapped[date] = mapped_column(Date)  # always the 1st of the month
    # pending: waiting for the Super Admin; escalated: waiting for the Manager; approved: final.
    status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending")
    # The Super Admin's own figure for the month, when they changed it. The difference from the
    # production total is spread over the tyres used, by share, when the month is approved.
    target_kg: Mapped[Decimal | None] = mapped_column(QTY)
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Saved on approval: what the production entries added up to, and the approved figure.
    runs: Mapped[int | None] = mapped_column(Integer)
    processed_kg: Mapped[Decimal | None] = mapped_column(QTY)
    output_kg: Mapped[Decimal | None] = mapped_column(QTY)
    calculated_kg: Mapped[Decimal | None] = mapped_column(QTY)
    approved_kg: Mapped[Decimal | None] = mapped_column(QTY)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    adjustments: Mapped[list["WastageAdjustment"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="WastageAdjustment.id"
    )


class WastageAdjustment(Base):
    """Raw stock moved when a changed month is approved: positive is taken out of stock (more
    wastage than production showed), negative is put back."""

    __tablename__ = "wastage_adjustments"
    __table_args__ = (UniqueConstraint("record_id", "item", name="uq_wastage_adjustments_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(
        ForeignKey("wastage_months.id", ondelete="CASCADE"), index=True
    )
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    item: Mapped[str] = mapped_column(String(20))  # a Grade A raw material
    processed_kg: Mapped[Decimal] = mapped_column(QTY)  # its share of the month's processing
    qty: Mapped[Decimal] = mapped_column(QTY)


class WastageMonthEvent(Base):
    """The history and comment thread of one month's wastage."""

    __tablename__ = "wastage_month_events"
    __table_args__ = (Index("ix_wastage_month_events_record", "record_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("wastage_months.id", ondelete="CASCADE"))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str] = mapped_column(Text, default="", server_default="")
    # For changes: {"wastage_kg": [old, new]}; for approvals: the stock moved per item.
    changes: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class StockCheck(Base):
    """One physical count by the Manager. Each line's difference adjusts the book stock."""

    __tablename__ = "stock_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    counted_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    counted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )

    lines: Mapped[list["StockCheckLine"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="StockCheckLine.id"
    )


class StockCheckLine(Base):
    __tablename__ = "stock_check_lines"
    __table_args__ = (
        UniqueConstraint("check_id", "grade", "item", name="uq_stock_check_lines_item"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    check_id: Mapped[int] = mapped_column(
        ForeignKey("stock_checks.id", ondelete="CASCADE"), index=True
    )
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    grade: Mapped[str] = mapped_column(String(1))
    # "raw" for Grade A material, "output" for products; Grade B lines use "resale".
    section: Mapped[str] = mapped_column(String(10))
    item: Mapped[str] = mapped_column(String(20))
    book_qty: Mapped[Decimal] = mapped_column(QTY)
    counted_qty: Mapped[Decimal] = mapped_column(QTY)
    # book − counted: positive is a shortage taken out of stock, negative a surplus added.
    difference: Mapped[Decimal] = mapped_column(QTY)
