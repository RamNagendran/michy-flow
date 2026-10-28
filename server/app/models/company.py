from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.enums import CompanyCategory


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
    # What the plant does: decides its raw material and products (models/catalog.py).
    category: Mapped[str] = mapped_column(
        String(20), default=CompanyCategory.CRUMB.value, server_default=CompanyCategory.CRUMB.value
    )
    # Inventory configuration (set by the Super Admin): what this company processes and makes.
    # Filled from the company type's defaults when the company is created.
    input_items: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    output_items: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    # kg per litre of oil, used to weigh oil output. Changing it never rewrites saved runs.
    oil_density: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=Decimal("1.040"), server_default="1.040"
    )
    # Months between the Manager's physical stock checks (1 or 3).
    stock_check_months: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
