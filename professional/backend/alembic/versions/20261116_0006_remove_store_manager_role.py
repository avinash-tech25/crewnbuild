"""remove the store manager role

The Store Manager role is gone: Site Engineers order directly from suppliers through the
marketplace. This drops the store's seven tables (their rows are dropped too, as the
owner chose; no archive), turns every Store Manager back into a plain engineer (category
and Engineer Category cleared, so they choose again) and narrows
ck_engineer_profiles__category to SITE_ENGINEER.

A Store Manager row is one with category STORE_MANAGER, or whose Engineer Category is
"Store Manager" ignoring case after trimming spaces, tabs and line breaks (the 0005 rule).
No other table has a foreign key into the store tables.

Downgrade puts the old check back and recreates the seven tables empty, exactly as 0001
made them; the cleared categories are not restored.

Revision ID: 0006
Revises: 0005
Created: 2026-11-16 10:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Children first.
STORE_TABLES = (
    "store_goods_receipts",
    "store_site_request_items",
    "store_payments",
    "store_stock_movements",
    "store_site_requests",
    "store_items",
    "store_builder_requests",
)
TRIMMED = r"btrim(coalesce(specialization, ''), E' \t\r\n')"
CATEGORY_CHECK = "ck_engineer_profiles__category"


def upgrade() -> None:
    for table in STORE_TABLES:
        op.execute(f"DROP TABLE IF EXISTS professional.{table}")
    op.execute(
        "UPDATE professional.engineer_profiles SET category = NULL, specialization = NULL "  # noqa: S608 - constant SQL
        f"WHERE category = 'STORE_MANAGER' OR lower({TRIMMED}) = 'store manager'"
    )
    op.execute(f"ALTER TABLE professional.engineer_profiles DROP CONSTRAINT IF EXISTS {CATEGORY_CHECK}")
    op.create_check_constraint(
        op.f(CATEGORY_CHECK),
        "engineer_profiles",
        "category IS NULL OR category IN ('SITE_ENGINEER')",
        schema="professional",
    )


def downgrade() -> None:
    op.drop_constraint(op.f(CATEGORY_CHECK), "engineer_profiles", type_="check", schema="professional")
    op.create_check_constraint(
        op.f(CATEGORY_CHECK),
        "engineer_profiles",
        "category IS NULL OR category IN ('SITE_ENGINEER', 'STORE_MANAGER')",
        schema="professional",
    )
    # The seven tables, empty, as 0001 created them.
    op.create_table(
        "store_builder_requests",
        sa.Column("direction", sa.String(length=20), nullable=False),
        sa.Column("store_manager_user_id", sa.Uuid(), nullable=False),
        sa.Column("builder_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint(
            "category IN ('GENERAL', 'MATERIAL', 'DELIVERY', 'PAYMENT', 'SCHEDULE', 'OTHER')",
            name=op.f("ck_store_builder_requests__category"),
        ),
        sa.CheckConstraint(
            "direction IN ('STORE_TO_BUILDER', 'BUILDER_TO_STORE')", name=op.f("ck_store_builder_requests__direction")
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')", name=op.f("ck_store_builder_requests__status")
        ),
        sa.ForeignKeyConstraint(
            ["builder_id"],
            ["professional.users.id"],
            name=op.f("fk_store_builder_requests__builder_id__users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["store_manager_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_builder_requests__store_manager_user_id__users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_builder_requests")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_builder_requests__builder_id"),
        "store_builder_requests",
        ["builder_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_builder_requests__status"),
        "store_builder_requests",
        ["status"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_builder_requests__store_manager_user_id"),
        "store_builder_requests",
        ["store_manager_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_table(
        "store_items",
        sa.Column("store_manager_user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("variant", sa.String(length=120), nullable=True),
        sa.Column("unit", sa.String(length=40), nullable=False),
        sa.Column("unit_cost_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("low_stock_threshold", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint("low_stock_threshold >= 0", name=op.f("ck_store_items__low_stock_threshold")),
        sa.CheckConstraint("quantity >= 0", name=op.f("ck_store_items__quantity")),
        sa.CheckConstraint("unit_cost_amount >= 0", name=op.f("ck_store_items__unit_cost")),
        sa.ForeignKeyConstraint(
            ["store_manager_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_items__store_manager_user_id__users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_items")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_items__store_manager_user_id"),
        "store_items",
        ["store_manager_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        "uq_store_items__identity",
        "store_items",
        [
            "store_manager_user_id",
            sa.text("lower(name)"),
            sa.text("lower(coalesce(brand, ''))"),
            sa.text("lower(unit)"),
            sa.text("lower(coalesce(variant, ''))"),
        ],
        unique=True,
        schema="professional",
    )
    op.create_table(
        "store_site_requests",
        sa.Column("store_manager_user_id", sa.Uuid(), nullable=False),
        sa.Column("engineer_user_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'PARTIALLY_ISSUED', 'REJECTED', 'ISSUED', 'CANCELLED')",
            name=op.f("ck_store_site_requests__status"),
        ),
        sa.ForeignKeyConstraint(
            ["engineer_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_site_requests__engineer_user_id__users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["professional.projects.id"],
            name=op.f("fk_store_site_requests__project_id__projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["store_manager_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_site_requests__store_manager_user_id__users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_site_requests")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_site_requests__engineer_user_id"),
        "store_site_requests",
        ["engineer_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_site_requests__project_id"),
        "store_site_requests",
        ["project_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_site_requests__status"), "store_site_requests", ["status"], unique=False, schema="professional"
    )
    op.create_index(
        op.f("ix_store_site_requests__store_manager_user_id"),
        "store_site_requests",
        ["store_manager_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_table(
        "store_stock_movements",
        sa.Column("store_item_id", sa.Uuid(), nullable=False),
        sa.Column("change_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("balance_after", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("reference", sa.String(length=60), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint(
            "reason IN ('INITIAL', 'ADJUSTMENT', 'PURCHASE_RECEIPT', 'ISSUE')",
            name=op.f("ck_store_stock_movements__reason"),
        ),
        sa.ForeignKeyConstraint(
            ["store_item_id"],
            ["professional.store_items.id"],
            name=op.f("fk_store_stock_movements__store_item_id__store_items"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_stock_movements")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_stock_movements__store_item_id"),
        "store_stock_movements",
        ["store_item_id"],
        unique=False,
        schema="professional",
    )
    op.create_table(
        "store_payments",
        sa.Column("store_manager_user_id", sa.Uuid(), nullable=False),
        sa.Column("order_number", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("method", sa.String(length=30), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.String(length=12), server_default="PAID", nullable=False),
        sa.Column("supplier_user_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("razorpay_order_id", sa.String(length=64), nullable=True),
        sa.Column("razorpay_payment_id", sa.String(length=64), nullable=True),
        sa.Column("gateway_mode", sa.String(length=8), nullable=True),
        sa.Column("failure_reason", sa.String(length=255), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("site_request_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint(
            "method IN ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER', 'RAZORPAY')",
            name=op.f("ck_store_payments__method"),
        ),
        sa.CheckConstraint("status IN ('CREATED', 'PAID', 'FAILED')", name=op.f("ck_store_payments__status")),
        sa.CheckConstraint("amount > 0", name=op.f("ck_store_payments__amount")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["professional.projects.id"],
            name=op.f("fk_store_payments__project_id__projects"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["site_request_id"],
            ["professional.store_site_requests.id"],
            name=op.f("fk_store_payments__site_request_id__store_site_requests"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["store_manager_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_payments__store_manager_user_id__users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["supplier_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_payments__supplier_user_id__users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_payments")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_payments__order_number"), "store_payments", ["order_number"], unique=False, schema="professional"
    )
    op.create_index(
        op.f("ix_store_payments__project_id"), "store_payments", ["project_id"], unique=False, schema="professional"
    )
    op.create_index(
        op.f("ix_store_payments__site_request_id"),
        "store_payments",
        ["site_request_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_payments__store_manager_user_id"),
        "store_payments",
        ["store_manager_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_payments__supplier_user_id"),
        "store_payments",
        ["supplier_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        "uq_store_payments__razorpay_order_id",
        "store_payments",
        ["razorpay_order_id"],
        unique=True,
        schema="professional",
        postgresql_where=sa.text("razorpay_order_id IS NOT NULL"),
    )
    op.create_index(
        "uq_store_payments__razorpay_payment_id",
        "store_payments",
        ["razorpay_payment_id"],
        unique=True,
        schema="professional",
        postgresql_where=sa.text("razorpay_payment_id IS NOT NULL"),
    )
    op.create_table(
        "store_site_request_items",
        sa.Column("site_request_id", sa.Uuid(), nullable=False),
        sa.Column("store_item_id", sa.Uuid(), nullable=True),
        sa.Column("item_name", sa.String(length=160), nullable=False),
        sa.Column("item_variant", sa.String(length=120), nullable=True),
        sa.Column("unit", sa.String(length=40), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("issued_quantity", sa.Numeric(precision=14, scale=3), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint(
            "issued_quantity >= 0 AND issued_quantity <= quantity",
            name=op.f("ck_store_site_request_items__issued_quantity"),
        ),
        sa.CheckConstraint("quantity > 0", name=op.f("ck_store_site_request_items__quantity")),
        sa.ForeignKeyConstraint(
            ["site_request_id"],
            ["professional.store_site_requests.id"],
            name=op.f("fk_store_site_request_items__site_request_id__store_site_requests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["store_item_id"],
            ["professional.store_items.id"],
            name=op.f("fk_store_site_request_items__store_item_id__store_items"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_site_request_items")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_site_request_items__site_request_id"),
        "store_site_request_items",
        ["site_request_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_site_request_items__store_item_id"),
        "store_site_request_items",
        ["store_item_id"],
        unique=False,
        schema="professional",
    )
    op.create_table(
        "store_goods_receipts",
        sa.Column("purchase_order_item_id", sa.Uuid(), nullable=False),
        sa.Column("store_manager_user_id", sa.Uuid(), nullable=False),
        sa.Column("store_item_id", sa.Uuid(), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("receipt_key", sa.String(length=64), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.CheckConstraint("quantity > 0", name=op.f("ck_store_goods_receipts__quantity")),
        sa.ForeignKeyConstraint(
            ["purchase_order_item_id"],
            ["professional.purchase_order_items.id"],
            name=op.f("fk_store_goods_receipts__purchase_order_item_id__purchase_order_items"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_item_id"],
            ["professional.store_items.id"],
            name=op.f("fk_store_goods_receipts__store_item_id__store_items"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["store_manager_user_id"],
            ["professional.users.id"],
            name=op.f("fk_store_goods_receipts__store_manager_user_id__users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_goods_receipts")),
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_goods_receipts__purchase_order_item_id"),
        "store_goods_receipts",
        ["purchase_order_item_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_goods_receipts__store_item_id"),
        "store_goods_receipts",
        ["store_item_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        op.f("ix_store_goods_receipts__store_manager_user_id"),
        "store_goods_receipts",
        ["store_manager_user_id"],
        unique=False,
        schema="professional",
    )
    op.create_index(
        "uq_store_goods_receipts__receipt_key",
        "store_goods_receipts",
        ["receipt_key"],
        unique=True,
        schema="professional",
        postgresql_where=sa.text("receipt_key IS NOT NULL"),
    )
