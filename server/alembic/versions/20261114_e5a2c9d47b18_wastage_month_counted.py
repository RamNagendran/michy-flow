"""raw material missing in a month's stock counts is part of its wastage

Approved months save that part next to the production figure.

Revision ID: e5a2c9d47b18
Revises: d81f3b7a5c42
Create Date: 2026-11-14 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5a2c9d47b18"
down_revision: str | None = "d81f3b7a5c42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("wastage_months", sa.Column("counted_kg", sa.Numeric(14, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("wastage_months", "counted_kg")
