"""Request bodies of the builder plan, coupon and premium routes (the old subscription/schemas.py)."""

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class CreateSubscriptionOrderRequest(BaseModel):
    """Only the tier and the duration. There is deliberately no amount field: the
    price is read from subscription_plan_prices on the server."""

    plan_code: str = Field(min_length=1, max_length=20)
    duration_code: str = Field(min_length=1, max_length=20)
    # Optional. Only the code: the discount and the amount are computed on the server.
    coupon_code: str | None = Field(default=None, max_length=60)


class SignupPlanChangeRequest(BaseModel):
    """Before paying: PROFESSIONAL/MONTHLY, BUSINESS/ANNUAL, or plan_code FREE to sign
    up free instead. Never an amount."""

    plan_code: str = Field(min_length=1, max_length=20)
    duration_code: str | None = Field(default=None, max_length=20)


class VerifySubscriptionRequest(BaseModel):
    subscription_payment_id: uuid.UUID
    razorpay_order_id: str = Field(min_length=1, max_length=64)
    razorpay_payment_id: str = Field(min_length=1, max_length=64)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class SubscriptionFailureRequest(BaseModel):
    """What Checkout reported. Informational only: it can never activate anything."""

    subscription_payment_id: uuid.UUID
    razorpay_payment_id: str | None = Field(default=None, max_length=64)
    code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)


class SubscriptionMockCheckoutRequest(BaseModel):
    subscription_payment_id: uuid.UUID
    outcome: Literal["success", "failure"] = "success"


class CostAdjustmentRequest(BaseModel):
    field_name: Literal["labour_cost", "material_cost", "equipment_cost", "total_expenses"]
    adjusted_value: float = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)


class CouponValidateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    # Optional: price one plan only. Without them, every plan the coupon applies to is priced.
    plan_code: str | None = Field(default=None, max_length=20)
    duration_code: str | None = Field(default=None, max_length=20)


class CouponCreate(BaseModel):
    """A fixed discount in the coupon country's currency, in major units ("500",
    "1.250"), on any offered paid plan. `country` is IN; a location
    administrator may only give their own. Created active, one use per builder."""

    code: str = Field(min_length=3, max_length=60)
    country: str | None = Field(default=None, max_length=10)
    discount_amount: str = Field(min_length=1, max_length=20)
    starts_on: date
    expires_on: date


class CouponUpdate(BaseModel):
    """Every field optional. The code and the country of a coupon never change."""

    discount_amount: str | None = Field(default=None, min_length=1, max_length=20)
    plan_code: str | None = Field(default=None, max_length=20)
    duration_code: str | None = Field(default=None, max_length=20)
    starts_on: date | None = None
    expires_on: date | None = None
    max_redemptions: int | None = Field(default=None, ge=1)
    max_per_builder: int | None = Field(default=None, ge=1)
    clear_max_redemptions: bool = False
    clear_max_per_builder: bool = False
    country: str | None = Field(default=None, max_length=10)  # refused if it differs


class CouponStatus(BaseModel):
    active: bool
