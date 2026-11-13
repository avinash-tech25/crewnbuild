"""What other modules read from the store: payments naming a supplier or one of its
listings (account deletion, listing deletion), a Store Manager's records others rely on
and the projects holding an engineer's store requests (account deletion; the old
purge_repository reads), and open site requests (weather; open = PENDING, APPROVED or
PARTIALLY_ISSUED, as the old weather rule had it)."""

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.marketplace.models import SupplierProduct
from app.modules.store.models import StorePaymentRecord, StorePurchaseReceipt, StoreSiteRequest

OPEN_SITE_REQUEST_STATUSES = ("PENDING", "APPROVED", "PARTIALLY_ISSUED")


def _count(database: Session, statement: Any) -> int:
    return int(database.scalar(statement) or 0)


def names_listing(listing_id: uuid.UUID) -> Any:
    """A payment whose checkout snapshot lists this listing (ids kept as text)."""
    return StorePaymentRecord.items.contains([{"product_id": str(listing_id)}])


def payment_count_for_listing(database: Session, listing_id: uuid.UUID) -> int:
    """Store Manager payments whose checkout snapshot lists this listing: a CREATED or
    FAILED one can still be captured and turned into order lines, so they count too."""
    return _count(database, select(func.count(StorePaymentRecord.id)).where(names_listing(listing_id)))


def supplier_payment_count(database: Session, supplier_id: uuid.UUID) -> int:
    """Store Manager payment records with this supplier or naming one of its listings."""
    listing_ids = database.scalars(select(SupplierProduct.id).where(SupplierProduct.supplier_id == supplier_id)).all()
    conditions = [StorePaymentRecord.supplier_id == supplier_id] + [names_listing(item) for item in listing_ids]
    return _count(database, select(func.count(StorePaymentRecord.id)).where(or_(*conditions)))


def store_manager_history_count(database: Session, store_manager_id: uuid.UUID) -> int:
    """Site Engineers' requests to this store, its payments and its goods receipts."""
    return (
        _count(
            database,
            select(func.count(StoreSiteRequest.id)).where(StoreSiteRequest.store_manager_id == store_manager_id),
        )
        + _count(
            database,
            select(func.count(StorePaymentRecord.id)).where(StorePaymentRecord.store_manager_id == store_manager_id),
        )
        + _count(
            database,
            select(func.count(StorePurchaseReceipt.id)).where(
                StorePurchaseReceipt.store_manager_id == store_manager_id
            ),
        )
    )


def engineer_request_project_ids(database: Session, engineer_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding this engineer's store requests."""
    return list(
        set(database.scalars(select(StoreSiteRequest.project_id).where(StoreSiteRequest.engineer_id == engineer_id)))
    )


def open_request_project_ids(database: Session, store_manager_id: uuid.UUID) -> set[uuid.UUID]:
    """Projects this Store Manager has open site requests for (delivery destinations)."""
    return set(
        database.scalars(
            select(StoreSiteRequest.project_id)
            .where(
                StoreSiteRequest.store_manager_id == store_manager_id,
                StoreSiteRequest.status.in_(OPEN_SITE_REQUEST_STATUSES),
            )
            .distinct()
        )
    )


def open_request_store_manager_ids(database: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    """Store Managers with open site requests for this project."""
    return set(
        database.scalars(
            select(StoreSiteRequest.store_manager_id)
            .where(StoreSiteRequest.project_id == project_id, StoreSiteRequest.status.in_(OPEN_SITE_REQUEST_STATUSES))
            .distinct()
        )
    )
