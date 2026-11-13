"""The CREWNBUILD payment receipt: numbered once, built only from verified database values."""

import uuid
from datetime import datetime
from decimal import Decimal

from app.core.local_time import local_iso
from app.integrations.razorpay import TEST_PAYMENT_NOTICE
from app.modules.billing.booking_payment_repository import BookingForPayment
from app.modules.billing.booking_payment_schemas import ReceiptResponse
from app.modules.billing.models import BookingPaymentReceipt as PaymentReceipt


def receipt_number_for(transaction_id: uuid.UUID, issued_at: datetime) -> str:
    """RCP-TEST-YYYYMMDD-XXXXXXXXXX: derived from the transaction id, so it is unique
    exactly as the transaction is, and it says it is a test receipt."""
    return f"RCP-TEST-{issued_at:%Y%m%d}-{transaction_id.hex[:10].upper()}"


def rupees(paise: int) -> str:
    """Exact decimal rupees for display, from integer paise ("500.00")."""
    return str((Decimal(paise) / Decimal(100)).quantize(Decimal("0.01")))


def role_label(technician_type: str | None) -> str:
    return (technician_type or "Technician").replace("_", " ").title()


def receipt_response(
    receipt: PaymentReceipt, booking: BookingForPayment | None, house_owner: str | None
) -> ReceiptResponse:
    return ReceiptResponse(
        receipt_number=receipt.receipt_number,
        booking_id=receipt.booking_id,
        booking_reference=booking.reference if booking else f"SR-{receipt.booking_id.hex[:8].upper()}",
        issued_at=local_iso(receipt.issued_at) or "",
        house_owner=house_owner,
        technician=booking.technician_name if booking else None,
        technician_role=role_label(booking.technician_type if booking else None),
        selected_service=booking.service_name if booking else None,
        # No fees, tax or extras exist in this flow: the total is the service amount.
        service_amount_paise=receipt.amount_paise,
        total_paid_paise=receipt.amount_paise,
        service_amount_rupees=rupees(receipt.amount_paise),
        total_paid_rupees=rupees(receipt.amount_paise),
        currency=receipt.currency,
        payment_method=receipt.payment_method,
        razorpay_payment_id=receipt.razorpay_payment_id,
        razorpay_order_id=receipt.razorpay_order_id,
        payment_status=receipt.status,
        test_mode=receipt.is_test,
        notice=TEST_PAYMENT_NOTICE,
    )
