"""Purchase orders: a House Owner's (or Store Manager's) buy request to one supplier, the
supplier's decision on a whole order or one line, and fulfilment into the project's
stock (ported from the old material_request_service.py and material_request_repository.py;
same rules, answers and notifications).

One buy request is one purchase order (order_number = the old request_code) with its
lines below it. A supplier only reaches lines of its own orders (supplier = them), so
another supplier's order is "not found" (404); a buyer only reads their own orders.
"""

import uuid
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso, local_workflow_now
from app.database.types import naive_utc_now
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.identity.models import ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.marketplace.cart import ensure_buyer, ensure_buyer_project_access, ensure_supplier_approved
from app.modules.marketplace.listings import supplier_product_stock_state, tiers_for, unit_price_for
from app.modules.marketplace.models import (
    STATUS_ACCEPTED,
    STATUS_FULFILLED,
    STATUS_PENDING,
    STATUS_REJECTED,
    PurchaseOrder,
    PurchaseOrderItem,
    SupplierProduct,
)
from app.modules.marketplace.schemas import MaterialRequestCreate, MaterialRequestDecision
from app.modules.projects.access import ensure_role, require_complete_profile, resolve_project_contractor
from app.modules.projects.models import Project, ProjectTimeline
from app.modules.projects.notices import create_notification, create_request_notification
from app.modules.site_operations.models import MaterialLog
from app.modules.site_operations.service import get_or_create_inventory

SITE_ENGINEER_USES_STORE = (
    "Site Engineers request materials from their Builder's Store Manager, not from a supplier. "
    "Open Suppliers > Store to send this request."
)


def money(value: Any) -> float:
    return float(value or 0)


def number(value: Any) -> Any:
    """A number as the old line payload had it: whole numbers as integers."""
    if value is None:
        return None
    numeric = float(value)
    return int(numeric) if numeric.is_integer() else numeric


def supplier_store_name(supplier: User | None) -> str:
    """The supplier's registered store name, else their account name."""
    profile = supplier.supplier_profile if supplier else None
    return (profile.store_name if profile and profile.store_name else None) or (
        supplier.name if supplier else "the supplier"
    )


def purchase_request_summary(rows: list[PurchaseOrderItem]) -> str:
    """'Dalmia OPC 53 Grade Cement (Bag) x 1 @ Rs 200; ...' for a notification."""
    parts = []
    for row in rows:
        size = f" ({row.unit})" if row.unit else ""
        parts.append(f"{row.material_name}{size} x {row.quantity:g} @ Rs {float(row.price or 0):g}")
    return "; ".join(parts)


def order_line_fields(row: PurchaseOrderItem) -> dict[str, Any]:
    """The old material_order_items row, column by column."""
    return {
        "id": row.id,
        "request_code": row.request_code,
        "project_id": row.project_id,
        "engineer_id": row.engineer_id,
        "supplier_id": row.supplier_id,
        "product_id": row.product_id,
        "material_name": row.material_name,
        "category": row.category,
        "price": number(row.price),
        "quantity": number(row.quantity),
        "unit": row.unit,
        "status": row.status,
        "created_at": local_iso(row.created_at),
        "fulfilled_at": local_iso(row.fulfilled_at),
    }


def material_request_payload(database: Session, row: PurchaseOrderItem) -> dict[str, Any]:
    project = database.get(Project, row.project_id)
    engineer = database.get(User, row.engineer_id)
    supplier = database.get(User, row.supplier_id)
    owner = database.get(User, project.owner_id) if project and project.owner_id else None
    product = database.get(SupplierProduct, row.product_id)
    return {
        **order_line_fields(row),
        "project_name": project.title if project else "",
        "engineer_name": engineer.name if engineer else "",
        "engineer_role": engineer.role if engineer else "",
        "buyer_is_store_manager": bool(engineer and is_store_manager(engineer)),
        "owner_name": owner.name if owner else "",
        "supplier_name": supplier.name if supplier else "",
        "image_url": product.display_image_url if product else None,
        "brand": product.brand if product else None,
        "size": product.size if product else None,
        "project_pincode": project.pincode if project else None,
        "project_city": project.project_city if project else None,
        "subcategory_name": (
            product.master_product.subcategory.name
            if product and product.master_product and product.master_product.subcategory
            else None
        ),
    }


