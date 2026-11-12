"""What account deletion and file access read from the marketplace: a supplier's or
buyer's order history (the old purge_repository counts), the projects holding an
engineer's orders, the pictures on a supplier's own listings, and the listings removed
with a deleted supplier (the old purge deleted them)."""

import uuid

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.modules.files.file_ownership import file_ids_in
from app.modules.marketplace.models import PurchaseOrder, PurchaseOrderItem, SupplierProduct


def supplier_order_line_count(database: Session, supplier_id: uuid.UUID) -> int:
    """Order lines of this supplier's orders, or naming one of its listings."""
    own_listings = select(SupplierProduct.id).where(SupplierProduct.supplier_id == supplier_id)
    return (
        database.scalar(
            select(func.count(PurchaseOrderItem.id))
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
            .where(or_(PurchaseOrder.supplier_id == supplier_id, PurchaseOrderItem.product_id.in_(own_listings)))
        )
        or 0
    )


def buyer_order_line_count(database: Session, buyer_id: uuid.UUID) -> int:
    """Order lines a Store Manager (or any buyer) placed: the suppliers' sales history."""
    return (
        database.scalar(
            select(func.count(PurchaseOrderItem.id))
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
            .where(PurchaseOrder.buyer_id == buyer_id)
        )
        or 0
    )


def buyer_order_project_ids(database: Session, buyer_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding purchase orders this account placed."""
    return list(database.scalars(select(PurchaseOrder.project_id).where(PurchaseOrder.buyer_id == buyer_id).distinct()))


def is_supplier_listing_image(database: Session, supplier_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """A picture on one of the supplier's own (pre-catalog) listings."""
    urls = database.scalars(
        select(SupplierProduct.image_url).where(
            SupplierProduct.supplier_id == supplier_id, SupplierProduct.image_url.isnot(None)
        )
    ).all()
    return file_id in file_ids_in(*urls)


def remove_supplier_listings(database: Session, supplier_id: uuid.UUID) -> None:
    """A deleted supplier's listings go (their tiers and cart lines with them; stock and
    usage keep their rows, unlinked). Deletion is refused while any listing has order
    history, so no order line names one."""
    database.execute(delete(SupplierProduct).where(SupplierProduct.supplier_id == supplier_id))
