"""Wastage control: monthly allowances, debit notes for runs over the limit, and the Manager's
physical stock checks."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.entries import KG, MONEY, QTY


class WastageAllowance(TimestampMixin, Base):
    """The wastage % the Manager declares acceptable for one month (up to the hard limit)."""

    __tablename__ = "wastage_allowances"
    __table_args__ = (
        UniqueConstraint("company_id", "month", name="uq_wastage_allowances_company_month"),
        CheckConstraint("pct > 0 AND pct <= 2", name="pct"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    month: Mapped[date] = mapped_column(Date)  # always the 1st of the month
    pct: Mapped[Decimal] = mapped_column(Numeric(4, 2))
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    declared_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class DebitNote(Base):
    """Raised for a production run whose missing weight is over the hard limit."""

    __tablename__ = "debit_notes"
    __table_args__ = (
        UniqueConstraint("company_id", "note_no", name="uq_debit_notes_company_note"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    production_id: Mapped[int] = mapped_column(
        ForeignKey("production.id", ondelete="CASCADE"), unique=True
    )
    note_no: Mapped[str] = mapped_column(String(50))
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="RESTRICT"))
    qty_kg: Mapped[Decimal] = mapped_column(KG)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    reason: Mapped[str] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
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
