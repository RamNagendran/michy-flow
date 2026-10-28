"""Purchases, production and sales: the three kinds of entry that move stock.

Purchases and sales carry a grade (A, B or C); production is always Grade A.

They share the approval workflow (WorkflowMixin) and differ only in what they record.
Rows are never hard-deleted: `deleted_at` hides them, so history and audit stay intact.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import EntrySource, EntryStatus, Grade

if TYPE_CHECKING:
    from app.models.party import Party

# Quantities (kg, or litres for oil) to 1/1000, money to the paisa, rates to 1/10000 of a rupee.
KG = Numeric(14, 3)
QTY = KG
MONEY = Numeric(16, 2)
RATE = Numeric(12, 4)


def _grade_column() -> Mapped[str]:
    # A, B or C (see models/grades.py). Existing rows are Grade A.
    return mapped_column(String(1), default=Grade.A.value, server_default=Grade.A.value)


def _grade_check() -> CheckConstraint:
    # Named ck_<table>_grade by the metadata naming convention.
    return CheckConstraint("grade IN ('A', 'B', 'C')", name="grade")


class WorkflowMixin(TimestampMixin):
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    # Human reference, e.g. PUR-MR-00042. Unique per company and kind.
    ref_no: Mapped[str] = mapped_column(String(30))
    entry_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default=EntryStatus.PENDING)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # An open escalation: the Manager asked the in-charge ("incharge"), or Finance asked the
    # Manager ("manager"). They talk in the comments; the asker's approval closes it.
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated_to: Mapped[str | None] = mapped_column(String(20))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @declared_attr.directive
    def __table_args__(cls) -> tuple:
        name = cls.__tablename__
        return (
            UniqueConstraint("company_id", "ref_no", name=f"uq_{name}_company_ref"),
            Index(f"ix_{name}_company_date", "company_id", "entry_date"),
            Index(f"ix_{name}_company_status", "company_id", "status"),
            *cls._extra_table_args(),
        )

    @classmethod
    def _extra_table_args(cls) -> tuple:
        return ()


class Purchase(WorkflowMixin, Base):
    __tablename__ = "purchases"

    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id", ondelete="RESTRICT"))
    grade: Mapped[str] = _grade_column()
    # A tyre type for Grade A and B; any item for Grade C.
    material: Mapped[str] = mapped_column(String(20))
    # In the item's unit (models/catalog.py): kg, or litres for oil. The rate is per unit.
    qty: Mapped[Decimal] = mapped_column(QTY)
    rate: Mapped[Decimal] = mapped_column(RATE)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    invoice_no: Mapped[str] = mapped_column(String(50))
    # Lorries / vehicles the goods came in, for the record only.
    vehicle_nos: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    source: Mapped[str] = mapped_column(String(10), default=EntrySource.MANUAL)
    # The uploaded bill this was read from, if any.
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))

    supplier: Mapped["Party"] = relationship(lazy="joined")

    @classmethod
    def _extra_table_args(cls) -> tuple:
        # The same supplier bill cannot be entered twice (deleted entries don't count).
        return (
            _grade_check(),
            Index(
                "uq_purchases_supplier_invoice",
                "company_id",
                "supplier_id",
                text("upper(invoice_no)"),
                unique=True,
                postgresql_where=text("deleted_at IS NULL AND status <> 'rejected'"),
            ),
        )


class Sale(WorkflowMixin, Base):
    __tablename__ = "sales"

    buyer_id: Mapped[int] = mapped_column(ForeignKey("parties.id", ondelete="RESTRICT"))
    grade: Mapped[str] = _grade_column()
    # A product for Grade A, a tyre type for Grade B, any item for Grade C.
    product: Mapped[str] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(QTY)  # kg, or litres for oil; the rate is per unit
    rate: Mapped[Decimal] = mapped_column(RATE)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    invoice_no: Mapped[str] = mapped_column(String(50))
    source: Mapped[str] = mapped_column(String(10), default=EntrySource.MANUAL)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))

    buyer: Mapped["Party"] = relationship(lazy="joined")

    @classmethod
    def _extra_table_args(cls) -> tuple:
        # A company's own invoice numbers never repeat.
        return (
            _grade_check(),
            Index(
                "uq_sales_invoice",
                "company_id",
                text("upper(invoice_no)"),
                unique=True,
                postgresql_where=text("deleted_at IS NULL AND status <> 'rejected'"),
            ),
        )


class Production(WorkflowMixin, Base):
    __tablename__ = "production"

    material: Mapped[str] = mapped_column(String(20))
    # Taken out of stock for the run.
    input_kg: Mapped[Decimal] = mapped_column(KG)
    # Not processed after all and put back into stock (e.g. tyres left over at the end).
    returned_kg: Mapped[Decimal] = mapped_column(KG, default=0, server_default="0")
    shift: Mapped[int | None] = mapped_column(Integer)
    # Operators who ran the shift (user ids), chosen by the production in-charge.
    crew_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list, server_default="{}")
    # Hours the plant actually ran in the shift; efficiency = running hours / shift hours.
    running_hours: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Worked out by the server, never sent by the client. In-charges weigh only what came out:
    #   output = weight of all outputs (oil via its density);
    #   calculated input = output + WASTAGE_ALERT_PCT of it, rounded to whole kg; this is
    #   input_kg, what stock goes down by;
    #   wastage = WASTAGE_ALERT_PCT of the output, or of a bigger total the in-charge entered
    #   (that total is used only for the wastage and is not kept);
    #   returned_kg is put back into stock, so stock goes down by input - returned.
    # Older runs (calculated_input_kg is NULL) used wastage = processed - output.
    output_kg: Mapped[Decimal] = mapped_column(KG)
    calculated_input_kg: Mapped[Decimal | None] = mapped_column(KG)
    wastage_kg: Mapped[Decimal] = mapped_column(KG)
    wastage_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3))  # of the processed weight

    outputs: Mapped[list["ProductionOutput"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ProductionOutput.id"
    )


class ProductionOutput(Base):
    __tablename__ = "production_outputs"
    __table_args__ = (
        UniqueConstraint("production_id", "product", name="uq_production_outputs_product"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    production_id: Mapped[int] = mapped_column(
        ForeignKey("production.id", ondelete="CASCADE"), index=True
    )
    product: Mapped[str] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(QTY)  # in the product's unit: litres for oil
    qty_kg: Mapped[Decimal] = mapped_column(KG)  # its weight, kept as it was worked out


class EntryEvent(Base):
    """The history and comment thread of one entry: created, approved, held, comments, …"""

    __tablename__ = "entry_events"
    __table_args__ = (Index("ix_entry_events_entry", "entry_type", "entry_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    entry_type: Mapped[str] = mapped_column(String(20))
    entry_id: Mapped[int]
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str] = mapped_column(Text, default="", server_default="")
    # For edits: {"field": [old, new], ...}
    changes: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class EntryCounter(Base):
    """Next reference number per company and kind, handed out atomically."""

    __tablename__ = "entry_counters"

    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True
    )
    prefix: Mapped[str] = mapped_column(String(5), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)
