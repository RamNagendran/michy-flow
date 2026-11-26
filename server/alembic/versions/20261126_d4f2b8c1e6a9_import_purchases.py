"""import purchases: overseas suppliers, currency, exchange rate, customs duty, Bill of Entry

Revision ID: d4f2b8c1e6a9
Revises: c3e9a1f2d7b4
Create Date: 2026-11-26 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4f2b8c1e6a9"
down_revision: str | None = "c3e9a1f2d7b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "parties", sa.Column("overseas", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    op.add_column(
        "purchases",
        sa.Column("origin", sa.String(10), server_default="domestic", nullable=False),
    )
    op.add_column(
        "purchases", sa.Column("currency", sa.String(3), server_default="INR", nullable=False)
    )
    op.add_column("purchases", sa.Column("fx_rate", sa.Numeric(12, 4)))
    op.add_column("purchases", sa.Column("foreign_rate", sa.Numeric(14, 6)))
    op.add_column("purchases", sa.Column("foreign_amount", sa.Numeric(16, 2)))
    op.add_column("purchases", sa.Column("customs_duty", sa.Numeric(16, 2)))
    op.add_column("purchases", sa.Column("be_no", sa.String(30)))
    op.add_column("purchases", sa.Column("be_date", sa.Date()))


def downgrade() -> None:
    for column in (
        "be_date",
        "be_no",
        "customs_duty",
        "foreign_amount",
        "foreign_rate",
        "fx_rate",
        "currency",
        "origin",
    ):
        op.drop_column("purchases", column)
    op.drop_column("parties", "overseas")
