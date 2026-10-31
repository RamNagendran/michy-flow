"""monthly wastage approval by the Super Admin; the Manager's allowance is gone

Revision ID: 9b4d27e1c8a5
Revises: e3a91f5c2d17
Create Date: 2026-10-30 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9b4d27e1c8a5"
down_revision: str | None = "e3a91f5c2d17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

QTY = sa.Numeric(14, 3)


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{target}.id"], name=op.f(f"fk_{table}_{column}_{target}"), ondelete=ondelete
    )


def _pk(table: str) -> sa.PrimaryKeyConstraint:
    return sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}"))


def upgrade() -> None:
    op.create_table(
        "wastage_months",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("status", sa.String(10), server_default="pending", nullable=False),
        sa.Column("target_kg", QTY, nullable=True),
        sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runs", sa.Integer(), nullable=True),
        sa.Column("processed_kg", QTY, nullable=True),
        sa.Column("output_kg", QTY, nullable=True),
        sa.Column("calculated_kg", QTY, nullable=True),
        sa.Column("approved_kg", QTY, nullable=True),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        _pk("wastage_months"),
        _fk("wastage_months", "company_id", "companies", "CASCADE"),
        _fk("wastage_months", "approved_by_id", "users", "SET NULL"),
        sa.UniqueConstraint("company_id", "month", name="uq_wastage_months_company_month"),
        sa.CheckConstraint(
            "status IN ('pending', 'escalated', 'approved')", name=op.f("ck_wastage_months_status")
        ),
        sa.CheckConstraint(
            "target_kg IS NULL OR target_kg >= 0", name=op.f("ck_wastage_months_target_kg")
        ),
    )
    op.create_table(
        "wastage_adjustments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("item", sa.String(20), nullable=False),
        sa.Column("processed_kg", QTY, nullable=False),
        sa.Column("qty", QTY, nullable=False),
        _pk("wastage_adjustments"),
        _fk("wastage_adjustments", "record_id", "wastage_months", "CASCADE"),
        _fk("wastage_adjustments", "company_id", "companies", "CASCADE"),
        sa.UniqueConstraint("record_id", "item", name="uq_wastage_adjustments_item"),
    )
    op.create_index("ix_wastage_adjustments_record_id", "wastage_adjustments", ["record_id"])
    op.create_index("ix_wastage_adjustments_company_id", "wastage_adjustments", ["company_id"])
    op.create_table(
        "wastage_month_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text(), server_default="", nullable=False),
        sa.Column("changes", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        _pk("wastage_month_events"),
        _fk("wastage_month_events", "record_id", "wastage_months", "CASCADE"),
        _fk("wastage_month_events", "company_id", "companies", "CASCADE"),
        _fk("wastage_month_events", "actor_id", "users", "SET NULL"),
    )
    op.create_index("ix_wastage_month_events_record", "wastage_month_events", ["record_id", "created_at"])
    op.drop_table("wastage_allowances")


def downgrade() -> None:
    op.create_table(
        "wastage_allowances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("pct", sa.Numeric(4, 2), nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("declared_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("pct > 0 AND pct <= 2", name=op.f("ck_wastage_allowances_pct")),
        _fk("wastage_allowances", "company_id", "companies", "CASCADE"),
        _fk("wastage_allowances", "declared_by_id", "users", "SET NULL"),
        _pk("wastage_allowances"),
        sa.UniqueConstraint("company_id", "month", name="uq_wastage_allowances_company_month"),
    )
    op.drop_table("wastage_month_events")
    op.drop_table("wastage_adjustments")
    op.drop_table("wastage_months")
