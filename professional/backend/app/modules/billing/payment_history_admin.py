"""Administrator view of builder subscription payments -- read-only.

    GET /admin/subscription-payments           subscriptions.view   paginated payment history
    GET /admin/subscription-payments/summary   subscriptions.view   collections, counts, monthly totals

Everything here is read from the records the checkout already writes; nothing is
written, and nothing in the checkout, verification, webhook or coupon code changes:

  * subscription_payments            one Razorpay order and what became of it
  * subscription_coupon_redemptions  the coupon priced into that order (original, discount, final)
  * builder_subscriptions            the period a verified payment bought (one per payment)

Money rules:
  * A payment counts as collected only when it has `paid_at`, which the service
    writes solely after the backend verified it (Checkout signature, a payment
    fetched from Razorpay, or a signed webhook). An order that was only created,
    failed, or was closed without paying (still CREATED) is never revenue.
  * Refunds are the payments now REFUNDED: a full refund, or a lost dispute (the
    period's revoked_reason says which). Partial refunds are not stored by the
    payment service, so they cannot be reported. Net = gross - refunds.
  * MOCK payments (the local demo checkout, no Razorpay) are listed but left out
    of every summary figure; the summary reports how many there are.

Country: a payment belongs to the country of its currency (INR -> IN),
which is fixed when the order is priced; the builder's current residence is shown
beside it but can change later. Who sees which country is decided by the signed-in
administrator (scope.viewing): a location administrator's ?country= is ignored.

Months are India Standard Time calendar months (plans are sold in India only); the
stored timestamps are naive UTC.
"""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, false, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.session import get_db as get_database
from app.database.types import naive_utc_now
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.dependencies import require_admin
from app.modules.admin.scope import viewing
from app.modules.billing import plans as catalogue
from app.modules.billing.models import (
    COUPON_CURRENCY,
    PAYMENT_CREATED,
    PAYMENT_DISPUTED,
    PAYMENT_FAILED,
    PAYMENT_PAID,
    PAYMENT_REFUNDED,
    PERIOD_ACTIVE,
    BuilderSubscription,
    SubscriptionCoupon,
    SubscriptionCouponRedemption,
    SubscriptionPayment,
)
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/subscription-payments", tags=["Admin: builder subscription payments"])

PAYMENT_STATUSES = (PAYMENT_CREATED, PAYMENT_PAID, PAYMENT_FAILED, PAYMENT_REFUNDED, PAYMENT_DISPUTED)
COUNTRY_OF_CURRENCY = {currency: country for country, currency in COUPON_CURRENCY.items()}
MOCK_MODE = "mock"
IST = timedelta(hours=5, minutes=30)
MAX_PAGE = 200


def _iso(value: datetime | None) -> str | None:
    return local_iso(value)


def _month_start_utc(year: int, month: int) -> datetime:
    """The first instant of an IST calendar month, as the naive UTC the rows store."""
    return datetime(year, month, 1) - IST


def _month_bounds(year: int, month: int | None) -> tuple[datetime, datetime]:
    if month is None:
        return _month_start_utc(year, 1), _month_start_utc(year + 1, 1)
    following = (year + 1, 1) if month == 12 else (year, month + 1)
    return _month_start_utc(year, month), _month_start_utc(*following)


def _ist_year_now() -> int:
    return (naive_utc_now() + IST).year


def _checked_filters(
    year: int | None, month: int | None, plan: str | None, status: str | None
) -> tuple[str | None, str | None]:
    if month is not None and year is None:
        raise HTTPException(status_code=400, detail="Choose a year to filter by month.")
    plan = (plan or "").strip().upper() or None
    if plan is not None and not catalogue.is_paid_plan(plan):
        raise HTTPException(status_code=400, detail="Unknown plan.")
    status = (status or "").strip().upper() or None
    if status is not None and status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown payment status.")
    return plan, status


def _scoped(query, admin: AdminIdentity, country: str | None):
    """Only the payments of the countries this administrator may see."""
    view = viewing(admin, country)
    if view.is_global:
        return query, "GLOBAL"
    currency = COUPON_CURRENCY.get(view.scope)
    if currency is None:
        return query.filter(false()), view.scope  # an unrecognised scope reaches nothing
    return query.filter(SubscriptionPayment.currency == currency), view.scope


# When a payment happened: when it was paid, otherwise when its order was created.
ACTIVITY_AT = func.coalesce(SubscriptionPayment.paid_at, SubscriptionPayment.created_at)


def _filtered(query, year, month, plan, status, email):
    if year is not None:
        start, end = _month_bounds(year, month)
        query = query.filter(start <= ACTIVITY_AT, end > ACTIVITY_AT)
    if plan:
        query = query.filter(SubscriptionPayment.plan_code == plan)
    if status:
        query = query.filter(SubscriptionPayment.status == status)
    email = (email or "").strip().lower()
    if email:
        query = query.filter(func.lower(User.email).contains(email, autoescape=True))
    return query


