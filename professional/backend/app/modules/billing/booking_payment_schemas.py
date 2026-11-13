"""Booking payment request and answer shapes (the old payment_gateway/schemas.py)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TechnicianBookingPayment(BaseModel):
    """One of the House Owner's completed technician bookings, with its payment state."""

    booking_id: uuid.UUID
    booking_reference: str
    technician_type: str
    technician_role: str
    service_name: str | None
    technician_name: str | None
    completed_at: datetime | None
    # From the booking's own booked price. NULL / 0 when the booking has none.
    amount_paise: int | None
    amount_rupees: str | None
    currency: str
    payment_status: Literal["UNPAID", "PAID", "NOT_PAYABLE"]
    receipt_number: str | None = None


class CreateOrderRequest(BaseModel):
    """Only the booking. There is deliberately no amount field: any amount a client
    sends is ignored by construction."""

    booking_id: uuid.UUID


class CreateOrderResponse(BaseModel):
    payment_order_id: uuid.UUID
    razorpay_order_id: str
    key_id: str  # public TEST key id; "" in mock mode. Never the secret.
    amount_paise: int
    amount_rupees: str
    currency: str
    booking_id: uuid.UUID
    booking_reference: str
    service_name: str | None
    gateway_mode: Literal["test", "mock"]
    test_mode: bool = True
    notice: str
    customer_name: str | None = None
    customer_email: str | None = None


class VerifyPaymentRequest(BaseModel):
    payment_order_id: uuid.UUID
    razorpay_order_id: str = Field(min_length=1, max_length=64)
    razorpay_payment_id: str = Field(min_length=1, max_length=64)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class PaymentFailureRequest(BaseModel):
    """What Checkout reported on failure. Informational only: it can never mark
    anything paid."""

    payment_order_id: uuid.UUID
    razorpay_payment_id: str | None = Field(default=None, max_length=64)
    code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)


class MockCheckoutRequest(BaseModel):
    payment_order_id: uuid.UUID
    outcome: Literal["success", "failure"]


class MockCheckoutResponse(BaseModel):
    """Shaped like Razorpay Checkout's own handler / payment.failed arguments."""

    succeeded: bool
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str | None = None
    error_code: str | None = None
    error_description: str | None = None


class ReceiptResponse(BaseModel):
    brand: str = "CREWNBUILD"
    title: str = "Payment Receipt"
    receipt_number: str
    booking_id: uuid.UUID
    booking_reference: str
    issued_at: str  # ISO 8601 with the local offset
    house_owner: str | None
    technician: str | None
    technician_role: str
    selected_service: str | None
    service_amount_paise: int
    total_paid_paise: int
    service_amount_rupees: str
    total_paid_rupees: str
    currency: str
    payment_method: str | None
    razorpay_payment_id: str
    razorpay_order_id: str
    payment_status: str
    test_mode: bool
    notice: str


class VerifyPaymentResponse(BaseModel):
    status: Literal["SUCCESS"]
    receipt: ReceiptResponse
