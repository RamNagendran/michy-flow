"""a production run may use several raw materials

Each run gets one line per raw material with the kg stock goes down by. Existing runs get one
line: their material, input less returned.

Revision ID: d81f3b7a5c42
Revises: c4a9e2f71d30
Create Date: 2026-11-14 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d81f3b7a5c42"
down_revision: str | None = "c4a9e2f71d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "production_materials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "production_id",
            sa.Integer(),
            sa.ForeignKey("production.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("material", sa.String(20), nullable=False),
        sa.Column("qty_kg", sa.Numeric(14, 3), nullable=False),
        sa.UniqueConstraint("production_id", "material", name="uq_production_materials_material"),
    )
    op.create_index(
        "ix_production_materials_production_id", "production_materials", ["production_id"]
    )
    op.execute(
        "INSERT INTO production_materials (production_id, material, qty_kg) "
        "SELECT id, material, input_kg - returned_kg FROM production"
    )


def downgrade() -> None:
    op.drop_index("ix_production_materials_production_id", table_name="production_materials")
    op.drop_table("production_materials")