def _unavailable(error: SQLAlchemyError):
    logger.exception("admin.subscription_payments.query_failed: %s", error)
    return HTTPException(status_code=503, detail="Subscription payments could not be loaded. Please try again.")


def _row(
    payment: SubscriptionPayment,
    builder: User,
    redemption,
    coupon_code,
    period: BuilderSubscription | None,
    now: datetime,
) -> dict:
    refunded = payment.status == PAYMENT_REFUNDED
    return {
        "id": str(payment.id),
        "builder": {
            "id": str(builder.id),
            "name": builder.name,
            "email": builder.email,
            "country": "India",
        },
        "payment_country": COUNTRY_OF_CURRENCY.get(payment.currency),
        "plan_code": payment.plan_code,
        "duration_code": payment.duration_code,
        "currency": payment.currency,
        # The order's own amount is the price after any coupon; the redemption keeps
        # the price before it. Without a coupon the two are the same figure.
        "original_amount_minor": int(redemption.original_amount_minor) if redemption else int(payment.amount_paise),
        "discount_minor": int(redemption.discount_minor) if redemption else 0,
        "amount_minor": int(payment.amount_paise),
        "coupon_code": coupon_code,
        "coupon_status": redemption.status if redemption else None,
        "status": payment.status,
        "gateway_mode": payment.gateway_mode,
        "created_at": _iso(payment.created_at),
        "paid_at": _iso(payment.paid_at),
        "razorpay_order_id": payment.razorpay_order_id,
        "razorpay_payment_id": payment.razorpay_payment_id,
        "failure_code": payment.failure_code,
        "failure_description": payment.failure_description,
        # Only full refunds and lost disputes are stored; both refund the whole amount.
        "refunded": refunded,
        "refund_amount_minor": int(payment.amount_paise) if refunded else None,
        "refunded_at": _iso(payment.refunded_at),
        "period": None
        if period is None
        else {
            "status": period.status,
            "start": _iso(period.subscription_start),
            "end": _iso(period.subscription_end),
            "revoked_reason": period.revoked_reason,
            "in_force": period.status == PERIOD_ACTIVE and period.subscription_start <= now < period.subscription_end,
        },
    }


