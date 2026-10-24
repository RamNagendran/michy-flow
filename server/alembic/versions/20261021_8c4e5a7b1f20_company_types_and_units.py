"""company types, quantities in each item's unit, tyres returned to stock

Revision ID: 8c4e5a7b1f20
Revises: 6b2f0c1d9e47
Create Date: 2026-10-21 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8c4e5a7b1f20"
down_revision: str | None = "6b2f0c1d9e47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing companies made rubber, steel and other: crumb rubber plants.
    op.add_column(
        "companies",
        sa.Column("category", sa.String(length=20), server_default="crumb", nullable=False),
    )
    # Quantities are now in each item's unit (litres for oil); everything so far was kg.
    for table in ("purchases", "sales"):
        op.alter_column(table, "qty_kg", new_column_name="qty")
    op.add_column(
        "production",
        sa.Column("returned_kg", sa.Numeric(14, 3), server_default="0", nullable=False),
    )
    op.add_column("production_outputs", sa.Column("qty", sa.Numeric(14, 3), nullable=True))
    op.execute("UPDATE production_outputs SET qty = qty_kg")
    op.alter_column("production_outputs", "qty", nullable=False)


def downgrade() -> None:
    op.drop_column("production_outputs", "qty")
    op.drop_column("production", "returned_kg")
    for table in ("purchases", "sales"):
        op.alter_column(table, "qty", new_column_name="qty_kg")
    op.drop_column("companies", "category")
