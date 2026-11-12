"""Supplier listings as every screen reads them: which listings count (catalog_listings),
the canonical fields a catalog listing copies, the discounted price, the bulk price
tiers and the listing payloads (ported from the old master_catalog_service helpers,
catalog_queries.catalog_listings, bulk_pricing.py and supplier_product_service payloads;
same rules and keys).

    unit_price_for(listing, quantity, tiers)
        the listing's discounted price, unless an active tier covering the quantity is
        lower; every authoritative price (cart line, order line) comes from here.
"""

import itertools
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, object_session

from app.modules.catalog.catalog_service import product_payload as catalog_product_payload
from app.modules.catalog.catalog_service import variant_payload as catalog_variant_payload
from app.modules.catalog.models import CatalogProduct, CatalogProductVariant
from app.modules.marketplace.models import SupplierBulkPrice, SupplierProduct

# ---- which listings count ----


def catalog_listings(query: Any) -> Any:
    """A supplier_listings query narrowed to listings of a product that exists in the
    Master Catalog: the product active, and the variant (when one is set) present and
    belonging to that product. A listing with no variant is how a product without
    variants is sold. Works on a Query and on a select()."""
    return (
        query.join(CatalogProduct, CatalogProduct.id == SupplierProduct.master_product_id)
        .outerjoin(
            CatalogProductVariant,
            (CatalogProductVariant.id == SupplierProduct.master_variant_id)
            & (CatalogProductVariant.product_id == SupplierProduct.master_product_id),
        )
        .filter(
            CatalogProduct.is_active.is_(True),
            or_(SupplierProduct.master_variant_id.is_(None), CatalogProductVariant.id.isnot(None)),
        )
    )


# ---- the catalog's half of a listing ----


def listing_description(listing: SupplierProduct) -> str | None:
    """A catalog listing shows its master product's description; an older listing keeps
    its own."""
    if listing.master_product_id is not None and listing.master_product is not None:
        return listing.master_product.description
    return listing.description


def discounted_price(price: Any, discount_percentage: Any) -> float:
    """price - price * discount / 100, to the paisa; the price itself with no discount."""
    base = float(price or 0)
    discount = float(discount_percentage or 0)
    if discount <= 0:
        return round(base, 2)
    return round(base - base * discount / 100, 2)


def canonical_snapshot(product: CatalogProduct, variant: CatalogProductVariant | None) -> dict[str, Any]:
    """The canonical fields, shaped for a supplier_listings row (name, brand, category,
    unit ... copied from the master product; the image is never copied)."""
    subcategory = product.subcategory
    category = subcategory.category if subcategory else None
    unit = (variant.unit if variant else None) or product.unit
    specifications = {**(product.specifications or {})}
    if variant:
        specifications.update(variant.specifications or {})
    return {
        "name": product.name,
        "brand": product.brand.name if product.brand else None,
        "size": variant.name if variant else None,
        "category": category.name if category else (subcategory.name if subcategory else ""),
        "image_url": None,
        "features": "\n".join(f"{key}: {value}" for key, value in specifications.items()) or None,
        "description": None,
        "product_type": product.product_type or (subcategory.name if subcategory else None),
        "grade": specifications.get("Grade"),
        "unit": unit.code if unit else "",
    }


# The fields a catalog listing takes from the catalog rather than from the supplier.
CANONICAL_LISTING_FIELDS = {
    "name",
    "brand",
    "size",
    "category",
    "image_url",
    "features",
    "description",
    "product_type",
    "grade",
    "usage",
    "unit",
}


def supplier_product_stock_state(quantity: Any, low_stock_threshold: Any) -> str:
    """Zero stock beats low stock."""
    if quantity == 0:
        return "OUT_OF_STOCK"
    return "LOW_STOCK" if low_stock_threshold and quantity <= low_stock_threshold else "IN_STOCK"


# ---- bulk price tiers ----


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


def tier_payload(row: SupplierBulkPrice) -> dict[str, Any]:
    return {
        "id": row.id,
        "min_quantity": _num(row.min_quantity),
        "max_quantity": _num(row.max_quantity),
        "unit_price": _num(row.unit_price),
    }


