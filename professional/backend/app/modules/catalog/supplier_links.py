"""What the catalog reads from supplier listings (marketplace module, supplier_listings):
which products a supplier lists (it then sees their media), the offers on a product,
and how many listings sell it (ported from the old master_catalog_service; same
answers)."""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.modules.accounts.models import SupplierProfile
from app.modules.identity.models import ROLE_SUPPLIER, User
from app.modules.marketplace.models import SupplierProduct


def supplier_listed_variants(database: Session, user: User) -> dict[Any, set[Any]] | None:
    """{product_id: {variant_id or None, ...}} of the catalog products this supplier
    lists; None for any other account."""
    if (user.role or "").upper() != ROLE_SUPPLIER:
        return None
    listed: dict[Any, set[Any]] = {}
    rows = database.execute(
        select(SupplierProduct.master_product_id, SupplierProduct.master_variant_id).where(
            SupplierProduct.supplier_id == user.id, SupplierProduct.master_product_id.isnot(None)
        )
    ).all()
    for product_id, variant_id in rows:
        listed.setdefault(product_id, set()).add(variant_id)
    return listed


def offers(database: Session, product_id: uuid.UUID) -> list[dict[str, Any]]:
    """The published listings of this product, cheapest first."""
    # Imported here: the marketplace listing helpers import the catalog service.
    from app.modules.marketplace.listings import catalog_listings, discounted_price

    rows = database.execute(
        catalog_listings(select(SupplierProduct, User, SupplierProfile))
        .join(User, SupplierProduct.supplier_id == User.id)
        .outerjoin(SupplierProfile, SupplierProfile.user_id == User.id)
        .options(joinedload(SupplierProduct.master_variant))
        .where(
            SupplierProduct.master_product_id == product_id,
            SupplierProduct.is_published.is_(True),
            User.deleted_at.is_(None),
        )
        .order_by(SupplierProduct.price)
    ).all()
    return [
        {
            # The listing's own id: what the cart and a purchase order take.
            "supplier_product_id": listing.id,
            "supplier_id": str(seller.id),
            "supplier_name": profile.store_name if profile else seller.name,
            "price": float(listing.price),
            "discount_percentage": float(listing.discount_percentage or 0),
            "discounted_price": discounted_price(listing.price, listing.discount_percentage),
            "unit": listing.unit,
            "variant_id": listing.master_variant_id,
            "variant_name": listing.master_variant.name if listing.master_variant else None,
            "quantity": listing.quantity,
            "stock_alert_state": listing.stock_alert_state,
        }
        for listing, seller, profile in rows
    ]


def listing_count(database: Session, product_id: uuid.UUID) -> int:
    """How many supplier listings sell this product."""
    return (
        database.scalar(select(func.count(SupplierProduct.id)).where(SupplierProduct.master_product_id == product_id))
        or 0
    )
