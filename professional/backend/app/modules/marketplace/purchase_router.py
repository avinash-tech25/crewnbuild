"""A Site Engineer's purchase requests (no payment step): history, one request, and receiving
a delivered line. The project's stock is the Store (site_operations, /projects/{id}/material-store).

    GET  /marketplace/orders                               the engineer's requests
    GET  /marketplace/orders/{order_id}                    one of them
    POST /marketplace/orders/{order_id}/items/{line}/receive   confirm a delivered line

Requests are placed from the cart (POST /cart/checkout) and answered by the supplier
(/supplier/purchase-requests/{code}/respond, /supplier/material-requests/{id}/respond).
"""

import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.auth.dependencies import Principal, require_roles
from app.core.local_time import local_iso
from app.database.session import get_db
from app.database.types import naive_utc_now
from app.modules.identity.models import ROLE_SITE_ENGINEER, User
from app.modules.marketplace.models import PurchaseOrder, PurchaseOrderItem, SupplierProduct
from app.modules.marketplace.order_service import order_line_fields, supplier_store_name
from app.modules.projects.models import Project

router = APIRouter(tags=["Marketplace Purchases"])
site_engineer = require_roles(ROLE_SITE_ENGINEER)


def operational_orders() -> Select[PurchaseOrder]:
    return select(PurchaseOrder).options(selectinload(PurchaseOrder.items))


def operational_payload(database: Session, order: PurchaseOrder) -> dict[str, Any]:
    project = database.get(Project, order.project_id) if order.project_id else None
    products = {
        product.id: product
        for product in database.scalars(
            select(SupplierProduct).where(SupplierProduct.id.in_([line.product_id for line in order.items]))
        )
    }
    items = []
    for line in order.items:
        product = products.get(line.product_id)
        items.append(
            {
                **order_line_fields(line),
                "name": line.material_name,
                "line_id": line.id,
                "image_url": product.display_image_url if product else None,
                "brand": product.brand if product else None,
                "size": product.size if product else None,
                "line_total": (line.price or Decimal(0)) * Decimal(str(line.quantity)),
            }
        )
    received = (
        bool(items)
        and any(line.received_at for line in order.items)
        and all(line.received_at or line.status == "REJECTED" for line in order.items)
    )
    total = sum(item["line_total"] for item in items)
    for item in items:
        item["line_total"] = float(item["line_total"])
    return {
        "id": order.id,
        "order_number": order.order_number,
        "created_at": local_iso(order.created_at),
        "project_name": project.title if project else None,
        "supplier_name": supplier_store_name(database.get(User, order.supplier_id)),
        "status": "COMPLETED" if received else order.status,
        "estimated_amount": float(total),
        "items": items,
    }


@router.get("/marketplace/orders")
def orders(principal: Principal = Depends(site_engineer), database: Session = Depends(get_db)) -> list[dict[str, Any]]:
    statement = (
        operational_orders()
        .where(PurchaseOrder.buyer_id == principal.user.id)
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
    )
    return [operational_payload(database, order) for order in database.scalars(statement)]


@router.get("/marketplace/orders/{order_id}")
def order_details(
    order_id: uuid.UUID, principal: Principal = Depends(site_engineer), database: Session = Depends(get_db)
) -> dict[str, Any]:
    order = database.scalar(
        operational_orders().where(PurchaseOrder.id == order_id, PurchaseOrder.buyer_id == principal.user.id)
    )
    if order is None:
        raise HTTPException(404, "Purchase request not found.")
    return operational_payload(database, order)


@router.post("/marketplace/orders/{order_id}/items/{line_id}/receive")
def receive(
    order_id: uuid.UUID,
    line_id: uuid.UUID,
    principal: Principal = Depends(site_engineer),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    order = database.scalar(
        operational_orders().where(PurchaseOrder.id == order_id, PurchaseOrder.buyer_id == principal.user.id)
    )
    if order is None:
        raise HTTPException(404, "Purchase request not found.")
    line = database.scalar(
        select(PurchaseOrderItem)
        .where(PurchaseOrderItem.id == line_id, PurchaseOrderItem.purchase_order_id == order_id)
        .with_for_update(of=PurchaseOrderItem)
        .execution_options(populate_existing=True)
    )
    if line is None:
        raise HTTPException(404, "Purchase item not found.")
    if line.status != "FULFILLED":
        raise HTTPException(409, "The supplier must fulfill this item first.")
    if line.received_at is None:
        line.received_at = naive_utc_now()
    database.commit()
    return operational_payload(database, order)
