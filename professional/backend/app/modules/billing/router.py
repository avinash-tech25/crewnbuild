"""Builder subscription API, Razorpay TEST mode only (the old app/subscription/router.py;
same paths and answers; ids are UUIDs).

    GET  /subscriptions/plans                     tiers, durations, configured prices (public)
    GET  /subscriptions/badges                    PRO / PREMIUM marks of listed builders
    GET  /subscriptions/me                        the builder's plan, status, dates, history
    POST /subscriptions/orders                    {plan_code, duration_code} -> TEST order (price from the server)
    POST /subscriptions/verify                    Checkout's ids + signature -> verified -> plan active
    POST /subscriptions/failures                  Checkout reported a failure (recorded, never active)
    POST /subscriptions/mock/checkout             local demo only (RAZORPAY_ALLOW_MOCK, no keys)
    POST /subscriptions/orders/{id}/reconcile     recover an order paid while the browser was closed
    POST /subscriptions/reconcile                 the same for the builder's recent unpaid orders
    PATCH /subscriptions/signup-plan              paid sign-up: change the chosen plan (or go Free) before paying
    POST /subscriptions/coupons/validate          the server's price with a coupon
    POST /subscriptions/webhooks/razorpay         Razorpay's signed events (public; signature checked)

    GET  /builder/portfolio                       Professional+: portfolio dashboard
    GET  /builder/portfolio/export.csv            Business: consolidated CSV
    GET  /projects/{project_id}/summary.csv       Professional+: one project's CSV summary
    GET  /cost-tool/registers/{id}/builder-adjustments    the record's audit trail (builder / engineer)
    POST /cost-tool/registers/{id}/builder-adjustments    Professional+: a correction on a closed day

    /admin/coupons/*, /admin/subscription-payments/*      the administrator screens

The old router refused with 503 SUBSCRIPTIONS_NOT_SET_UP while its migrations were
missing; the tables are part of the schema now, so that check is gone.
"""

import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import current_user
from app.core.config import get_settings
from app.core.local_time import local_iso
from app.database.session import get_db
from app.database.types import naive_utc_now
from app.integrations.razorpay import PaymentClient, payment_client, payment_error, verify_webhook_signature
from app.integrations.razorpay import webhook_secret as razorpay_webhook_secret
from app.modules.billing import booking_payment_errors as payment_errors
from app.modules.billing import coupons, entitlements, lead_locations, signup_checkout
from app.modules.billing import plans as catalogue
from app.modules.billing.coupon_admin import router as coupon_admin_router
from app.modules.billing.models import BuilderSubscription, SubscriptionPayment, SubscriptionPlanPrice
from app.modules.billing.payment_history_admin import router as payment_history_admin_router
from app.modules.billing.premium_service import PremiumService
from app.modules.billing.schemas import (
    CostAdjustmentRequest,
    CouponValidateRequest,
    CreateSubscriptionOrderRequest,
    SignupPlanChangeRequest,
    SubscriptionFailureRequest,
    SubscriptionMockCheckoutRequest,
    VerifySubscriptionRequest,
)
from app.modules.billing.subscription_service import CURRENCY, SubscriptionService, region_supported
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Builder subscriptions (Razorpay TEST)"])
_unpriced_warned: list[bool] = []


def get_payment_client(request: Request) -> PaymentClient:
    """The Razorpay client, or 503 PAYMENT_GATEWAY_MISCONFIGURED naming why."""
    return payment_client(request.app.state.settings)


def get_subscription_service(
    database: Session = Depends(get_db), client: PaymentClient = Depends(get_payment_client)
) -> SubscriptionService:
    return SubscriptionService(database, client)


def get_premium_service(database: Session = Depends(get_db)) -> PremiumService:
    return PremiumService(database)


def _iso(value: datetime | None) -> str | None:
    return local_iso(value)


def _period_out(period: BuilderSubscription | None) -> dict[str, Any] | None:
    if period is None:
        return None
    return {
        "id": str(period.id),
        "plan_code": period.plan_code,
        "duration_code": period.duration_code,
        "status": period.status,
        "period_start": _iso(period.subscription_start),
        "period_end": _iso(period.subscription_end),
        "revoked_reason": period.revoked_reason,
    }


