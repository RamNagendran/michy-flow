"""production wastage is entered by the in-charge (kg and gas / liquid / solid), not 2%

Revision ID: b7d3e1f05a28
Revises: b7e3d91a4c26
Create Date: 2026-11-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7d3e1f05a28"
down_revision: str | None = "b7e3d91a4c26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Older runs keep their 2% wastage; it just has no type.
    op.add_column("production", sa.Column("wastage_type", sa.String(10), nullable=True))
    op.create_check_constraint(
        op.f("ck_production_wastage_type"),
        "production",
        "wastage_type IS NULL OR wastage_type IN ('gas', 'liquid', 'solid')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_production_wastage_type"), "production", type_="check")
    op.drop_column("production", "wastage_type")
