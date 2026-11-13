"""The customer payment rules. TEST MODE ONLY.

Order:   OWNER only -> own booking -> COMPLETED -> has a booked price -> not paid
         -> amount = the booking's quoted_amount in integer paise (never the client's)
         -> Razorpay TEST order (or the local mock) -> booking_payment_orders row.
Verify:  the order is loaded from OUR database and its Razorpay order id is the one
         signed -> HMAC signature checked -> the payment is re-read from Razorpay
         and must belong to that order, for exactly that amount, and be captured
         -> booking_payment_transactions SUCCESS + booking_payment_orders PAID + a receipt,
         in one transaction. Idempotent: a repeat returns the same receipt.
Webhook: same finalisation, reached from Razorpay's signed event instead.

A failed or abandoned payment never creates a receipt and never touches the
booking. Nothing here writes to Partner's tables.
"""

import logging
import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.types import naive_utc_now
from app.integrations.razorpay import (
    MOCK_MODE,
    TEST_PAYMENT_NOTICE,
    RazorpayPayment,
    RazorpayRequestError,
    payment_error,
    verify_checkout_signature,
)
from app.modules.billing import booking_payment_errors as errors
from app.modules.billing.booking_payment_receipts import receipt_number_for, receipt_response, role_label, rupees
from app.modules.billing.booking_payment_repository import BookingForPayment, PaymentRepository
from app.modules.billing.booking_payment_schemas import (
    CreateOrderResponse,
    MockCheckoutResponse,
    ReceiptResponse,
    TechnicianBookingPayment,
    VerifyPaymentResponse,
)
from app.modules.billing.models import (
    ORDER_CREATED,
    ORDER_PAID,
    RECEIPT_SUCCESS,
    TRANSACTION_FAILED,
    TRANSACTION_SUCCESS,
)
from app.modules.billing.models import BookingPaymentOrder as PaymentOrder
from app.modules.billing.models import BookingPaymentReceipt as PaymentReceipt
from app.modules.billing.models import BookingPaymentTransaction as PaymentTransaction
from app.modules.identity.models import ROLE_OWNER, User

logger = logging.getLogger(__name__)

OWNER_ROLE = ROLE_OWNER
BOOKING_COMPLETED = "COMPLETED"
CURRENCY = "INR"


def booked_amount_paise(booking: BookingForPayment) -> int | None:
    """The booking's own booked price in integer paise, or None when it has none.

    Decimal all the way: ₹500.00 -> 50000. A price that is not a whole number of
    paise, zero, negative or in another currency makes the booking not payable
    rather than being rounded into something nobody agreed to.
    """
    amount = booking.quoted_amount
    if amount is None or (booking.currency or CURRENCY) != CURRENCY:
        return None
    paise = Decimal(amount) * 100
    if paise <= 0 or paise != paise.to_integral_value():
        return None
    return int(paise)


