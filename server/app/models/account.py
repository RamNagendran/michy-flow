from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Account(TimestampMixin, Base):
    """A tenant. Every domain row belongs to exactly one account."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Changes whenever the Super Admin changes an item or company type, so every server
    # reloads its in-memory copy of the catalogue (models/catalog.py).
    catalog_version: Mapped[str] = mapped_column(
        String(32), default=lambda: uuid4().hex, server_default=text("md5(random()::text)")
    )

    users: Mapped[list["User"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
