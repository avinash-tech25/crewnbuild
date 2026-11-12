"""Who may buy what, for which project, from which supplier, and the server-side cart
(ported from the old cart_service.py and cart_repository.py; same rules and answers).

A House Owner orders for a project they own; a Store Manager for a project of a builder
whose team they are on (an actively assigned Site Engineer passes the project check,
but material orders refuse them later, as before). A House Owner buys from a supplier
who accepted their request (for that project, when ordering), or, on a Self Construction
project, from a supplier serving its location; a Site Engineer or Store Manager from a
supplier their builder approved. A buyer only reaches their own cart lines.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.marketplace.listings import tiers_for, unit_price_for
from app.modules.marketplace.models import CartItem, SupplierProduct
from app.modules.projects.access import engineer_has_project_access, store_manager_serves_project
from app.modules.projects.models import ContractorEngineer, Project, ProjectRequest

BUYER_ROLES = {ROLE_OWNER, ROLE_ENGINEER}
OWNER_SUPPLIER_REQUEST_TYPES = ["OWNER_TO_SUPPLIER", "SUPPLIER_TO_OWNER"]
BUILDER_SUPPLIER_REQUEST_TYPES = ["CONTRACTOR_TO_SUPPLIER", "SUPPLIER_TO_CONTRACTOR"]
SELF_CONSTRUCTION = "SELF_CONSTRUCTION"


def ensure_buyer(user: User) -> None:
    if user.role not in BUYER_ROLES:
        raise HTTPException(status_code=403, detail="Only a House Owner or Site Engineer can use a cart.")


def ensure_buyer_project_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    """A House Owner must own the project; a Site Engineer must be actively assigned; a
    Store Manager must serve its builder."""
    project = database.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role == ROLE_OWNER:
        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="You can only order materials for your own project.")
        return project
    if user.role == ROLE_ENGINEER and engineer_has_project_access(database, project_id, user.id):
        return project
    if store_manager_serves_project(database, user, project):
        return project
    raise HTTPException(status_code=403, detail="Only an actively assigned Site Engineer can order for this project.")


def approved_supplier_ids_for(
    database: Session, user: User, project_id: uuid.UUID | None = None
) -> list[uuid.UUID] | None:
    """The suppliers this buyer may shop from; None for a role with no restriction."""
    if user.role == ROLE_OWNER:
        statement = select(ProjectRequest.sender_id, ProjectRequest.receiver_id).where(
            ProjectRequest.status == "accepted",
            ProjectRequest.request_type.in_(OWNER_SUPPLIER_REQUEST_TYPES),
            or_(ProjectRequest.sender_id == user.id, ProjectRequest.receiver_id == user.id),
        )
        if project_id is not None:
            statement = statement.where(ProjectRequest.project_id == project_id)
        accepted = set()
        for sender_id, receiver_id in database.execute(statement).all():
            accepted.add(receiver_id if sender_id == user.id else sender_id)
        accepted.discard(user.id)
        return sorted(accepted)

    if user.role != ROLE_ENGINEER:
        return None

    builder_ids = list(
        database.scalars(
            select(ContractorEngineer.contractor_id).where(
                ContractorEngineer.engineer_id == user.id, ContractorEngineer.status == "ACTIVE"
            )
        ).all()
    )
    if not builder_ids:
        return []
    approved = set()
    rows = database.execute(
        select(ProjectRequest.sender_id, ProjectRequest.receiver_id).where(
            ProjectRequest.status == "accepted",
            ProjectRequest.request_type.in_(BUILDER_SUPPLIER_REQUEST_TYPES),
            or_(ProjectRequest.sender_id.in_(builder_ids), ProjectRequest.receiver_id.in_(builder_ids)),
        )
    ).all()
    for sender_id, receiver_id in rows:
        if sender_id in builder_ids:
            approved.add(receiver_id)
        elif receiver_id in builder_ids:
            approved.add(sender_id)
    return sorted(approved)


def serves_self_construction_project(
    database: Session, user: User, supplier_id: uuid.UUID, project_id: uuid.UUID | None
) -> bool:
    """Whether this supplier serves this House Owner's Self Construction project: the
    same locality rule as /suppliers/nearby (pincode in India, else the country)."""
    if user.role != ROLE_OWNER or project_id is None:
        return False
    project = database.get(Project, project_id)
    if not project or project.owner_id != user.id or project.construction_type != SELF_CONSTRUCTION:
        return False
    supplier = database.get(User, supplier_id)
    if not supplier or supplier.role != ROLE_SUPPLIER:
        return False
    country = (project.project_country or "").strip()
    if country and country != "India":
        return supplier.country_code == country
    if not project.pincode or supplier.pincode != project.pincode:
        return False
    return not country or supplier.country_code == country


def ensure_supplier_approved(
    database: Session, user: User, supplier_id: uuid.UUID, project_id: uuid.UUID | None = None
) -> None:
    """Refuse a purchase from a supplier who has not accepted this buyer."""
    allowed = approved_supplier_ids_for(database, user, project_id)
    if allowed is None or supplier_id in allowed:
        return
    if serves_self_construction_project(database, user, supplier_id, project_id):
        return
    raise HTTPException(
        status_code=403, detail="You can order from this supplier once they have accepted your request."
    )


# ---- the cart ----


class CartService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def items_for(self, user: User, project_id: uuid.UUID | None = None) -> list[CartItem]:
        """One project's basket; without a project there is nothing to show."""
        if project_id is None:
            return []
        return list(
            self.database.scalars(
                select(CartItem)
                .where(CartItem.user_id == user.id, CartItem.project_id == project_id)
                .order_by(CartItem.created_at, CartItem.id)
            ).all()
        )

    def get_published_product(self, product_id: uuid.UUID) -> SupplierProduct:
        product = self.database.scalars(
            select(SupplierProduct).where(SupplierProduct.id == product_id, SupplierProduct.is_published.is_(True))
        ).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        return product

    def add_item(self, user: User, project_id: uuid.UUID, product_id: uuid.UUID, quantity: float) -> CartItem:
        ensure_buyer(user)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Enter a quantity greater than zero.")
        project = ensure_buyer_project_access(self.database, project_id, user)
        product = self.get_published_product(product_id)
        ensure_supplier_approved(self.database, user, product.supplier_id, project.id)

        existing = self.database.scalars(
            select(CartItem).where(
                CartItem.user_id == user.id, CartItem.project_id == project.id, CartItem.product_id == product_id
            )
        ).first()
        wanted = (existing.quantity if existing else 0) + quantity
        self.check_stock(product, wanted)
        if existing:
            existing.quantity = wanted
            item = existing
        else:
            item = CartItem(
                user_id=user.id,
                project_id=project.id,
                supplier_id=product.supplier_id,
                product_id=product.id,
                quantity=quantity,
            )
            self.database.add(item)
        self.database.commit()
        self.database.refresh(item)
        return item

    def set_quantity(self, user: User, item_id: uuid.UUID, quantity: float) -> CartItem:
        ensure_buyer(user)
        item = self.owned_item(user, item_id)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Enter a quantity greater than zero.")
        ensure_supplier_approved(self.database, user, item.supplier_id, item.project_id)
        self.check_stock(self.get_published_product(item.product_id), quantity)
        item.quantity = quantity
        self.database.commit()
        self.database.refresh(item)
        return item

    def remove_item(self, user: User, item_id: uuid.UUID) -> None:
        ensure_buyer(user)
        self.database.delete(self.owned_item(user, item_id))
        self.database.commit()

    def clear(self, user: User, project_id: uuid.UUID | None = None) -> None:
        """Empty one project's basket, never every project's at once."""
        ensure_buyer(user)
        if project_id is None:
            return
        for item in self.items_for(user, project_id):
            self.database.delete(item)
        self.database.commit()

    def owned_item(self, user: User, item_id: uuid.UUID) -> CartItem:
        item = self.database.scalars(
            select(CartItem).where(CartItem.id == item_id, CartItem.user_id == user.id)
        ).first()
        if not item:
            raise HTTPException(status_code=404, detail="Cart item not found")
        return item

    def check_stock(self, product: SupplierProduct, wanted: float) -> None:
        if product.quantity <= 0:
            raise HTTPException(status_code=409, detail=f"{product.name} is out of stock")
        if wanted > product.quantity:
            raise HTTPException(
                status_code=409, detail=f"Only {product.quantity:g} {product.unit} of {product.name} are available."
            )


