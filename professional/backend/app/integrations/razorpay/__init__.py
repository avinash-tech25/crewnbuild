"""Razorpay payments client: TEST keys only, or the local mock (ported from the old
app/payment_gateway config, signatures, client and error shapes; same rules).

`resolve_gateway` is the one gate every payment passes:

    RAZORPAY_MODE        must be "test"; there is no live mode
    RAZORPAY_KEY_ID      empty -> refused, unless RAZORPAY_ALLOW_MOCK=true outside
                         production, which selects the local mock; rzp_test_... ->
                         Razorpay TEST; rzp_live_... or anything else -> refused
    RAZORPAY_KEY_SECRET  required with a key id, never without one; never returned,
                         never logged

A refusal raises PaymentGatewayConfigurationError, answered as a 503 for payments only.
"""

import hashlib
import hmac
import logging
import secrets
import threading
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
from fastapi import HTTPException

from app.core.config import Settings

logger = logging.getLogger(__name__)

TEST_MODE = "test"
MOCK_MODE = "mock"
TEST_KEY_PREFIX = "rzp_test_"
LIVE_KEY_PREFIX = "rzp_live_"
TEST_PAYMENT_NOTICE = "TEST PAYMENT — NO REAL MONEY TRANSFERRED"


class PaymentGatewayConfigurationError(Exception):
    """The Razorpay settings are unsafe or incomplete. The message never holds a secret."""


class RazorpayRequestError(Exception):
    """Razorpay could not be reached or refused the request."""