def tiers_by_listing(database: Session | None, listing_ids: Any) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """Active tiers of these listings, lowest quantity first. One query."""
    ids = [listing_id for listing_id in set(listing_ids) if listing_id is not None]
    if not ids or database is None:
        return {}
    rows = database.scalars(
        select(SupplierBulkPrice)
        .where(SupplierBulkPrice.supplier_product_id.in_(ids), SupplierBulkPrice.is_active.is_(True))
        .order_by(SupplierBulkPrice.supplier_product_id, SupplierBulkPrice.min_quantity)
    ).all()
    result: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for row in rows:
        result.setdefault(row.supplier_product_id, []).append(tier_payload(row))
    return result


def tiers_for(database: Session | None, listing_id: uuid.UUID) -> list[dict[str, Any]]:
    return tiers_by_listing(database, [listing_id]).get(listing_id, [])


def applicable_tier(tiers: list[dict[str, Any]], quantity: float) -> dict[str, Any] | None:
    """The active tier with the highest min_quantity whose range holds the quantity."""
    quantity = float(quantity or 0)
    fitting = [
        tier
        for tier in tiers
        if tier["min_quantity"] <= quantity and (tier["max_quantity"] is None or quantity <= tier["max_quantity"])
    ]
    return max(fitting, key=lambda tier: tier["min_quantity"]) if fitting else None


def unit_price_for(
    listing: SupplierProduct, quantity: float, tiers: list[dict[str, Any]]
) -> tuple[float, dict[str, Any] | None]:
    """(unit price to charge, the tier used or None): the discounted price, or a fitting
    tier when it is not above it."""
    listed = discounted_price(listing.price, listing.discount_percentage)
    tier = applicable_tier(tiers, quantity)
    if tier is not None and float(tier["unit_price"]) <= listed:
        return float(tier["unit_price"]), tier
    return listed, None


