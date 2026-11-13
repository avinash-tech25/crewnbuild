"""Book Technician booking payments, Razorpay TEST mode only (the old
app/payment_gateway/router.py; same paths and answers).

    GET  /payments/technician-bookings     the House Owner's completed bookings + payment state
    POST /payments/orders                  {booking_id} -> TEST order (amount from the booking)
    POST /payments/verify                  Checkout's ids + signature -> verified -> receipt
    POST /payments/failures                Checkout reported a failure (recorded, never "paid")
    GET  /payments/receipts/{number}       a receipt, to its House Owner only
    POST /payments/webhooks/razorpay       Razorpay's signed events (public; signature checked)
    POST /payments/mock/checkout           local demo only (RAZORPAY_ALLOW_MOCK, no keys)
    GET  /payments/gateway-status          which gateway is active: "test", "mock" or "unavailable"

Only the booking's House Owner pays, only a COMPLETED booking, at its quoted_amount
(CR-03, unchanged). Bookings are read from partner.v_professional_bookings.
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.integrations.razorpay import (
    PaymentClient,
    PaymentGatewayConfigurationError,
    client_for,
    payment_client,
    payment_error,
    resolve_gateway,
    verify_webhook_signature,
    webhook_secret,
)
from app.modules.billing import booking_payment_errors as errors
from app.modules.billing.booking_payment_repository import PaymentRepository
from app.modules.billing.booking_payment_schemas import (
    CreateOrderRequest,
    CreateOrderResponse,
    MockCheckoutRequest,
    MockCheckoutResponse,
    PaymentFailureRequest,
    ReceiptResponse,
    TechnicianBookingPayment,
    VerifyPaymentRequest,
    VerifyPaymentResponse,
)
from app.modules.billing.booking_payment_service import PaymentService
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments (Razorpay TEST)"])


def get_payment_client(request: Request) -> PaymentClient:
    return payment_client(request.app.state.settings)


def get_payment_service(
    database: Session = Depends(get_db), client: PaymentClient = Depends(get_payment_client)
) -> PaymentService:
    return PaymentService(database, PaymentRepository(database), client)


def get_payment_read_service(request: Request, database: Session = Depends(get_db)) -> PaymentService:
    """For reads that never call the gateway: they keep working while Razorpay is not
    configured."""
    try:
        client: PaymentClient | None = client_for(resolve_gateway(request.app.state.settings))
    except PaymentGatewayConfigurationError:
        client = None
    return PaymentService(database, PaymentRepository(database), client)


@router.get("/gateway-status")
def payment_gateway_status(request: Request) -> dict[str, Any]:
    """For checking a deployment: is real Razorpay TEST Checkout active? Never a key or secret."""
    try:
        mode = client_for(resolve_gateway(request.app.state.settings)).mode
    except PaymentGatewayConfigurationError as error:
        return {"mode": "unavailable", "test_mode_only": True, "reason": str(error)}
    return {"mode": mode, "test_mode_only": True, "reason": None}


@router.get("/technician-bookings", response_model=list[TechnicianBookingPayment])
def list_technician_booking_payments(
    user: User = Depends(current_user), service: PaymentService = Depends(get_payment_read_service)
) -> list[TechnicianBookingPayment]:
    return service.list_bookings(user)


@router.post("/orders", response_model=CreateOrderResponse)
def create_payment_order(
    payload: CreateOrderRequest,
    user: User = Depends(current_user),
    service: PaymentService = Depends(get_payment_service),
) -> CreateOrderResponse:
    return service.create_order(user, payload.booking_id)


@router.post("/verify", response_model=VerifyPaymentResponse)
def verify_payment(
    payload: VerifyPaymentRequest,
    user: User = Depends(current_user),
    service: PaymentService = Depends(get_payment_service),
) -> VerifyPaymentResponse:
    return service.verify(
        user,
        payload.payment_order_id,
        payload.razorpay_order_id,
        payload.razorpay_payment_id,
        payload.razorpay_signature,
    )


@router.post("/failures")
def report_payment_failure(
    payload: PaymentFailureRequest,
    user: User = Depends(current_user),
    service: PaymentService = Depends(get_payment_service),
) -> dict[str, Any]:
    return service.report_failure(
        user, payload.payment_order_id, payload.razorpay_payment_id, payload.code, payload.description
    )


@router.get("/receipts/{receipt_number}", response_model=ReceiptResponse)
def read_payment_receipt(
    receipt_number: str, user: User = Depends(current_user), service: PaymentService = Depends(get_payment_service)
) -> ReceiptResponse:
    return service.receipt(user, receipt_number)


@router.post("/mock/checkout", response_model=MockCheckoutResponse)
def mock_checkout(
    payload: MockCheckoutRequest,
    user: User = Depends(current_user),
    service: PaymentService = Depends(get_payment_service),
) -> MockCheckoutResponse:
    return service.mock_checkout(user, payload.payment_order_id, payload.outcome == "success")


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, database: Session = Depends(get_db)) -> dict[str, Any]:
    """Razorpay cannot reach localhost: this only receives events once the backend has a
    public HTTPS URL."""
    secret = webhook_secret(request.app.state.settings)
    if not secret:
        raise payment_error(503, errors.WEBHOOK_NOT_CONFIGURED, "Webhook secret not configured.")
    raw_body = await request.body()
    if not verify_webhook_signature(secret, raw_body, request.headers.get("X-Razorpay-Signature")):
        logger.warning("payment.webhook_signature_invalid")
        raise payment_error(400, errors.WEBHOOK_SIGNATURE_INVALID, "Invalid webhook signature.")
    try:
        event = json.loads(raw_body)
    except ValueError:
        raise payment_error(400, errors.WEBHOOK_SIGNATURE_INVALID, "Invalid webhook body.") from None
    # Webhook handling never calls Razorpay, so it needs no gateway client.
    service = PaymentService(database, PaymentRepository(database), client=None)
    outcome = await run_in_threadpool(service.handle_webhook_event, event)
    logger.info("payment.webhook event=%s outcome=%s", event.get("event"), outcome)
    return {"status": "ok", "outcome": outcome}
