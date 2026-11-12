"""What the projects module reads from or does to the marketplace: an assigned
supplier's published products, and a deleted project's purchase orders."""

import uuid
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.modules.marketplace.listings import supplier_product_payload
from app.modules.marketplace.models import PurchaseOrder


def published_products_by_supplier(
    database: Session, supplier_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """The suppliers' published catalog listings (supplier_product_payload), by supplier,
    by category then name."""
    # Imported here: discovery reads the projects module.
    from app.modules.marketplace.discovery_service import published_listings_of

    products: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for product in published_listings_of(database, list(supplier_ids)):
        products.setdefault(product.supplier_id, []).append(supplier_product_payload(product))
    return products


def delete_project_orders(database: Session, project_id: uuid.UUID) -> None:
    """The project's purchase orders and their lines go with a deleted project, as the
    old purge removed them."""
    database.execute(delete(PurchaseOrder).where(PurchaseOrder.project_id == project_id))
