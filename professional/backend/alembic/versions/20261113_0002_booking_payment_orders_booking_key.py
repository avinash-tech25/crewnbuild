"""booking payment orders: key to partner.bookings

booking_payment_orders.booking_id -> partner.bookings (id) ON DELETE RESTRICT (section 10,
porting-todo #62). Partner's baseline must have run: it creates partner.bookings and grants
REFERENCES on it to crewnbuild_professional. scripts/migrate.py runs Professional 0001,
then Partner, then this.

Revision ID: 0002
Revises: 0001
Created: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEY = "fk_booking_payment_orders__booking_id__bookings"
PARTNER_FIRST = (
    "partner.bookings is not visible to this role: run Partner's baseline before Professional 0002 "
    "(python scripts/migrate.py runs Professional 0001, Partner, then Professional again)."
)


def upgrade() -> None:
    visible = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM information_schema.table_privileges WHERE table_schema = 'partner' "
                "AND table_name = 'bookings' AND privilege_type = 'REFERENCES' AND grantee = current_user"
            )
        )
        .first()
    )
    if visible is None:
        visible = (
            op.get_bind()
            .execute(
                sa.text(
                    "SELECT 1 FROM information_schema.column_privileges WHERE table_schema = 'partner' "
                    "AND table_name = 'bookings' AND column_name = 'id' AND privilege_type = 'REFERENCES' "
                    "AND grantee = current_user"
                )
            )
            .first()
        )
    if visible is None:
        raise RuntimeError(PARTNER_FIRST)
    op.create_foreign_key(
        KEY,
        "booking_payment_orders",
        "bookings",
        ["booking_id"],
        ["id"],
        source_schema="professional",
        referent_schema="partner",
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(KEY, "booking_payment_orders", schema="professional", type_="foreignkey")
