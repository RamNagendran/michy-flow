from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Operator(TimestampMixin, Base):
    """A plant worker who runs production shifts: no login. The Manager keeps the list, and the
    production in-charge picks from it."""

    __tablename__ = "operators"
    __table_args__ = (
        # One operator per name in a company.
        Index("uq_operators_company_name", "company_id", text("lower(trim(name))"), unique=True),
        CheckConstraint("shift IS NULL OR shift BETWEEN 1 AND 3", name="shift"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # Required for new operators; empty on ones added before the Manager kept the list.
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(320))
    # Their usual shift (1-3), if they have one.
    shift: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Machine(TimestampMixin, Base):
    """A production machine. The Manager keeps the list; every production run names one."""

    __tablename__ = "machines"
    __table_args__ = (
        # One machine per number in a company.
        Index("uq_machines_company_code", "company_id", text("lower(trim(code))"), unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    # The machine's own number, e.g. "M-01".
    code: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
