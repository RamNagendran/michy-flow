"""vehicle numbers on purchases, for the record only

Revision ID: e3a91f5c2d17
Revises: c5e19a7d3b60
Create Date: 2026-10-28 19:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e3a91f5c2d17"
down_revision: str | None = "c5e19a7d3b60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "purchases",
        sa.Column(
            "vehicle_nos",
            postgresql.ARRAY(sa.String(length=20)),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("purchases", "vehicle_nos")
