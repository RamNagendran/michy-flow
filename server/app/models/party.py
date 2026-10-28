from sqlalchemy import Boolean, ForeignKey, Index, String, text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Party(TimestampMixin, Base):
    """A supplier (sells us tyres) or buyer (buys our output). Each company keeps its own list."""

    __tablename__ = "parties"
    __table_args__ = (
        Index("ix_parties_company_kind", "company_id", "kind"),
        # One supplier (or buyer) per GST number in a company; bills are matched by it.
        Index(
            "uq_parties_company_kind_gstin",
            "company_id",
            "kind",
            "gstin",
            unique=True,
            postgresql_where=text("gstin IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100), default="", server_default="")
    # GST number; a bill from or to this party must show it.
    gstin: Mapped[str | None] = mapped_column(String(15))
    contact_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    phone: Mapped[str] = mapped_column(String(30), default="", server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