def subscription_status_payload(database: Session, user: User, state: entitlements.SubscriptionState) -> dict[str, Any]:
    history = (
        database.query(BuilderSubscription, SubscriptionPayment)
        .join(SubscriptionPayment, SubscriptionPayment.id == BuilderSubscription.payment_id)
        .filter(BuilderSubscription.builder_id == user.id)
        .order_by(BuilderSubscription.subscription_start.desc())
        .limit(24)
        .all()
    )
    plan = catalogue.plan_for(state.plan_code)
    usage = lead_locations.usage(database, user)
    return {
        "status": state.status,
        "plan_code": state.plan_code,
        "is_premium": state.is_premium,
        "badge": state.badge,
        "features": sorted(state.features),
        "current_period": _period_out(state.current),
        "coverage_end": _iso(state.coverage_end),
        "grace_until": _iso(state.grace_until),
        # End of the account's free first month (Professional features without the badge).
        "free_access_until": _iso(state.free_access_until),
        "queued_periods": [_period_out(period) for period in state.queued],
        # The tier's location and lead limits, and (for an India builder, where they are
        # enforced) the locations and open leads per pincode in use.
        "limits_configured": plan.limits,
        "limits_enforced": usage is not None,
        "usage": usage,
        "region_supported": region_supported(user),
        "can_change_plan": state.status not in (entitlements.STATUS_ACTIVE, entitlements.STATUS_GRACE),
        "history": [
            {
                **(_period_out(period) or {}),
                "amount_paise": payment.amount_paise,
                "currency": payment.currency,
                "payment_status": payment.status,
                "paid_at": _iso(payment.paid_at),
                "gateway_mode": payment.gateway_mode,
            }
            for period, payment in history
        ],
        "server_time": _iso(naive_utc_now()),
    }


# ---- plans ----


@router.get("/subscriptions/plans")
def list_subscription_plans(database: Session = Depends(get_db)) -> dict[str, Any]:
    prices = (
        database.query(SubscriptionPlanPrice)
        .filter(SubscriptionPlanPrice.is_active.is_(True), SubscriptionPlanPrice.currency == CURRENCY)
        .all()
    )
    price_map = {(price.plan_code, price.duration_code): int(price.amount_paise) for price in prices}
    unpriced = [
        f"{plan}/{duration}"
        for plan in catalogue.PAID_PLANS
        for duration in catalogue.OFFERED_DURATIONS
        if (plan, duration) not in price_map
    ]
    if unpriced and not _unpriced_warned:
        # Once per process: a paid plan with no price shows "Price not set" and cannot be
        # bought, which must never go unnoticed by whoever runs this.
        logger.warning(
            "subscription.prices_missing %s -- run python -m app.seeds.seed_subscription_plan_prices",
            ", ".join(unpriced),
        )
        _unpriced_warned.append(True)
    return {
        "currency": CURRENCY,
        "durations": [
            {"code": code, "months": catalogue.DURATION_MONTHS[code]} for code in catalogue.OFFERED_DURATIONS
        ],
        "grace_days": get_settings().subscription_grace_days,
        "unpriced": unpriced,
        "test_mode": True,
        "plans": [
            {
                "code": plan.code,
                "rank": plan.rank,
                "purchasable": plan.purchasable,
                "features": sorted(plan.features),
                "badge": catalogue.PLAN_BADGES.get(plan.code),
                "limits": plan.limits,  # max_locations / max_leads_per_location, None = unlimited
                "prices": {duration: price_map.get((plan.code, duration)) for duration in catalogue.OFFERED_DURATIONS}
                if plan.purchasable
                else {},
            }
            for plan in sorted(catalogue.PLANS.values(), key=lambda item: item.rank)
        ],
    }


MAX_BADGE_LOOKUP = 50


