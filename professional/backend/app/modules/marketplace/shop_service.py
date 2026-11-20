"""The buyer's shop: one project's cart, checkout into a purchase order, and the
published listings a buyer may order (ported from the old shop_service.py; same rules
and answers)."""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.accounts.models import SupplierProfile
from app.modules.identity.models import ROLE_ENGINEER, ROLE_SITE_ENGINEER, User
from app.modules.identity.policies import session_role
from app.modules.marketplace.cart import (
    CartService,
    approved_supplier_ids_for,
    cart_payload,
    ensure_buyer,
    ensure_buyer_project_access,
    ensure_supplier_approved,
)
from app.modules.marketplace.listings import catalog_listings, supplier_product_payload, supplier_product_stock_state
from app.modules.marketplace.models import CartItem, PurchaseOrder, SupplierProduct
from app.modules.marketplace.order_service import MaterialRequestService
from app.modules.marketplace.schemas import (
    CartCheckout,
    CartItemCreate,
    CartItemUpdate,
    MaterialRequestCreate,
    MaterialRequestItemCreate,
)
from app.modules.projects.access import require_complete_profile
from app.modules.rate_limits.service import hit


class ShopService:
    def __init__(self, database: Session) -> None:
        self.database = database
        self.cart = CartService(database)

    def fetch_cart(self, project_id: uuid.UUID | None, user: User) -> dict[str, Any]:
        ensure_buyer(user)
        return cart_payload(self.database, self.cart.items_for(user, project_id))

    def clear_cart(self, project_id: uuid.UUID | None, user: User) -> dict[str, Any]:
        self.cart.clear(user, project_id)
        return cart_payload(self.database, self.cart.items_for(user, project_id))

    def add_cart_item(self, payload: CartItemCreate, user: User) -> dict[str, Any]:
        item = self.cart.add_item(user, payload.project_id, payload.product_id, payload.quantity)
        return cart_payload(self.database, self.cart.items_for(user, item.project_id))

    def update_cart_item(self, item_id: uuid.UUID, payload: CartItemUpdate, user: User) -> dict[str, Any]:
        item = self.cart.set_quantity(user, item_id, payload.quantity)
        return cart_payload(self.database, self.cart.items_for(user, item.project_id))

    def delete_cart_item(self, item_id: uuid.UUID, user: User) -> dict[str, Any]:
        # Read the project before the row goes, so the reply is that project's cart.
        project_id = self.cart.owned_item(user, item_id).project_id
        self.cart.remove_item(user, item_id)
        return cart_payload(self.database, self.cart.items_for(user, project_id))

    def checkout_cart(self, payload: CartCheckout, user: User) -> dict[str, Any]:
        ensure_buyer(user)
        require_complete_profile(user)
        # Who may order, for which project and from which supplier, is settled before
        # anything in the body is validated: another user, a Site Engineer not (or no
        # longer) assigned to the project, or a supplier not allowed on it gets 403.
        project = ensure_buyer_project_access(self.database, payload.project_id, user)
        ensure_supplier_approved(self.database, user, payload.supplier_id, project.id)
        engineer = session_role(user) == ROLE_SITE_ENGINEER
        request_key = payload.request_key if engineer else None
        if engineer and request_key is None:
            raise HTTPException(422, "A request key is required.")
        if request_key is not None:
            if not hit(self.database, "marketplace-checkout", str(user.id), 30, 60):
                raise HTTPException(429, "Too many purchase requests. Try again shortly.")
            self.database.execute(select(User.id).where(User.id == user.id).with_for_update())
            existing = self.database.scalar(
                select(PurchaseOrder).where(PurchaseOrder.buyer_id == user.id, PurchaseOrder.request_key == request_key)
            )
            if existing is not None:
                if existing.project_id != payload.project_id or existing.supplier_id != payload.supplier_id:
                    raise HTTPException(409, "This request key was used for another supplier or project.")
                return {
                    "id": existing.id,
                    "request_code": existing.order_number,
                    "cart": cart_payload(self.database, self.cart.items_for(user, payload.project_id)),
                }
        statement = (
            select(CartItem)
            .where(
                CartItem.user_id == user.id,
                CartItem.project_id == payload.project_id,
                CartItem.supplier_id == payload.supplier_id,
            )
            .order_by(CartItem.created_at, CartItem.id)
        )
        lines = self.database.scalars(statement.with_for_update() if engineer else statement).all()
        if not lines:
            raise HTTPException(status_code=400, detail="There is nothing from that supplier in your cart.")
        request = MaterialRequestService(self.database).create_material_request(
            MaterialRequestCreate(
                project_id=payload.project_id,
                supplier_id=payload.supplier_id,
                items=[MaterialRequestItemCreate(product_id=line.product_id, quantity=line.quantity) for line in lines],
            ),
            user,
            request_key=request_key,
        )
        for line in lines:
            self.database.delete(line)
        self.database.commit()
        return {**request, "cart": cart_payload(self.database, self.cart.items_for(user, payload.project_id))}

    def fetch_shop_products(
        self, category: str | None, search: str | None, user: User, project_id: uuid.UUID | None = None
    ) -> dict[str, Any]:
        """A House Owner sees the listings of every supplier who accepted them (as before;
        `project_id` is not used for them). A Site Engineer shops for one project they are
        actively assigned to, from the suppliers allowed on it: without a project the
        answer is empty with needs_project, and with no allowed supplier, no_suppliers."""
        ensure_buyer(user)
        if user.role == ROLE_ENGINEER:
            if project_id is None:
                return {"products": [], "categories": [], "restricted": True, "needs_project": True}
            ensure_buyer_project_access(self.database, project_id, user)
        statement = catalog_listings(
            select(SupplierProduct, User, SupplierProfile)
            .join(User, SupplierProduct.supplier_id == User.id)
            .outerjoin(SupplierProfile, SupplierProfile.user_id == User.id)
            .where(SupplierProduct.is_published.is_(True))
        )
        allowed_supplier_ids = approved_supplier_ids_for(
            self.database, user, project_id if user.role == ROLE_ENGINEER else None
        )
        if allowed_supplier_ids is not None:
            if not allowed_supplier_ids:
                empty: dict[str, Any] = {"products": [], "categories": [], "restricted": True}
                if user.role == ROLE_ENGINEER:
                    empty["no_suppliers"] = True
                return empty
            statement = statement.where(SupplierProduct.supplier_id.in_(allowed_supplier_ids))
        if category:
            statement = statement.where(SupplierProduct.category == category)
        if search:
            pattern = f"%{search.strip()}%"
            statement = statement.where(or_(SupplierProduct.name.ilike(pattern), SupplierProduct.brand.ilike(pattern)))
        rows = self.database.execute(statement.order_by(SupplierProduct.category, SupplierProduct.name)).all()
        products = [
            {
                **supplier_product_payload(product),
                "supplier_id": supplier.id,
                "supplier_name": supplier.name,
                "store_name": profile.store_name if profile else "",
                "supplier_rating": supplier.rating,
                "supplier_pincode": supplier.pincode,
                "stock_state": supplier_product_stock_state(product.quantity, product.low_stock_threshold),
            }
            for product, supplier, profile in rows
        ]
        return {
            "products": products,
            "categories": sorted({item["category"] for item in products if item["category"]}),
            "restricted": allowed_supplier_ids is not None,
        }
