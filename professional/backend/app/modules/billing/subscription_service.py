"""Builder plan purchase. Razorpay TEST MODE ONLY, through the existing gateway client.

Order:   BUILDER only -> India account (INR) -> purchasable tier + known duration
         -> a price row exists -> plan-change rule -> amount from OUR price table
         (never the client's) -> Razorpay TEST order (or the local mock).
Verify:  our stored order id must match -> HMAC checkout signature -> the payment
         is re-read from Razorpay and must belong to that order, for exactly that
         amount and currency, and be captured -> PAID + one subscription period,
         in one transaction. Repeating it returns the same period.
Webhook: the same activation from Razorpay's signed event; failures, refunds and
         disputes too. Each event id is processed once.

Renewal rule (approved): the same tier extends from the end of the current
coverage; a different tier cannot be bought while a paid plan is in force. A
paid period is never discarded: if two orders race, the later one is queued
after the current coverage instead of overlapping it.

Refund rule: a FULL refund revokes the period that payment bought; a partial
refund is recorded in the log only. Dispute rule: access is kept while the
dispute is open; a lost dispute revokes like a refund, a won one restores PAID.

Nothing here touches the technician-booking payment tables or Partner's schema.
"""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.integrations.razorpay import (
    MOCK_MODE,
    TEST_PAYMENT_NOTICE,
    RazorpayPayment,
    RazorpayRequestError,
    payment_error,
    verify_checkout_signature,
)
from app.modules.billing import coupons, entitlements, signup_checkout
from app.modules.billing import plans as catalogue
from app.modules.billing.models import (
    PAYMENT_CREATED,
    PAYMENT_DISPUTED,
    PAYMENT_FAILED,
    PAYMENT_PAID,
    PAYMENT_REFUNDED,
    PERIOD_ACTIVE,
    PERIOD_REVOKED,
    BuilderSubscription,
    PaymentWebhookEvent,
    SubscriptionCoupon,
    SubscriptionCouponRedemption,
    SubscriptionPayment,
    SubscriptionPlanPrice,
)
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

CURRENCY = "INR"

# Error codes returned to the frontend, in the payment module's {"code", "message"} shape.
REGION_NOT_SUPPORTED = "SUBSCRIPTION_REGION_NOT_SUPPORTED"
PLAN_NOT_AVAILABLE = "SUBSCRIPTION_PLAN_NOT_AVAILABLE"
PLAN_CHANGE_NOT_ALLOWED = "SUBSCRIPTION_PLAN_CHANGE_NOT_ALLOWED"
# The builder expiry popup's window (frontend EXPIRY_WARNING_DAYS): in it a Pro
# subscriber may already buy Plus or Premium, which then starts when Pro ends.
EXPIRY_WARNING_DAYS = 3
ORDER_NOT_FOUND = "SUBSCRIPTION_ORDER_NOT_FOUND"
ORDER_MISMATCH = "SUBSCRIPTION_ORDER_MISMATCH"
SIGNATURE_INVALID = "SUBSCRIPTION_SIGNATURE_INVALID"
AMOUNT_MISMATCH = "SUBSCRIPTION_AMOUNT_MISMATCH"
PAYMENT_NOT_COMPLETED = "SUBSCRIPTION_PAYMENT_NOT_COMPLETED"
PAYMENT_FAILED_CODE = "SUBSCRIPTION_PAYMENT_FAILED"
PAYMENT_CLOSED = "SUBSCRIPTION_PAYMENT_CLOSED"
GATEWAY_UNAVAILABLE = "PAYMENT_GATEWAY_UNAVAILABLE"
GATEWAY_MODE_CHANGED = "PAYMENT_GATEWAY_MODE_CHANGED"
MOCK_DISABLED = "PAYMENT_MOCK_DISABLED"


def region_supported(user: User) -> bool:
    """India accounts only (Razorpay INR)."""
    return entitlements.is_india_account(user)


def active_price(database: Session, plan_code: str, duration_code: str) -> SubscriptionPlanPrice | None:
    return (
        database.query(SubscriptionPlanPrice)
        .filter(
            SubscriptionPlanPrice.plan_code == plan_code,
            SubscriptionPlanPrice.duration_code == duration_code,
            SubscriptionPlanPrice.currency == CURRENCY,
            SubscriptionPlanPrice.is_active.is_(True),
        )
        .first()
    )


