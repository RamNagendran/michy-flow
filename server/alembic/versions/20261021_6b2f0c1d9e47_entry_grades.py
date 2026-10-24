"""entry grades (A, B, C) on purchases and sales

Revision ID: 6b2f0c1d9e47
Revises: 501fc4e11e68
Create Date: 2026-10-21 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6b2f0c1d9e47"
down_revision: str | None = "501fc4e11e68"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("purchases", "sales")


def upgrade() -> None:
    # Everything entered so far was physical stock through the plant: Grade A.
    for table in _TABLES:
        op.add_column(
            table, sa.Column("grade", sa.String(length=1), server_default="A", nullable=False)
        )
        op.create_check_constraint(op.f(f"ck_{table}_grade"), table, "grade IN ('A', 'B', 'C')")


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(op.f(f"ck_{table}_grade"), table, type_="check")
        op.drop_column(table, "grade")