def notify_purchase_decision(database: Session, supplier: User, rows: list[PurchaseOrderItem], accepted: bool) -> None:
    """The buyer's notification for a decision on one order, and the supplier's own
    confirmation; committed with the status change or not at all."""
    first = rows[0]
    code = first.request_code[:8].upper()
    project = database.get(Project, first.project_id)
    buyer = database.get(User, first.engineer_id)
    store = supplier_store_name(supplier)
    title = (
        "Your order has been accepted. Your delivery is on the way."
        if accepted
        else "Your order has been rejected by the supplier."
    )
    create_request_notification(
        database,
        first.engineer_id,
        title,
        f"Purchase request #{code} · Supplier: {store} · {purchase_request_summary(rows)}"
        + (f" · Project: {project.title}" if project else ""),
        category="MATERIAL",
    )
    create_request_notification(
        database,
        supplier.id,
        "Order accepted successfully." if accepted else "Order rejected successfully.",
        f"{buyer.name if buyer else 'The buyer'} has been notified. Purchase request #{code}"
        + (f" · Project: {project.title}" if project else ""),
        category="MATERIAL",
    )


class MaterialRequestService:
    def __init__(self, database: Session) -> None:
        self.database = database

    # ---- reads ----

    def lines(self) -> Any:
        return select(PurchaseOrderItem).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)

    def fetch_supplier_material_requests(self, user: User) -> list[dict[str, Any]]:
        ensure_role(user, "SUPPLIER")
        rows = self.database.scalars(
            self.lines()
            .where(PurchaseOrder.supplier_id == user.id)
            .order_by(desc(PurchaseOrderItem.created_at), desc(PurchaseOrderItem.id))
        ).all()
        return [material_request_payload(self.database, row) for row in rows]

    def fetch_my_material_requests(self, user: User, project_id: uuid.UUID | None) -> list[dict[str, Any]]:
        # Owners order materials too, so both buyer roles read their own orders back.
        ensure_buyer(user)
        statement = self.lines().where(PurchaseOrder.buyer_id == user.id)
        if project_id is not None:
            statement = statement.where(PurchaseOrder.project_id == project_id)
        rows = self.database.scalars(
            statement.order_by(desc(PurchaseOrderItem.created_at), desc(PurchaseOrderItem.id))
        ).all()
        return [material_request_payload(self.database, row) for row in rows]

    # ---- locks ----

    def lock_supplier_request(self, request_id: uuid.UUID, supplier_id: uuid.UUID) -> PurchaseOrderItem | None:
        return self.database.scalars(
            self.lines()
            .where(PurchaseOrderItem.id == request_id, PurchaseOrder.supplier_id == supplier_id)
            .with_for_update(of=PurchaseOrderItem)
        ).first()

    def lock_purchase_request_lines(self, request_code: str, supplier_id: uuid.UUID) -> list[PurchaseOrderItem]:
        return list(
            self.database.scalars(
                self.lines()
                .where(PurchaseOrder.order_number == request_code, PurchaseOrder.supplier_id == supplier_id)
                .order_by(PurchaseOrderItem.created_at, PurchaseOrderItem.id)
                .with_for_update(of=PurchaseOrderItem)
            ).all()
        )

    def lock_supplier_product(self, product_id: uuid.UUID, supplier_id: uuid.UUID) -> SupplierProduct | None:
        return self.database.scalars(
            select(SupplierProduct)
            .where(SupplierProduct.id == product_id, SupplierProduct.supplier_id == supplier_id)
            .with_for_update()
        ).first()

    def find_other_accepted_line_id(
        self, request_code: str, supplier_id: uuid.UUID, request_id: uuid.UUID
    ) -> uuid.UUID | None:
        return self.database.scalars(
            select(PurchaseOrderItem.id)
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
            .where(
                PurchaseOrder.order_number == request_code,
                PurchaseOrder.supplier_id == supplier_id,
                PurchaseOrderItem.id != request_id,
                PurchaseOrderItem.status.in_([STATUS_ACCEPTED, STATUS_FULFILLED]),
            )
        ).first()

    def accepted_unfulfilled_quantity(self, product_id: uuid.UUID, exclude_ids: list[uuid.UUID]) -> float:
        """Quantity of this listing on ACCEPTED (not yet fulfilled) order lines."""
        statement = select(func.coalesce(func.sum(PurchaseOrderItem.quantity), 0)).where(
            PurchaseOrderItem.product_id == product_id, PurchaseOrderItem.status == STATUS_ACCEPTED
        )
        if exclude_ids:
            statement = statement.where(PurchaseOrderItem.id.notin_(exclude_ids))
        return float(self.database.scalar(statement) or 0)

    def ensure_stock_for_acceptance(self, rows: list[PurchaseOrderItem], user: User) -> None:
        """Refuse to accept more than the supplier can still deliver: stock less what is
        already accepted and not yet fulfilled. Each listing is locked first."""
        wanted: dict[uuid.UUID, float] = {}
        for row in rows:
            wanted[row.product_id] = wanted.get(row.product_id, 0.0) + float(row.quantity or 0)
        for product_id in sorted(wanted):
            product = self.lock_supplier_product(product_id, user.id)
            if not product:
                raise HTTPException(
                    status_code=409, detail="This product is no longer listed; the order cannot be accepted."
                )
            committed = self.accepted_unfulfilled_quantity(product_id, exclude_ids=[row.id for row in rows])
            free = float(product.quantity or 0) - committed
            if wanted[product_id] > free:
                raise HTTPException(
                    status_code=409,
                    detail=f"Only {max(free, 0):g} {product.unit} of {product.name} can still be accepted "
                    "(stock less orders already accepted).",
                )

    # ---- one line ----

    def respond_supplier_material_request(
        self, request_id: uuid.UUID, payload: MaterialRequestDecision, user: User
    ) -> dict[str, Any]:
        ensure_role(user, "SUPPLIER")
        row = self.lock_supplier_request(request_id, user.id)
        if not row:
            raise HTTPException(status_code=404, detail="Material request not found")
        if row.status not in {STATUS_PENDING, STATUS_ACCEPTED}:
            raise HTTPException(status_code=409, detail="This request was already processed")
        action = payload.action.strip().upper()
        if action in {"ACCEPT", "FULFILL"}:
            require_complete_profile(user)
        if action == "ACCEPT":
            return self.accept_line(row, user)
        if action == "REJECT":
            return self.reject_line(row, user)
        if action != "FULFILL":
            raise HTTPException(status_code=400, detail="Action must be ACCEPT, FULFILL or REJECT")
        return self.fulfil_line(row, user)

    def accept_line(self, row: PurchaseOrderItem, user: User) -> dict[str, Any]:
        if row.status != STATUS_PENDING:
            raise HTTPException(status_code=409, detail="This request was already accepted")
        self.ensure_stock_for_acceptance([row], user)
        row.status = STATUS_ACCEPTED
        buyer = self.database.get(User, row.engineer_id)
        if buyer is not None and buyer.role == ROLE_OWNER:
            # A House Owner hears once per order, the first time one of its lines is accepted.
            if self.find_other_accepted_line_id(row.request_code, user.id, row.id) is None:
                project = self.database.get(Project, row.project_id)
                create_request_notification(
                    self.database,
                    row.engineer_id,
                    "Your order has been accepted. Your delivery is on the way.",
                    f"Purchase request #{row.request_code[:8].upper()} · Supplier: {supplier_store_name(user)} · "
                    f"{row.material_name} x {row.quantity:g} {row.unit} · Project: {project.title if project else ''}",
                    category="MATERIAL",
                )
        else:
            create_request_notification(
                self.database,
                row.engineer_id,
                "Material request accepted",
                f"{row.material_name} request was accepted by {user.name}.",
                category="MATERIAL",
            )
        row.order.sync_status()
        self.database.commit()
        return material_request_payload(self.database, row)

    def reject_line(self, row: PurchaseOrderItem, user: User) -> dict[str, Any]:
        # Decided once, for every buyer: an accepted line is never reversed.
        if row.status != STATUS_PENDING:
            raise HTTPException(status_code=409, detail="This order was already accepted")
        row.status = STATUS_REJECTED
        buyer = self.database.get(User, row.engineer_id)
        if buyer is not None and buyer.role == ROLE_OWNER:
            project = self.database.get(Project, row.project_id)
            create_request_notification(
                self.database,
                row.engineer_id,
                "Your order has been rejected by the supplier.",
                f"Purchase request #{row.request_code[:8].upper()} · Supplier: {supplier_store_name(user)} · "
                f"{row.material_name} x {row.quantity:g} {row.unit} · Project: {project.title if project else ''}",
                category="MATERIAL",
            )
        else:
            create_request_notification(
                self.database,
                row.engineer_id,
                "Material request rejected",
                f"{row.material_name} request was rejected.",
                category="MATERIAL",
            )
        row.order.sync_status()
        self.database.commit()
        return material_request_payload(self.database, row)

    def fulfil_line(self, row: PurchaseOrderItem, user: User) -> dict[str, Any]:
        product = self.lock_supplier_product(row.product_id, user.id)
        if not product or product.quantity < row.quantity:
            create_request_notification(
                self.database,
                row.engineer_id,
                "Material unavailable",
                f"Insufficient stock for {row.quantity:g} {row.unit} {row.material_name}.",
                category="MATERIAL",
            )
            self.database.commit()
            raise HTTPException(status_code=409, detail="Insufficient stock; request was not fulfilled")
        previous_state = product.stock_alert_state or "IN_STOCK"
        project = self.database.get(Project, row.project_id)
        contractor_id = resolve_project_contractor(self.database, project, row.engineer_id) if project else None
        if not project or not contractor_id:
            raise HTTPException(status_code=409, detail="Project is not linked to the engineer's active builder team")
        product.quantity -= row.quantity
        next_state = supplier_product_stock_state(product.quantity, product.low_stock_threshold)
        product.stock_alert_state = next_state
        row.status, row.fulfilled_at = STATUS_FULFILLED, naive_utc_now()
        inventory = get_or_create_inventory(self.database, project.id, contractor_id, row.material_name, row.unit, 0)
        inventory.product_id = row.product_id
        inventory.current_stock += row.quantity
        self.database.add(
            MaterialLog(
                project_id=project.id,
                material_name=row.material_name,
                quantity=row.quantity,
                unit=row.unit,
                cost=money(product.price) * row.quantity,
            )
        )
        self.database.add(
            ProjectTimeline(
                project_id=project.id,
                created_by_id=row.engineer_id,
                title="Material Request",
                description=f"{row.material_name} — {row.quantity:g} {row.unit}; Supplier: {user.name}; "
                "Status: Fulfilled",
                date=local_workflow_now().replace(tzinfo=None),
                completion_status="FULFILLED",
            )
        )
        create_request_notification(
            self.database,
            row.engineer_id,
            "Material request fulfilled",
            f"{row.material_name} for {project.title} was fulfilled by {user.name}.",
            category="MATERIAL",
        )
        create_request_notification(
            self.database,
            contractor_id,
            "Project material received",
            f"{row.quantity:g} {row.unit} {row.material_name} was fulfilled for {project.title}.",
            category="MATERIAL",
        )
        if next_state != previous_state and next_state in {"LOW_STOCK", "OUT_OF_STOCK"}:
            create_notification(
                self.database,
                user.id,
                "Out of stock" if next_state == "OUT_OF_STOCK" else "Low stock",
                f"{product.name} now has {product.quantity:g} {product.unit} remaining.",
                category="MATERIAL",
            )
        row.order.sync_status()
        self.database.commit()
        return material_request_payload(self.database, row)

    # ---- a whole order ----

    def respond_supplier_purchase_request(
        self, request_code: str, payload: MaterialRequestDecision, user: User
    ) -> list[dict[str, Any]]:
        ensure_role(user, "SUPPLIER")
        action = payload.action.strip().upper()
        if action not in {"ACCEPT", "REJECT"}:
            raise HTTPException(status_code=400, detail="Action must be ACCEPT or REJECT")
        if action == "ACCEPT":
            require_complete_profile(user)
        rows = self.lock_purchase_request_lines(request_code, user.id)
        if not rows:
            raise HTTPException(status_code=404, detail="Purchase request not found")
        if any(row.status != STATUS_PENDING for row in rows):
            decided = next(row.status for row in rows if row.status != STATUS_PENDING)
            raise HTTPException(status_code=409, detail=f"This order was already {decided.lower()}")
        if action == "ACCEPT":
            self.ensure_stock_for_acceptance(rows, user)
        try:
            for row in rows:
                row.status = STATUS_ACCEPTED if action == "ACCEPT" else STATUS_REJECTED
            rows[0].order.sync_status()
            notify_purchase_decision(self.database, user, rows, accepted=action == "ACCEPT")
            self.database.commit()
        except Exception:
            self.database.rollback()
            raise
        return [material_request_payload(self.database, row) for row in rows]

    # ---- the buyer ----

    def create_material_request(self, payload: MaterialRequestCreate, user: User) -> dict[str, Any]:
        # A Site Engineer orders through the builder's Store Manager, never a supplier.
        if user.role == ROLE_ENGINEER and not is_store_manager(user):
            raise HTTPException(status_code=403, detail=SITE_ENGINEER_USES_STORE)
        project = ensure_buyer_project_access(self.database, payload.project_id, user)
        require_complete_profile(user)
        supplier = self.database.scalars(
            select(User).where(User.id == payload.supplier_id, User.role == ROLE_SUPPLIER)
        ).first()
        if not supplier or not payload.items:
            raise HTTPException(status_code=400, detail="Select a supplier and at least one material")
        ensure_supplier_approved(self.database, user, supplier.id, project.id)
        code = uuid4().hex
        order = PurchaseOrder(order_number=code, project_id=project.id, buyer_id=user.id, supplier_id=supplier.id)
        self.database.add(order)
        rows: list[PurchaseOrderItem] = []
        for requested in payload.items:
            product = self.database.scalars(
                select(SupplierProduct).where(
                    SupplierProduct.id == requested.product_id,
                    SupplierProduct.supplier_id == supplier.id,
                    SupplierProduct.is_published.is_(True),
                )
            ).first()
            if not product or requested.quantity <= 0:
                raise HTTPException(status_code=400, detail="Invalid supplier product or quantity")
            if product.quantity <= 0:
                raise HTTPException(status_code=409, detail=f"{product.name} is out of stock")
            if requested.quantity > product.quantity:
                raise HTTPException(
                    status_code=409,
                    detail=f"Insufficient stock. Only {product.quantity:g} {product.unit} are currently available.",
                )
            # The unit price agreed now is stored on the line; later tier changes never
            # touch an existing order.
            unit_price, _tier = unit_price_for(product, requested.quantity, tiers_for(self.database, product.id))
            row = PurchaseOrderItem(
                order=order,
                product_id=product.id,
                material_name=product.name,
                category=product.category,
                price=unit_price,
                quantity=requested.quantity,
                unit=product.unit,
                status=STATUS_PENDING,
                created_at=naive_utc_now(),
            )
            self.database.add(row)
            rows.append(row)
        if user.role == ROLE_OWNER:
            total = sum(float(row.price or 0) * row.quantity for row in rows)
            location = ", ".join(part for part in (project.pincode, project.project_city) if part)
            create_request_notification(
                self.database,
                supplier.id,
                f"New purchase request from {user.name}",
                f"Purchase request #{code[:8].upper()} · {purchase_request_summary(rows)} · Total Rs {total:g}"
                + f" · Project: {project.title}"
                + (f" · Delivery: {location}" if location else ""),
                category="MATERIAL",
            )
            create_notification(
                self.database,
                user.id,
                f"Purchase request sent to {supplier_store_name(supplier)}",
                f"Purchase request #{code[:8].upper()} for {project.title}: {purchase_request_summary(rows)}. "
                "You will be notified when the supplier accepts or rejects it.",
                category="MATERIAL",
            )
        else:
            # Only a Store Manager reaches here (a Site Engineer was refused above).
            create_request_notification(
                self.database,
                supplier.id,
                "New purchase order from a Store Manager",
                f"{user.name} (Store Manager) ordered {len(rows)} item(s) for {project.title}.",
                category="MATERIAL",
            )
            create_notification(
                self.database,
                user.id,
                "Material request submitted",
                f"Your request for {project.title} was submitted to {supplier.name}.",
                category="MATERIAL",
            )
        self.database.commit()
        return {"request_code": code, "items": [material_request_payload(self.database, row) for row in rows]}
