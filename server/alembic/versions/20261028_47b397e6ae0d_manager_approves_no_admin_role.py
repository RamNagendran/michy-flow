"""manager approves, no admin role

Revision ID: 47b397e6ae0d
Revises: 337d46a51801
Create Date: 2026-10-28 10:35:16.250311
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '47b397e6ae0d'
down_revision: str | None = '337d46a51801'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ENTRIES = ("purchases", "sales", "production")


def upgrade() -> None:
    # Who an open escalation waits on: "incharge" (Manager asked) or "manager" (Finance asked).
    for table in _ENTRIES:
        op.add_column(table, sa.Column("escalated_to", sa.String(length=20), nullable=True))
        # Finance's open escalations and holds now wait on the Manager. "On hold" is gone:
        # those entries go back to "approved" with an open escalation to the Manager.
        op.execute(
            f"UPDATE {table} SET escalated_to = 'manager' WHERE escalated_at IS NOT NULL"
        )
        op.execute(
            f"UPDATE {table} SET status = 'approved', escalated_to = 'manager',"
            " escalated_at = COALESCE(escalated_at, now()) WHERE status = 'on_hold'"
        )
        # Only Manager-approved entries count in stock now. Older entries that were approved
        # or verified without a stamp get one, so they keep counting.
        op.execute(
            f"UPDATE {table} SET approved_at = COALESCE(verified_at, updated_at, created_at)"
            " WHERE status IN ('approved', 'verified') AND approved_at IS NULL"
        )
    # The Admin role is merged into the Manager. Their sign-ins end so the new access applies.
    op.execute(
        "UPDATE users SET token_version = token_version + 1 WHERE id IN"
        " (SELECT user_id FROM company_memberships WHERE role = 'admin')"
    )
    op.execute("UPDATE company_memberships SET role = 'manager', duties = '{}' WHERE role = 'admin'")


def downgrade() -> None:
    # Former Admins stay Managers and "on hold" is not restored: neither can be told apart
    # from the data any more.
    for table in _ENTRIES:
        op.drop_column(table, "escalated_to")
