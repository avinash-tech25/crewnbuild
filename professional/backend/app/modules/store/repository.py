"""The Store Manager's reads and row locks (ported from the old
store_manager_repository.py; same reads). A purchase line's buyer, order number and
project now live on its purchase order, so those filters join purchase_orders."""

import uuid
from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.modules.marketplace.models import PurchaseOrder, PurchaseOrderItem, SupplierProduct
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import ContractorEngineer, Project, ProjectEngineer
from app.modules.store.models import (
    StoreBuilderRequest,
    StoreItem,
    StorePaymentRecord,
    StorePurchaseReceipt,
    StoreSiteRequest,
    StoreSiteRequestLine,
    StoreStockMovement,
)


def purchase_lines() -> Any:
    """Purchase order lines with their order joined (buyer, order number, project)."""
    return select(PurchaseOrderItem).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)


class StoreManagerRepository(BaseRepository[StoreItem]):
    def __init__(self, database: Session) -> None:
        super().__init__(database, StoreItem)

    def get_user(self, user_id: Any) -> User | None:
        return self.database.get(User, user_id) if user_id else None

    def get_project(self, project_id: Any) -> Project | None:
        return self.database.get(Project, project_id) if project_id else None

    # ---- items ----

    def list_items(self, store_manager_id: uuid.UUID, active_only: bool = False) -> list[StoreItem]:
        query = self.database.query(StoreItem).filter(StoreItem.store_manager_id == store_manager_id)
        if active_only:
            query = query.filter(StoreItem.is_active.is_(True))
        return query.order_by(StoreItem.category, StoreItem.name).all()

    def list_items_by_ids(self, store_manager_id: uuid.UUID, item_ids: Iterable[Any]) -> list[StoreItem]:
        ids = [item_id for item_id in item_ids if item_id]
        if not ids:
            return []
        return (
            self.database.query(StoreItem)
            .filter(StoreItem.store_manager_id == store_manager_id, StoreItem.id.in_(ids))
            .all()
        )

    def lock_item(self, store_manager_id: uuid.UUID, item_id: Any) -> StoreItem | None:
        return (
            self.database.query(StoreItem)
            .filter(StoreItem.id == item_id, StoreItem.store_manager_id == store_manager_id)
            .with_for_update()
            .first()
        )

    def lock_items(self, store_manager_id: uuid.UUID, item_ids: Iterable[Any]) -> list[StoreItem]:
        # In id order, so two issues sharing products cannot deadlock.
        ids = [item_id for item_id in item_ids if item_id]
        if not ids:
            return []
        return (
            self.database.query(StoreItem)
            .filter(StoreItem.store_manager_id == store_manager_id, StoreItem.id.in_(ids))
            .order_by(StoreItem.id)
            .with_for_update()
            .all()
        )

    def lock_item_by_identity(
        self, store_manager_id: uuid.UUID, name: str, unit: str, variant: str | None = None, brand: str | None = None
    ) -> StoreItem | None:
        """The store's product for this name, unit and variant: the same variant, or one
        kept before it had a variant. With a brand, an item of a DIFFERENT brand is never
        matched; a brand-less item can still take this one."""
        rows = (
            self.database.query(StoreItem)
            .filter(
                StoreItem.store_manager_id == store_manager_id,
                func.lower(StoreItem.name) == name.lower(),
                func.lower(StoreItem.unit) == unit.lower(),
            )
            .order_by(StoreItem.created_at, StoreItem.id)
            .with_for_update()
            .all()
        )
        wanted_brand = (brand or "").strip().lower()
        if wanted_brand:
            rows = [
                row
                for row in rows
                if not (row.brand or "").strip() or (row.brand or "").strip().lower() == wanted_brand
            ]
        wanted = (variant or "").strip().lower()
        same = next((row for row in rows if (row.variant or "").strip().lower() == wanted), None)
        return same or next((row for row in rows if not row.variant), None)

    def lock_item_exact(
        self, store_manager_id: uuid.UUID, name: str, brand: str | None, unit: str, variant: str | None
    ) -> StoreItem | None:
        """The store's product with exactly this identity (uq_store_items__identity)."""
        return (
            self.database.query(StoreItem)
            .filter(
                StoreItem.store_manager_id == store_manager_id,
                func.lower(StoreItem.name) == name.lower(),
                func.lower(func.coalesce(StoreItem.brand, "")) == (brand or "").lower(),
                func.lower(StoreItem.unit) == unit.lower(),
                func.lower(func.coalesce(StoreItem.variant, "")) == (variant or "").lower(),
            )
            .with_for_update()
            .first()
        )

    def list_movements(self, item_id: uuid.UUID) -> list[StoreStockMovement]:
        return (
            self.database.query(StoreStockMovement)
            .filter(StoreStockMovement.store_item_id == item_id)
            .order_by(desc(StoreStockMovement.created_at), desc(StoreStockMovement.id))
            .limit(100)
            .all()
        )

    # ---- site requests ----

    def list_site_requests(
        self, store_manager_id: uuid.UUID, status: str | None = None, public_request_id: uuid.UUID | None = None
    ) -> list[StoreSiteRequest]:
        query = self.database.query(StoreSiteRequest).filter(StoreSiteRequest.store_manager_id == store_manager_id)
        if status:
            query = query.filter(StoreSiteRequest.status == status)
        if public_request_id is not None:
            query = query.filter(StoreSiteRequest.id == public_request_id)
        return query.order_by(desc(StoreSiteRequest.created_at)).all()

    def list_engineer_requests(
        self, engineer_id: uuid.UUID, project_id: uuid.UUID | None = None, public_request_id: uuid.UUID | None = None
    ) -> list[StoreSiteRequest]:
        query = self.database.query(StoreSiteRequest).filter(StoreSiteRequest.engineer_id == engineer_id)
        if project_id is not None:
            query = query.filter(StoreSiteRequest.project_id == project_id)
        if public_request_id is not None:
            query = query.filter(StoreSiteRequest.id == public_request_id)
        return query.order_by(desc(StoreSiteRequest.created_at)).all()

    def lock_site_request(self, store_manager_id: uuid.UUID, request_id: Any) -> StoreSiteRequest | None:
        return (
            self.database.query(StoreSiteRequest)
            .filter(StoreSiteRequest.id == request_id, StoreSiteRequest.store_manager_id == store_manager_id)
            .with_for_update()
            .first()
        )

    def lock_engineer_request(self, engineer_id: uuid.UUID, request_id: Any) -> StoreSiteRequest | None:
        return (
            self.database.query(StoreSiteRequest)
            .filter(StoreSiteRequest.id == request_id, StoreSiteRequest.engineer_id == engineer_id)
            .with_for_update()
            .first()
        )

    def list_request_lines(self, request_id: uuid.UUID) -> list[StoreSiteRequestLine]:
        return (
            self.database.query(StoreSiteRequestLine)
            .filter(StoreSiteRequestLine.request_id == request_id)
            .order_by(StoreSiteRequestLine.created_at, StoreSiteRequestLine.id)
            .all()
        )

    # ---- builders and projects ----

    def list_active_builder_ids(self, engineer_id: uuid.UUID) -> list[uuid.UUID]:
        return list(
            self.database.scalars(
                select(ContractorEngineer.contractor_id).where(
                    ContractorEngineer.engineer_id == engineer_id, ContractorEngineer.status == "ACTIVE"
                )
            ).all()
        )

    def list_builder_projects(self, builder_ids: list[uuid.UUID]) -> list[Project]:
        if not builder_ids:
            return []
        return (
            self.database.query(Project)
            .filter(Project.contractor_id.in_(builder_ids))
            .order_by(desc(Project.created_at))
            .all()
        )

    def list_engineer_projects(self, engineer_id: uuid.UUID) -> list[Project]:
        return (
            self.database.query(Project)
            .join(ProjectEngineer, ProjectEngineer.project_id == Project.id)
            .filter(ProjectEngineer.engineer_id == engineer_id, ProjectEngineer.status == "ACTIVE")
            .all()
        )

    def list_builder_team_members(self, builder_id: uuid.UUID) -> list[User]:
        """A builder's active team; the caller keeps the Store Managers."""
        return (
            self.database.query(User)
            .join(ContractorEngineer, ContractorEngineer.engineer_id == User.id)
            .filter(ContractorEngineer.contractor_id == builder_id, ContractorEngineer.status == "ACTIVE")
            .all()
        )

    def is_active_team_pair(self, builder_id: uuid.UUID, store_manager_id: uuid.UUID) -> bool:
        return (
            self.database.query(ContractorEngineer.id)
            .filter(
                ContractorEngineer.contractor_id == builder_id,
                ContractorEngineer.engineer_id == store_manager_id,
                ContractorEngineer.status == "ACTIVE",
            )
            .first()
        ) is not None

    # ---- Builder <-> Store Manager requests ----

    def list_builder_requests(
        self, *, store_manager_id: uuid.UUID | None = None, builder_id: uuid.UUID | None = None
    ) -> list[StoreBuilderRequest]:
        query = self.database.query(StoreBuilderRequest)
        if store_manager_id is not None:
            query = query.filter(StoreBuilderRequest.store_manager_id == store_manager_id)
        if builder_id is not None:
            query = query.filter(StoreBuilderRequest.builder_id == builder_id)
        return query.order_by(desc(StoreBuilderRequest.created_at), desc(StoreBuilderRequest.id)).all()

    def lock_builder_request(self, request_id: Any) -> StoreBuilderRequest | None:
        return (
            self.database.query(StoreBuilderRequest)
            .filter(StoreBuilderRequest.id == request_id)
            .with_for_update()
            .first()
        )

    def list_served_engineer_ids(self, store_manager_id: uuid.UUID) -> list[uuid.UUID]:
        """The Site Engineers actively on a project of a builder whose team this Store
        Manager is on: everyone whose Store lists this store's stock."""
        builder_ids = select(ContractorEngineer.contractor_id).where(
            ContractorEngineer.engineer_id == store_manager_id, ContractorEngineer.status == "ACTIVE"
        )
        rows = self.database.scalars(
            select(ProjectEngineer.engineer_id)
            .join(Project, Project.id == ProjectEngineer.project_id)
            .where(Project.contractor_id.in_(builder_ids), ProjectEngineer.status == "ACTIVE")
            .distinct()
        ).all()
        return [row for row in rows if row != store_manager_id]

    # ---- purchases ----

    def list_purchase_lines(self, store_manager_id: uuid.UUID) -> list[PurchaseOrderItem]:
        return list(
            self.database.scalars(
                purchase_lines()
                .where(PurchaseOrder.buyer_id == store_manager_id)
                .order_by(desc(PurchaseOrderItem.created_at), PurchaseOrderItem.id)
            ).all()
        )

    def lock_purchase_line(self, store_manager_id: uuid.UUID, line_id: Any) -> PurchaseOrderItem | None:
        return self.database.scalars(
            purchase_lines()
            .where(PurchaseOrderItem.id == line_id, PurchaseOrder.buyer_id == store_manager_id)
            .with_for_update(of=PurchaseOrderItem)
        ).first()

    def lock_purchase_order(self, store_manager_id: uuid.UUID, request_code: str) -> list[PurchaseOrderItem]:
        return list(
            self.database.scalars(
                purchase_lines()
                .where(PurchaseOrder.order_number == request_code, PurchaseOrder.buyer_id == store_manager_id)
                .order_by(PurchaseOrderItem.created_at, PurchaseOrderItem.id)
                .with_for_update(of=PurchaseOrderItem)
            ).all()
        )

    def received_quantity(self, line_id: uuid.UUID) -> Decimal:
        """What has arrived of one purchase line so far, over all its receipts."""
        return self.database.scalar(
            select(func.coalesce(func.sum(StorePurchaseReceipt.quantity), 0)).where(
                StorePurchaseReceipt.order_line_id == line_id
            )
        )

    def find_receipt_by_key(self, receipt_key: str) -> StorePurchaseReceipt | None:
        return self.database.query(StorePurchaseReceipt).filter(StorePurchaseReceipt.receipt_key == receipt_key).first()

    def list_receipts(self, store_manager_id: uuid.UUID) -> list[StorePurchaseReceipt]:
        return (
            self.database.query(StorePurchaseReceipt)
            .filter(StorePurchaseReceipt.store_manager_id == store_manager_id)
            .all()
        )

    # ---- supplier stock a Buy may still take ----

    def lock_supplier_products(self, supplier_id: uuid.UUID, product_ids: list[Any]) -> list[SupplierProduct]:
        """The supplier's listings, row-locked in id order."""
        if not product_ids:
            return []
        return (
            self.database.query(SupplierProduct)
            .filter(SupplierProduct.supplier_id == supplier_id, SupplierProduct.id.in_(product_ids))
            .order_by(SupplierProduct.id)
            .with_for_update()
            .all()
        )

    def committed_supplier_quantities(self, product_ids: list[uuid.UUID]) -> dict[uuid.UUID, Any]:
        """Per listing, what is already promised out of its stock: lines the supplier
        accepted and has not delivered, and lines of a Store Manager purchase already
        PAID but not yet accepted."""
        if not product_ids:
            return {}
        paid_codes = select(StorePaymentRecord.request_code).where(StorePaymentRecord.status == "PAID")
        rows = self.database.execute(
            select(PurchaseOrderItem.product_id, func.coalesce(func.sum(PurchaseOrderItem.quantity), 0))
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
            .where(
                PurchaseOrderItem.product_id.in_(product_ids),
                or_(
                    PurchaseOrderItem.status == "ACCEPTED",
                    and_(PurchaseOrderItem.status == "PENDING", PurchaseOrder.order_number.in_(paid_codes)),
                ),
            )
            .group_by(PurchaseOrderItem.product_id)
        ).all()
        return dict(rows)  # type: ignore[arg-type]

    def list_open_checkouts(self, since: datetime) -> list[StorePaymentRecord]:
        """Razorpay checkouts started since `since` and not yet paid or failed."""
        return (
            self.database.query(StorePaymentRecord)
            .filter(
                StorePaymentRecord.status == "CREATED",
                StorePaymentRecord.method == "RAZORPAY",
                StorePaymentRecord.created_at >= since,
            )
            .all()
        )

    def lock_payment(self, store_manager_id: uuid.UUID, payment_id: Any) -> StorePaymentRecord | None:
        return (
            self.database.query(StorePaymentRecord)
            .filter(StorePaymentRecord.id == payment_id, StorePaymentRecord.store_manager_id == store_manager_id)
            .with_for_update()
            .first()
        )

    def find_paid_checkout(self, store_manager_id: uuid.UUID, request_code: str) -> StorePaymentRecord | None:
        return (
            self.database.query(StorePaymentRecord)
            .filter(
                StorePaymentRecord.store_manager_id == store_manager_id,
                StorePaymentRecord.request_code == request_code,
                StorePaymentRecord.method == "RAZORPAY",
                StorePaymentRecord.status == "PAID",
            )
            .first()
        )

    def list_site_request_payments(self, site_request_id: uuid.UUID) -> list[StorePaymentRecord]:
        """The Razorpay purchases made to cover this request's shortage."""
        return (
            self.database.query(StorePaymentRecord)
            .filter(StorePaymentRecord.site_request_id == site_request_id)
            .order_by(StorePaymentRecord.created_at, StorePaymentRecord.id)
            .all()
        )

    def list_receipts_for_codes(self, request_codes: list[str]) -> list[Any]:
        if not request_codes:
            return []
        return list(
            self.database.execute(
                select(StorePurchaseReceipt, PurchaseOrderItem)
                .join(PurchaseOrderItem, PurchaseOrderItem.id == StorePurchaseReceipt.order_line_id)
                .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
                .where(PurchaseOrder.order_number.in_(request_codes))
                .order_by(StorePurchaseReceipt.received_at)
            ).all()
        )

    def list_purchase_lines_for_codes(self, request_codes: list[str]) -> list[PurchaseOrderItem]:
        """The supplier order lines of these Buys, oldest first."""
        if not request_codes:
            return []
        return list(
            self.database.scalars(
                purchase_lines()
                .where(PurchaseOrder.order_number.in_(request_codes))
                .order_by(PurchaseOrderItem.created_at, PurchaseOrderItem.id)
            ).all()
        )

    def list_request_issue_times(self, request_id: uuid.UUID) -> list[datetime]:
        """When each ledger row handing this request's products over was written."""
        return list(
            self.database.scalars(
                select(StoreStockMovement.created_at)
                .where(StoreStockMovement.reason == "ISSUE", StoreStockMovement.reference == f"REQUEST-{request_id}")
                .order_by(StoreStockMovement.created_at)
            ).all()
        )

    def list_item_source_products(self, store_manager_id: uuid.UUID, item_ids: list[Any]) -> list[Any]:
        """(store item id, supplier listing) for every purchase received into these
        items, newest first: where an item's picture and catalog identity come from."""
        ids = [item_id for item_id in item_ids if item_id]
        if not ids:
            return []
        return list(
            self.database.execute(
                select(StorePurchaseReceipt.store_item_id, SupplierProduct)
                .join(PurchaseOrderItem, PurchaseOrderItem.id == StorePurchaseReceipt.order_line_id)
                .join(SupplierProduct, SupplierProduct.id == PurchaseOrderItem.product_id)
                .where(
                    StorePurchaseReceipt.store_manager_id == store_manager_id,
                    StorePurchaseReceipt.store_item_id.in_(ids),
                )
                .order_by(desc(StorePurchaseReceipt.received_at))
            ).all()
        )

    def list_recent_movements(self, store_manager_id: uuid.UUID, limit: int = 10) -> list[Any]:
        return (
            self.database.query(StoreStockMovement, StoreItem)
            .join(StoreItem, StoreItem.id == StoreStockMovement.store_item_id)
            .filter(StoreItem.store_manager_id == store_manager_id)
            .order_by(desc(StoreStockMovement.created_at), desc(StoreStockMovement.id))
            .limit(limit)
            .all()
        )

    # ---- payments ----

    def list_payments(self, store_manager_id: uuid.UUID) -> list[StorePaymentRecord]:
        return (
            self.database.query(StorePaymentRecord)
            .filter(StorePaymentRecord.store_manager_id == store_manager_id)
            .order_by(desc(StorePaymentRecord.created_at), desc(StorePaymentRecord.id))
            .all()
        )