@router.get("")
def list_subscription_payments(
    country: str | None = Query(default=None, max_length=20),
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    plan: str | None = Query(default=None, max_length=20),
    status: str | None = Query(default=None, max_length=12),
    email: str | None = Query(default=None, max_length=255),
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
    admin: AdminIdentity = Depends(require_admin("subscriptions.view")),
    database: Session = Depends(get_database),
):
    plan, status = _checked_filters(year, month, plan, status)
    try:
        # One row per payment: every join is to a table holding at most one row per payment.
        query = (
            database.query(
                SubscriptionPayment, User, SubscriptionCouponRedemption, SubscriptionCoupon.code, BuilderSubscription
            )
            .join(User, User.id == SubscriptionPayment.builder_id)
            .outerjoin(SubscriptionCouponRedemption, SubscriptionCouponRedemption.payment_id == SubscriptionPayment.id)
            .outerjoin(SubscriptionCoupon, SubscriptionCoupon.id == SubscriptionCouponRedemption.coupon_id)
            .outerjoin(BuilderSubscription, BuilderSubscription.payment_id == SubscriptionPayment.id)
        )
        query, scope = _scoped(query, admin, country)
        query = _filtered(query, year, month, plan, status, email)
        total = query.order_by(None).count()
        rows = query.order_by(ACTIVITY_AT.desc(), SubscriptionPayment.id.desc()).offset(offset).limit(limit).all()
    except SQLAlchemyError as error:
        raise _unavailable(error)
    now = naive_utc_now()
    return {
        "payments": [_row(*row, now) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "scope": scope,
    }


def _money_and_counts(query) -> dict:
    """Collections and status counts of the (already filtered, non-mock) payments."""
    collected = SubscriptionPayment.paid_at.isnot(None)
    refunded = SubscriptionPayment.status == PAYMENT_REFUNDED
    by_status = lambda value: func.coalesce(func.sum(case((SubscriptionPayment.status == value, 1), else_=0)), 0)  # noqa: E731
    row = query.with_entities(
        func.count(SubscriptionPayment.id),
        func.coalesce(func.sum(case((collected, 1), else_=0)), 0),
        func.coalesce(func.sum(case((collected, SubscriptionPayment.amount_paise), else_=0)), 0),
        func.coalesce(func.sum(case((and_(collected, refunded), 1), else_=0)), 0),
        func.coalesce(func.sum(case((and_(collected, refunded), SubscriptionPayment.amount_paise), else_=0)), 0),
        by_status(PAYMENT_FAILED),
        by_status(PAYMENT_CREATED),
        by_status(PAYMENT_DISPUTED),
    ).one()
    total, paid_count, gross, refund_count, refunds, failed, pending, disputed = (int(value or 0) for value in row)
    return {
        "payment_count": total,
        "successful_count": paid_count,  # verified by the backend, whatever happened after
        "failed_count": failed,
        "pending_count": pending,  # order created, never paid (includes closed checkouts)
        "refunded_count": refund_count,
        "disputed_count": disputed,
        "gross_minor": gross,
        "refunds_minor": refunds,
        "net_minor": gross - refunds,
    }


@router.get("/summary")
def subscription_payment_summary(
    country: str | None = Query(default=None, max_length=20),
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    plan: str | None = Query(default=None, max_length=20),
    status: str | None = Query(default=None, max_length=12),
    email: str | None = Query(default=None, max_length=255),
    admin: AdminIdentity = Depends(require_admin("subscriptions.view")),
    database: Session = Depends(get_database),
):
    plan, status = _checked_filters(year, month, plan, status)
    breakdown_year = year or _ist_year_now()
    try:
        base = database.query(SubscriptionPayment).join(User, User.id == SubscriptionPayment.builder_id)
        base, scope = _scoped(base, admin, country)
        real = base.filter(SubscriptionPayment.gateway_mode != MOCK_MODE)

        totals = _money_and_counts(_filtered(real, year, month, plan, status, email))
        mock_count = (
            _filtered(base, year, month, plan, status, email)
            .filter(SubscriptionPayment.gateway_mode == MOCK_MODE)
            .order_by(None)
            .count()
        )

        # Every month of the year in one grouped query. Collections fall in the month
        # they were paid; unpaid orders in the month they were created (ACTIVITY_AT).
        month_index = case(
            *[
                (
                    and_(
                        _month_start_utc(breakdown_year, number) <= ACTIVITY_AT,
                        _month_bounds(breakdown_year, number)[1] > ACTIVITY_AT,
                    ),
                    number,
                )
                for number in range(1, 13)
            ],
            else_=0,
        ).label("month")
        collected = SubscriptionPayment.paid_at.isnot(None)
        refunded = and_(collected, SubscriptionPayment.status == PAYMENT_REFUNDED)
        year_start, year_end = _month_bounds(breakdown_year, None)
        monthly_rows = (
            _filtered(real, None, None, plan, status, email)
            .filter(year_start <= ACTIVITY_AT, year_end > ACTIVITY_AT)
            .with_entities(
                month_index,
                func.count(SubscriptionPayment.id),
                func.coalesce(func.sum(case((collected, 1), else_=0)), 0),
                func.coalesce(func.sum(case((collected, SubscriptionPayment.amount_paise), else_=0)), 0),
                func.coalesce(func.sum(case((refunded, SubscriptionPayment.amount_paise), else_=0)), 0),
                func.coalesce(func.sum(case((SubscriptionPayment.status == PAYMENT_FAILED, 1), else_=0)), 0),
                func.coalesce(func.sum(case((SubscriptionPayment.status == PAYMENT_CREATED, 1), else_=0)), 0),
            )
            .group_by(month_index)
            .order_by(None)
            .all()
        )

        # Subscriptions in force right now: a different question from payment history.
        now = naive_utc_now()
        active = (
            database.query(func.count(func.distinct(BuilderSubscription.builder_id)))
            .join(SubscriptionPayment, SubscriptionPayment.id == BuilderSubscription.payment_id)
            .join(User, User.id == BuilderSubscription.builder_id)
            .filter(
                BuilderSubscription.status == PERIOD_ACTIVE,
                BuilderSubscription.subscription_start <= now,
                BuilderSubscription.subscription_end > now,
                SubscriptionPayment.gateway_mode != MOCK_MODE,
            )
        )
        active, _ = _scoped(active, admin, country)
        if plan:
            active = active.filter(BuilderSubscription.plan_code == plan)
        active_count = int(active.scalar() or 0)
    except SQLAlchemyError as error:
        raise _unavailable(error)

    months = {
        number: {
            "month": number,
            "payment_count": 0,
            "successful_count": 0,
            "gross_minor": 0,
            "refunds_minor": 0,
            "net_minor": 0,
            "failed_count": 0,
            "pending_count": 0,
        }
        for number in range(1, 13)
    }
    for number, count, paid_count, gross, refunds, failed, pending in monthly_rows:
        if number in months:
            months[number].update(
                payment_count=int(count),
                successful_count=int(paid_count),
                gross_minor=int(gross),
                refunds_minor=int(refunds),
                net_minor=int(gross) - int(refunds),
                failed_count=int(failed),
                pending_count=int(pending),
            )
    return {
        "scope": scope,
        "currency": COUPON_CURRENCY.get(scope, "INR") if scope != "GLOBAL" else "INR",
        "period": {"year": year, "month": month},
        "totals": totals,
        "mock_payment_count": mock_count,
        "active_subscription_count": active_count,
        "monthly": {"year": breakdown_year, "months": [months[number] for number in range(1, 13)]},
        "timezone": "Asia/Kolkata",
    }