class PaymentService:
    def __init__(self, database: Session, repository: PaymentRepository, client):
        self.database = database
        self.payments = repository
        self.client = client

    # ------------------------------------------------------------ guards

    @staticmethod
    def require_owner(user: User) -> None:
        if (user.role or "").upper() != OWNER_ROLE:
            raise payment_error(403, errors.NOT_OWNER, "Only House Owners can pay for technician bookings.")

    def _owned_booking(self, user: User, booking_id: uuid.UUID) -> BookingForPayment:
        booking = self.payments.booking(booking_id)
        # Someone else's booking is answered exactly like an unknown one.
        if booking is None or booking.requested_by_user_id != user.id or booking.requested_by_role != OWNER_ROLE:
            raise payment_error(404, errors.BOOKING_NOT_FOUND, "Booking not found.")
        return booking

    def _owned_order(self, user: User, payment_order_id: uuid.UUID) -> PaymentOrder:
        order = self.payments.lock_order(payment_order_id)
        if order is None or order.customer_id != user.id:
            raise payment_error(404, errors.ORDER_NOT_FOUND, "Payment not found.")
        return order

    # -------------------------------------------------------------- list

    def list_bookings(self, user: User) -> list[TechnicianBookingPayment]:
        self.require_owner(user)
        bookings = [b for b in self.payments.completed_bookings_for(user.id) if b.requested_by_role == OWNER_ROLE]
        receipts = self.payments.receipts_for_bookings([booking.id for booking in bookings])
        rows = []
        for booking in bookings:
            amount = booked_amount_paise(booking)
            receipt = receipts.get(booking.id)
            status = "PAID" if receipt else ("UNPAID" if amount else "NOT_PAYABLE")
            rows.append(
                TechnicianBookingPayment(
                    booking_id=booking.id,
                    booking_reference=booking.reference,
                    technician_type=booking.technician_type,
                    technician_role=role_label(booking.technician_type),
                    service_name=booking.service_name,
                    technician_name=booking.technician_name,
                    completed_at=booking.completed_at,
                    amount_paise=amount,
                    amount_rupees=rupees(amount) if amount else None,
                    currency=CURRENCY,
                    payment_status=status,
                    receipt_number=receipt.receipt_number if receipt else None,
                )
            )
        return rows

    # ------------------------------------------------------------- order

    def create_order(self, user: User, booking_id: uuid.UUID) -> CreateOrderResponse:
        self.require_owner(user)
        booking = self._owned_booking(user, booking_id)
        if booking.status != BOOKING_COMPLETED:
            raise payment_error(
                409, errors.BOOKING_NOT_COMPLETED, "Payment opens once the technician has completed the work."
            )
        amount = booked_amount_paise(booking)
        if amount is None:
            raise payment_error(
                409, errors.NOT_PAYABLE, "Payment is not available for this booking: it has no booked service price."
            )

        self.payments.serialize_booking(booking.id)
        paid = self.payments.paid_order_for_booking(booking.id)
        if paid is not None:
            receipt = self.payments.receipt_for_order(paid.id)
            raise payment_error(
                409,
                errors.ALREADY_PAID,
                "This booking is already paid.",
                receipt_number=receipt.receipt_number if receipt else None,
            )

        order = self.payments.reusable_order(booking.id, user.id, amount, self.client.mode)
        if order is None:
            try:
                razorpay_order = self.client.create_order(
                    amount,
                    CURRENCY,
                    receipt=f"bk_{booking.id.hex[:20]}",
                    notes={"booking_reference": booking.reference, "mode": "test"},
                )
            except RazorpayRequestError as error:
                logger.warning("payment.order_failed booking=%s reason=%s", booking.reference, error)
                raise payment_error(
                    502, errors.GATEWAY_UNAVAILABLE, "The payment gateway is unavailable. Please try again."
                )
            if razorpay_order.amount_paise != amount or razorpay_order.currency != CURRENCY:
                raise payment_error(502, errors.AMOUNT_MISMATCH, "The payment gateway returned an unexpected amount.")
            order = PaymentOrder(
                booking_id=booking.id,
                customer_id=user.id,
                razorpay_order_id=razorpay_order.id,
                amount_paise=amount,
                currency=CURRENCY,
                status=ORDER_CREATED,
                gateway_mode=self.client.mode,
            )
            self.database.add(order)
        self.database.commit()
        logger.info(
            "payment.order_ready booking=%s order=%s amount_paise=%s mode=%s",
            booking.reference,
            order.razorpay_order_id,
            amount,
            order.gateway_mode,
        )
        return CreateOrderResponse(
            payment_order_id=order.id,
            razorpay_order_id=order.razorpay_order_id,
            key_id=self.client.key_id,
            amount_paise=order.amount_paise,
            amount_rupees=rupees(order.amount_paise),
            currency=order.currency,
            booking_id=booking.id,
            booking_reference=booking.reference,
            service_name=booking.service_name,
            gateway_mode=order.gateway_mode,
            notice=TEST_PAYMENT_NOTICE,
            customer_name=user.name,
            customer_email=getattr(user, "email", None),
        )

    # ------------------------------------------------------------ verify

    def verify(
        self,
        user: User,
        payment_order_id: uuid.UUID,
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str,
    ) -> VerifyPaymentResponse:
        self.require_owner(user)
        order = self._owned_order(user, payment_order_id)

        if order.status == ORDER_PAID:
            receipt = self.payments.receipt_for_order(order.id)
            self.database.commit()
            if receipt is not None and receipt.razorpay_payment_id == razorpay_payment_id:
                return VerifyPaymentResponse(status="SUCCESS", receipt=self._receipt_out(receipt, order.customer_id))
            raise payment_error(
                409,
                errors.ALREADY_PAID,
                "This booking is already paid.",
                receipt_number=receipt.receipt_number if receipt else None,
            )

        if order.gateway_mode != self.client.mode:
            self.database.rollback()
            raise payment_error(
                409, errors.GATEWAY_MODE_CHANGED, "Payment settings changed. Please start the payment again."
            )
        # The id that is checked is OUR stored one; a client-sent id must merely agree with it.
        if razorpay_order_id != order.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, errors.ORDER_MISMATCH, "This payment does not belong to this order.")
        if not verify_checkout_signature(
            self.client.signing_secret(), order.razorpay_order_id, razorpay_payment_id, razorpay_signature
        ):
            self.database.rollback()
            logger.warning("payment.signature_invalid order=%s", order.razorpay_order_id)
            raise payment_error(
                400, errors.SIGNATURE_INVALID, "Payment verification failed. The payment was not recorded as paid."
            )

        payment = self._confirmed_payment(order, razorpay_payment_id)
        receipt = self._finalize_success(order, payment)
        return VerifyPaymentResponse(status="SUCCESS", receipt=self._receipt_out(receipt, order.customer_id))

    def _confirmed_payment(self, order: PaymentOrder, razorpay_payment_id: str) -> RazorpayPayment:
        """Razorpay's own record of the payment, which must match this order exactly."""
        try:
            payment = self.client.fetch_payment(razorpay_payment_id)
            if payment.order_id == order.razorpay_order_id and payment.status == "authorized":
                payment = self.client.capture_payment(payment.id, order.amount_paise, order.currency)
        except RazorpayRequestError as error:
            self.database.rollback()
            logger.warning("payment.fetch_failed order=%s reason=%s", order.razorpay_order_id, error)
            raise payment_error(
                502, errors.GATEWAY_UNAVAILABLE, "The payment could not be confirmed. Please try again."
            )
        if payment.order_id != order.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, errors.ORDER_MISMATCH, "This payment does not belong to this order.")
        if payment.amount_paise != order.amount_paise or payment.currency != order.currency:
            self.database.rollback()
            raise payment_error(400, errors.AMOUNT_MISMATCH, "The payment amount does not match the booking amount.")
        if payment.status == "failed":
            self._record_failure(order, payment.id, payment.error_code, payment.error_description)
            raise payment_error(402, errors.PAYMENT_FAILED, "Payment failed. Please try again.")
        if payment.status != "captured":
            self.database.rollback()
            raise payment_error(409, errors.PAYMENT_NOT_COMPLETED, "The payment has not completed yet.")
        return payment

    def _finalize_success(self, order: PaymentOrder, payment: RazorpayPayment) -> PaymentReceipt:
        """Mark one verified payment successful and issue its receipt, atomically.
        Caller holds the order's row lock."""
        now = naive_utc_now()
        transaction = self.payments.transaction_by_payment_id(payment.id)
        if transaction is None:
            transaction = PaymentTransaction(
                payment_order_id=order.id,
                booking_id=order.booking_id,
                razorpay_payment_id=payment.id,
                razorpay_order_id=order.razorpay_order_id,
                amount_paise=payment.amount_paise,
                currency=payment.currency,
            )
            self.database.add(transaction)
        transaction.status = TRANSACTION_SUCCESS
        transaction.signature_verified = True
        transaction.payment_method = payment.method
        transaction.failure_code = None
        transaction.failure_description = None
        transaction.paid_at = now
        order.status = ORDER_PAID
        order.paid_at = now
        try:
            self.database.flush()
            receipt = PaymentReceipt(
                receipt_number=receipt_number_for(transaction.id, now),
                booking_id=order.booking_id,
                payment_order_id=order.id,
                payment_transaction_id=transaction.id,
                amount_paise=transaction.amount_paise,
                currency=transaction.currency,
                payment_method=transaction.payment_method,
                razorpay_payment_id=payment.id,
                razorpay_order_id=order.razorpay_order_id,
                issued_at=now,
                status=RECEIPT_SUCCESS,
                is_test=True,
            )
            self.database.add(receipt)
            self.database.commit()
        except IntegrityError:
            # Another verified payment for this booking won the race; this one is not recorded twice.
            self.database.rollback()
            logger.warning("payment.duplicate_success_refused order=%s payment=%s", order.razorpay_order_id, payment.id)
            raise payment_error(409, errors.ALREADY_PAID, "This booking is already paid.")
        logger.info(
            "payment.succeeded order=%s payment=%s receipt=%s amount_paise=%s mode=%s",
            order.razorpay_order_id,
            payment.id,
            receipt.receipt_number,
            order.amount_paise,
            order.gateway_mode,
        )
        return receipt

    # ----------------------------------------------------------- failure

    def _record_failure(
        self, order: PaymentOrder, razorpay_payment_id: str | None, code: str | None, description: str | None
    ) -> None:
        """Keep a failed attempt. Never touches the order's PAID state or the booking."""
        if order.status == ORDER_PAID:
            self.database.commit()
            return
        transaction = self.payments.transaction_by_payment_id(razorpay_payment_id) if razorpay_payment_id else None
        if transaction is not None and transaction.status == TRANSACTION_SUCCESS:
            self.database.commit()
            return
        if transaction is None:
            transaction = PaymentTransaction(
                payment_order_id=order.id,
                booking_id=order.booking_id,
                razorpay_payment_id=razorpay_payment_id,
                razorpay_order_id=order.razorpay_order_id,
                amount_paise=order.amount_paise,
                currency=order.currency,
            )
            self.database.add(transaction)
        transaction.status = TRANSACTION_FAILED
        transaction.signature_verified = False
        transaction.failure_code = (code or "PAYMENT_FAILED")[:64]
        transaction.failure_description = (description or "Payment failed.")[:255]
        self.database.commit()
        logger.info(
            "payment.failed order=%s payment=%s code=%s",
            order.razorpay_order_id,
            razorpay_payment_id,
            transaction.failure_code,
        )

    def report_failure(
        self,
        user: User,
        payment_order_id: uuid.UUID,
        razorpay_payment_id: str | None,
        code: str | None,
        description: str | None,
    ) -> dict:
        self.require_owner(user)
        order = self._owned_order(user, payment_order_id)
        self._record_failure(order, razorpay_payment_id, code, description)
        return {"status": "FAILED", "message": "Payment failed. Please try again."}

    # ---------------------------------------------------------- receipts

    def _receipt_out(self, receipt: PaymentReceipt, customer_id: uuid.UUID) -> ReceiptResponse:
        return receipt_response(
            receipt, self.payments.booking(receipt.booking_id), self.payments.customer_name(customer_id)
        )

    def receipt(self, user: User, receipt_number: str) -> ReceiptResponse:
        self.require_owner(user)
        receipt = self.payments.receipt_by_number(receipt_number)
        order = self.payments.order(receipt.payment_order_id) if receipt else None
        if receipt is None or order is None or order.customer_id != user.id:
            raise payment_error(404, errors.RECEIPT_NOT_FOUND, "Receipt not found.")
        return self._receipt_out(receipt, order.customer_id)

    # ----------------------------------------------------------- webhook

    def handle_webhook_event(self, event: dict) -> str:
        """A signature-verified Razorpay event. Idempotent: a repeated event finds the
        order already PAID (or the failure already recorded) and changes nothing."""
        name = event.get("event")
        entity = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
        payment_id, order_id = entity.get("id"), entity.get("order_id")
        if name not in ("payment.captured", "order.paid", "payment.failed") or not payment_id or not order_id:
            return "ignored"
        order = self.payments.lock_order_by_razorpay_id(order_id)
        if order is None:
            self.database.rollback()
            return "unknown_order"
        if order.status == ORDER_PAID:
            self.database.commit()
            return "duplicate"
        if name == "payment.failed":
            self._record_failure(order, payment_id, entity.get("error_code"), entity.get("error_description"))
            return "failure_recorded"
        if (
            int(entity.get("amount") or 0) != order.amount_paise
            or entity.get("currency") != order.currency
            or entity.get("status") != "captured"
        ):
            self.database.rollback()
            logger.warning("payment.webhook_mismatch order=%s payment=%s", order_id, payment_id)
            return "mismatch"
        payment = RazorpayPayment(
            id=payment_id,
            order_id=order_id,
            amount_paise=order.amount_paise,
            currency=order.currency,
            status="captured",
            method=entity.get("method"),
        )
        try:
            self._finalize_success(order, payment)
        except HTTPException:  # an ALREADY_PAID race is a duplicate, not a failure
            return "duplicate"
        return "paid"

    # -------------------------------------------------------------- mock

    def mock_checkout(self, user: User, payment_order_id: uuid.UUID, succeed: bool) -> MockCheckoutResponse:
        """Stand-in for Razorpay Checkout while no TEST keys are set. Refused otherwise."""
        if self.client.mode != MOCK_MODE:
            raise payment_error(404, errors.MOCK_DISABLED, "Not available.")
        self.require_owner(user)
        order = self._owned_order(user, payment_order_id)
        self.database.commit()
        if order.gateway_mode != MOCK_MODE or order.status != ORDER_CREATED:
            raise payment_error(
                409,
                errors.ALREADY_PAID if order.status == ORDER_PAID else errors.GATEWAY_MODE_CHANGED,
                "This payment cannot be simulated.",
            )
        payment, signature = self.client.simulate_checkout(
            order.razorpay_order_id, order.amount_paise, order.currency, succeed
        )
        return MockCheckoutResponse(
            succeeded=succeed,
            razorpay_order_id=order.razorpay_order_id,
            razorpay_payment_id=payment.id,
            razorpay_signature=signature,
            error_code=payment.error_code,
            error_description=payment.error_description,
        )