def cart_item_payload(database: Session, item: CartItem) -> dict[str, Any]:
    product = database.get(SupplierProduct, item.product_id)
    supplier = database.get(User, item.supplier_id)
    # The unit price for this quantity, computed here, never taken from the browser.
    line_price, tier = (
        unit_price_for(product, item.quantity, tiers_for(database, product.id)) if product else (0.0, None)
    )
    return {
        "id": item.id,
        "product_id": item.product_id,
        "supplier_id": item.supplier_id,
        "supplier_name": supplier.name if supplier else "",
        "store_name": supplier.supplier_profile.store_name if supplier and supplier.supplier_profile else "",
        "name": product.name if product else "",
        "brand": product.brand if product else None,
        "category": product.category if product else None,
        "image_url": product.display_image_url if product else None,
        "unit": product.unit if product else "",
        "size": product.size if product else None,
        "price": line_price,
        "normal_price": float(product.price or 0) if product else 0,
        "bulk_tier": tier,
        "available_quantity": product.quantity if product else 0,
        "quantity": item.quantity,
        "line_total": round(line_price * item.quantity, 2),
    }


def cart_payload(database: Session, items: list[CartItem]) -> dict[str, Any]:
    lines = [cart_item_payload(database, item) for item in items]
    suppliers: dict[Any, dict[str, Any]] = {}
    for line in lines:
        group = suppliers.setdefault(
            line["supplier_id"],
            {
                "supplier_id": line["supplier_id"],
                "supplier_name": line["supplier_name"],
                "store_name": line["store_name"],
                "items": [],
                "total": 0,
            },
        )
        group["items"].append(line)
        group["total"] = round(group["total"] + line["line_total"], 2)
    return {
        "items": lines,
        "suppliers": list(suppliers.values()),
        "item_count": len(lines),
        "total": round(sum(line["line_total"] for line in lines), 2),
    }
