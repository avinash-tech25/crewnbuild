"""The Site Engineer's Store: a project's material inventory, one card per product and
variant (project_material_stock), with every movement traceable.

    received  an order line the supplier fulfilled (purchase_order_items, status FULFILLED),
              or an offline purchase in a daily record (site_material_purchases)
    used      site_material_usages: from a daily record, or recorded here (no daily record)

Both kinds of usage lower the same project_material_stock.current_stock, so the balance is
counted once: in stock = received - used. A stock row whose balance came from before this
ledger existed (an opening stock typed into the cost tool) shows the difference as one
"opening balance" movement, so the history always adds up to what is in stock.

Who may do what (the existing project guards): the actively assigned Site Engineer records
usage (ensure_engineer_project_write_access); that engineer and the project's builder set a
material's low-stock level; the builder, the House Owner and that engineer read
(ensure_project_activity_read_access); everyone else is refused (403).
"""

import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso, local_today
from app.database.types import naive_utc_now
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, User
from app.modules.marketplace.models import PurchaseOrder, PurchaseOrderItem, SupplierProduct
from app.modules.projects.access import (
    contractor_has_project_access,
    engineer_has_project_access,
    ensure_engineer_project_write_access,
    ensure_project_activity_read_access,
)
from app.modules.projects.models import Project
from app.modules.projects.notices import create_notification
from app.modules.site_operations.models import (
    CostMaterialInventory,
    CostMaterialPurchase,
    CostMaterialUsage,
    DailyCostRegister,
)

QUANTITY_EPSILON = 1e-6


def stock_material_name(name: str, size: str | None) -> str:
    """The stock row's name for a product and its variant: "TMT Bar 12mm · 6 m". Buying the
    same product and variant again (from any supplier listing it under that name) lands on
    the same row; another variant gets its own."""
    name = (name or "").strip()
    size = (size or "").strip()
    return f"{name} · {size}"[:120] if size else name[:120]


def find_stock_for_line(database: Session, project_id: uuid.UUID, listing: SupplierProduct | None, line: Any):
    """The stock row a fulfilled order line adds to, and the name for a new one. A row of the
    same product and variant in another unit is a different stock ("(kg)" is added), so a
    quantity is never added to a balance kept in another unit."""
    base = stock_material_name(line.material_name, listing.size if listing else None)
    for name in (base, f"{base} ({line.unit})"[:120]):
        row = database.scalars(
            select(CostMaterialInventory).where(
                CostMaterialInventory.project_id == project_id, CostMaterialInventory.material == name
            )
        ).first()
        if row is None:
            return None, name
        if (row.unit or "").casefold() == (line.unit or "").casefold():
            return row, name
    return None, f"{base} ({line.unit})"[:120]


def _project_register_ids(database: Session, project_id: uuid.UUID) -> list[uuid.UUID]:
    return list(database.scalars(select(DailyCostRegister.id).where(DailyCostRegister.project_id == project_id)))


def project_usages(database: Session, project_id: uuid.UUID, register_ids: list[uuid.UUID] | None = None):
    """Every usage row of the project: its daily records' and its Store's."""
    if register_ids is None:
        register_ids = _project_register_ids(database, project_id)
    store = and_(CostMaterialUsage.register_id.is_(None), CostMaterialUsage.project_id == project_id)
    condition = or_(CostMaterialUsage.register_id.in_(register_ids), store) if register_ids else store
    return list(database.scalars(select(CostMaterialUsage).where(condition)))


def used_of(database: Session, project_id: uuid.UUID, material: str) -> float:
    """How much of one material the project has used, daily records and Store together."""
    return sum(
        float(item.quantity_used or 0) for item in project_usages(database, project_id) if item.material == material
    )


def _listings(database: Session, ids: list[Any]) -> dict[uuid.UUID, SupplierProduct]:
    ids = [item for item in ids if item]
    if not ids:
        return {}
    return {row.id: row for row in database.scalars(select(SupplierProduct).where(SupplierProduct.id.in_(ids)))}


def _stock_state(remaining: float, minimum: float) -> str:
    if remaining <= QUANTITY_EPSILON:
        return "OUT_OF_STOCK"
    if minimum and remaining <= minimum + QUANTITY_EPSILON:
        return "LOW_STOCK"
    return "IN_STOCK"


def _round(value: float) -> float:
    return round(float(value or 0), 3)


def _card(row: CostMaterialInventory, used: float, listing: SupplierProduct | None) -> dict[str, Any]:
    remaining = _round(row.current_stock)
    minimum = _round(row.minimum_stock)
    return {
        "id": row.id,
        "material": row.material,
        "name": listing.name if listing else row.material,
        "brand": listing.brand if listing else None,
        "size": listing.size if listing else None,
        "image_url": listing.display_image_url if listing else None,
        "unit": row.unit,
        "in_stock": remaining,
        "received_total": _round(remaining + used),
        "used_total": _round(used),
        "minimum_stock": minimum,
        "low_stock": _stock_state(remaining, minimum) == "LOW_STOCK",
        "stock_status": _stock_state(remaining, minimum),
        "updated_at": local_iso(row.updated_at),
        # Reorder opens the supplier catalog on this product.
        "listing_id": row.product_id,
        "catalog_product_id": listing.master_product_id if listing else None,
    }


