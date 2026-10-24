from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Account(TimestampMixin, Base):
    """A tenant. Every domain row belongs to exactly one account."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))

    users: Mapped[list["User"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
