"""items and company types are rows the Super Admin can add, change and delete

Every account gets the items and types that used to be fixed in the code, with the same keys,
so saved entries and company settings keep working.

Revision ID: b7e3d91a4c26
Revises: 4f8a2c6e1b93
Create Date: 2026-11-10 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b7e3d91a4c26"
down_revision: str | None = "4f8a2c6e1b93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copied here (not imported) so this migration never changes when the app's defaults do.
_ITEMS = (
    ("truck", "Truck tyres", "TBR / bus & truck scrap tyres, whole or cut", "material", "kg", True, "#2F6FEB"),
    ("car", "Car tyres", "PCR / passenger car scrap tyres", "material", "kg", True, "#0F9D8A"),
    ("tractor", "Tractor tyres", "Agricultural / tractor scrap tyres", "material", "kg", True, "#5E8C31"),
    ("twowheeler", "Two-wheeler tyres", "Bike & scooter scrap tyres", "material", "kg", True, "#B8860B"),
    ("otr", "OTR tyres", "Off-the-road / earthmover tyres", "material", "kg", True, "#7A5AF8"),
    ("scrap_steel", "Scrap steel", "Tyre steel wire and scrap steel for recovery", "material", "kg", True, "#6B7280"),
    ("oil", "Oil", "Tyre pyrolysis oil, measured in litres", "product", "L", True, "#C2410C"),
    ("carbon", "Carbon powder", "Recovered carbon black / carbon powder", "product", "kg", True, "#7A5AF8"),
    ("rubber", "Rubber crumbs", "Crumb rubber / rubber granules", "product", "kg", True, "#D82E54"),
    ("steel", "Steel", "Recovered steel wire", "product", "kg", True, "#4A7FC1"),
    ("other", "Fibre & other", "Fabric / fluff and other by-products", "product", "kg", True, "#B8860B"),
    ("waste_water", "Waste water", "Water separated in the process", "product", "kg", True, "#1BAF7A"),
    ("waste", "Waste", "Weighed waste for disposal: recorded, never stocked or sold", "product", "kg", False, "#A1A1AA"),
)  # fmt: skip
_TYRES = ["truck", "car", "tractor", "twowheeler", "otr"]
_TYPES = (
    ("pyrolysis", "Tyre pyrolysis", "e.g. Jack's Green Tech", _TYRES, ["oil", "carbon", "steel", "waste_water", "waste"]),
    ("crumb", "Crumb rubber", "e.g. Chennai Crumb Industries", _TYRES, ["rubber", "steel", "other", "waste"]),
    ("steel", "Steel recovery", "e.g. Michy Metal and Alloys", ["scrap_steel"], ["steel", "waste"]),
)  # fmt: skip


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]  # fmt: skip


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column(
            "catalog_version",
            sa.String(32),
            server_default=sa.text("md5(random()::text)"),
            nullable=False,
        ),
    )
    items = op.create_table(
        "catalog_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE", name="fk_catalog_items_account_id_accounts"),
            nullable=False,
        ),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("description", sa.String(200), server_default="", nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("unit", sa.String(5), server_default="kg", nullable=False),
        sa.Column("stocked", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("color", sa.String(7), server_default="#8A919E", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("account_id", "key", name="uq_catalog_items_account_key"),
    )  # fmt: skip
    types = op.create_table(
        "company_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE", name="fk_company_types_account_id_accounts"),
            nullable=False,
        ),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("example", sa.String(100), server_default="", nullable=False),
        sa.Column("input_items", postgresql.ARRAY(sa.String(20)), nullable=False),
        sa.Column("output_items", postgresql.ARRAY(sa.String(20)), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("account_id", "key", name="uq_company_types_account_key"),
    )  # fmt: skip

    accounts = [r[0] for r in op.get_bind().execute(sa.text("SELECT id FROM accounts"))]
    if not accounts:
        return
    op.bulk_insert(
        items,
        [
            dict(account_id=a, key=k, name=n, description=d, kind=kind, unit=u, stocked=s, color=c, position=pos)
            for a in accounts
            for pos, (k, n, d, kind, u, s, c) in enumerate(_ITEMS)
        ],
    )  # fmt: skip
    op.bulk_insert(
        types,
        [
            dict(account_id=a, key=k, name=n, example=e, input_items=i, output_items=o, position=pos)
            for a in accounts
            for pos, (k, n, e, i, o) in enumerate(_TYPES)
        ],
    )  # fmt: skip


def downgrade() -> None:
    op.drop_table("company_types")
    op.drop_table("catalog_items")
    op.drop_column("accounts", "catalog_version")
