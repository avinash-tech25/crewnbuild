"""Billing tables (technical-architecture.md section 10, domain Billing).

    subscription_plan_prices          UUID (was an integer key)
    subscription_payments             unchanged; one Razorpay order for one plan purchase
    builder_subscriptions             unchanged; one paid period
    subscription_coupons              UUID
    subscription_coupon_redemptions   UUID
    payment_webhook_events            was subscription_webhook_events; UUID. The builder
                                      plan webhook records each event id here once (the
                                      booking webhook stays idempotent by its order state,
                                      as before)
    booking_payment_orders            was payment_orders
    booking_payment_transactions      was payment_transactions
    booking_payment_receipts          was payment_receipts

The builders' audited cost corrections live in site_operations
(site_daily_record_adjustments); billing's premium tools write them.

Integrity in the database, not only in code (as before):
  * a Razorpay order id and a Razorpay payment id are each recorded once,
  * one subscription period per payment (a repeated verify or webhook cannot activate
    or extend twice), one coupon redemption per payment,
  * one stored webhook event per Razorpay event id,
  * one PAID booking order per booking, one SUCCESS transaction per order, one receipt
    per booking, order and transaction; receipts are test receipts only,
  * INR, test/mock gateway modes and known plan/duration codes only.

No card number, CVV, UPI PIN, OTP or bank credential exists in any column.

Delete rules (9.3): money and its history must survive, so payments, periods,
redemptions, booking orders, transactions and receipts keep their user and their payment
(RESTRICT; accounts are soft-deleted, never removed). A coupon keeps its redemptions
(RESTRICT); who created or last changed a coupon is a link that may go (SET NULL).

booking_payment_orders.booking_id refers to partner.bookings (RESTRICT). That table exists
only once Partner's baseline has run, so the foreign key is added by the DDL below when
the table is created after it (and, on an existing database, by the later Professional
migration that section 11.2 describes); until then the column holds the id unchecked, as
the old payment_orders did.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    DDL,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    event,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import PROFESSIONAL_SCHEMA
from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

PAYMENT_CREATED = "CREATED"
PAYMENT_PAID = "PAID"
PAYMENT_FAILED = "FAILED"
PAYMENT_REFUNDED = "REFUNDED"
PAYMENT_DISPUTED = "DISPUTED"

PERIOD_ACTIVE = "ACTIVE"
PERIOD_REVOKED = "REVOKED"

ADJUSTABLE_FIELDS = ("labour_cost", "material_cost", "equipment_cost", "total_expenses")

PLAN_CHECK = "plan_code IN ('PROFESSIONAL', 'BUSINESS')"
DURATION_CHECK = "duration_code IN ('MONTHLY', 'SIX_MONTHS', 'ANNUAL')"


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


def updated_at_column() -> Mapped[datetime]:
    return mapped_column(
        "updated_at",
        NaiveUtcTimestamp,
        nullable=False,
        default=naive_utc_now,
        onupdate=naive_utc_now,
        server_default=text("now()"),
    )


def user_fk(column: str = "builder_id", *, nullable: bool = False, ondelete: str = "RESTRICT") -> Mapped[uuid.UUID]:
    return mapped_column(column, ForeignKey("users.id", ondelete=ondelete), nullable=nullable, index=True)


class SubscriptionPlanPrice(UuidPrimaryKeyMixin, Base):
    """The price of one tier for one billing duration. No row = not purchasable."""

    __tablename__ = "subscription_plan_prices"
    __table_args__ = (
        UniqueConstraint("plan_code", "duration_code", "currency"),
        CheckConstraint(PLAN_CHECK, name="plan"),
        CheckConstraint(DURATION_CHECK, name="duration"),
        CheckConstraint("amount_paise > 0", name="amount"),
        CheckConstraint("currency = 'INR'", name="currency"),
    )

    plan_code: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_code: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class SubscriptionPayment(UuidPrimaryKeyMixin, Base):
    """One Razorpay order for one plan purchase, and what became of it."""

    __tablename__ = "subscription_payments"
    __table_args__ = (
        CheckConstraint("status IN ('CREATED', 'FAILED', 'PAID', 'REFUNDED', 'DISPUTED')", name="status"),
        CheckConstraint(PLAN_CHECK, name="plan"),
        CheckConstraint(DURATION_CHECK, name="duration"),
        CheckConstraint("amount_paise > 0", name="amount"),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint("gateway_mode IN ('test', 'mock')", name="gateway_mode"),
        Index(
            "uq_subscription_payments__razorpay_payment_id",
            "razorpay_payment_id",
            unique=True,
            postgresql_where=text("razorpay_payment_id IS NOT NULL"),
        ),
    )

    builder_id: Mapped[uuid.UUID] = user_fk()
    plan_code: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_code: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    razorpay_order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=PAYMENT_CREATED)
    gateway_mode: Mapped[str] = mapped_column(String(8), nullable=False)
    signature_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payment_method: Mapped[str | None] = mapped_column(String(32))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    failure_description: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
    paid_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    refunded_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    disputed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)


class BuilderSubscription(UuidPrimaryKeyMixin, Base):
    """One paid period. A builder's history is its rows; the current plan is the ACTIVE
    row whose [subscription_start, subscription_end) contains now."""

    __tablename__ = "builder_subscriptions"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE', 'REVOKED')", name="status"),
        CheckConstraint(PLAN_CHECK, name="plan"),
        CheckConstraint(DURATION_CHECK, name="duration"),
        CheckConstraint("subscription_end > subscription_start", name="period"),
        Index("ix_builder_subscriptions__builder_id_subscription_end", "builder_id", "subscription_end"),
    )

    builder_id: Mapped[uuid.UUID] = user_fk()
    # The payment that bought this period. Unique: the idempotency guarantee.
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_payments.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    plan_code: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=PERIOD_ACTIVE)
    subscription_start: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    subscription_end: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    # Notification bookkeeping, so each message is sent once.
    reminder_sent_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    expiry_notified_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class PaymentWebhookEvent(UuidPrimaryKeyMixin, Base):
    """A processed Razorpay webhook event. The unique id makes a redelivery a no-op."""

    __tablename__ = "payment_webhook_events"

    event_id: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    outcome: Mapped[str] = mapped_column(String(40), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )
    created_at: Mapped[datetime] = created_at_column()


# ---- coupons ----
# India only. A coupon belongs to the administrator's scope code IN and is priced in INR,
# in minor units (paise). It discounts one existing (plan_code, duration_code), or (both
# NULL) any offered paid plan. The discount and the amount charged are always computed on
# the server from subscription_plan_prices.

COUPON_COUNTRIES = ("IN",)
COUPON_CURRENCY = {"IN": "INR"}

REDEMPTION_RESERVED = "RESERVED"  # held by an unpaid order; counts against limits for a short time
REDEMPTION_REDEEMED = "REDEEMED"  # the order's payment was verified; a completed redemption
REDEMPTION_RELEASED = "RELEASED"  # the hold was given up (failure, replaced order); counts for nothing


class SubscriptionCoupon(UuidPrimaryKeyMixin, Base):
    __tablename__ = "subscription_coupons"
    __table_args__ = (
        CheckConstraint("country = 'IN'", name="country"),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint("discount_minor > 0", name="discount"),
        CheckConstraint(PLAN_CHECK, name="plan"),
        CheckConstraint(DURATION_CHECK, name="duration"),
        CheckConstraint("expires_on >= starts_on", name="dates"),
        CheckConstraint("max_redemptions IS NULL OR max_redemptions > 0", name="max_total"),
        CheckConstraint("max_per_builder IS NULL OR max_per_builder > 0", name="max_builder"),
        CheckConstraint("code = upper(code)", name="code_upper"),
    )

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # NULL: the coupon applies to every offered paid plan and period.
    plan_code: Mapped[str | None] = mapped_column(String(20))
    duration_code: Mapped[str | None] = mapped_column(String(20))
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    expires_on: Mapped[date] = mapped_column(Date, nullable=False)
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    max_per_builder: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[uuid.UUID | None] = user_fk("created_by_user_id", nullable=True, ondelete="SET NULL")
    updated_by_id: Mapped[uuid.UUID | None] = user_fk("updated_by_user_id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class SubscriptionCouponRedemption(UuidPrimaryKeyMixin, Base):
    """One coupon applied to one subscription order (one row per payment)."""

    __tablename__ = "subscription_coupon_redemptions"
    __table_args__ = (
        CheckConstraint("status IN ('RESERVED', 'REDEEMED', 'RELEASED')", name="status"),
        CheckConstraint(
            "discount_minor > 0 AND final_amount_minor > 0 "
            "AND final_amount_minor + discount_minor = original_amount_minor",
            name="amounts",
        ),
        Index("ix_subscription_coupon_redemptions__coupon_id_status", "coupon_id", "status"),
        Index("ix_subscription_coupon_redemptions__coupon_id_builder_id", "coupon_id", "builder_id"),
    )

    coupon_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_coupons.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_payments.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    builder_id: Mapped[uuid.UUID] = user_fk()
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=REDEMPTION_RESERVED)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    original_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    final_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reserved_until: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    redeemed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    released_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


# ---- Book Technician booking payments ----
# The booking itself is Partner's and is not copied: booking_id holds its id. The customer
# is professional.users. Technician, service and price are read from the booking when
# needed (partner.v_professional_bookings), never duplicated; only what Razorpay reported
# (ids, method, amount) and the receipt number are kept.

ORDER_CREATED = "CREATED"
ORDER_PAID = "PAID"
TRANSACTION_SUCCESS = "SUCCESS"
TRANSACTION_FAILED = "FAILED"
RECEIPT_SUCCESS = "SUCCESS"


class BookingPaymentOrder(UuidPrimaryKeyMixin, Base):
    __tablename__ = "booking_payment_orders"
    __table_args__ = (
        CheckConstraint("status IN ('CREATED', 'PAID')", name="status"),
        CheckConstraint("amount_paise > 0", name="amount"),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint("gateway_mode IN ('test', 'mock')", name="gateway_mode"),
        Index(
            "uq_booking_payment_orders__booking_id_paid",
            "booking_id",
            unique=True,
            postgresql_where=text("status = 'PAID'"),
        ),
    )

    # partner.bookings.id (RESTRICT): see the module docstring and BOOKING_FOREIGN_KEY.
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = user_fk("customer_user_id")
    razorpay_order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=ORDER_CREATED)
    gateway_mode: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
    paid_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)


class BookingPaymentTransaction(UuidPrimaryKeyMixin, Base):
    __tablename__ = "booking_payment_transactions"
    __table_args__ = (
        CheckConstraint("status IN ('SUCCESS', 'FAILED')", name="status"),
        CheckConstraint("currency = 'INR'", name="currency"),
        Index(
            "uq_booking_payment_transactions__razorpay_payment_id",
            "razorpay_payment_id",
            unique=True,
            postgresql_where=text("razorpay_payment_id IS NOT NULL"),
        ),
        Index(
            "uq_booking_payment_transactions__order_id_success",
            "booking_payment_order_id",
            unique=True,
            postgresql_where=text("status = 'SUCCESS'"),
        ),
    )

    payment_order_id: Mapped[uuid.UUID] = mapped_column(
        "booking_payment_order_id",
        ForeignKey("booking_payment_orders.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64))
    razorpay_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    payment_method: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    signature_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    failure_code: Mapped[str | None] = mapped_column(String(64))
    failure_description: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
    paid_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)


class BookingPaymentReceipt(UuidPrimaryKeyMixin, Base):
    __tablename__ = "booking_payment_receipts"
    __table_args__ = (
        CheckConstraint("status = 'SUCCESS'", name="status"),
        CheckConstraint("is_test", name="test_only"),
        CheckConstraint("currency = 'INR'", name="currency"),
    )

    receipt_number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, unique=True)
    payment_order_id: Mapped[uuid.UUID] = mapped_column(
        "booking_payment_order_id",
        ForeignKey("booking_payment_orders.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    payment_transaction_id: Mapped[uuid.UUID] = mapped_column(
        "booking_payment_transaction_id",
        ForeignKey("booking_payment_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    payment_method: Mapped[str | None] = mapped_column(String(32))
    razorpay_payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    razorpay_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False, default=naive_utc_now)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=RECEIPT_SUCCESS)
    is_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = created_at_column()


# booking_payment_orders.booking_id -> partner.bookings.id ON DELETE RESTRICT (section 10).
# Created with the table when Partner's bookings table already exists; otherwise the later
# Professional migration adds it (docs/porting-todo.md).
BOOKING_FOREIGN_KEY_NAME = "fk_booking_payment_orders__booking_id__bookings"
BOOKING_FOREIGN_KEY = DDL(
    f"ALTER TABLE {PROFESSIONAL_SCHEMA}.booking_payment_orders "
    f"ADD CONSTRAINT {BOOKING_FOREIGN_KEY_NAME} "
    "FOREIGN KEY (booking_id) REFERENCES partner.bookings (id) ON DELETE RESTRICT"
)


def partner_bookings_exist(ddl: object, target: object, bind: object, **_: object) -> bool:
    """partner.bookings exists and this role may reference it. information_schema lists
    only what the role has some privilege on (to_regclass would need USAGE on the schema)."""
    found = bind.execute(  # type: ignore[attr-defined]
        text("SELECT 1 FROM information_schema.tables WHERE table_schema = 'partner' AND table_name = 'bookings'")
    ).first()
    return found is not None


event.listen(
    BookingPaymentOrder.__table__,
    "after_create",
    BOOKING_FOREIGN_KEY.execute_if(callable_=partner_bookings_exist),  # type: ignore[arg-type]
)
