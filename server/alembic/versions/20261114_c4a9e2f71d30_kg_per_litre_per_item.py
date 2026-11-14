"""kg per litre moves from one oil number per company to each litres item

Each litres item gets its own kg per litre (oil starts at 1.040). A company may set its own
number for any litres item. A company whose oil number was not the default keeps it, for every
litres item it was used for, so new weights stay the same.

Revision ID: c4a9e2f71d30
Revises: b7d3e1f05a28
Create Date: 2026-11-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4a9e2f71d30"
down_revision: str | None = "b7d3e1f05a28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("catalog_items", sa.Column("kg_per_litre", sa.Numeric(5, 3), nullable=True))
    op.execute("UPDATE catalog_items SET kg_per_litre = 1.040 WHERE unit = 'L'")
    op.add_column(
        "companies",
        sa.Column(
            "kg_per_litre",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.execute(
        """
        UPDATE companies c
        SET kg_per_litre = (
            SELECT jsonb_object_agg(i.key, c.oil_density::text)
            FROM catalog_items i
            WHERE i.account_id = c.account_id AND i.unit = 'L'
        )
        WHERE c.oil_density <> 1.040
          AND EXISTS (
            SELECT 1 FROM catalog_items i WHERE i.account_id = c.account_id AND i.unit = 'L'
          )
        """
    )
    op.drop_column("companies", "oil_density")


def downgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("oil_density", sa.Numeric(5, 3), nullable=False, server_default="1.040"),
    )
    op.execute(
        "UPDATE companies SET oil_density = (kg_per_litre->>'oil')::numeric "
        "WHERE kg_per_litre ? 'oil'"
    )
    op.drop_column("companies", "kg_per_litre")
    op.drop_column("catalog_items", "kg_per_litre")
