"""What site operations reads from the marketplace: the supplier listings stock and
material usage name, and the order lines a supplier fulfilled for a project on a day
(the old daily_cost_repository reads, same answers)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.modules.marketplace.models import STATUS_FULFILLED, PurchaseOrder, PurchaseOrderItem, SupplierProduct


def supplier_listings(database: Session, product_ids: list[Any]) -> list[SupplierProduct]:
    """The supplier listings with these ids (id, price, supplier_id, brand, size ...).
    An id that is not a UUID names no listing."""
    ids = []
    for value in product_ids:
        try:
            ids.append(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))
        except (TypeError, ValueError, AttributeError):
            continue
    if not ids:
        return []
    return list(database.scalars(select(SupplierProduct).where(SupplierProduct.id.in_(ids))).all())


def fulfilled_orders(
    database: Session, project_id: uuid.UUID, start: datetime, end: datetime
) -> list[PurchaseOrderItem]:
    """Order lines fulfilled for the project between two UTC instants, newest first."""
    return list(
        database.scalars(
            select(PurchaseOrderItem)
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
            .where(
                PurchaseOrder.project_id == project_id,
                PurchaseOrderItem.status == STATUS_FULFILLED,
                PurchaseOrderItem.fulfilled_at >= start,
                PurchaseOrderItem.fulfilled_at < end,
            )
            .order_by(desc(PurchaseOrderItem.fulfilled_at), desc(PurchaseOrderItem.id))
        ).all()
    )


# Open purchase-order lines: a supplier still has to deliver them (the old weather rule).
OPEN_LINE_STATUSES = ("PENDING", "ACCEPTED")


def open_order_project_ids(database: Session, supplier_id: uuid.UUID) -> set[uuid.UUID]:
    """Projects this supplier has open order lines for (its delivery destinations)."""
    return set(
        database.scalars(
            select(PurchaseOrder.project_id)
            .join(PurchaseOrderItem, PurchaseOrderItem.purchase_order_id == PurchaseOrder.id)
            .where(PurchaseOrder.supplier_id == supplier_id, PurchaseOrderItem.status.in_(OPEN_LINE_STATUSES))
            .distinct()
        )
    )


def open_order_supplier_ids(database: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    """Suppliers with open order lines for this project."""
    return set(
        database.scalars(
            select(PurchaseOrder.supplier_id)
            .join(PurchaseOrderItem, PurchaseOrderItem.purchase_order_id == PurchaseOrder.id)
            .where(PurchaseOrder.project_id == project_id, PurchaseOrderItem.status.in_(OPEN_LINE_STATUSES))
            .distinct()
        )
    )
