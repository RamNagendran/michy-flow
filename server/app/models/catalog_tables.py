"""The account's own items and company types, set by the Super Admin (Settings → Company types
& items). Read through models/catalog.py, which keeps them in memory per account.

Entries store an item's `key`, never its id, so an item's key never changes once made.
"""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CatalogItem(TimestampMixin, Base):
    """Something bought, processed, made or sold."""

    __tablename__ = "catalog_items"
    __table_args__ = (UniqueConstraint("account_id", "key", name="uq_catalog_items_account_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(200), default="", server_default="")
    # "material" goes into production; "product" comes out of it.
    kind: Mapped[str] = mapped_column(String(10))
    unit: Mapped[str] = mapped_column(String(5), default="kg", server_default="kg")
    # Kept in stock and can be sold. Weighed waste is recorded but never stocked.
    stocked: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Litres items only: how many kg one litre weighs. A company may set its own number.
    kg_per_litre: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    color: Mapped[str] = mapped_column(String(7), default="#8A919E", server_default="#8A919E")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class CompanyType(TimestampMixin, Base):
    """A kind of plant: what it processes and what it makes. A new company starts from these."""

    __tablename__ = "company_types"
    __table_args__ = (UniqueConstraint("account_id", "key", name="uq_company_types_account_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    # Stored on each company (companies.category).
    key: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(60))
    example: Mapped[str] = mapped_column(String(100), default="", server_default="")
    input_items: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=list)
    output_items: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=list)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
