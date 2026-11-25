"""a deactivated user's email may be given to a new user: unique only among active users

Revision ID: c3e9a1f2d7b4
Revises: a7c4e1d93b52
Create Date: 2026-11-25 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3e9a1f2d7b4"
down_revision: str | None = "a7c4e1d93b52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index(
        "uq_users_active_email",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )


def downgrade() -> None:
    # Fails if a deactivated user shares an email with another user; remove one first.
    op.drop_index("uq_users_active_email", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
