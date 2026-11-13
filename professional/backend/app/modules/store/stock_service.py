"""The store's catalog and stock: items, manual corrections that only lower stock,
the ledger (ported from the old stock_service.py; same rules and answers)."""

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.modules.identity.models import User
from app.modules.projects.access import (
    require_complete_profile,
)
from app.modules.projects.notices import create_notification
from app.modules.store.models import StoreItem, StoreStockMovement
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import StockUpdate, StoreItemCreate, StoreItemUpdate

ITEM_EXISTS = "This product is already in your catalog. Update its stock instead."

# Units counted in whole numbers (bags, rods, buckets ...); any other unit (kg, tonne,
# litre, cft ...) is measured and may take up to three decimals.
COUNT_UNITS = {
    "bag",
    "piece",
    "pc",
    "no",
    "nos",
    "number",
    "unit",
    "rod",
    "bar",
    "bucket",
    "box",
    "bundle",
    "sheet",
    "packet",
    "pack",
    "roll",
    "drum",
    "tin",
    "can",
    "set",
    "pair",
    "length",
    "coil",
    "tile",
    "block",
    "brick",
    "load",
}


# Why stock cannot be added by hand, and what to do instead.
PURCHASE_TO_ADD_STOCK = (
    "Stock is added only when goods from a paid supplier purchase are received. "
    "Use Purchase from Supplier, then mark the delivery received."
)


def is_count_unit(unit: str | None) -> bool:
    word = (unit or "").strip().lower().rstrip(".")
    return (
        word in COUNT_UNITS
        or (word.endswith("es") and word[:-2] in COUNT_UNITS)
        or (word.endswith("s") and word[:-1] in COUNT_UNITS)
    )


def stock_state(item: StoreItem) -> str:
    if item.quantity <= 0:
        return "OUT_OF_STOCK"
    return "LOW_STOCK" if item.quantity <= item.low_stock_threshold else "IN_STOCK"


def item_sources(repository: StoreManagerRepository, store_manager_id, items: list[StoreItem]) -> dict[uuid.UUID, dict]:
    """The picture and description of the supplier product last received into each
    item, so the store's Catalog and its engineers see the product that was bought."""
    sources: dict[uuid.UUID, dict] = {}
    for item_id, product in repository.list_item_source_products(store_manager_id, [item.id for item in items]):
        source = sources.setdefault(item_id, {"image_url": None, "description": None, "subcategory": None})
        if not source["image_url"] and product.display_image_url:
            source["image_url"] = product.display_image_url
        if not source["description"] and (product.description or "").strip():
            source["description"] = product.description.strip()
        master = product.master_product if product.master_product_id is not None else None
        if not source["subcategory"] and master is not None and master.subcategory is not None:
            source["subcategory"] = master.subcategory.name
    return sources


def store_item_payload(item: StoreItem, source: dict | None = None) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "brand": item.brand,
        "variant": item.variant,
        "unit": item.unit,
        "unit_cost": float(item.unit_cost),
        "quantity": float(item.quantity),
        "low_stock_threshold": float(item.low_stock_threshold),
        "stock_state": stock_state(item),
        "is_active": item.is_active,
        "updated_at": local_iso(item.updated_at),
        "image_url": (source or {}).get("image_url"),
        "description": (source or {}).get("description"),
        "subcategory": (source or {}).get("subcategory"),
    }


def engineer_item_payload(
    item: StoreItem, image_url: str | None = None, description: str | None = None, subcategory: str | None = None
) -> dict:
    """What a Site Engineer sees of a store's product: what it is and how much is
    there. Never the purchase price or anything else financial."""
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "brand": item.brand,
        "variant": item.variant,
        "unit": item.unit,
        "quantity": float(item.quantity),
        "stock_state": stock_state(item),
        "image_url": image_url,
        "description": description,
        "subcategory": subcategory,
    }


def movement_payload(row: StoreStockMovement, item: StoreItem | None = None) -> dict:
    payload = {
        "id": row.id,
        "change": float(row.change),
        # The ledger keeps the balance after; the one before follows from it.
        "balance_before": float(Decimal(row.balance_after) - Decimal(row.change)),
        "balance_after": float(row.balance_after),
        "reason": row.reason,
        "reference": row.reference,
        "note": row.note,
        "created_at": local_iso(row.created_at),
    }
    if item is not None:
        payload.update({"item_id": item.id, "item_name": item.name, "unit": item.unit})
    return payload


def record_movement(
    database: Session,
    item: StoreItem,
    change: Decimal,
    reason: str,
    reference: str | None = None,
    note: str | None = None,
    at: datetime | None = None,
) -> None:
    """Apply a quantity change and write its ledger row, together. The only place
    a store item's quantity changes. `at` gives the rows of one hand-over one moment."""
    item.quantity = Decimal(item.quantity) + change
    database.add(
        StoreStockMovement(
            store_item_id=item.id,
            change=change,
            balance_after=item.quantity,
            reason=reason,
            reference=reference,
            note=note,
            **({"created_at": at} if at else {}),
        )
    )


