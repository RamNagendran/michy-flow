from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Operator(TimestampMixin, Base):
    """A plant worker who runs production shifts. Just a name and their usual shift: no login.
    The production in-charge adds them straight from the production form."""

    __tablename__ = "operators"
    __table_args__ = (
        # One operator per name in a company.
        Index("uq_operators_company_name", "company_id", text("lower(trim(name))"), unique=True),
        CheckConstraint("shift IS NULL OR shift BETWEEN 1 AND 3", name="shift"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # Their usual shift (1-3). Empty only for workers moved over from the old user list.
    shift: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
