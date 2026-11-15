"""the Manager keeps the operators (with phone and email) and machines; every run names a machine

Revision ID: f6b3d8a21c94
Revises: e5a2c9d47b18
Create Date: 2026-11-15 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f6b3d8a21c94"
down_revision: str | None = "e5a2c9d47b18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("operators", sa.Column("phone", sa.String(30), nullable=True))
    op.add_column("operators", sa.Column("email", sa.String(320), nullable=True))
    op.create_table(
        "machines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "uq_machines_company_code",
        "machines",
        ["company_id", sa.text("lower(trim(code))")],
        unique=True,
    )
    op.add_column(
        "production",
        sa.Column(
            "machine_id",
            sa.Integer(),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index("ix_production_machine_id", "production", ["machine_id"])


def downgrade() -> None:
    op.drop_index("ix_production_machine_id", table_name="production")
    op.drop_column("production", "machine_id")
    op.drop_index("uq_machines_company_code", table_name="machines")
    op.drop_table("machines")
    op.drop_column("operators", "email")
    op.drop_column("operators", "phone")
