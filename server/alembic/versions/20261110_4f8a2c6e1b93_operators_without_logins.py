"""operators are plain names with a shift, not users; the 'shift' duty is gone

Every shift worker (and anyone already on a production crew) becomes an operator in that
company, and production crews are rewritten from user ids to operator ids.

Revision ID: 4f8a2c6e1b93
Revises: 9b4d27e1c8a5
Create Date: 2026-11-10 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "4f8a2c6e1b93"
down_revision: str | None = "9b4d27e1c8a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "operators",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("shift", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_operators")),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_operators_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_operators_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "shift IS NULL OR shift BETWEEN 1 AND 3", name=op.f("ck_operators_shift")
        ),
    )

    # Shift workers, and anyone on a crew already, keep their name as an operator.
    op.execute(
        """
        INSERT INTO operators (company_id, name, is_active)
        SELECT DISTINCT ON (p.company_id, lower(trim(u.full_name)))
               p.company_id, trim(u.full_name), u.is_active
        FROM (
            SELECT company_id, user_id FROM company_memberships WHERE 'shift' = ANY(duties)
            UNION
            SELECT company_id, unnest(crew_ids) FROM production
        ) p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.company_id, lower(trim(u.full_name)), u.is_active DESC, u.id
        """
    )
    # Two users with the same name in a company share one operator.
    op.execute(
        """
        UPDATE production pr SET crew_ids = COALESCE((
            SELECT array_agg(DISTINCT o.id ORDER BY o.id)
            FROM unnest(pr.crew_ids) AS c(user_id)
            JOIN users u ON u.id = c.user_id
            JOIN operators o
              ON o.company_id = pr.company_id AND lower(trim(o.name)) = lower(trim(u.full_name))
        ), '{}')
        WHERE cardinality(pr.crew_ids) > 0
        """
    )
    op.create_index(
        "uq_operators_company_name",
        "operators",
        ["company_id", sa.text("lower(trim(name))")],
        unique=True,
    )
    op.execute("UPDATE company_memberships SET duties = array_remove(duties, 'shift')")


def downgrade() -> None:
    # Operators had no logins, so crews cannot point back at users.
    op.execute("UPDATE production SET crew_ids = '{}'")
    op.drop_index("uq_operators_company_name", table_name="operators")
    op.drop_table("operators")
