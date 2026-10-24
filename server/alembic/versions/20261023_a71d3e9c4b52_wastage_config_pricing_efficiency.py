"""inventory configuration, wastage control, escalation, shift crew and running hours

Revision ID: a71d3e9c4b52
Revises: 8c4e5a7b1f20
Create Date: 2026-10-23 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a71d3e9c4b52"
down_revision: str | None = "8c4e5a7b1f20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ITEMS = postgresql.ARRAY(sa.String(length=20))
# Each company type's default inputs and outputs, as at this revision.
_TYRES = "{truck,car,tractor,twowheeler,otr}"
_DEFAULTS = {
    "pyrolysis": (_TYRES, "{oil,carbon,steel,waste_water,waste}"),
    "crumb": (_TYRES, "{rubber,steel,other,waste}"),
    "steel": ("{scrap_steel}", "{steel,waste}"),
}


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{target}.id"], name=op.f(f"fk_{table}_{column}_{target}"), ondelete=ondelete
    )


def upgrade() -> None:
    op.add_column(
        "companies", sa.Column("input_items", _ITEMS, server_default="{}", nullable=False)
    )
    op.add_column(
        "companies", sa.Column("output_items", _ITEMS, server_default="{}", nullable=False)
    )
    op.add_column(
        "companies",
        sa.Column("oil_density", sa.Numeric(5, 3), server_default="1.040", nullable=False),
    )
    op.add_column(
        "companies",
        sa.Column("stock_check_months", sa.Integer(), server_default="1", nullable=False),
    )
    for category, (inputs, outputs) in _DEFAULTS.items():
        op.execute(
            sa.text(
                "UPDATE companies SET input_items = CAST(:i AS varchar(20)[]), "
                "output_items = CAST(:o AS varchar(20)[]) WHERE category = :c"
            ).bindparams(i=inputs, o=outputs, c=category)
        )

    for table in ("purchases", "sales", "production"):
        op.add_column(table, sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "production",
        sa.Column("crew_ids", postgresql.ARRAY(sa.Integer()), server_default="{}", nullable=False),
    )
    op.add_column("production", sa.Column("running_hours", sa.Numeric(5, 2), nullable=True))

    op.create_table(
        "wastage_allowances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("pct", sa.Numeric(4, 2), nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("declared_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("pct > 0 AND pct <= 2", name=op.f("ck_wastage_allowances_pct")),
        _fk("wastage_allowances", "company_id", "companies", "CASCADE"),
        _fk("wastage_allowances", "declared_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wastage_allowances")),
        sa.UniqueConstraint("company_id", "month", name="uq_wastage_allowances_company_month"),
    )
    op.create_table(
        "debit_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("production_id", sa.Integer(), nullable=False),
        sa.Column("note_no", sa.String(length=50), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("qty_kg", sa.Numeric(14, 3), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        _fk("debit_notes", "company_id", "companies", "CASCADE"),
        _fk("debit_notes", "production_id", "production", "CASCADE"),
        _fk("debit_notes", "supplier_id", "parties", "RESTRICT"),
        _fk("debit_notes", "created_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_debit_notes")),
        sa.UniqueConstraint("company_id", "note_no", name="uq_debit_notes_company_note"),
        sa.UniqueConstraint("production_id", name=op.f("uq_debit_notes_production_id")),
    )
    op.create_table(
        "stock_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("counted_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("counted_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        _fk("stock_checks", "company_id", "companies", "CASCADE"),
        _fk("stock_checks", "counted_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_checks")),
    )
    op.create_index(op.f("ix_stock_checks_company_id"), "stock_checks", ["company_id"])
    op.create_table(
        "stock_check_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("check_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("grade", sa.String(length=1), nullable=False),
        sa.Column("section", sa.String(length=10), nullable=False),
        sa.Column("item", sa.String(length=20), nullable=False),
        sa.Column("book_qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("counted_qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("difference", sa.Numeric(14, 3), nullable=False),
        _fk("stock_check_lines", "check_id", "stock_checks", "CASCADE"),
        _fk("stock_check_lines", "company_id", "companies", "CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_check_lines")),
        sa.UniqueConstraint("check_id", "grade", "item", name="uq_stock_check_lines_item"),
    )
    op.create_index(op.f("ix_stock_check_lines_check_id"), "stock_check_lines", ["check_id"])


def downgrade() -> None:
    op.drop_table("stock_check_lines")
    op.drop_table("stock_checks")
    op.drop_table("debit_notes")
    op.drop_table("wastage_allowances")
    op.drop_column("production", "running_hours")
    op.drop_column("production", "crew_ids")
    for table in ("purchases", "sales", "production"):
        op.drop_column(table, "escalated_at")
    for column in ("stock_check_months", "oil_density", "output_items", "input_items"):
        op.drop_column("companies", column)