def validate_tiers(raw_tiers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Clean, sorted tiers, or a 400 naming the first problem."""
    cleaned = []
    for index, tier in enumerate(raw_tiers or [], start=1):
        try:
            minimum = Decimal(str(tier.get("min_quantity")))
            maximum = None if tier.get("max_quantity") in (None, "") else Decimal(str(tier.get("max_quantity")))
            price = Decimal(str(tier.get("unit_price")))
            if not (minimum.is_finite() and price.is_finite() and (maximum is None or maximum.is_finite())):
                raise InvalidOperation
        except (InvalidOperation, ValueError, TypeError, AttributeError):
            raise HTTPException(
                status_code=400, detail=f"Tier {index}: enter numbers for quantity and price."
            ) from None
        if minimum < 1:
            raise HTTPException(status_code=400, detail=f"Tier {index}: minimum quantity must be at least 1.")
        if maximum is not None and maximum < minimum:
            raise HTTPException(
                status_code=400, detail=f"Tier {index}: maximum quantity must be empty or at least the minimum."
            )
        if price <= 0:
            raise HTTPException(status_code=400, detail=f"Tier {index}: price per unit must be greater than 0.")
        cleaned.append({"min_quantity": minimum, "max_quantity": maximum, "unit_price": price})
    cleaned.sort(key=lambda tier: tier["min_quantity"])
    for previous, current in itertools.pairwise(cleaned):
        if current["min_quantity"] == previous["min_quantity"]:
            raise HTTPException(
                status_code=400,
                detail=f"Two tiers start at {current['min_quantity']:g}; each tier needs its own minimum quantity.",
            )
        if previous["max_quantity"] is None or current["min_quantity"] <= previous["max_quantity"]:
            upper = "and above" if previous["max_quantity"] is None else f"to {previous['max_quantity']:g}"
            raise HTTPException(
                status_code=400,
                detail=f"Tiers overlap: {previous['min_quantity']:g} {upper} and {current['min_quantity']:g}+. "
                "Quantity ranges must not overlap.",
            )
    return cleaned


def replace_tiers(database: Session, listing_id: uuid.UUID, raw_tiers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make this validated set the listing's active tiers (empty = no bulk pricing).
    Nothing is deleted: a tier with the same minimum is updated, a new one added, one
    no longer in the set switched off. The caller commits."""
    cleaned = validate_tiers(raw_tiers)
    existing = {
        Decimal(str(row.min_quantity)): row
        for row in database.scalars(
            select(SupplierBulkPrice).where(SupplierBulkPrice.supplier_product_id == listing_id)
        ).all()
    }
    wanted = set()
    for tier in cleaned:
        wanted.add(tier["min_quantity"])
        row = existing.get(tier["min_quantity"])
        if row is None:
            database.add(SupplierBulkPrice(supplier_product_id=listing_id, is_active=True, **tier))
        else:
            row.max_quantity, row.unit_price, row.is_active = tier["max_quantity"], tier["unit_price"], True
    for minimum, row in existing.items():
        if minimum not in wanted and row.is_active:
            row.is_active = False
    database.flush()
    return tiers_for(database, listing_id)


# ---- payloads ----


def listing_columns(product: SupplierProduct) -> dict[str, Any]:
    """Every column of the listing by its attribute name (the old jsonable_encoder of the
    row, without the relationships it happened to have loaded)."""
    return {
        "id": product.id,
        "supplier_id": product.supplier_id,
        "name": product.name,
        "brand": product.brand,
        "size": product.size,
        "category": product.category,
        "image_url": product.image_url,
        "features": product.features,
        "description": product.description,
        "product_type": product.product_type,
        "grade": product.grade,
        "usage": product.usage,
        "unit": product.unit,
        "price": float(product.price) if product.price is not None else None,
        "quantity": product.quantity,
        "low_stock_threshold": product.low_stock_threshold,
        "stock_alert_state": product.stock_alert_state,
        "is_published": product.is_published,
        "discount_percentage": product.discount_percentage,
        "created_at": product.created_at.isoformat() if product.created_at else None,
        "master_product_id": product.master_product_id,
        "master_variant_id": product.master_variant_id,
    }


def supplier_product_payload(product: SupplierProduct, with_catalog: bool = False) -> dict[str, Any]:
    """One supplier listing as buyers see it; `with_catalog` adds the canonical product
    (and the listed variant) under "catalog"."""
    payload = {
        "id": product.id,
        "master_product_id": product.master_product_id,
        "master_variant_id": product.master_variant_id,
        "name": product.name,
        "brand": product.brand,
        "size": product.size,
        "category": product.category,
        "image_url": product.display_image_url,
        "features": product.features,
        "description": listing_description(product),
        "product_type": product.product_type,
        "grade": product.grade,
        "usage": product.usage,
        "unit": product.unit,
        "price": float(product.price or 0),
        "discount_percentage": float(product.discount_percentage or 0),
        "discounted_price": discounted_price(product.price, product.discount_percentage),
        "quantity": product.quantity,
        "low_stock_threshold": product.low_stock_threshold,
        "stock_status": product.stock_alert_state,
        "is_published": product.is_published,
        "created_at": product.created_at.isoformat() if product.created_at else None,
        "bulk_pricing": tiers_for(object_session(product), product.id),
    }
    if with_catalog and product.master_product_id is not None and product.master_product is not None:
        master = product.master_product
        payload["catalog"] = {
            **catalog_product_payload(master),
            "variant": catalog_variant_payload(product.master_variant, master) if product.master_variant else None,
        }
    return payload


def supplier_listing_response(product: SupplierProduct) -> dict[str, Any]:
    """A supplier's own listing, as its endpoints return it: every column, the picture it
    shows, the catalog description, the discount and the catalog names and pictures."""
    master = product.master_product if product.master_product_id is not None else None
    subcategory = master.subcategory if master is not None else None
    category = subcategory.category if subcategory is not None else None
    return {
        **listing_columns(product),
        "image_url": product.display_image_url,
        "description": listing_description(product),
        "discount_percentage": float(product.discount_percentage or 0),
        "discounted_price": discounted_price(product.price, product.discount_percentage),
        "brand_logo_url": master.brand.logo_url if master is not None and master.brand is not None else None,
        "category_id": category.id if category is not None else None,
        "category_image_url": category.image_url if category is not None else None,
        "subcategory_id": subcategory.id if subcategory is not None else None,
        "subcategory_name": subcategory.name if subcategory is not None else None,
        "bulk_pricing": tiers_for(object_session(product), product.id),
    }


def catalog_entry_payload(product: SupplierProduct) -> dict[str, Any]:
    """A listing with where it sits in the catalog and its brand's logo (the marketplace
    cards and filters)."""
    master = product.master_product
    subcategory = master.subcategory if master is not None else None
    category = subcategory.category if subcategory is not None else None
    return {
        **supplier_product_payload(product),
        "brand_logo_url": master.brand.logo_url if master is not None and master.brand is not None else None,
        "category_id": category.id if category is not None else None,
        "category_name": category.name if category is not None else None,
        "subcategory_id": subcategory.id if subcategory is not None else None,
        "subcategory_name": subcategory.name if subcategory is not None else None,
    }
