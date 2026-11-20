"""Add test-mode marketplace payment state without rewriting legacy orders."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

SCHEMA = "professional"


def upgrade() -> None:
    op.alter_column("purchase_orders", "project_id", nullable=True, schema=SCHEMA)
    op.create_table(
        "purchase_payments",
        sa.Column("order_id", sa.Uuid, sa.ForeignKey("professional.purchase_orders.id", ondelete="RESTRICT"),
                  primary_key=True),
        sa.Column("checkout_key", sa.Uuid, nullable=False, unique=True),
        sa.Column("project_snapshot_id", sa.Uuid, nullable=False),
        sa.Column("snapshot", sa.JSON, nullable=False),
        sa.Column("amount_paise", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("gateway_create_started_at", sa.DateTime(timezone=True)),
        sa.Column("gateway_order_id", sa.String(80), unique=True),
        sa.Column("gateway_payment_id", sa.String(80), unique=True),
        sa.Column("gateway_refund_id", sa.String(80), unique=True),
        sa.Column("payment_status", sa.String(16), nullable=False),
        sa.Column("supplier_status", sa.String(32), nullable=False),
        sa.Column("refund_status", sa.String(16), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("decision_at", sa.DateTime(timezone=True)),
        sa.Column("refunded_at", sa.DateTime(timezone=True)),
        sa.Column("checked_at", sa.DateTime(timezone=True)),
        sa.Column("rejection_reason", sa.String(500)),
        sa.CheckConstraint("amount_paise > 0 AND currency = 'INR'", name="amount"),
        sa.CheckConstraint("payment_status IN ('PENDING', 'FAILED', 'SUCCESSFUL')", name="payment_status"),
        sa.CheckConstraint(
            "supplier_status IN ('NOT_SUBMITTED', 'AWAITING_SUPPLIER_ACCEPTANCE', 'ACCEPTED', 'REJECTED')",
            name="supplier_status",
        ),
        sa.CheckConstraint("refund_status IN ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED')", name="refund_status"),
        sa.CheckConstraint(
            "(payment_status = 'SUCCESSFUL') = (paid_at IS NOT NULL AND gateway_payment_id IS NOT NULL)",
            name="capture_reference",
        ),
        sa.CheckConstraint("supplier_status = 'NOT_SUBMITTED' OR payment_status = 'SUCCESSFUL'",
                           name="verified_decision"),
        sa.CheckConstraint("supplier_status <> 'REJECTED' OR refund_status <> 'NOT_REQUIRED'", name="refund_required"),
        schema=SCHEMA,
    )
    op.create_index("ix_purchase_payments__reconcile", "purchase_payments",
                    ["checked_at", "payment_status", "refund_status"], schema=SCHEMA)
    op.create_table(
        "purchase_gateway_events",
        sa.Column("event_key", sa.String(64), primary_key=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "purchase_payment_attempts",
        sa.Column("gateway_payment_id", sa.String(80), primary_key=True),
        sa.Column("order_id", sa.Uuid, sa.ForeignKey("professional.purchase_payments.order_id", ondelete="RESTRICT"),
                  nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    # Preserve financial records even if a deployment rolls back.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM professional.purchase_payments) THEN
                RAISE EXCEPTION 'Cannot downgrade with marketplace payment history';
            END IF;
        END $$;
    """)
    op.drop_table("purchase_payment_attempts", schema=SCHEMA)
    op.drop_table("purchase_gateway_events", schema=SCHEMA)
    op.drop_table("purchase_payments", schema=SCHEMA)
    op.alter_column("purchase_orders", "project_id", nullable=False, schema=SCHEMA)
