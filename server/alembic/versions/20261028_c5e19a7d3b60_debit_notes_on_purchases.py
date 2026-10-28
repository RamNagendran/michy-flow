"""debit notes on purchases: a flag on the supplier until settled on a later bill

Revision ID: c5e19a7d3b60
Revises: 82874ad832a4
Create Date: 2026-10-28 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5e19a7d3b60"
down_revision: str | None = "82874ad832a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Older notes were raised on production runs; they are kept as they are (no longer shown).
    op.alter_column("debit_notes", "production_id", existing_type=sa.Integer(), nullable=True)
    # A note is a flag for the team; quantity and amount are optional.
    op.alter_column("debit_notes", "qty_kg", existing_type=sa.Numeric(14, 3), nullable=True)
    op.alter_column("debit_notes", "amount", existing_type=sa.Numeric(16, 2), nullable=True)
    op.add_column("debit_notes", sa.Column("purchase_id", sa.Integer(), nullable=True))
    op.add_column("debit_notes", sa.Column("item", sa.String(length=20), nullable=True))
    op.add_column("debit_notes", sa.Column("adjusted_purchase_id", sa.Integer(), nullable=True))
    op.add_column("debit_notes", sa.Column("adjusted_by_id", sa.Integer(), nullable=True))
    op.add_column(
        "debit_notes", sa.Column("adjusted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_debit_notes_purchase_id_purchases"),
        "debit_notes",
        "purchases",
        ["purchase_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        op.f("fk_debit_notes_adjusted_purchase_id_purchases"),
        "debit_notes",
        "purchases",
        ["adjusted_purchase_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_debit_notes_adjusted_by_id_users"),
        "debit_notes",
        "users",
        ["adjusted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_debit_notes_purchase_id"), "debit_notes", ["purchase_id"])
    op.create_index(
        "ix_debit_notes_company_supplier", "debit_notes", ["company_id", "supplier_id"]
    )
    op.create_check_constraint(
        op.f("ck_debit_notes_one_entry"),
        "debit_notes",
        "num_nonnulls(production_id, purchase_id) = 1",
    )


def downgrade() -> None:
    # Purchase debit notes cannot exist in the older shape: they are deleted.
    op.drop_constraint(op.f("ck_debit_notes_one_entry"), "debit_notes", type_="check")
    op.execute("DELETE FROM debit_notes WHERE production_id IS NULL")
    op.drop_index("ix_debit_notes_company_supplier", table_name="debit_notes")
    op.drop_index(op.f("ix_debit_notes_purchase_id"), table_name="debit_notes")
    op.drop_constraint(
        op.f("fk_debit_notes_adjusted_by_id_users"), "debit_notes", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_debit_notes_adjusted_purchase_id_purchases"), "debit_notes", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_debit_notes_purchase_id_purchases"), "debit_notes", type_="foreignkey"
    )
    op.drop_column("debit_notes", "adjusted_at")
    op.drop_column("debit_notes", "adjusted_by_id")
    op.drop_column("debit_notes", "adjusted_purchase_id")
    op.drop_column("debit_notes", "item")
    op.drop_column("debit_notes", "purchase_id")
    op.alter_column("debit_notes", "amount", existing_type=sa.Numeric(16, 2), nullable=False)
    op.alter_column("debit_notes", "qty_kg", existing_type=sa.Numeric(14, 3), nullable=False)
    op.alter_column("debit_notes", "production_id", existing_type=sa.Integer(), nullable=False)
