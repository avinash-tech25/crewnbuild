"""Booking payment records, and the one read-only window onto Partner's bookings.

Bookings belong to Partner (partner.bookings). Professional reads them only through the
view Partner publishes for it, partner.v_professional_bookings (technical-architecture.md
section 11.2), in plain SQL, so Partner's tables never enter Professional's metadata and
nothing in `partner` is written. The price read is the booking's own `quoted_amount` (the
catalogue price snapshotted when the booking was made), which is what the House Owner
agreed to pay.

Partner's baseline creates and grants the view (scripts/migrate.py runs it right after
Professional's); where it is not visible there are no bookings to pay. `booking_source` is
the single place the rows come from.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.modules.billing.models import (
    ORDER_CREATED,
    ORDER_PAID,
    BookingPaymentOrder,
    BookingPaymentReceipt,
    BookingPaymentTransaction,
)
from app.modules.identity.models import User

PARTNER_BOOKINGS_VIEW = "partner.v_professional_bookings"
BOOKING_COLUMNS = (
    "id, requested_by_user_id, requested_by_role, status, trade AS technician_type, "
    "quoted_amount, currency, completed_at, service_name, technician_name"
)


@dataclass(frozen=True)
class BookingForPayment:
    id: uuid.UUID
    requested_by_user_id: uuid.UUID
    requested_by_role: str
    status: str
    technician_type: str
    quoted_amount: Decimal | None
    currency: str | None
    completed_at: datetime | None
    service_name: str | None
    technician_name: str | None

    @property
    def reference(self) -> str:
        """Partner's own booking reference, SR-XXXXXXXX, so both apps name it alike."""
        return f"SR-{self.id.hex[:8].upper()}"


def _booking(row: Any) -> BookingForPayment:
    return BookingForPayment(**dict(row._mapping))


def partner_view_visible(database: Session) -> bool:
    return (
        database.execute(
            text(
                "SELECT 1 FROM information_schema.views "
                "WHERE table_schema = 'partner' AND table_name = 'v_professional_bookings'"
            )
        ).first()
        is not None
    )


def booking_source(database: Session, where: str, parameters: dict[str, Any]) -> Sequence[Any]:
    """Rows of Partner's booking view matching `where` (a constant condition with bound
    parameters), or none while the view does not exist."""
    if not partner_view_visible(database):
        return []
    return database.execute(
        text(f"SELECT {BOOKING_COLUMNS} FROM {PARTNER_BOOKINGS_VIEW} WHERE {where}"),  # noqa: S608 constant SQL
        parameters,
    ).all()


class PaymentRepository:
    def __init__(self, database: Session):
        self.database = database

    # ---- bookings (read-only) ----

    def completed_bookings_for(self, customer_id: uuid.UUID) -> list[BookingForPayment]:
        rows = booking_source(
            self.database,
            "requested_by_user_id = :customer AND status = 'COMPLETED' ORDER BY completed_at DESC NULLS LAST, id",
            {"customer": customer_id},
        )
        return [_booking(row) for row in rows]

    def booking(self, booking_id: uuid.UUID) -> BookingForPayment | None:
        rows = booking_source(self.database, "id = :booking", {"booking": booking_id})
        return _booking(rows[0]) if rows else None

    def customer_name(self, customer_id: uuid.UUID) -> str | None:
        return self.database.scalar(select(User.name).where(User.id == customer_id))

    def serialize_booking(self, booking_id: uuid.UUID) -> None:
        """Serialise order creation for one booking within this transaction."""
        self.database.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"payment:{booking_id}"})

    # ---- orders ----

    def paid_order_for_booking(self, booking_id: uuid.UUID) -> BookingPaymentOrder | None:
        return self.database.scalars(
            select(BookingPaymentOrder).where(
                BookingPaymentOrder.booking_id == booking_id, BookingPaymentOrder.status == ORDER_PAID
            )
        ).first()

    def reusable_order(
        self, booking_id: uuid.UUID, customer_id: uuid.UUID, amount_paise: int, mode: str
    ) -> BookingPaymentOrder | None:
        """An unpaid order for the same booking, payer, amount and gateway: Razorpay lets
        one order take several attempts, so a retry does not need a new one."""
        return self.database.scalars(
            select(BookingPaymentOrder)
            .where(
                BookingPaymentOrder.booking_id == booking_id,
                BookingPaymentOrder.customer_id == customer_id,
                BookingPaymentOrder.status == ORDER_CREATED,
                BookingPaymentOrder.amount_paise == amount_paise,
                BookingPaymentOrder.gateway_mode == mode,
            )
            .order_by(BookingPaymentOrder.created_at.desc())
        ).first()

    def lock_order(self, payment_order_id: uuid.UUID) -> BookingPaymentOrder | None:
        return self.database.scalars(
            select(BookingPaymentOrder)
            .where(BookingPaymentOrder.id == payment_order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def lock_order_by_razorpay_id(self, razorpay_order_id: str) -> BookingPaymentOrder | None:
        return self.database.scalars(
            select(BookingPaymentOrder)
            .where(BookingPaymentOrder.razorpay_order_id == razorpay_order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    # ---- transactions ----

    def transaction_by_payment_id(self, razorpay_payment_id: str) -> BookingPaymentTransaction | None:
        return self.database.scalars(
            select(BookingPaymentTransaction).where(
                BookingPaymentTransaction.razorpay_payment_id == razorpay_payment_id
            )
        ).first()

    # ---- receipts ----

    def receipt_for_order(self, payment_order_id: uuid.UUID) -> BookingPaymentReceipt | None:
        return self.database.scalars(
            select(BookingPaymentReceipt).where(BookingPaymentReceipt.payment_order_id == payment_order_id)
        ).first()

    def receipt_by_number(self, receipt_number: str) -> BookingPaymentReceipt | None:
        return self.database.scalars(
            select(BookingPaymentReceipt).where(BookingPaymentReceipt.receipt_number == receipt_number)
        ).first()

    def receipts_for_bookings(self, booking_ids: list[uuid.UUID]) -> dict[uuid.UUID, BookingPaymentReceipt]:
        if not booking_ids:
            return {}
        rows = self.database.scalars(
            select(BookingPaymentReceipt).where(BookingPaymentReceipt.booking_id.in_(booking_ids))
        ).all()
        return {row.booking_id: row for row in rows}

    def order(self, payment_order_id: uuid.UUID) -> BookingPaymentOrder | None:
        return self.database.get(BookingPaymentOrder, payment_order_id)
