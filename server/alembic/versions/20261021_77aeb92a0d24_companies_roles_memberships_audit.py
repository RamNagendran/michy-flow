"""companies roles memberships audit

Revision ID: 77aeb92a0d24
Revises: fd614c9bdb77
Create Date: 2026-10-21 02:12:03.034243
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '77aeb92a0d24'
down_revision: str | None = 'fd614c9bdb77'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('companies',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('account_id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=10), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('city', sa.String(length=100), server_default='', nullable=False),
    sa.Column('gstin', sa.String(length=15), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], name=op.f('fk_companies_account_id_accounts'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_companies')),
    sa.UniqueConstraint('account_id', 'code', name='uq_companies_account_code')
    )
    op.create_index(op.f('ix_companies_account_id'), 'companies', ['account_id'], unique=False)
    op.create_table('audit_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('account_id', sa.Integer(), nullable=False),
    sa.Column('actor_id', sa.Integer(), nullable=True),
    sa.Column('company_id', sa.Integer(), nullable=True),
    sa.Column('action', sa.String(length=50), nullable=False),
    sa.Column('entity_type', sa.String(length=50), nullable=False),
    sa.Column('entity_id', sa.Integer(), nullable=True),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('ip_address', sa.String(length=45), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], name=op.f('fk_audit_logs_account_id_accounts'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_audit_logs_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_audit_logs_company_id_companies'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_logs'))
    )
    op.create_index('ix_audit_logs_account_created', 'audit_logs', ['account_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_company_id'), 'audit_logs', ['company_id'], unique=False)
    op.create_table('company_memberships',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('duties', postgresql.ARRAY(sa.String(length=20)), server_default='{}', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_company_memberships_company_id_companies'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_company_memberships_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_company_memberships')),
    sa.UniqueConstraint('user_id', 'company_id', name='uq_company_memberships_user_company')
    )
    op.create_index(op.f('ix_company_memberships_company_id'), 'company_memberships', ['company_id'], unique=False)
    op.create_index(op.f('ix_company_memberships_user_id'), 'company_memberships', ['user_id'], unique=False)
    op.add_column('users', sa.Column('global_role', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('users', sa.Column('token_version', sa.Integer(), server_default='0', nullable=False))
    # Old single-level roles: the account admin becomes the Super Admin, the CEO stays CEO.
    # Old operators had no site assignments, so they get no global role and need memberships.
    op.execute(
        "UPDATE users SET global_role = CASE role "
        "WHEN 'admin' THEN 'super_admin' WHEN 'ceo' THEN 'ceo' END"
    )
    op.drop_index(op.f('ix_users_role'), table_name='users')
    op.create_index(op.f('ix_users_global_role'), 'users', ['global_role'], unique=False)
    op.drop_column('users', 'role')


def downgrade() -> None:
    op.add_column('users', sa.Column('role', sa.VARCHAR(length=20), server_default='operator', nullable=False))
    op.execute(
        "UPDATE users SET role = CASE global_role "
        "WHEN 'super_admin' THEN 'admin' WHEN 'ceo' THEN 'ceo' ELSE 'operator' END"
    )
    op.alter_column('users', 'role', server_default=None)
    op.drop_index(op.f('ix_users_global_role'), table_name='users')
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    op.drop_column('users', 'token_version')
    op.drop_column('users', 'must_change_password')
    op.drop_column('users', 'global_role')
    op.drop_index(op.f('ix_company_memberships_user_id'), table_name='company_memberships')
    op.drop_index(op.f('ix_company_memberships_company_id'), table_name='company_memberships')
    op.drop_table('company_memberships')
    op.drop_index(op.f('ix_audit_logs_company_id'), table_name='audit_logs')
    op.drop_index('ix_audit_logs_account_created', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index(op.f('ix_companies_account_id'), table_name='companies')
    op.drop_table('companies')
