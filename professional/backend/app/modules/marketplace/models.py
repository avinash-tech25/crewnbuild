"""Marketplace tables (technical-architecture.md section 10, domain Marketplace).

    supplier_listings              was supplier_products; FKs to the catalog product and
                                   variant (master_product_id -> catalog_product_id,
                                   master_variant_id -> catalog_variant_id)
    supplier_listing_price_tiers   was supplier_bulk_pricing (supplier_product_id ->
                                   listing_id)
    cart_items                     UUID; product_id -> listing_id
    purchase_orders                split from material_order_items: one order per
                                   request_code and supplier; order_number is the old
                                   request_code
    purchase_order_items           the lines below it (product_id -> listing_id,
                                   price -> unit_price_amount)

Every key is a UUID. The Python attribute names stay the old ones (product_id,
master_product_id, price, engineer_id, request_code ...) so the ported services and the
API keys are unchanged; the column names follow section 9. A purchase order line still
answers request_code, project_id, engineer_id (the buyer) and supplier_id, read from its
order, so the old line-shaped code reads it as before (SupplierMaterialRequest is an
alias of PurchaseOrderItem).

Delete rules (9.3): a listing goes with nothing but its own delete (its price tiers and
the cart lines naming it go with it; project stock and material usage keep their rows
and lose the link, SET NULL, as the old delete unlinked them); an order line is sales
history and keeps its listing (RESTRICT, which the listing delete already refuses); an
order keeps its buyer and supplier (RESTRICT; accounts are soft-deleted) and its project
(RESTRICT; the project delete removes the project's orders first, as the old purge did);
lines go with their order (CASCADE); a cart line goes with its buyer or project
(CASCADE).
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

STATUS_PENDING = "PENDING"
STATUS_ACCEPTED = "ACCEPTED"
STATUS_REJECTED = "REJECTED"
STATUS_FULFILLED = "FULFILLED"
# An order whose lines were not all decided the same way (one line accepted from the
# supplier's Orders screen, another rejected); the lines carry the real statuses.
STATUS_PARTIAL = "PARTIAL"
LINE_STATUSES = (STATUS_PENDING, STATUS_ACCEPTED, STATUS_REJECTED, STATUS_FULFILLED)
ORDER_STATUSES = (*LINE_STATUSES, STATUS_PARTIAL)

STOCK_STATES = ("IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


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


def quantity_column(column: str, *, nullable: bool = False, default: object = None) -> Mapped[float]:
    """numeric(14,3), read as a float as the old Float columns were."""
    return mapped_column(column, Numeric(14, 3, asdecimal=False), nullable=nullable, default=default)


class SupplierProduct(UuidPrimaryKeyMixin, Base):
    """One supplier's offer of a product: a Master Catalog product (and variant) at the
    supplier's price, or a listing made before the catalog."""

    __tablename__ = "supplier_listings"
    __table_args__ = (
        CheckConstraint("discount_percentage BETWEEN 0 AND 100", name="discount_percentage"),
        CheckConstraint(_in("stock_alert_state", STOCK_STATES), name="stock_alert_state"),
        # One listing per supplier, catalog product and variant (the old
        # uq_supplier_products_supplier_master; a missing variant counts as one value).
        Index(
            "uq_supplier_listings__supplier_catalog_product_variant",
            "supplier_user_id",
            "catalog_product_id",
            text("COALESCE(catalog_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)"),
            unique=True,
            postgresql_where=text("catalog_product_id IS NOT NULL"),
        ),
        Index("ix_supplier_listings__supplier_user_id_is_published", "supplier_user_id", "is_published"),
    )

    supplier_id: Mapped[uuid.UUID] = mapped_column(
        "supplier_user_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(120), index=True)
    size: Mapped[str | None] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    # Only a listing made before the catalog has its own picture; a catalog listing
    # shows its product's primary image (display_image_url).
    image_url: Mapped[str | None] = mapped_column(String(500))
    features: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    product_type: Mapped[str | None] = mapped_column(String(80))
    grade: Mapped[str | None] = mapped_column(String(80))
    usage: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    price: Mapped[Decimal] = mapped_column("price_amount", Numeric(14, 2), nullable=False)
    quantity: Mapped[float] = quantity_column("stock_quantity")
    low_stock_threshold: Mapped[float] = quantity_column("low_stock_threshold", default=0)
    stock_alert_state: Mapped[str] = mapped_column(String(30), nullable=False, default="IN_STOCK")
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # The supplier's optional discount, 0-100; `price` stays the base price.
    discount_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=0, server_default=text("0")
    )
    master_product_id: Mapped[uuid.UUID | None] = mapped_column(
        "catalog_product_id", ForeignKey("catalog_products.id", ondelete="RESTRICT"), index=True
    )
    master_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        "catalog_variant_id", ForeignKey("catalog_product_variants.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    master_product = relationship("CatalogProduct")
    master_variant = relationship("CatalogProductVariant")
    supplier = relationship("User")

    @property
    def display_image_url(self) -> str | None:
        """The picture every screen shows: a catalog listing's product's primary image,
        read live (None when there is none); an older listing's own image."""
        if self.master_product_id is None:
            return self.image_url
        product = self.master_product
        if product is None:
            return None
        primary = next(
            (image for image in product.images if image.is_primary and (image.media_type or "IMAGE") == "IMAGE"),
            None,
        )
        return primary.image_url if primary else None


class SupplierBulkPrice(UuidPrimaryKeyMixin, Base):
    """One optional quantity tier of one supplier listing."""

    __tablename__ = "supplier_listing_price_tiers"
    __table_args__ = (
        UniqueConstraint("listing_id", "min_quantity"),
        CheckConstraint("min_quantity >= 1", name="min_quantity"),
        CheckConstraint("max_quantity IS NULL OR max_quantity >= min_quantity", name="quantity_range"),
        CheckConstraint("unit_price_amount > 0", name="unit_price"),
    )

    supplier_product_id: Mapped[uuid.UUID] = mapped_column(
        "listing_id", ForeignKey("supplier_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    min_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    max_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))  # NULL = no upper limit
    unit_price: Mapped[Decimal] = mapped_column("unit_price_amount", Numeric(14, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class CartItem(UuidPrimaryKeyMixin, Base):
    """A listing a buyer has put aside for one project before sending a buy request."""

    __tablename__ = "cart_items"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", "listing_id"),
        CheckConstraint("quantity > 0", name="quantity"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        "supplier_user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        "listing_id", ForeignKey("supplier_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity: Mapped[float] = quantity_column("quantity")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class PurchaseOrder(UuidPrimaryKeyMixin, Base):
    """One buy request to one supplier for one project (the old request_code)."""

    __tablename__ = "purchase_orders"
    __table_args__ = (
        UniqueConstraint("order_number"),
        CheckConstraint(_in("status", ORDER_STATUSES), name="status"),
    )

    order_number: Mapped[str] = mapped_column(String(40), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        "buyer_user_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        "supplier_user_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_PENDING)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    items = relationship(
        "PurchaseOrderItem",
        back_populates="order",
        order_by="(PurchaseOrderItem.created_at, PurchaseOrderItem.id)",
        passive_deletes=True,
    )

    def sync_status(self) -> None:
        """The order's status: its lines' status when they agree, else PARTIAL."""
        statuses = {item.status for item in self.items}
        self.status = statuses.pop() if len(statuses) == 1 else STATUS_PARTIAL


class PurchaseOrderItem(UuidPrimaryKeyMixin, Base):
    """One line of a purchase order: a listing, the quantity and the agreed unit price."""

    __tablename__ = "purchase_order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint(_in("status", LINE_STATUSES), name="status"),
        Index("ix_purchase_order_items__status_fulfilled_at", "status", "fulfilled_at"),
    )

    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        "listing_id", ForeignKey("supplier_listings.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80))
    price: Mapped[Decimal | None] = mapped_column("unit_price_amount", Numeric(14, 2))
    quantity: Mapped[float] = quantity_column("quantity")
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_PENDING, index=True)
    created_at: Mapped[datetime] = created_at_column()
    fulfilled_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    order = relationship("PurchaseOrder", back_populates="items", lazy="joined")

    # The old line columns, read from the order.
    @property
    def request_code(self) -> str:
        return self.order.order_number

    @property
    def project_id(self) -> uuid.UUID:
        return self.order.project_id

    @property
    def engineer_id(self) -> uuid.UUID:
        """The buyer (a House Owner or a Store Manager; the old column name)."""
        return self.order.buyer_id

    @property
    def supplier_id(self) -> uuid.UUID:
        return self.order.supplier_id


# The old name of an order line.
SupplierMaterialRequest = PurchaseOrderItem
