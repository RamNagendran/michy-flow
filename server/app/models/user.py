from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, false, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.account import Account
    from app.models.membership import CompanyMembership


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # Stored lowercased; unique across all accounts because login is by email alone.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    # Set for Super Admin and CEO. Company-level people have None and get access via memberships.
    global_role: Mapped[str | None] = mapped_column(String(20), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Set when an admin creates the user or resets their password.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    # Bumped whenever access changes (password, role, memberships, deactivation).
    # Tokens carry the version they were issued with, so older tokens stop working at once.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    account: Mapped["Account"] = relationship(back_populates="users", lazy="joined")
    memberships: Mapped[list["CompanyMembership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    def revoke_sessions(self) -> None:
        self.token_version += 1