def payment_error(status_code: int, code: str, message: str, **extra: Any) -> HTTPException:
    """`{"detail": {"code", "message"}}`: the shape the frontend already reads."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


# Error codes returned to the frontend.
ORDER_NOT_FOUND = "PAYMENT_ORDER_NOT_FOUND"
ORDER_MISMATCH = "PAYMENT_ORDER_MISMATCH"
SIGNATURE_INVALID = "PAYMENT_SIGNATURE_INVALID"
PAYMENT_FAILED = "PAYMENT_FAILED"
PAYMENT_NOT_COMPLETED = "PAYMENT_NOT_COMPLETED"
AMOUNT_MISMATCH = "PAYMENT_AMOUNT_MISMATCH"
ALREADY_PAID = "BOOKING_ALREADY_PAID"
GATEWAY_UNAVAILABLE = "PAYMENT_GATEWAY_UNAVAILABLE"
GATEWAY_MISCONFIGURED = "PAYMENT_GATEWAY_MISCONFIGURED"
GATEWAY_MODE_CHANGED = "PAYMENT_GATEWAY_MODE_CHANGED"
MOCK_DISABLED = "PAYMENT_MOCK_DISABLED"


# ---- the gateway choice ----


@dataclass(frozen=True)
class GatewayChoice:
    mode: str  # "test" (Razorpay TEST) or "mock" (local, no network)
    key_id: str
    key_secret: str
    api_base_url: str
    timeout_seconds: float


def resolve_gateway(settings: Settings) -> GatewayChoice:
    mode = (settings.razorpay_mode or "").strip().lower()
    if mode != TEST_MODE:
        raise PaymentGatewayConfigurationError(
            "Only RAZORPAY_MODE=test is supported. Live payments are not implemented and are refused."
        )
    key_id = (settings.razorpay_key_id or "").strip()
    secret = settings.razorpay_key_secret.get_secret_value().strip()
    if key_id.startswith(LIVE_KEY_PREFIX):
        raise PaymentGatewayConfigurationError("A live Razorpay key (rzp_live_) is refused in TEST mode.")
    if key_id and not key_id.startswith(TEST_KEY_PREFIX):
        raise PaymentGatewayConfigurationError("RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_...).")
    if bool(key_id) != bool(secret):
        raise PaymentGatewayConfigurationError("Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or neither.")
    if not key_id:
        if settings.is_production():
            raise PaymentGatewayConfigurationError(
                "Razorpay TEST keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET). "
                "The simulated checkout is never used in production."
            )
        if not settings.razorpay_allow_mock:
            raise PaymentGatewayConfigurationError(
                "Razorpay TEST keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET). "
                "For a local demo only, RAZORPAY_ALLOW_MOCK=true enables the simulated checkout."
            )
        return GatewayChoice(MOCK_MODE, "", "", "", 0.0)
    return GatewayChoice(
        TEST_MODE, key_id, secret, settings.razorpay_api_base_url.rstrip("/"), settings.razorpay_timeout_seconds
    )


# ---- signatures ----


def _hmac_sha256_hex(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def checkout_signature(secret: str, razorpay_order_id: str, razorpay_payment_id: str) -> str:
    """What Razorpay signs after Checkout: HMAC-SHA256("<order_id>|<payment_id>")."""
    return _hmac_sha256_hex(secret, f"{razorpay_order_id}|{razorpay_payment_id}".encode())


def verify_checkout_signature(secret: str, razorpay_order_id: str, razorpay_payment_id: str, signature: str) -> bool:
    """Constant-time; a missing value never verifies."""
    if not (secret and razorpay_order_id and razorpay_payment_id and signature):
        return False
    return hmac.compare_digest(checkout_signature(secret, razorpay_order_id, razorpay_payment_id), signature)


def verify_webhook_signature(secret: str, raw_body: bytes, signature: str | None) -> bool:
    """X-Razorpay-Signature: HMAC-SHA256 of the raw request body with the webhook secret,
    compared in constant time; a missing secret or signature never verifies."""
    if not (secret and raw_body is not None and signature):
        return False
    return hmac.compare_digest(_hmac_sha256_hex(secret, raw_body), signature)


def webhook_secret(settings: Settings) -> str:
    return settings.razorpay_webhook_secret.get_secret_value().strip()


# ---- the clients ----


@dataclass(frozen=True)
class RazorpayOrder:
    id: str
    amount_paise: int
    currency: str


@dataclass(frozen=True)
class RazorpayPayment:
    id: str
    order_id: str
    amount_paise: int
    currency: str
    status: str  # created | authorized | captured | refunded | failed
    method: str | None
    error_code: str | None = None
    error_description: str | None = None


def _payment_from(entity: dict[str, Any]) -> RazorpayPayment:
    return RazorpayPayment(
        id=str(entity.get("id") or ""),
        order_id=str(entity.get("order_id") or ""),
        amount_paise=int(entity.get("amount") or 0),
        currency=str(entity.get("currency") or ""),
        status=str(entity.get("status") or ""),
        method=entity.get("method"),
        error_code=entity.get("error_code"),
        error_description=entity.get("error_description"),
    )


class RazorpayTestClient:
    """Razorpay TEST. Refuses to exist with anything but an rzp_test_ key."""

    mode = TEST_MODE

    def __init__(self, choice: GatewayChoice) -> None:
        if not choice.key_id.startswith(TEST_KEY_PREFIX):
            raise PaymentGatewayConfigurationError("Only Razorpay TEST keys may be used.")
        self.key_id = choice.key_id
        self._secret = choice.key_secret
        self._base = choice.api_base_url
        self._timeout = choice.timeout_seconds

    def signing_secret(self) -> str:
        return self._secret

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self._timeout, auth=(self.key_id, self._secret)) as client:
                response = client.request(method, f"{self._base}{path}", json=json)
        except httpx.HTTPError as error:
            raise RazorpayRequestError(f"Razorpay unreachable: {type(error).__name__}") from None
        if response.status_code >= 400:
            # Razorpay's error description only; never the request or credentials.
            try:
                description = response.json().get("error", {}).get("description")
            except ValueError:
                description = None
            raise RazorpayRequestError(f"Razorpay {response.status_code}: {description or 'request refused'}")
        return response.json()  # type: ignore[no-any-return]

    def create_order(self, amount_paise: int, currency: str, receipt: str, notes: dict[str, Any]) -> RazorpayOrder:
        body = self._request(
            "POST", "/orders", {"amount": amount_paise, "currency": currency, "receipt": receipt, "notes": notes}
        )
        return RazorpayOrder(id=body["id"], amount_paise=int(body["amount"]), currency=body["currency"])

    def fetch_payment(self, payment_id: str) -> RazorpayPayment:
        return _payment_from(self._request("GET", f"/payments/{payment_id}"))

    def fetch_order_payments(self, order_id: str) -> list[RazorpayPayment]:
        return [_payment_from(item) for item in self._request("GET", f"/orders/{order_id}/payments").get("items", [])]

    def capture_payment(self, payment_id: str, amount_paise: int, currency: str) -> RazorpayPayment:
        return _payment_from(
            self._request("POST", f"/payments/{payment_id}/capture", {"amount": amount_paise, "currency": currency})
        )


class MockRazorpayClient:
    """Razorpay's shape, entirely local, while no TEST keys are configured. Payments are
    kept in process memory and signed with a random per-process secret."""

    mode = MOCK_MODE
    key_id = ""

    def __init__(self) -> None:
        self._secret = secrets.token_hex(32)
        self._orders: dict[str, RazorpayOrder] = {}
        self._payments: dict[str, RazorpayPayment] = {}
        self._lock = threading.Lock()

    def signing_secret(self) -> str:
        return self._secret

    def create_order(self, amount_paise: int, currency: str, receipt: str, notes: dict[str, Any]) -> RazorpayOrder:
        order = RazorpayOrder(id=f"order_MOCK{secrets.token_hex(7)}", amount_paise=amount_paise, currency=currency)
        with self._lock:
            self._orders[order.id] = order
        return order

    def simulate_checkout(
        self, order_id: str, amount_paise: int, currency: str, succeed: bool
    ) -> tuple[RazorpayPayment, str | None]:
        """What Razorpay Checkout would hand back: a payment and, on success, its signature."""
        payment = RazorpayPayment(
            id=f"pay_MOCK{secrets.token_hex(7)}",
            order_id=order_id,
            amount_paise=amount_paise,
            currency=currency,
            status="captured" if succeed else "failed",
            method="upi",
            error_code=None if succeed else "BAD_REQUEST_ERROR",
            error_description=None if succeed else "Payment failed (simulated test payment).",
        )
        with self._lock:
            self._payments[payment.id] = payment
        return payment, (checkout_signature(self._secret, order_id, payment.id) if succeed else None)

    def fetch_payment(self, payment_id: str) -> RazorpayPayment:
        with self._lock:
            payment = self._payments.get(payment_id)
        if payment is None:
            raise RazorpayRequestError("Unknown mock payment (the backend may have restarted).")
        return payment

    def fetch_order_payments(self, order_id: str) -> list[RazorpayPayment]:
        with self._lock:
            return [payment for payment in self._payments.values() if payment.order_id == order_id]

    def capture_payment(self, payment_id: str, amount_paise: int, currency: str) -> RazorpayPayment:
        return self.fetch_payment(payment_id)


PaymentClient = RazorpayTestClient | MockRazorpayClient


@lru_cache
def client_for(choice: GatewayChoice) -> PaymentClient:
    """One client per gateway choice for the process, so the mock keeps its payments
    between requests."""
    return RazorpayTestClient(choice) if choice.mode == TEST_MODE else MockRazorpayClient()


def payment_client(settings: Settings) -> PaymentClient:
    """The client for these settings, or a 503 naming why payments are unavailable."""
    try:
        return client_for(resolve_gateway(settings))
    except PaymentGatewayConfigurationError as error:
        logger.error("payment.gateway_refused reason=%s", error)
        raise payment_error(503, GATEWAY_MISCONFIGURED, f"Payments are unavailable: {error}") from None