def _local_date(moment: datetime):
    """A stored UTC instant's date in the app's local timezone (Asia/Kolkata)."""
    return datetime.fromisoformat(local_iso(moment) or "").date()


def upgrade_window_open(state: entitlements.SubscriptionState, plan_code: str, now: datetime | None = None) -> bool:
    """Pro in force (ACTIVE, not grace), nothing bought after it yet, the order is
    for Plus/Premium, and the popup's window: not yet ended and at most
    EXPIRY_WARNING_DAYS calendar days away by local date (28 Oct -> 31 Oct is 3,
    whatever the time of day). Activation still waits for a verified payment and
    then starts at the end of the Pro coverage."""
    now = now or naive_utc_now()
    return (
        state.status == entitlements.STATUS_ACTIVE
        and not state.queued
        and state.plan_code == catalogue.PROFESSIONAL
        and plan_code == catalogue.BUSINESS
        and state.coverage_end is not None
        and now < state.coverage_end
        and (_local_date(state.coverage_end) - _local_date(now)).days <= EXPIRY_WARNING_DAYS
    )


class SubscriptionService:
    def __init__(self, database: Session, client):
        self.database = database
        self.client = client

    # ------------------------------------------------------------ helpers

    def _lock_payment(self, payment_id: uuid.UUID) -> SubscriptionPayment | None:
        return (
            self.database.query(SubscriptionPayment)
            .filter(SubscriptionPayment.id == payment_id)
            .with_for_update()
            .first()
        )

    def _lock_payment_by_order(self, razorpay_order_id: str) -> SubscriptionPayment | None:
        return (
            self.database.query(SubscriptionPayment)
            .filter(SubscriptionPayment.razorpay_order_id == razorpay_order_id)
            .with_for_update()
            .first()
        )

    def _owned_payment(self, user: User, payment_id: uuid.UUID) -> SubscriptionPayment:
        payment = self._lock_payment(payment_id)
        if payment is None or payment.builder_id != user.id:
            self.database.rollback()
            raise payment_error(404, ORDER_NOT_FOUND, "Payment not found.")
        return payment

    def _serialize_builder(self, builder_id: uuid.UUID) -> None:
        """One activation at a time per builder, until this transaction ends, so two
        different payments verified at the same moment cannot both read the same
        coverage and receive overlapping periods. The same pattern as the booking
        flow's serialize_booking. PostgreSQL only (the isolated SQLite tests run
        single-threaded and have no advisory locks)."""
        bind = self.database.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            self.database.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"subscription:{builder_id}"}
            )

    def _period_for(self, payment: SubscriptionPayment) -> BuilderSubscription | None:
        return self.database.query(BuilderSubscription).filter(BuilderSubscription.payment_id == payment.id).first()

    # -------------------------------------------------------------- order

    def create_order(self, user: User, plan_code: str, duration_code: str, coupon_code: str | None = None) -> dict:
        entitlements.require_builder(user)
        if not region_supported(user):
            raise payment_error(403, REGION_NOT_SUPPORTED, "Builder plans are not yet available in your region.")
        plan_code, duration_code = (plan_code or "").upper(), (duration_code or "").upper()
        if not catalogue.is_paid_plan(plan_code) or not catalogue.is_offered_duration(duration_code):
            raise payment_error(400, PLAN_NOT_AVAILABLE, "Choose a valid plan and a Monthly or Annual billing period.")
        price = active_price(self.database, plan_code, duration_code)
        if price is None:
            raise payment_error(409, PLAN_NOT_AVAILABLE, "This plan is not available for purchase yet.")
        # A paid sign-up pays for the plan it chose (switched first if wanted), and only
        # after its PIN code step.
        pending = signup_checkout.pending_checkout(user, self.database)
        if pending is not None:
            if (pending["plan_code"], pending["duration_code"]) != (plan_code, duration_code):
                raise payment_error(
                    409,
                    "SUBSCRIPTION_SIGNUP_PLAN_MISMATCH",
                    "Change your selected plan on the checkout page before paying for another one.",
                    **pending,
                )
            signup_checkout.require_pincode(user, self.database)

        state = entitlements.subscription_state(self.database, user.id)
        in_force = state.status in (entitlements.STATUS_ACTIVE, entitlements.STATUS_GRACE)
        if in_force and state.plan_code != plan_code and not upgrade_window_open(state, plan_code):
            raise payment_error(
                409,
                PLAN_CHANGE_NOT_ALLOWED,
                "You can switch plans after your current plan ends. You can renew your current plan at any time.",
                current_plan=state.plan_code,
            )

        original = int(price.amount_paise)
        coupon_quote = None
        if coupon_code and coupon_code.strip():
            # The coupon row is locked for the rest of this transaction: concurrent
            # checkouts with the same coupon queue here, so limits cannot be exceeded.
            held = (
                self.database.query(SubscriptionCoupon)
                .filter(SubscriptionCoupon.code == coupons.normalize_code(coupon_code))
                .with_for_update()
                .first()
            )
            if held is not None and coupons.release_open_reservations(self.database, user.id, held.id):
                self.database.flush()  # sessions do not autoflush: the limit count below must see the release
            coupon_quote = coupons.quote(self.database, user, coupon_code, plan_code, duration_code, lock=True)
        amount = coupon_quote.final_minor if coupon_quote else original

        existing = None
        if coupon_quote is None:
            # A repeated request (double click, reload, closed Checkout) reuses the builder's
            # still-open full-price order for the same plan; never one that carries a coupon,
            # and never a FAILED one: a new attempt after a failure gets its own payment row
            # and Razorpay order, so the failed attempt stays on record as it was.
            existing = (
                self.database.query(SubscriptionPayment)
                .filter(
                    SubscriptionPayment.builder_id == user.id,
                    SubscriptionPayment.plan_code == plan_code,
                    SubscriptionPayment.duration_code == duration_code,
                    SubscriptionPayment.amount_paise == amount,
                    SubscriptionPayment.status == PAYMENT_CREATED,
                    SubscriptionPayment.gateway_mode == self.client.mode,
                    ~SubscriptionPayment.id.in_(self.database.query(SubscriptionCouponRedemption.payment_id)),
                )
                .order_by(SubscriptionPayment.created_at.desc())
                .first()
            )
        if existing is None:
            try:
                order = self.client.create_order(
                    amount,
                    CURRENCY,
                    receipt=f"sub_{uuid.uuid4().hex[:20]}",
                    notes={
                        "purpose": "builder_subscription",
                        "plan": plan_code,
                        "duration": duration_code,
                        "mode": "test",
                    },
                )
            except RazorpayRequestError as error:
                logger.warning("subscription.order_failed builder=%s reason=%s", user.id, error)
                raise payment_error(502, GATEWAY_UNAVAILABLE, "The payment gateway is unavailable. Please try again.")
            if order.amount_paise != amount or order.currency != CURRENCY:
                raise payment_error(502, AMOUNT_MISMATCH, "The payment gateway returned an unexpected amount.")
            existing = SubscriptionPayment(
                builder_id=user.id,
                plan_code=plan_code,
                duration_code=duration_code,
                amount_paise=amount,
                currency=CURRENCY,
                razorpay_order_id=order.id,
                status=PAYMENT_CREATED,
                gateway_mode=self.client.mode,
            )
            self.database.add(existing)
            if coupon_quote is not None:
                self.database.flush()
                coupons.reserve(self.database, existing, coupon_quote)
        self.database.commit()
        logger.info(
            "subscription.order_ready builder=%s order=%s plan=%s duration=%s amount_paise=%s mode=%s",
            user.id,
            existing.razorpay_order_id,
            plan_code,
            duration_code,
            amount,
            existing.gateway_mode,
        )
        return {
            "subscription_payment_id": existing.id,
            "razorpay_order_id": existing.razorpay_order_id,
            "key_id": self.client.key_id,  # the PUBLIC key id only
            "amount_paise": existing.amount_paise,
            "currency": existing.currency,
            "plan_code": plan_code,
            "duration_code": duration_code,
            "gateway_mode": existing.gateway_mode,
            "notice": TEST_PAYMENT_NOTICE,
            "customer_name": user.name,
            "customer_email": getattr(user, "email", None),
            # How the server arrived at amount_paise (no coupon: no discount).
            "original_amount_paise": original,
            "discount_paise": coupon_quote.discount_minor if coupon_quote else 0,
            "coupon_code": coupon_quote.coupon.code if coupon_quote else None,
        }

    # ------------------------------------------------------------- verify

    def verify(
        self,
        user: User,
        payment_id: uuid.UUID,
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str,
    ) -> BuilderSubscription:
        entitlements.require_builder(user)
        payment = self._owned_payment(user, payment_id)

        if payment.status in (PAYMENT_PAID, PAYMENT_DISPUTED):
            period = self._period_for(payment)
            self.database.commit()
            if period is not None and payment.razorpay_payment_id == razorpay_payment_id:
                return period  # the same verify again: same answer
            raise payment_error(409, PAYMENT_CLOSED, "This payment has already been processed.")
        if payment.status == PAYMENT_REFUNDED:
            self.database.rollback()
            raise payment_error(409, PAYMENT_CLOSED, "This payment was refunded.")
        if payment.gateway_mode != self.client.mode:
            self.database.rollback()
            raise payment_error(409, GATEWAY_MODE_CHANGED, "Payment settings changed. Please start the payment again.")
        # The id checked is OUR stored one; the client-sent id must merely agree with it.
        if razorpay_order_id != payment.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, ORDER_MISMATCH, "This payment does not belong to this order.")
        if not verify_checkout_signature(
            self.client.signing_secret(), payment.razorpay_order_id, razorpay_payment_id, razorpay_signature
        ):
            self.database.rollback()
            logger.warning("subscription.signature_invalid order=%s", payment.razorpay_order_id)
            raise payment_error(400, SIGNATURE_INVALID, "Payment verification failed. Your plan was not activated.")

        gateway_payment = self._confirmed_payment(payment, razorpay_payment_id)
        return self._activate(payment, gateway_payment, signature_verified=True)

    def _confirmed_payment(self, payment: SubscriptionPayment, razorpay_payment_id: str) -> RazorpayPayment:
        """Razorpay's own record of the payment, which must match this order exactly."""
        try:
            gateway_payment = self.client.fetch_payment(razorpay_payment_id)
            if gateway_payment.order_id == payment.razorpay_order_id and gateway_payment.status == "authorized":
                gateway_payment = self.client.capture_payment(
                    gateway_payment.id, payment.amount_paise, payment.currency
                )
        except RazorpayRequestError as error:
            self.database.rollback()
            logger.warning("subscription.fetch_failed order=%s reason=%s", payment.razorpay_order_id, error)
            raise payment_error(502, GATEWAY_UNAVAILABLE, "The payment could not be confirmed. Please try again.")
        if gateway_payment.order_id != payment.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, ORDER_MISMATCH, "This payment does not belong to this order.")
        if gateway_payment.amount_paise != payment.amount_paise or gateway_payment.currency != payment.currency:
            self.database.rollback()
            raise payment_error(400, AMOUNT_MISMATCH, "The payment amount does not match the plan price.")
        if gateway_payment.status == "failed":
            self._record_failure(
                payment, gateway_payment.id, gateway_payment.error_code, gateway_payment.error_description
            )
            raise payment_error(402, PAYMENT_FAILED_CODE, "Payment failed. Your plan was not activated.")
        if gateway_payment.status != "captured":
            self.database.rollback()
            raise payment_error(409, PAYMENT_NOT_COMPLETED, "The payment has not completed yet.")
        return gateway_payment

    def _activate(
        self, payment: SubscriptionPayment, gateway_payment: RazorpayPayment, *, signature_verified: bool
    ) -> BuilderSubscription:
        """PAID + one period, atomically. The caller holds the payment's row lock.

        The period starts now, or -- when a paid plan is already in force -- at the
        end of the current coverage (a same-tier renewal extends; a period bought by
        a racing order is queued, never overlapped)."""
        self._serialize_builder(payment.builder_id)
        existing = self._period_for(payment)
        if existing is not None:  # a concurrent verify/webhook got here first
            self.database.commit()
            return existing
        now = naive_utc_now()
        state = entitlements.subscription_state(self.database, payment.builder_id, now)
        start = now
        if state.status == entitlements.STATUS_ACTIVE and state.coverage_end is not None:
            start = max(now, state.coverage_end)
        for queued in state.queued:  # never overlap a period already queued
            start = max(start, queued.subscription_end)
        period = BuilderSubscription(
            builder_id=payment.builder_id,
            payment_id=payment.id,
            plan_code=payment.plan_code,
            duration_code=payment.duration_code,
            status=PERIOD_ACTIVE,
            subscription_start=start,
            subscription_end=entitlements.period_end_for(start, payment.duration_code),
        )
        payment.status = PAYMENT_PAID
        payment.razorpay_payment_id = gateway_payment.id
        payment.payment_method = gateway_payment.method
        payment.signature_verified = payment.signature_verified or signature_verified
        payment.failure_code = None
        payment.failure_description = None
        payment.paid_at = now
        # A coupon on this order becomes a completed redemption only now, with the
        # verified payment, in the same transaction as the period it bought.
        coupons.mark_redeemed(self.database, payment, now)
        self.database.add(period)
        try:
            self.database.commit()
        except IntegrityError:
            # Another activation for this payment (or this Razorpay payment id) won the race.
            self.database.rollback()
            logger.warning("subscription.duplicate_activation_refused order=%s", payment.razorpay_order_id)
            winner = (
                self.database.query(BuilderSubscription).filter(BuilderSubscription.payment_id == payment.id).first()
            )
            if winner is not None:
                return winner
            raise payment_error(409, PAYMENT_CLOSED, "This payment has already been processed.")
        logger.info(
            "subscription.activated builder=%s plan=%s duration=%s start=%s end=%s order=%s mode=%s",
            payment.builder_id,
            period.plan_code,
            period.duration_code,
            period.subscription_start,
            period.subscription_end,
            payment.razorpay_order_id,
            payment.gateway_mode,
        )
        return period

    # ------------------------------------------------------------ failure

    def _record_failure(
        self, payment: SubscriptionPayment, razorpay_payment_id: str | None, code: str | None, description: str | None
    ) -> None:
        """Keep a failed attempt. Never touches a PAID/REFUNDED/DISPUTED payment or any period."""
        if payment.status != PAYMENT_CREATED and payment.status != PAYMENT_FAILED:
            self.database.commit()
            return
        payment.status = PAYMENT_FAILED
        payment.failure_code = (code or "PAYMENT_FAILED")[:64]
        payment.failure_description = (description or "Payment failed.")[:255]
        coupons.release(self.database, payment)  # a failed payment holds no coupon use
        self.database.commit()
        logger.info(
            "subscription.payment_failed order=%s payment=%s code=%s",
            payment.razorpay_order_id,
            razorpay_payment_id,
            payment.failure_code,
        )

    def report_failure(
        self,
        user: User,
        payment_id: uuid.UUID,
        razorpay_payment_id: str | None,
        code: str | None,
        description: str | None,
    ) -> dict:
        entitlements.require_builder(user)
        payment = self._owned_payment(user, payment_id)
        self._record_failure(payment, razorpay_payment_id, code, description)
        return {"status": payment.status, "message": "Payment failed. Your plan was not activated."}

    # ------------------------------------------------------ refund/dispute

    def reconcile(self, user: User, payment_id: uuid.UUID) -> dict:
        """Recover an order paid while the browser closed before verification (Razorpay
        cannot reach a local server's webhook). Asks Razorpay for the order's payments
        and activates only through the same checks as verify -- captured status, order,
        amount and currency confirmed from Razorpay itself. Never creates a charge;
        repeating it is harmless."""
        entitlements.require_builder(user)
        payment = self._owned_payment(user, payment_id)
        if payment.status in (PAYMENT_PAID, PAYMENT_DISPUTED):
            self.database.commit()
            return {"status": "ACTIVATED"}
        if payment.status not in (PAYMENT_CREATED, PAYMENT_FAILED) or payment.gateway_mode != self.client.mode:
            self.database.rollback()
            return {"status": payment.status}
        try:
            attempts = self.client.fetch_order_payments(payment.razorpay_order_id)
        except RazorpayRequestError as error:
            self.database.rollback()
            logger.warning("subscription.reconcile_failed order=%s reason=%s", payment.razorpay_order_id, error)
            raise payment_error(502, GATEWAY_UNAVAILABLE, "The payment could not be checked. Please try again.")
        paid = next(
            (
                attempt
                for attempt in attempts
                if attempt.order_id == payment.razorpay_order_id and attempt.status in ("captured", "authorized")
            ),
            None,
        )
        if paid is None:
            self.database.rollback()
            return {"status": "NOT_PAID"}
        self._activate(payment, self._confirmed_payment(payment, paid.id), signature_verified=False)
        logger.info("subscription.reconciled order=%s payment=%s", payment.razorpay_order_id, paid.id)
        return {"status": "ACTIVATED"}

    RECONCILE_WINDOW = timedelta(days=2)

    def reconcile_recent(self, user: User) -> dict:
        """Recovery without anything stored in the browser: check this builder's own
        unpaid orders from the last two days, newest first, and stop at the first one
        Razorpay reports paid. Another device or browser finds the payment too."""
        entitlements.require_builder(user)
        since = naive_utc_now() - self.RECONCILE_WINDOW
        candidates = [
            row[0]
            for row in (
                self.database.query(SubscriptionPayment.id)
                .filter(
                    SubscriptionPayment.builder_id == user.id,
                    SubscriptionPayment.created_at >= since,
                    SubscriptionPayment.status.in_((PAYMENT_CREATED, PAYMENT_FAILED)),
                    SubscriptionPayment.gateway_mode == self.client.mode,
                )
                .order_by(SubscriptionPayment.created_at.desc())
                .limit(5)
                .all()
            )
        ]
        self.database.rollback()
        for payment_id in candidates:
            if self.reconcile(user, payment_id)["status"] == "ACTIVATED":
                return {"status": "ACTIVATED"}
        return {"status": "NOT_PAID"}

    def _revoke(self, payment: SubscriptionPayment, reason: str) -> None:
        period = self._period_for(payment)
        if period is not None and period.status == PERIOD_ACTIVE:
            period.status = PERIOD_REVOKED
            period.revoked_at = naive_utc_now()
            period.revoked_reason = reason

    def _apply_refund(self, payment: SubscriptionPayment, refunded_paise: int) -> str:
        if payment.status not in (PAYMENT_PAID, PAYMENT_DISPUTED):
            return "refund_ignored"
        if refunded_paise < payment.amount_paise:
            logger.warning(
                "subscription.partial_refund order=%s refunded=%s of %s",
                payment.razorpay_order_id,
                refunded_paise,
                payment.amount_paise,
            )
            return "partial_refund_recorded"
        payment.status = PAYMENT_REFUNDED
        payment.refunded_at = naive_utc_now()
        self._revoke(payment, "REFUNDED")
        return "refunded"

    # ------------------------------------------------------------ webhook

    def handle_webhook_event(self, event_id: str, event: dict) -> str:
        """A signature-verified Razorpay event, processed at most once per event id."""
        name = str(event.get("event") or "")
        try:
            self.database.add(PaymentWebhookEvent(event_id=event_id[:80], event_type=name[:60], outcome="processing"))
            self.database.flush()
        except IntegrityError:
            self.database.rollback()
            return "duplicate_event"
        outcome = self._dispatch(name, event.get("payload") or {})
        record = self.database.query(PaymentWebhookEvent).filter(PaymentWebhookEvent.event_id == event_id[:80]).first()
        if record is not None:
            record.outcome = outcome[:40]
        self.database.commit()
        return outcome

    def _dispatch(self, name: str, payload: dict) -> str:
        payment_entity = (payload.get("payment") or {}).get("entity") or {}
        if name in ("payment.captured", "order.paid", "payment.failed"):
            order_id, payment_id = payment_entity.get("order_id"), payment_entity.get("id")
            if not order_id or not payment_id:
                return "ignored"
            payment = self._lock_payment_by_order(order_id)
            if payment is None:
                return "unknown_order"  # e.g. a technician-booking order
            if name == "payment.failed":
                if payment.status in (PAYMENT_CREATED, PAYMENT_FAILED):
                    payment.status = PAYMENT_FAILED
                    payment.failure_code = (payment_entity.get("error_code") or "PAYMENT_FAILED")[:64]
                    payment.failure_description = (payment_entity.get("error_description") or "Payment failed.")[:255]
                    coupons.release(self.database, payment)
                    return "failure_recorded"
                return "failure_ignored"
            if payment.status != PAYMENT_CREATED and payment.status != PAYMENT_FAILED:
                return "duplicate"
            if (
                int(payment_entity.get("amount") or 0) != payment.amount_paise
                or payment_entity.get("currency") != payment.currency
                or payment_entity.get("status") != "captured"
            ):
                logger.warning("subscription.webhook_mismatch order=%s payment=%s", order_id, payment_id)
                return "mismatch"
            gateway_payment = RazorpayPayment(
                id=payment_id,
                order_id=order_id,
                amount_paise=payment.amount_paise,
                currency=payment.currency,
                status="captured",
                method=payment_entity.get("method"),
            )
            self._activate(payment, gateway_payment, signature_verified=False)
            return "activated"

        if name in ("payment.refunded", "refund.processed"):
            refund_entity = (payload.get("refund") or {}).get("entity") or {}
            payment_id = payment_entity.get("id") or refund_entity.get("payment_id")
            payment = self._payment_by_razorpay_payment(payment_id)
            if payment is None:
                return "unknown_payment"
            refunded = int(payment_entity.get("amount_refunded") or refund_entity.get("amount") or 0)
            return self._apply_refund(payment, refunded)

        if name.startswith("payment.dispute."):
            dispute_entity = (payload.get("dispute") or {}).get("entity") or {}
            payment = self._payment_by_razorpay_payment(dispute_entity.get("payment_id") or payment_entity.get("id"))
            if payment is None:
                return "unknown_payment"
            if name == "payment.dispute.created":
                if payment.status == PAYMENT_PAID:
                    payment.status = PAYMENT_DISPUTED
                    payment.disputed_at = naive_utc_now()
                    logger.warning(
                        "subscription.dispute_opened order=%s builder=%s", payment.razorpay_order_id, payment.builder_id
                    )
                    return "dispute_opened"
                return "dispute_ignored"
            if name == "payment.dispute.won" and payment.status == PAYMENT_DISPUTED:
                payment.status = PAYMENT_PAID
                return "dispute_won"
            if name == "payment.dispute.lost" and payment.status in (PAYMENT_DISPUTED, PAYMENT_PAID):
                payment.status = PAYMENT_REFUNDED
                payment.refunded_at = naive_utc_now()
                self._revoke(payment, "DISPUTE_LOST")
                return "dispute_lost"
            return "dispute_ignored"
        return "ignored"

    def _payment_by_razorpay_payment(self, razorpay_payment_id: str | None) -> SubscriptionPayment | None:
        if not razorpay_payment_id:
            return None
        return (
            self.database.query(SubscriptionPayment)
            .filter(SubscriptionPayment.razorpay_payment_id == razorpay_payment_id)
            .with_for_update()
            .first()
        )

    # --------------------------------------------------------------- mock

    def mock_checkout(self, user: User, payment_id: uuid.UUID, succeed: bool) -> dict:
        """Stand-in for Razorpay Checkout while no TEST keys are set (RAZORPAY_ALLOW_MOCK). Refused otherwise."""
        if self.client.mode != MOCK_MODE:
            raise payment_error(
                403, MOCK_DISABLED, "The simulated checkout is only available without Razorpay test keys."
            )
        entitlements.require_builder(user)
        payment = self._owned_payment(user, payment_id)
        gateway_payment, signature = self.client.simulate_checkout(
            payment.razorpay_order_id,
            payment.amount_paise,
            payment.currency,
            succeed,
        )
        self.database.commit()
        return {
            "razorpay_order_id": payment.razorpay_order_id,
            "razorpay_payment_id": gateway_payment.id,
            "razorpay_signature": signature,
            "outcome": "success" if succeed else "failure",
            "error_code": gateway_payment.error_code,
            "error_description": gateway_payment.error_description,
        }
