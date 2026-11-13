"""Store tables (technical-architecture.md section 10, domain Store): a Store Manager's
own records. A Store Manager is an Engineer account in the Store Manager category, so
there is no profile table; its purchases are purchase_orders / purchase_order_items
(marketplace), which is what puts them on the supplier's screens.

    store_items                 + version (rows edited concurrently)
    store_stock_movements       the ledger: every quantity change and the balance after
    store_site_requests         public_request_id becomes id
    store_site_request_items    was store_site_request_lines
    store_goods_receipts        was store_purchase_receipts; order_line_id ->
                                purchase_order_item_id
    store_payments              was store_payment_records; transaction_uuid becomes id
    store_builder_requests      UUID

Every key is a UUID. The Python attribute names stay the old ones (store_manager_id,
request_id, order_line_id, request_code, unit_cost ...) so the ported services and the
API keys are unchanged; the column names follow section 9. Quantities are numeric, not
float: stock is added and subtracted for years and must not drift. Times are timestamptz
read as naive UTC.

Delete rules (9.3): a store's items and ledger go with its account (CASCADE, as before;
accounts are soft-deleted); a request's lines go with it (CASCADE); a request goes with
its project (CASCADE, as before); a line or receipt keeps its row when the item goes
(SET NULL); a receipt is purchase history and keeps its order line (RESTRICT); a payment
keeps its supplier and project as a link that may go (SET NULL, as before).
store_payments.request_code is the purchase's order number; a checkout exists before
its order is created on payment, so it is not a foreign key.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp
from app.modules.labour_supply.models import account_fk, created_at_column, updated_at_column

# Methods a Store Manager records by hand. RAZORPAY is set only by a verified checkout.
PAYMENT_METHODS = ("CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "OTHER")
METHOD_RAZORPAY = "RAZORPAY"
PAYMENT_CREATED = "CREATED"
PAYMENT_PAID = "PAID"
PAYMENT_FAILED = "FAILED"

BUILDER_REQUEST_DIRECTIONS = ("STORE_TO_BUILDER", "BUILDER_TO_STORE")
BUILDER_REQUEST_CATEGORIES = ("GENERAL", "MATERIAL", "DELIVERY", "PAYMENT", "SCHEDULE", "OTHER")
BUILDER_REQUEST_STATUSES = ("PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN")


def quantity_column(column: str = "", **options: Any) -> Mapped[Decimal]:
    if column:
        return mapped_column(column, Numeric(14, 3), **options)
    return mapped_column(Numeric(14, 3), **options)


class StoreItem(UuidPrimaryKeyMixin, Base):
    """One product the store keeps (each size or variant is its own product)."""

    __tablename__ = "store_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="quantity"),
        CheckConstraint("low_stock_threshold >= 0", name="low_stock_threshold"),
        CheckConstraint("unit_cost_amount >= 0", name="unit_cost"),
    )

    store_manager_id: Mapped[uuid.UUID] = account_fk("store_manager_user_id", ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(120))
    variant: Mapped[str | None] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column("unit_cost_amount", Numeric(14, 2), nullable=False, default=0)
    quantity: Mapped[Decimal] = quantity_column(nullable=False, default=0)
    low_stock_threshold: Mapped[Decimal] = quantity_column(nullable=False, default=0)
    # Archived rather than deleted: past requests and the ledger still name it.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    __mapper_args__ = {"version_id_col": version}  # noqa: RUF012


# One row per product variant in a store, whatever the capitalisation.
Index(
    "uq_store_items__identity",
    StoreItem.store_manager_id,
    func.lower(StoreItem.name),
    func.lower(func.coalesce(StoreItem.brand, "")),
    func.lower(StoreItem.unit),
    func.lower(func.coalesce(StoreItem.variant, "")),
    unique=True,
)


class StoreStockMovement(UuidPrimaryKeyMixin, Base):
    """The ledger: every change to an item's quantity, and the balance it left."""

    __tablename__ = "store_stock_movements"
    __table_args__ = (
        CheckConstraint("reason IN ('INITIAL', 'ADJUSTMENT', 'PURCHASE_RECEIPT', 'ISSUE')", name="reason"),
    )

    store_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    change: Mapped[Decimal] = quantity_column("change_quantity", nullable=False)
    balance_after: Mapped[Decimal] = quantity_column("balance_after", nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(60))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()


class StoreSiteRequest(UuidPrimaryKeyMixin, Base):
    """A Site Engineer's request to a Store Manager, for one project. Its id is the
    Request ID people see and search."""

    __tablename__ = "store_site_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'PARTIALLY_ISSUED', 'REJECTED', 'ISSUED', 'CANCELLED')", name="status"
        ),
    )

    store_manager_id: Mapped[uuid.UUID] = account_fk("store_manager_user_id")
    engineer_id: Mapped[uuid.UUID] = account_fk("engineer_user_id")
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    decided_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    issued_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    @property
    def public_request_id(self) -> uuid.UUID:
        """The old separate Request ID column: now the key itself."""
        return self.id


