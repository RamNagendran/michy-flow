from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Company(TimestampMixin, Base):
    """An entity (company) inside an account. Purchases, production and sales all happen here."""

    __tablename__ = "companies"
    __table_args__ = (UniqueConstraint("account_id", "code", name="uq_companies_account_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # Short uppercase code shown on badges and invoice prefixes, e.g. "MR".
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100), default="", server_default="")
    # GST number; bills uploaded for this company must show it.
    gstin: Mapped[str | None] = mapped_column(String(15))
    # Its company type (company_types.key): decides its default raw material and products.
    category: Mapped[str] = mapped_column(String(20), default="crumb", server_default="crumb")
    # Inventory configuration (set by the Super Admin): what this company processes and makes.
    # Filled from the company type's defaults when the company is created.
    input_items: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    output_items: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    # This company's own kg per litre for litres items, e.g. {"oil": "1.045"}. Items left out
    # use the item's number. Changing it never rewrites saved runs.
    kg_per_litre: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict, server_default="{}")
    # Months between the Super Admin's physical stock checks (1 or 3).
    stock_check_months: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