def may_set_threshold(database: Session, project: Project, user: User) -> bool:
    """The actively assigned Site Engineer, or the builder the project was awarded to."""
    if user.role == ROLE_ENGINEER:
        return engineer_has_project_access(database, project.id, user.id)
    if user.role == ROLE_BUILDER:
        return project.contractor_id == user.id or contractor_has_project_access(database, project.id, user.id)
    return False


def store_payload(database: Session, project_id: uuid.UUID, user: User) -> dict[str, Any]:
    project = ensure_project_activity_read_access(database, project_id, user)
    rows = list(
        database.scalars(
            select(CostMaterialInventory)
            .where(CostMaterialInventory.project_id == project_id)
            .order_by(CostMaterialInventory.material)
        )
    )
    used: dict[str, float] = {}
    for usage in project_usages(database, project_id):
        used[usage.material] = used.get(usage.material, 0.0) + float(usage.quantity_used or 0)
    listings = _listings(database, [row.product_id for row in rows])
    return {
        "project_id": project_id,
        "can_record_usage": user.role == ROLE_ENGINEER and engineer_has_project_access(database, project_id, user.id),
        "can_set_threshold": may_set_threshold(database, project, user),
        "items": [_card(row, used.get(row.material, 0.0), listings.get(row.product_id)) for row in rows],
    }


def _stock_row(database: Session, project_id: uuid.UUID, stock_id: uuid.UUID, lock: bool = False):
    query = select(CostMaterialInventory).where(
        CostMaterialInventory.id == stock_id, CostMaterialInventory.project_id == project_id
    )
    row = database.scalars(query.with_for_update() if lock else query).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Material not found in this project's store")
    return row


def record_store_usage(
    database: Session,
    project_id: uuid.UUID,
    stock_id: uuid.UUID,
    user: User,
    *,
    quantity: float,
    unit: str,
    used_on: date | None,
    note: str | None,
) -> dict[str, Any]:
    project = ensure_engineer_project_write_access(database, project_id, user)
    row = _stock_row(database, project_id, stock_id, lock=True)
    if not quantity or quantity <= 0:
        raise HTTPException(status_code=400, detail="Enter a quantity greater than zero.")
    if (unit or "").strip().casefold() != (row.unit or "").casefold():
        raise HTTPException(
            status_code=400, detail=f"{row.material} is counted in {row.unit}; record the usage in {row.unit}."
        )
    today = local_today()
    used_on = used_on or today
    if used_on > today:
        raise HTTPException(status_code=400, detail="The usage date cannot be in the future.")
    in_stock = float(row.current_stock or 0)
    if quantity > in_stock + QUANTITY_EPSILON:
        raise HTTPException(status_code=409, detail=f"Only {in_stock:g} {row.unit} {row.material} in stock.")
    listing = _listings(database, [row.product_id]).get(row.product_id)
    rate = listing.price if listing else 0
    closing = 0.0 if abs(in_stock - quantity) <= QUANTITY_EPSILON else in_stock - quantity
    usage = CostMaterialUsage(
        register_id=None,
        product_id=row.product_id,
        project_id=project_id,
        engineer_id=user.id,
        material=row.material,
        opening_stock=in_stock,
        quantity_used=quantity,
        unit=row.unit,
        rate=rate,
        total_cost=float(rate or 0) * quantity,
        closing_stock=closing,
        work_date=used_on,
        note=(note or "").strip() or None,
    )
    database.add(usage)
    previous_state = _stock_state(in_stock, float(row.minimum_stock or 0))
    row.current_stock = closing
    row.updated_at = naive_utc_now()
    next_state = _stock_state(closing, float(row.minimum_stock or 0))
    if next_state != previous_state and next_state in {"LOW_STOCK", "OUT_OF_STOCK"}:
        message = f"{row.material} now has only {closing:g} {row.unit} remaining in {project.title}."
        title = "Out of stock" if next_state == "OUT_OF_STOCK" else "Low stock"
        for recipient in {row.contractor_id, user.id}:
            create_notification(database, recipient, title, message, category="MATERIAL")
    database.commit()
    used = used_of(database, project_id, row.material)
    return {"usage_id": usage.id, "item": _card(row, used, listing)}


