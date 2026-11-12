"""A Material Supplier's own listings: add from the Master Catalog (or the old free-form
way), price, stock, discount, bulk tiers, delete (ported from the old
supplier_product_service.py; same rules and answers).

A supplier only ever reaches its own listings: every lookup is by listing id AND the
signed-in supplier, so another supplier's listing is "Product not found" (404).
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.catalog_service import find_product, viewer_catalog_country
from app.modules.catalog.models import CatalogProduct, CatalogSubcategory
from app.modules.identity.models import User
from app.modules.marketplace.listings import (
    CANONICAL_LISTING_FIELDS,
    canonical_snapshot,
    catalog_listings,
    listing_columns,
    replace_tiers,
    supplier_listing_response,
    supplier_product_stock_state,
    tiers_for,
)
from app.modules.marketplace.models import PurchaseOrderItem, SupplierProduct
from app.modules.marketplace.pending_links import pending_store_payment_count_for_listing
from app.modules.marketplace.schemas import (
    SupplierBulkPricingUpdate,
    SupplierCatalogListingCreate,
    SupplierProductCreate,
    SupplierProductPriceUpdate,
    SupplierProductUpdate,
)
from app.modules.projects.access import ensure_role

MATERIAL_SUPPLIER_CATEGORY = "Material Supplier"
PRODUCT_NOT_FOUND = "Product not found"


def ensure_material_supplier(user: User) -> None:
    """Material listings belong to Material Suppliers only."""
    ensure_role(user, "SUPPLIER")
    profile = user.supplier_profile
    if not profile or (profile.supplier_category or "").strip() != MATERIAL_SUPPLIER_CATEGORY:
        raise HTTPException(status_code=403, detail="Only a Material Supplier can manage material products.")


class SupplierProductService:
    def __init__(self, database: Session) -> None:
        self.database = database

    # ---- reads ----

    def own_listing(self, product_id: uuid.UUID, user: User) -> SupplierProduct:
        product = self.database.scalars(
            select(SupplierProduct).where(SupplierProduct.id == product_id, SupplierProduct.supplier_id == user.id)
        ).first()
        if not product:
            raise HTTPException(status_code=404, detail=PRODUCT_NOT_FOUND)
        return product

    def fetch_supplier_products(self, user: User) -> list[dict[str, Any]]:
        ensure_role(user, "SUPPLIER")
        statement = (
            catalog_listings(select(SupplierProduct))
            .options(
                selectinload(SupplierProduct.master_product).selectinload(CatalogProduct.brand),
                selectinload(SupplierProduct.master_product).selectinload(CatalogProduct.images),
                selectinload(SupplierProduct.master_product)
                .selectinload(CatalogProduct.subcategory)
                .selectinload(CatalogSubcategory.category),
            )
            .where(SupplierProduct.supplier_id == user.id)
            .order_by(desc(SupplierProduct.created_at))
        )
        return [supplier_listing_response(product) for product in self.database.scalars(statement).all()]

    # ---- writes ----

    def save_supplier_product(self, payload: SupplierProductCreate, user: User) -> dict[str, Any]:
        ensure_material_supplier(user)
        values = payload.model_dump()
        values["name"] = values["name"].strip()
        values["category"] = values["category"].strip()
        values["unit"] = values["unit"].strip()
        values["brand"] = (values.get("brand") or "").strip() or None
        values["size"] = (values.get("size") or "").strip() or None
        if not values["name"] or not values["category"] or not values["unit"]:
            raise HTTPException(status_code=400, detail="Name, material category, and unit are required")
        if values["price"] < 0 or values["quantity"] < 0 or values["low_stock_threshold"] < 0:
            raise HTTPException(status_code=400, detail="Price, stock, and low-stock threshold cannot be negative")
        values["stock_alert_state"] = supplier_product_stock_state(values["quantity"], values["low_stock_threshold"])
        product = SupplierProduct(supplier_id=user.id, **values)
        self.database.add(product)
        self.database.commit()
        self.database.refresh(product)
        # The row itself, as the old endpoint returned it.
        return listing_columns(product)

    def add_supplier_product_from_catalog(self, payload: SupplierCatalogListingCreate, user: User) -> dict[str, Any]:
        ensure_material_supplier(user)
        # Only the supplier's own country's catalog.
        product = find_product(self.database, payload.master_product_id, viewer_catalog_country(user))
        if not product:
            raise HTTPException(status_code=404, detail="That product is not in the catalog.")
        if not product.is_active:
            raise HTTPException(status_code=400, detail="That product is no longer available in the catalog.")

        variant = None
        if payload.master_variant_id is not None:
            variant = next((item for item in product.variants if item.id == payload.master_variant_id), None)
            if not variant:
                raise HTTPException(status_code=400, detail="That variant does not belong to this product.")
            if not variant.is_active:
                raise HTTPException(status_code=400, detail="That variant is no longer available.")
        elif any(item.is_active for item in product.variants):
            # A product that has variants is not sellable without one.
            raise HTTPException(status_code=400, detail="Choose a variant for this product.")

        if payload.price < 0:
            raise HTTPException(status_code=400, detail="Price cannot be negative")
        if payload.quantity < 0 or payload.low_stock_threshold < 0:
            raise HTTPException(status_code=400, detail="Stock and low-stock threshold cannot be negative")

        variant_id = variant.id if variant else None
        existing = self.database.scalars(
            select(SupplierProduct.id).where(
                SupplierProduct.supplier_id == user.id,
                SupplierProduct.master_product_id == product.id,
                SupplierProduct.master_variant_id.is_(None)
                if variant_id is None
                else SupplierProduct.master_variant_id == variant_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=409, detail="That product is already in your catalog. Edit its price instead."
            )

        listing = SupplierProduct(
            supplier_id=user.id,
            master_product_id=product.id,
            master_variant_id=variant_id,
            price=payload.price,
            quantity=payload.quantity,
            low_stock_threshold=payload.low_stock_threshold,
            stock_alert_state=supplier_product_stock_state(payload.quantity, payload.low_stock_threshold),
            is_published=payload.is_published,
            discount_percentage=payload.discount_percentage,
            **canonical_snapshot(product, variant),
        )
        self.database.add(listing)
        self.database.commit()
        self.database.refresh(listing)
        return supplier_listing_response(listing)

    def update_supplier_product_price(
        self, product_id: uuid.UUID, payload: SupplierProductPriceUpdate, user: User
    ) -> dict[str, Any]:
        ensure_material_supplier(user)
        product = self.own_listing(product_id, user)
        if payload.price < 0:
            raise HTTPException(status_code=400, detail="Price cannot be negative")
        product.price = payload.price  # type: ignore[assignment]
        self.database.commit()
        self.database.refresh(product)
        return supplier_listing_response(product)

    def update_supplier_product(
        self, product_id: uuid.UUID, payload: SupplierProductUpdate, user: User
    ) -> dict[str, Any]:
        ensure_material_supplier(user)
        product = self.own_listing(product_id, user)
        updates = payload.model_dump(exclude_unset=True)
        for field in ("price", "quantity", "low_stock_threshold"):
            if field in updates and updates[field] is not None and updates[field] < 0:
                raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} cannot be negative")
        # A catalog listing's canonical fields belong to the catalog.
        if product.master_product_id is not None:
            locked = CANONICAL_LISTING_FIELDS.intersection(updates)
            if locked:
                raise HTTPException(
                    status_code=400,
                    detail="This product's details come from the master catalog and cannot be edited here: "
                    + ", ".join(sorted(locked)),
                )
        for field, value in updates.items():
            setattr(product, field, value)
        product.stock_alert_state = supplier_product_stock_state(product.quantity, product.low_stock_threshold)
        self.database.commit()
        self.database.refresh(product)
        return supplier_listing_response(product)

    def fetch_supplier_bulk_pricing(self, product_id: uuid.UUID, user: User) -> dict[str, Any]:
        ensure_role(user, "SUPPLIER")
        product = self.own_listing(product_id, user)
        return {
            "product_id": product.id,
            "normal_price": float(product.price or 0),
            "tiers": tiers_for(self.database, product.id),
        }

    def save_supplier_bulk_pricing(
        self, product_id: uuid.UUID, payload: SupplierBulkPricingUpdate, user: User
    ) -> dict[str, Any]:
        ensure_material_supplier(user)
        product = self.own_listing(product_id, user)
        tiers = replace_tiers(self.database, product.id, payload.tiers)
        self.database.commit()
        return {"product_id": product.id, "normal_price": float(product.price or 0), "tiers": tiers}

    def delete_supplier_product(self, product_id: uuid.UUID, user: User) -> dict[str, Any]:
        ensure_material_supplier(user)
        product = self.own_listing(product_id, user)
        # A listing that was ever ordered is the buyers' order history: never deleted.
        orders = self.database.scalar(
            select(func.count(PurchaseOrderItem.id)).where(PurchaseOrderItem.product_id == product.id)
        )
        payments = pending_store_payment_count_for_listing(self.database, product.id)
        if orders or payments:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{product.name} has order history, so it cannot be deleted. "
                    "Unpublish it instead to hide it from buyers; its past orders and payments are kept."
                ),
            )
        # Project stock and material usage keep their rows and lose the link (SET NULL);
        # the listing's tiers and the cart lines naming it go with it (CASCADE).
        self.database.delete(product)
        self.database.commit()
        return {"deleted": True, "removed_requests": 0}
