from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.user import User


class CompanyMembership(TimestampMixin, Base):
    """One person's role in one company. A person may belong to several companies."""

    __tablename__ = "company_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_company_memberships_user_company"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    # Operator duties (purchase / sales / production). Empty for every other role.
    duties: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=list, server_default="{}")

    user: Mapped["User"] = relationship(back_populates="memberships")
    company: Mapped["Company"] = relationship(lazy="joined")
