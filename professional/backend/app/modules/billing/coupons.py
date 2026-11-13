"""Builder subscription coupons: validation, the discounted price, and redemption accounting.

Everything here runs on the server. The client sends a coupon CODE (and, for an
order, the plan and billing period it is buying); the discount and the amount
charged are computed from subscription_coupons and subscription_plan_prices and
never taken from the request.

A coupon is refused when it is unknown, inactive, not started, expired, for another
country, for another plan or billing period, used up (in total or by this builder),
for a currency checkout does not take, or would leave less than the minimum payable
amount (so a payable amount is never zero or negative).

Usage limits count REDEEMED redemptions (verified payments) plus RESERVED ones still
inside their hold window (orders being paid right now), so concurrent checkouts
cannot exceed a limit: the coupon row is locked while an order is reserved against
it. A failed, cancelled or unverified payment never becomes a completed redemption.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.types import naive_utc_now
from app.integrations.razorpay import payment_error
from app.modules.billing import plans as catalogue
from app.modules.billing.entitlements import is_india_account
from app.modules.billing.models import (
    COUPON_CURRENCY,
    REDEMPTION_REDEEMED,
    REDEMPTION_RELEASED,
    REDEMPTION_RESERVED,
    SubscriptionCoupon,
    SubscriptionCouponRedemption,
    SubscriptionPayment,
    SubscriptionPlanPrice,
)
from app.modules.identity.models import User

# Minor units per currency: paise for INR.
CURRENCY_EXPONENT = {"INR": 2}
# The smallest amount a coupon may leave payable (Razorpay's minimum order is Rs 1).
MIN_PAYABLE_MINOR = {"INR": 100}
# Coupon dates are calendar days in the coupon's own country.
COUNTRY_UTC_OFFSET_MINUTES = {"IN": 330}
# How long an unpaid order holds its coupon against the limits.
RESERVATION_MINUTES = 30
# The largest amount accepted, in major units (the column is bigint minor units).
MAX_MAJOR_AMOUNT = Decimal("10000000000000")
CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,39}$")

# Error codes, in the payment module's {"code", "message"} shape.
COUPON_INVALID = "COUPON_INVALID"
COUPON_INACTIVE = "COUPON_INACTIVE"
COUPON_NOT_STARTED = "COUPON_NOT_STARTED"
COUPON_EXPIRED = "COUPON_EXPIRED"
COUPON_WRONG_COUNTRY = "COUPON_WRONG_COUNTRY"
COUPON_NOT_FOR_PLAN = "COUPON_NOT_FOR_PLAN"
COUPON_EXHAUSTED = "COUPON_EXHAUSTED"
COUPON_BUILDER_LIMIT = "COUPON_BUILDER_LIMIT"
COUPON_DISCOUNT_TOO_LARGE = "COUPON_DISCOUNT_TOO_LARGE"
COUPON_CHECKOUT_UNAVAILABLE = "COUPON_CHECKOUT_UNAVAILABLE"


def normalize_code(raw: str | None) -> str:
    """Upper case, surrounding and inner spaces removed: " save 500 " -> "SAVE500"."""
    return re.sub(r"\s+", "", (raw or "")).upper()


def valid_code(code: str) -> bool:
    return bool(CODE_PATTERN.match(code))


def to_minor(amount, currency: str) -> int:
    """A major-unit amount ("500", "1.250") in minor units, refusing extra precision."""
    exponent = CURRENCY_EXPONENT[currency]
    try:
        value = Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Enter a valid amount.") from None
    # Crash fixed: NaN, Infinity or an amount past the bigint column was a 500.
    if not value.is_finite() or abs(value) > MAX_MAJOR_AMOUNT:
        raise ValueError("Enter a valid amount.")
    minor = value * (Decimal(10) ** exponent)
    if minor != minor.to_integral_value(rounding=ROUND_DOWN):
        raise ValueError(f"{currency} amounts have at most {exponent} decimal places.")
    return int(minor)


def from_minor(minor: int, currency: str) -> str:
    exponent = CURRENCY_EXPONENT[currency]
    return f"{Decimal(minor) / (Decimal(10) ** exponent):.{exponent}f}"


def country_today(country: str, now: datetime | None = None) -> date:
    now = now or naive_utc_now()
    return (now.replace(tzinfo=UTC) + timedelta(minutes=COUNTRY_UTC_OFFSET_MINUTES[country])).date()


def plan_price(database: Session, plan_code: str, duration_code: str, currency: str) -> int | None:
    row = (
        database.query(SubscriptionPlanPrice)
        .filter(
            SubscriptionPlanPrice.plan_code == plan_code,
            SubscriptionPlanPrice.duration_code == duration_code,
            SubscriptionPlanPrice.currency == currency,
            SubscriptionPlanPrice.is_active.is_(True),
        )
        .first()
    )
    return int(row.amount_paise) if row else None


def usage(
    database: Session, coupon_id: uuid.UUID, builder_id=None, now: datetime | None = None, exclude_payment_id=None
) -> tuple[int, int]:
    """(completed, in_progress) redemptions of a coupon, optionally for one builder."""
    now = now or naive_utc_now()
    query = database.query(SubscriptionCouponRedemption).filter(SubscriptionCouponRedemption.coupon_id == coupon_id)
    if builder_id is not None:
        query = query.filter(SubscriptionCouponRedemption.builder_id == builder_id)
    if exclude_payment_id is not None:
        query = query.filter(SubscriptionCouponRedemption.payment_id != exclude_payment_id)
    completed = (
        query.filter(SubscriptionCouponRedemption.status == REDEMPTION_REDEEMED).with_entities(func.count()).scalar()
    )
    held = (
        query.filter(
            SubscriptionCouponRedemption.status == REDEMPTION_RESERVED,
            SubscriptionCouponRedemption.reserved_until > now,
        )
        .with_entities(func.count())
        .scalar()
    )
    return int(completed or 0), int(held or 0)


@dataclass
class CouponQuote:
    coupon: SubscriptionCoupon
    plan_code: str
    duration_code: str
    currency: str
    original_minor: int
    discount_minor: int
    final_minor: int

    def payload(self) -> dict:
        return {
            "code": self.coupon.code,
            "plan_code": self.plan_code,
            "duration_code": self.duration_code,
            "currency": self.currency,
            "original_amount_paise": self.original_minor,
            "discount_paise": self.discount_minor,
            "final_amount_paise": self.final_minor,
        }


def _refuse(status: int, code: str, message: str, **extra):
    raise payment_error(status, code, message, **extra)


def eligible_plans(coupon: SubscriptionCoupon) -> list[tuple[str, str]]:
    """The (plan, billing period) pairs a coupon discounts: the one it names, or --
    no plan named -- every offered paid plan and period."""
    if coupon.plan_code is None:
        return [(plan, duration) for plan in catalogue.PAID_PLANS for duration in catalogue.OFFERED_DURATIONS]
    return [(coupon.plan_code, coupon.duration_code)]


def _usable_coupon(database: Session, builder: User, raw_code: str, lock: bool, now: datetime) -> SubscriptionCoupon:
    code = normalize_code(raw_code)
    query = database.query(SubscriptionCoupon).filter(SubscriptionCoupon.code == code)
    coupon = (query.with_for_update() if lock else query).first() if valid_code(code) else None
    if coupon is None:
        _refuse(404, COUPON_INVALID, "This coupon code is not valid.")
    if not coupon.is_active:
        _refuse(409, COUPON_INACTIVE, "This coupon is not active.")
    builder_country = "IN" if is_india_account(builder) else ""
    if coupon.country != builder_country:
        _refuse(409, COUPON_WRONG_COUNTRY, "This coupon is not valid in your country.")
    today = country_today(coupon.country, now)
    if today < coupon.starts_on:
        _refuse(409, COUPON_NOT_STARTED, "This coupon is not valid yet.", starts_on=coupon.starts_on.isoformat())
    if today > coupon.expires_on:
        _refuse(409, COUPON_EXPIRED, "This coupon has expired.")
    if COUPON_CURRENCY[coupon.country] != coupon.currency:
        _refuse(409, COUPON_CHECKOUT_UNAVAILABLE, "This coupon cannot be used at checkout.")
    return coupon


def _priced(database: Session, coupon: SubscriptionCoupon, plan_code: str, duration_code: str) -> CouponQuote:
    currency = coupon.currency
    original = plan_price(database, plan_code, duration_code, currency)
    if original is None:
        _refuse(409, COUPON_CHECKOUT_UNAVAILABLE, "The plan this coupon is for is not available for purchase.")
    final = original - int(coupon.discount_minor)
    if final < MIN_PAYABLE_MINOR[currency]:
        _refuse(409, COUPON_DISCOUNT_TOO_LARGE, "This coupon's discount is larger than this plan allows.")
    return CouponQuote(coupon, plan_code, duration_code, currency, original, int(coupon.discount_minor), final)


def quote(
    database: Session,
    builder: User,
    raw_code: str,
    plan_code: str | None = None,
    duration_code: str | None = None,
    *,
    lock: bool = False,
    exclude_payment_id=None,
    now: datetime | None = None,
) -> CouponQuote:
    """The server's price for `builder` buying (plan_code, duration_code) with this
    coupon, or a refusal saying why. Without a plan: the first plan it can be used on.

    lock=True takes the coupon's row lock (order creation), so that two checkouts
    cannot both pass the limit check for the last remaining use.
    """
    now = now or naive_utc_now()
    coupon = _usable_coupon(database, builder, raw_code, lock, now)
    if plan_code is None:
        return quotes(database, builder, coupon.code, now=now)[0]
    if (plan_code, duration_code) not in eligible_plans(coupon):
        _refuse(
            409,
            COUPON_NOT_FOR_PLAN,
            "This coupon is for a different plan or billing period.",
            plan_code=coupon.plan_code,
            duration_code=coupon.duration_code,
        )
    priced = _priced(database, coupon, plan_code, duration_code)
    _check_limits(database, coupon, builder, now, exclude_payment_id)
    return priced


def quotes(database: Session, builder: User, raw_code: str, now: datetime | None = None) -> list[CouponQuote]:
    """The server's price for every plan this coupon can be used on (validation at
    checkout; nothing is reserved). Refused when it can be used on none."""
    now = now or naive_utc_now()
    coupon = _usable_coupon(database, builder, raw_code, False, now)
    priced, refusal = [], None
    for plan_code, duration_code in eligible_plans(coupon):
        try:
            priced.append(_priced(database, coupon, plan_code, duration_code))
        except HTTPException as error:
            refusal = refusal or error
    if not priced:
        raise refusal
    _check_limits(database, coupon, builder, now, None)
    return priced


def _check_limits(
    database: Session, coupon: SubscriptionCoupon, builder: User, now: datetime, exclude_payment_id
) -> None:
    if coupon.max_redemptions is not None:
        completed, held = usage(database, coupon.id, now=now, exclude_payment_id=exclude_payment_id)
        if completed + held >= coupon.max_redemptions:
            _refuse(409, COUPON_EXHAUSTED, "This coupon has been fully used.")
    if coupon.max_per_builder is not None:
        completed, held = usage(database, coupon.id, builder.id, now=now, exclude_payment_id=exclude_payment_id)
        if completed + held >= coupon.max_per_builder:
            _refuse(409, COUPON_BUILDER_LIMIT, "You have already used this coupon the maximum number of times.")


def redemption_for(database: Session, payment: SubscriptionPayment) -> SubscriptionCouponRedemption | None:
    return (
        database.query(SubscriptionCouponRedemption)
        .filter(SubscriptionCouponRedemption.payment_id == payment.id)
        .first()
    )


def release_open_reservations(database: Session, builder_id, coupon_id: uuid.UUID, now: datetime | None = None) -> int:
    """Give up this builder's holds on a coupon from orders that were never paid (the
    builder is starting a fresh one), so a retry is not blocked by their own hold."""
    now = now or naive_utc_now()
    rows = (
        database.query(SubscriptionCouponRedemption)
        .join(SubscriptionPayment, SubscriptionPayment.id == SubscriptionCouponRedemption.payment_id)
        .filter(
            SubscriptionCouponRedemption.builder_id == builder_id,
            SubscriptionCouponRedemption.coupon_id == coupon_id,
            SubscriptionCouponRedemption.status == REDEMPTION_RESERVED,
            SubscriptionPayment.status.in_(("CREATED", "FAILED")),
        )
        .all()
    )
    for row in rows:
        row.status, row.released_at = REDEMPTION_RELEASED, now
    return len(rows)


def reserve(database: Session, payment: SubscriptionPayment, coupon_quote: CouponQuote, now: datetime | None = None):
    now = now or naive_utc_now()
    database.add(
        SubscriptionCouponRedemption(
            coupon_id=coupon_quote.coupon.id,
            payment_id=payment.id,
            builder_id=payment.builder_id,
            status=REDEMPTION_RESERVED,
            currency=coupon_quote.currency,
            original_amount_minor=coupon_quote.original_minor,
            discount_minor=coupon_quote.discount_minor,
            final_amount_minor=coupon_quote.final_minor,
            reserved_until=now + timedelta(minutes=RESERVATION_MINUTES),
        )
    )


def mark_redeemed(database: Session, payment: SubscriptionPayment, now: datetime | None = None) -> None:
    """The order's payment was verified: its coupon use is now a completed redemption.

    Honoured even if the hold had lapsed meanwhile -- the builder has paid the
    discounted amount, so the discount stands."""
    row = redemption_for(database, payment)
    if row is not None and row.status != REDEMPTION_REDEEMED:
        row.status, row.redeemed_at = REDEMPTION_REDEEMED, now or naive_utc_now()


def release(database: Session, payment: SubscriptionPayment, now: datetime | None = None) -> None:
    """A failed or abandoned payment: its hold on the coupon is given up."""
    row = redemption_for(database, payment)
    if row is not None and row.status == REDEMPTION_RESERVED:
        row.status, row.released_at = REDEMPTION_RELEASED, now or naive_utc_now()