class StoreSiteRequestLine(UuidPrimaryKeyMixin, Base):
    __tablename__ = "store_site_request_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("issued_quantity >= 0 AND issued_quantity <= quantity", name="issued_quantity"),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        "site_request_id", ForeignKey("store_site_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("store_items.id", ondelete="SET NULL"), index=True
    )
    # A snapshot, so a request still reads correctly after the item changes.
    item_name: Mapped[str] = mapped_column(String(160), nullable=False)
    item_variant: Mapped[str | None] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[Decimal] = quantity_column(nullable=False)
    issued_quantity: Mapped[Decimal] = quantity_column(nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = created_at_column()


class StorePurchaseReceipt(UuidPrimaryKeyMixin, Base):
    """Goods received against one purchase line: one row per delivery. A retried
    receipt carries the same receipt_key, which is unique."""

    __tablename__ = "store_goods_receipts"
    __table_args__ = (
        Index(
            "uq_store_goods_receipts__receipt_key",
            "receipt_key",
            unique=True,
            postgresql_where=text("receipt_key IS NOT NULL"),
        ),
        CheckConstraint("quantity > 0", name="quantity"),
    )

    order_line_id: Mapped[uuid.UUID] = mapped_column(
        "purchase_order_item_id",
        ForeignKey("purchase_order_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    store_manager_id: Mapped[uuid.UUID] = account_fk("store_manager_user_id")
    store_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("store_items.id", ondelete="SET NULL"), index=True
    )
    quantity: Mapped[Decimal] = quantity_column(nullable=False)
    received_at: Mapped[datetime] = created_at_column()
    receipt_key: Mapped[str | None] = mapped_column(String(64))


class StorePaymentRecord(UuidPrimaryKeyMixin, Base):
    """A payment against a purchase: a ledger entry the Store Manager records (CASH ...
    OTHER, PAID), or a Razorpay TEST checkout (RAZORPAY), CREATED with the priced cart in
    `items` until verified, then PAID (only then do the purchase lines exist) or FAILED.
    Its id is the Transaction ID people see."""

    __tablename__ = "store_payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount"),
        CheckConstraint("method IN ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER', 'RAZORPAY')", name="method"),
        CheckConstraint("status IN ('CREATED', 'PAID', 'FAILED')", name="status"),
        Index(
            "uq_store_payments__razorpay_order_id",
            "razorpay_order_id",
            unique=True,
            postgresql_where=text("razorpay_order_id IS NOT NULL"),
        ),
        Index(
            "uq_store_payments__razorpay_payment_id",
            "razorpay_payment_id",
            unique=True,
            postgresql_where=text("razorpay_payment_id IS NOT NULL"),
        ),
    )

    store_manager_id: Mapped[uuid.UUID] = account_fk("store_manager_user_id")
    # The purchase's order number (purchase_orders.order_number): one Buy, several lines.
    request_code: Mapped[str] = mapped_column("order_number", String(40), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column("amount", Numeric(14, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=PAYMENT_PAID, server_default=PAYMENT_PAID)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        "supplier_user_id", ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    items: Mapped[list[Any] | None] = mapped_column(JSONB)
    razorpay_order_id: Mapped[str | None] = mapped_column(String(64))
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64))
    gateway_mode: Mapped[str | None] = mapped_column(String(8))
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    paid_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    # The Site Engineer request whose shortage this purchase covers, if any.
    site_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("store_site_requests.id", ondelete="SET NULL"), index=True
    )

    @property
    def transaction_uuid(self) -> uuid.UUID:
        """The old separate Transaction ID column: now the key itself."""
        return self.id


class StoreBuilderRequest(UuidPrimaryKeyMixin, Base):
    """A written request between a Builder and a Store Manager on that Builder's active
    team, in either direction."""

    __tablename__ = "store_builder_requests"
    __table_args__ = (
        CheckConstraint("direction IN ('STORE_TO_BUILDER', 'BUILDER_TO_STORE')", name="direction"),
        CheckConstraint(
            "category IN ('GENERAL', 'MATERIAL', 'DELIVERY', 'PAYMENT', 'SCHEDULE', 'OTHER')", name="category"
        ),
        CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')", name="status"),
    )

    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    store_manager_id: Mapped[uuid.UUID] = account_fk("store_manager_user_id", ondelete="CASCADE")
    builder_id: Mapped[uuid.UUID] = account_fk("builder_id", ondelete="CASCADE")
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="GENERAL")
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)
    response: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    responded_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
