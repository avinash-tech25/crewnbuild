"""Request bodies of the store (the old schemas/store_manager.py; same fields and rules,
ids are UUIDs)."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class StoreItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=80)
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    unit: str = Field(min_length=1, max_length=40)
    unit_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    quantity: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    low_stock_threshold: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)


class StoreItemUpdate(BaseModel):
    """The item's details; quantity changes only through the stock endpoint."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=160)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    low_stock_threshold: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    is_active: bool | None = None


class StockUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # REMOVE lowers the quantity by this much; SET is a stock count.
    mode: str
    quantity: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    note: str | None = Field(default=None, max_length=500)


class SiteRequestDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)


class SiteRequestIssueLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_id: uuid.UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)


class SiteRequestIssue(BaseModel):
    """What to hand over now, per request line; left out, everything still owed that
    the store holds is handed over."""

    model_config = ConfigDict(extra="forbid")

    lines: list[SiteRequestIssueLine] | None = Field(default=None, max_length=100)


class PurchaseLineReceive(BaseModel):
    """The quantity that actually arrived; left out, all that is still to arrive."""

    model_config = ConfigDict(extra="forbid")

    quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)
    receipt_key: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class SiteRequestLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: uuid.UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)


class SiteRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    # Left out, the request goes to the Store Manager on the project builder's team.
    store_manager_id: uuid.UUID | None = None
    items: list[SiteRequestLineCreate] = Field(min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=500)


class StorePaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_code: str = Field(min_length=1, max_length=40)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    method: str
    reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


class PurchaseCheckoutLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)


class PurchaseCheckoutCreate(BaseModel):
    """A Buy from one supplier, paid through Razorpay TEST; prices and the total are
    worked out on the server."""

    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    supplier_id: uuid.UUID
    items: list[PurchaseCheckoutLine] = Field(min_length=1, max_length=50)
    site_request_id: uuid.UUID | None = None


class PurchaseVerify(BaseModel):
    payment_id: uuid.UUID
    razorpay_order_id: str = Field(min_length=1, max_length=64)
    razorpay_payment_id: str = Field(min_length=1, max_length=64)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class PurchaseFailure(BaseModel):
    payment_id: uuid.UUID
    code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)


class PurchaseMockCheckout(BaseModel):
    payment_id: uuid.UUID
    outcome: str = Field(pattern="^(success|failure)$")


class StoreBuilderRequestCreate(BaseModel):
    """counterpart_id is the recipient; the sender is the signed-in account."""

    model_config = ConfigDict(extra="forbid")

    counterpart_id: uuid.UUID
    category: str = Field(default="GENERAL", max_length=20)
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=3, max_length=2000)


class StoreBuilderRequestRespond(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: str = Field(pattern="^(ACCEPT|REJECT)$")
    response: str | None = Field(default=None, max_length=1000)