def set_stock_threshold(
    database: Session, project_id: uuid.UUID, stock_id: uuid.UUID, user: User, *, minimum_stock: float, unit: str
) -> dict[str, Any]:
    """A material's low-stock level: "Low stock" shows at or below it; 0 turns it off. Set in
    the stock's own unit. Not a movement: the balance and its history are unchanged."""
    project = database.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not may_set_threshold(database, project, user):
        raise HTTPException(
            status_code=403,
            detail="Only the assigned Site Engineer or the project's builder can set the low-stock level",
        )
    row = _stock_row(database, project_id, stock_id, lock=True)
    if minimum_stock is None or minimum_stock < 0:
        raise HTTPException(status_code=400, detail="The low-stock level cannot be negative.")
    if (unit or "").strip().casefold() != (row.unit or "").casefold():
        raise HTTPException(
            status_code=400, detail=f"{row.material} is counted in {row.unit}; set the level in {row.unit}."
        )
    row.minimum_stock = minimum_stock
    database.commit()
    used = used_of(database, project_id, row.material)
    return {"item": _card(row, used, _listings(database, [row.product_id]).get(row.product_id))}


def stock_movements(database: Session, project_id: uuid.UUID, stock_id: uuid.UUID, user: User) -> dict[str, Any]:
    """Every movement of one stock row, newest first, and the balance they add up to."""
    ensure_project_activity_read_access(database, project_id, user)
    row = _stock_row(database, project_id, stock_id)
    register_ids = _project_register_ids(database, project_id)
    registers = (
        {
            register.id: register
            for register in database.scalars(select(DailyCostRegister).where(DailyCostRegister.id.in_(register_ids)))
        }
        if register_ids
        else {}
    )
    people: dict[uuid.UUID, str] = {}

    def name_of(user_id: uuid.UUID | None) -> str | None:
        if not user_id:
            return None
        if user_id not in people:
            person = database.get(User, user_id)
            people[user_id] = person.name if person else ""
        return people[user_id] or None

    movements: list[dict[str, Any]] = []
    lines = database.scalars(
        select(PurchaseOrderItem)
        .join(PurchaseOrder, PurchaseOrderItem.purchase_order_id == PurchaseOrder.id)
        .where(PurchaseOrder.project_id == project_id, PurchaseOrderItem.status == "FULFILLED")
    ).all()
    listings = _listings(database, [line.product_id for line in lines])
    for line in lines:
        base = stock_material_name(line.material_name, getattr(listings.get(line.product_id), "size", None))
        names = {base, f"{base} ({line.unit})"[:120], line.material_name}
        if row.material not in names or (line.unit or "").casefold() != (row.unit or "").casefold():
            continue
        movements.append(
            {
                "id": f"order-line-{line.id}",
                "kind": "RECEIVED",
                "quantity": _round(line.quantity),
                "unit": line.unit,
                "at": local_iso(line.fulfilled_at),
                "by": name_of(line.order.supplier_id),
                "source": {"kind": "ORDER", "id": line.order.id, "number": line.order.order_number[:8].upper()},
                "note": None,
            }
        )
    if register_ids:
        purchases = database.scalars(
            select(CostMaterialPurchase).where(
                CostMaterialPurchase.register_id.in_(register_ids), CostMaterialPurchase.material == row.material
            )
        ).all()
        for purchase in purchases:
            register = registers.get(purchase.register_id)
            movements.append(
                {
                    "id": f"purchase-{purchase.id}",
                    "kind": "RECEIVED",
                    "quantity": _round(purchase.quantity),
                    "unit": purchase.unit,
                    "at": purchase.purchase_date.isoformat(),
                    "by": purchase.supplier_name,
                    "source": {
                        "kind": "DAILY_RECORD",
                        "id": purchase.register_id,
                        "date": register.work_date.isoformat() if register else None,
                    },
                    "note": None,
                }
            )
    used_total = 0.0
    for usage in project_usages(database, project_id, register_ids):
        if usage.material != row.material:
            continue
        used_total += float(usage.quantity_used or 0)
        if not usage.quantity_used:
            continue
        register = registers.get(usage.register_id) if usage.register_id else None
        record_date = register.work_date.isoformat() if register else None
        daily_source = {"kind": "DAILY_RECORD", "id": usage.register_id, "date": record_date}
        movements.append(
            {
                "id": f"usage-{usage.id}",
                "kind": "USED",
                "quantity": _round(usage.quantity_used),
                "unit": usage.unit,
                "at": usage.work_date.isoformat() if usage.work_date else local_iso(usage.created_at),
                "by": name_of(usage.engineer_id) or (name_of(register.created_by_id) if register else None),
                "source": daily_source if usage.register_id else {"kind": "STORE_USAGE", "id": usage.id},
                "note": usage.note,
            }
        )
    received_total = float(row.current_stock or 0) + used_total
    listed = sum(item["quantity"] for item in movements if item["kind"] == "RECEIVED")
    if received_total - listed > 0.0005:
        # A balance from before the ledger (an opening stock typed into the cost tool).
        movements.append(
            {
                "id": f"opening-{row.id}",
                "kind": "OPENING",
                "quantity": _round(received_total - listed),
                "unit": row.unit,
                "at": None,
                "by": None,
                "source": {"kind": "OPENING"},
                "note": None,
            }
        )
    movements.sort(key=lambda item: item["at"] or "", reverse=True)
    listing = _listings(database, [row.product_id]).get(row.product_id)
    return {"item": _card(row, used_total, listing), "movements": movements}
