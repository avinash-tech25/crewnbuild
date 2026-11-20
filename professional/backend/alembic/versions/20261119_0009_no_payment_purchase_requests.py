"""Add idempotent purchase requests and engineer receipt confirmation."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

SCHEMA = "professional"
REQUEST_KEY_CONSTRAINT = "uq_purchase_orders__buyer_user_id_request_key"


def upgrade() -> None:
    op.add_column("purchase_orders", sa.Column("request_key", sa.Uuid()), schema=SCHEMA)
    op.create_unique_constraint(
        op.f(REQUEST_KEY_CONSTRAINT), "purchase_orders", ["buyer_user_id", "request_key"], schema=SCHEMA
    )
    op.add_column("purchase_order_items", sa.Column("received_at", sa.DateTime(timezone=True)), schema=SCHEMA)


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM professional.purchase_orders WHERE request_key IS NOT NULL)
                OR EXISTS (SELECT 1 FROM professional.purchase_order_items WHERE received_at IS NOT NULL) THEN
                RAISE EXCEPTION 'Cannot downgrade with purchase request keys or confirmed receipts';
            END IF;
        END $$;
        """
    )
    op.drop_column("purchase_order_items", "received_at", schema=SCHEMA)
    op.drop_constraint(op.f(REQUEST_KEY_CONSTRAINT), "purchase_orders", type_="unique", schema=SCHEMA)
    op.drop_column("purchase_orders", "request_key", schema=SCHEMA)