@router.get("/subscriptions/badges")
def read_builder_badges(
    builder_ids: str = Query(default="", max_length=MAX_BADGE_LOOKUP * 37),
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    """The PRO / PREMIUM mark of listed builders, for profile cards any signed-in user sees.
    Only the mark of a plan currently in force is returned (never a plan name, price, date
    or payment), and only for builder accounts; others are simply absent."""
    wanted = []
    for raw in builder_ids.split(","):
        try:
            wanted.append(uuid.UUID(raw.strip()))
        except ValueError:
            continue
    wanted = list(dict.fromkeys(wanted))[:MAX_BADGE_LOOKUP]
    if not wanted:
        return {"badges": {}}
    builders = database.query(User.id).filter(User.id.in_(wanted), User.role == entitlements.BUILDER_ROLE).all()
    badges = {}
    for (builder_id,) in builders:
        badge = entitlements.subscription_state(database, builder_id).badge
        if badge:
            badges[str(builder_id)] = badge
    return {"badges": badges}


@router.get("/subscriptions/me")
def read_my_subscription(user: User = Depends(current_user), database: Session = Depends(get_db)) -> dict[str, Any]:
    entitlements.require_builder(user)
    state = entitlements.sync_lifecycle(database, user)
    return subscription_status_payload(database, user, state)


# ---- purchase ----


@router.post("/subscriptions/orders")
def create_subscription_order(
    payload: CreateSubscriptionOrderRequest,
    user: User = Depends(current_user),
    service: SubscriptionService = Depends(get_subscription_service),
) -> dict[str, Any]:
    return service.create_order(user, payload.plan_code, payload.duration_code, payload.coupon_code)


@router.post("/subscriptions/reconcile")
def reconcile_recent_subscription_orders(
    user: User = Depends(current_user), service: SubscriptionService = Depends(get_subscription_service)
) -> dict[str, Any]:
    """Recover a payment made while the browser was closed, from any device."""
    result = service.reconcile_recent(user)
    if result["status"] == "ACTIVATED":
        state = entitlements.subscription_state(service.database, user.id)
        result["subscription"] = subscription_status_payload(service.database, user, state)
    return result


@router.post("/subscriptions/orders/{payment_id}/reconcile")
def reconcile_subscription_order(
    payment_id: uuid.UUID,
    user: User = Depends(current_user),
    service: SubscriptionService = Depends(get_subscription_service),
) -> dict[str, Any]:
    result = service.reconcile(user, payment_id)
    if result["status"] == "ACTIVATED":
        state = entitlements.subscription_state(service.database, user.id)
        result["subscription"] = subscription_status_payload(service.database, user, state)
    return result


@router.patch("/subscriptions/signup-plan")
def change_signup_plan(
    payload: SignupPlanChangeRequest, user: User = Depends(current_user), database: Session = Depends(get_db)
) -> dict[str, Any]:
    """The paid plan chosen at sign-up, before it is paid for: switch offers or go Free."""
    entitlements.require_builder(user)
    return {
        "subscription_checkout": signup_checkout.change_signup_plan(
            database, user, payload.plan_code, payload.duration_code
        )
    }


@router.post("/subscriptions/coupons/validate")
def validate_subscription_coupon(
    payload: CouponValidateRequest, user: User = Depends(current_user), database: Session = Depends(get_db)
) -> dict[str, Any]:
    """The server's price with this coupon: original, discount and the amount payable, for
    the plan named or for every plan it applies to (`quotes`; the first one is also
    returned at the top level). Nothing is reserved; the order re-checks everything."""
    entitlements.require_builder(user)
    if not region_supported(user):
        raise payment_error(
            403, "SUBSCRIPTION_REGION_NOT_SUPPORTED", "Builder plans are not yet available in your region."
        )
    if payload.plan_code:
        priced = [
            coupons.quote(
                database, user, payload.code, payload.plan_code.upper(), (payload.duration_code or "").upper()
            )
        ]
    else:
        priced = coupons.quotes(database, user, payload.code)
    return {**priced[0].payload(), "quotes": [item.payload() for item in priced]}


@router.post("/subscriptions/verify")
def verify_subscription_payment(
    payload: VerifySubscriptionRequest,
    user: User = Depends(current_user),
    service: SubscriptionService = Depends(get_subscription_service),
) -> dict[str, Any]:
    service.verify(
        user,
        payload.subscription_payment_id,
        payload.razorpay_order_id,
        payload.razorpay_payment_id,
        payload.razorpay_signature,
    )
    state = entitlements.subscription_state(service.database, user.id)
    return {"status": "ACTIVATED", "subscription": subscription_status_payload(service.database, user, state)}


@router.post("/subscriptions/failures")
def report_subscription_failure(
    payload: SubscriptionFailureRequest,
    user: User = Depends(current_user),
    service: SubscriptionService = Depends(get_subscription_service),
) -> dict[str, Any]:
    return service.report_failure(
        user, payload.subscription_payment_id, payload.razorpay_payment_id, payload.code, payload.description
    )


@router.post("/subscriptions/mock/checkout")
def subscription_mock_checkout(
    payload: SubscriptionMockCheckoutRequest,
    user: User = Depends(current_user),
    service: SubscriptionService = Depends(get_subscription_service),
) -> dict[str, Any]:
    return service.mock_checkout(user, payload.subscription_payment_id, payload.outcome == "success")


@router.post("/subscriptions/webhooks/razorpay")
async def subscription_razorpay_webhook(request: Request, database: Session = Depends(get_db)) -> dict[str, Any]:
    """Configure this URL as a separate webhook in the Razorpay dashboard (same webhook
    secret). Razorpay cannot reach localhost: it needs a public HTTPS URL."""
    secret = razorpay_webhook_secret(request.app.state.settings)
    if not secret:
        raise payment_error(503, payment_errors.WEBHOOK_NOT_CONFIGURED, "Webhook secret not configured.")
    raw_body = await request.body()
    if not verify_webhook_signature(secret, raw_body, request.headers.get("X-Razorpay-Signature")):
        logger.warning("subscription.webhook_signature_invalid")
        raise payment_error(400, payment_errors.WEBHOOK_SIGNATURE_INVALID, "Invalid webhook signature.")
    try:
        event = json.loads(raw_body)
    except ValueError:
        raise payment_error(400, payment_errors.WEBHOOK_SIGNATURE_INVALID, "Invalid webhook body.") from None
    # Razorpay's own event id when sent; otherwise the body's hash (a redelivery is byte-identical).
    event_id = request.headers.get("X-Razorpay-Event-Id") or f"sha256:{hashlib.sha256(raw_body).hexdigest()}"
    # Webhook handling never calls Razorpay, so it needs no gateway client.
    service = SubscriptionService(database, client=None)
    outcome = await run_in_threadpool(service.handle_webhook_event, event_id, event)
    logger.info("subscription.webhook event=%s outcome=%s", event.get("event"), outcome)
    return {"status": "ok", "outcome": outcome}


# ---- premium features ----


@router.get("/builder/portfolio")
def read_builder_portfolio(
    user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> dict[str, Any]:
    return service.portfolio(user)


def _csv_response(filename: str, body: str) -> Response:
    return Response(
        content=body.encode("utf-8-sig"),  # BOM: Excel opens UTF-8 names correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/builder/portfolio/export.csv")
def export_builder_portfolio(
    user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> Response:
    return _csv_response(*service.portfolio_csv(user))


@router.get("/projects/{project_id}/summary.csv")
def export_project_summary(
    project_id: uuid.UUID, user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> Response:
    return _csv_response(*service.project_summary_csv(user, project_id))


@router.get("/cost-tool/registers/{register_id}/builder-adjustments")
def list_cost_adjustments(
    register_id: uuid.UUID, user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> dict[str, Any]:
    return service.list_adjustments(user, register_id)


@router.post("/cost-tool/registers/{register_id}/builder-adjustments")
def create_cost_adjustment(
    register_id: uuid.UUID,
    payload: CostAdjustmentRequest,
    user: User = Depends(current_user),
    service: PremiumService = Depends(get_premium_service),
) -> dict[str, Any]:
    return service.create_adjustment(user, register_id, payload.field_name, payload.adjusted_value, payload.reason)


# Administrator coupon management (/admin/coupons) and payment history
# (/admin/subscription-payments, read-only).
router.include_router(coupon_admin_router)
router.include_router(payment_history_admin_router)