def notify_if_stock_fell(database: Session, item: StoreItem, previous_state: str) -> None:
    state = stock_state(item)
    if state != previous_state and state != "IN_STOCK":
        title = "Out of stock" if state == "OUT_OF_STOCK" else "Low stock"
        create_notification(
            database,
            item.store_manager_id,
            title,
            f"{item.name} now has {item.quantity:g} {item.unit} remaining.",
            category="MATERIAL",
        )


class StockService:
    def __init__(self, repository: StoreManagerRepository):
        self.repository = repository
        self.database = repository.database

    def list_items(self, user: User):
        items = self.repository.list_items(user.id)
        sources = item_sources(self.repository, user.id, items)
        return [store_item_payload(item, sources.get(item.id)) for item in items]

    def own_item(self, user: User, item_id: uuid.UUID) -> StoreItem:
        item = self.repository.lock_item(user.id, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Product not found")
        return item

    def create_item(self, payload: StoreItemCreate, user: User):
        require_complete_profile(user)
        # A product added by hand starts empty: stock only arrives by receiving a paid supplier purchase.
        if payload.quantity:
            raise HTTPException(status_code=400, detail=PURCHASE_TO_ADD_STOCK)
        item = StoreItem(
            store_manager_id=user.id,
            name=payload.name.strip(),
            category=payload.category.strip(),
            brand=(payload.brand or "").strip() or None,
            variant=(payload.variant or "").strip() or None,
            unit=payload.unit.strip(),
            unit_cost=payload.unit_cost,
            quantity=Decimal("0"),
            low_stock_threshold=payload.low_stock_threshold,
        )
        try:
            self.repository.add(item)
            self.database.flush()
            if payload.quantity:
                record_movement(self.database, item, payload.quantity, "INITIAL")
            self.repository.commit()
        except IntegrityError:
            self.repository.rollback()
            raise HTTPException(status_code=409, detail=ITEM_EXISTS) from None
        self.repository.refresh(item)
        return store_item_payload(item)

    def update_item(self, item_id: uuid.UUID, payload: StoreItemUpdate, user: User):
        require_complete_profile(user)
        item = self.own_item(user, item_id)
        for field in payload.model_fields_set:
            value = getattr(payload, field)
            if isinstance(value, str):
                value = value.strip() or None
            if value is None and field not in ("brand", "variant"):
                raise HTTPException(status_code=422, detail=f"{field} cannot be empty.")
            # Stock is counted in the item's unit: changing it while stock is held
            # would silently re-label every quantity (bags -> kg).
            if (
                field == "unit"
                and value
                and value.lower() != (item.unit or "").lower()
                and Decimal(item.quantity or 0) > 0
            ):
                raise HTTPException(
                    status_code=409, detail=f"The unit cannot change while {item.quantity:g} {item.unit} are in stock."
                )
            setattr(item, field, value)
        try:
            self.repository.commit()
        except IntegrityError:
            self.repository.rollback()
            raise HTTPException(status_code=409, detail=ITEM_EXISTS) from None
        self.repository.refresh(item)
        return store_item_payload(item)

    def update_stock(self, item_id: uuid.UUID, payload: StockUpdate, user: User):
        """A manual correction that can only lower stock: REMOVE (damaged, lost, used
        outside a request) or SET to a lower physical count. Stock is never raised by
        hand -- it enters only when a paid supplier purchase is received
        (PurchaseService.receive_line)."""
        require_complete_profile(user)
        item = self.own_item(user, item_id)
        mode = payload.mode.strip().upper()
        if mode == "ADD":
            raise HTTPException(status_code=400, detail=PURCHASE_TO_ADD_STOCK)
        if mode not in {"REMOVE", "SET"}:
            raise HTTPException(status_code=400, detail="Mode must be REMOVE or SET")
        previous_state = stock_state(item)
        current = Decimal(item.quantity)
        change = {"REMOVE": -payload.quantity, "SET": payload.quantity - current}[mode]
        if change > 0:
            raise HTTPException(
                status_code=409,
                detail=f"A stock count can only lower stock (now {current:g} {item.unit}). {PURCHASE_TO_ADD_STOCK}",
            )
        if current + change < 0:
            raise HTTPException(status_code=409, detail=f"Only {current:g} {item.unit} are in stock.")
        if change:
            record_movement(self.database, item, change, "ADJUSTMENT", note=(payload.note or "").strip() or None)
            notify_if_stock_fell(self.database, item, previous_state)
        self.repository.commit()
        self.repository.refresh(item)
        return store_item_payload(item)

    def list_movements(self, item_id: uuid.UUID, user: User):
        if not self.repository.list_items_by_ids(user.id, [item_id]):
            raise HTTPException(status_code=404, detail="Product not found")
        return [movement_payload(row) for row in self.repository.list_movements(item_id)]
