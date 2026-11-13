"""The Store Manager's supplier purchases: the orders, goods received into stock
(in parts, once only), payments recorded by hand (ported from the old
purchase_service.py; same rules and answers)."""

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import object_session

from app.core.local_time import local_iso
from app.modules.identity.models import User
from app.modules.marketplace.models import SupplierMaterialRequest, SupplierProduct
from app.modules.marketplace.order_service import material_request_payload
from app.modules.messaging.live_events import queue_live_hint
from app.modules.projects.access import (
    require_complete_profile,
)
from app.modules.projects.notices import create_notification
from app.modules.store.models import (
    PAYMENT_METHODS,
    PAYMENT_PAID,
    StoreItem,
    StorePaymentRecord,
    StorePurchaseReceipt,
    StoreSiteRequest,
)
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import StorePaymentCreate
from app.modules.store.stock_service import is_count_unit, record_movement, store_item_payload

# A supplier's accept means the goods are coming; delivery is what the Store
# Manager confirms. FULFILLED is the supplier marking the same delivery from its side.
RECEIVABLE_STATUSES = {"ACCEPTED", "FULFILLED"}


def product_variant(product: SupplierProduct | None) -> str | None:
    """The size or variant a supplier sells: its size as buyers see it, else the
    catalog variant's name."""
    if product is None:
        return None
    size = (product.size or "").strip()
    if size:
        return size
    return product.master_variant.name if product.master_variant is not None else None


def order_total(lines: list[SupplierMaterialRequest]) -> Decimal:
    """What a Buy is worth: a line the supplier rejected is owed to nobody."""
    total = sum(
        (Decimal(line.price or 0) * Decimal(str(line.quantity)) for line in lines if line.status != "REJECTED"),
        Decimal("0"),
    )
    return total.quantize(Decimal("0.01"))


def purchase_id(request_code: str) -> str:
    """A purchase's Purchase ID: its stored request_code (a random uuid4 hex, set
    once at checkout and shared by its order lines and payment records) written as a
    UUID. reference_code is only its first 8 characters, which need not be unique."""
    try:
        return str(uuid.UUID(hex=request_code))
    except (TypeError, ValueError):
        return request_code


def site_request_public_id(row: StorePaymentRecord) -> str | None:
    if row.site_request_id is None:
        return None
    site_request = object_session(row).get(StoreSiteRequest, row.site_request_id)
    return str(site_request.id) if site_request else None


def payment_payload(row: StorePaymentRecord) -> dict:
    return {
        "id": row.id,
        # The Transaction ID people see (migration 0050), set once at creation.
        "transaction_uuid": str(row.id),
        "request_code": row.request_code,
        "reference_code": row.request_code[:8].upper(),
        "purchase_id": purchase_id(row.request_code),
        "amount": float(row.amount),
        "method": row.method,
        "reference": row.reference,
        "note": row.note,
        # The gateway's own identifiers, exactly as Razorpay (or, with no keys, the
        # local stand-in it says it is) returned them; none for a payment recorded by hand.
        "razorpay_order_id": row.razorpay_order_id,
        "razorpay_payment_id": row.razorpay_payment_id,
        "gateway_mode": row.gateway_mode,
        "supplier_id": row.supplier_id,
        "project_id": row.project_id,
        "site_request_id": row.site_request_id,
        # That request's Request ID, as the request itself shows it (migration 0049).
        "site_request_public_id": site_request_public_id(row),
        "items": row.items,
        "created_at": local_iso(row.created_at),
        # A Razorpay checkout is CREATED until verified, then PAID or FAILED;
        # a recorded payment is always PAID.
        "status": row.status,
        "failure_reason": row.failure_reason,
        "paid_at": local_iso(row.paid_at) if row.paid_at else None,
    }


def receipts_by_line(receipts: list[StorePurchaseReceipt]) -> dict[uuid.UUID, dict]:
    """Per purchase line, what has arrived over all its receipts and when it last did."""
    lines: dict[uuid.UUID, dict] = {}
    for receipt in sorted(receipts, key=lambda row: row.received_at):
        entry = lines.setdefault(
            receipt.order_line_id, {"quantity": Decimal("0"), "at": receipt.received_at, "entries": []}
        )
        entry["quantity"] += Decimal(receipt.quantity)
        entry["at"] = max(entry["at"], receipt.received_at)
        entry["entries"].append(receipt)
    return lines


def receipt_fields(line: SupplierMaterialRequest, received: dict | None) -> dict:
    """What a purchase line shows of its receipts: received so far, when last, and
    what is still to arrive. A line the supplier rejected is owed nothing."""
    got = received["quantity"] if received else Decimal("0")
    pending = max(Decimal(str(line.quantity)) - got, Decimal("0")) if line.status != "REJECTED" else Decimal("0")
    return {
        "received": got > 0,
        "received_quantity": float(got),
        "received_at": local_iso(received["at"]) if received else None,
        "pending_quantity": float(pending),
        "fully_received": got > 0 and pending <= 0,
        # Each delivery received, as recorded, for the purchase's timeline.
        "receipts": [
            {"quantity": float(row.quantity), "received_at": local_iso(row.received_at)}
            for row in (received["entries"] if received else [])
        ],
        # When the supplier marked the line delivered (FULFILLED); acceptance has no recorded time.
        "delivered_at": local_iso(line.fulfilled_at) if line.fulfilled_at else None,
    }


def paid_by_request_code(payments: list[StorePaymentRecord]) -> dict[str, Decimal]:
    """Only money actually paid: a checkout still CREATED, or FAILED, paid nothing."""
    paid: dict[str, Decimal] = {}
    for payment in payments:
        if payment.status == PAYMENT_PAID:
            paid[payment.request_code] = paid.get(payment.request_code, Decimal("0")) + Decimal(payment.amount)
    return paid


class PurchaseService:
    def __init__(self, repository: StoreManagerRepository):
        self.repository = repository
        self.database = repository.database

    def list_orders(self, user: User):
        """Every Buy this store placed, one entry per request_code, with what has
        been received and paid."""
        receipts = receipts_by_line(self.repository.list_receipts(user.id))
        all_payments = self.repository.list_payments(user.id)
        paid = paid_by_request_code(all_payments)
        payments_by_code: dict[str, list] = {}
        for row in all_payments:
            payments_by_code.setdefault(row.request_code, []).append(row)
        orders: dict[str, list] = {}
        for line in self.repository.list_purchase_lines(user.id):
            orders.setdefault(line.request_code, []).append(line)
        payloads = []
        for code, lines in orders.items():
            total = order_total(lines)
            paid_amount = paid.get(code, Decimal("0"))
            line_payloads = [material_request_payload(self.database, line) for line in lines]
            for payload, line in zip(line_payloads, lines):
                payload.update(receipt_fields(line, receipts.get(line.id)))
                # Accepted by the supplier and not all of it here yet: the rest can still be received.
                payload["can_receive"] = line.status in RECEIVABLE_STATUSES and payload["pending_quantity"] > 0
            project = self.repository.get_project(lines[0].project_id) if lines[0].project_id else None
            builder = self.repository.get_user(project.contractor_id) if project and project.contractor_id else None
            order_payments = [payment_payload(row) for row in payments_by_code.get(code, [])]
            live = [line for line in lines if line.status != "REJECTED"]
            payloads.append(
                {
                    "request_code": code,
                    "reference_code": code[:8].upper(),
                    "purchase_id": purchase_id(code),
                    "supplier_id": lines[0].supplier_id,
                    "supplier_name": line_payloads[0]["supplier_name"],
                    "project_id": lines[0].project_id,
                    "project_name": line_payloads[0]["project_name"],
                    "builder_id": builder.id if builder else None,
                    "builder_name": builder.name if builder else "",
                    "store_manager_id": user.id,
                    "created_at": local_iso(lines[0].created_at),
                    "total": float(total),
                    "paid": float(paid_amount),
                    "balance": float(max(total - paid_amount, Decimal("0"))),
                    "payment_status": "PAID"
                    if total > 0 and paid_amount >= total
                    else "PARTLY_PAID"
                    if paid_amount > 0
                    else "UNPAID",
                    "receipt_status": (
                        "RECEIVED"
                        if live
                        and all(
                            payload["fully_received"]
                            for payload, line in zip(line_payloads, lines)
                            if line.status != "REJECTED"
                        )
                        else "PARTLY_RECEIVED"
                        if any(payload["received"] for payload in line_payloads)
                        else "NOT_RECEIVED"
                    ),
                    "payments": order_payments,
                    "lines": line_payloads,
                }
            )
        return payloads

    def find_or_create_item(self, user: User, line: SupplierMaterialRequest) -> StoreItem:
        # The brand of the supplier product bought, so the store and its engineers see it.
        product = self.database.get(SupplierProduct, line.product_id) if line.product_id else None
        brand = (product.brand or "").strip() or None if product else None
        variant = product_variant(product)
        # The same catalog product and size received before, from any supplier and
        # under whatever name that supplier gives it: one product, one stock. Else
        # the same name, unit and size.
        item = self.item_of_catalog_product(user, product, line.unit)
        if item is None:
            item = self.repository.lock_item_by_identity(
                user.id,
                line.material_name,
                line.unit,
                variant,
                brand,
            )

            # The same name, but received before as another catalog product or size:
            # a different product, kept apart (unless one with exactly its identity exists).
            if item is not None and self.is_other_catalog_product(user, item, product):
                item = self.repository.lock_item_exact(
                    user.id,
                    line.material_name,
                    brand,
                    line.unit,
                    variant,
                )
        if item:
            if item.brand is None and brand:
                item.brand = brand
            if item.variant is None and variant:
                item.variant = variant
            return item
        item = StoreItem(
            store_manager_id=user.id,
            name=line.material_name,
            category=line.category or "Other",
            brand=brand,
            variant=variant,
            unit=line.unit,
            unit_cost=line.price or 0,
            quantity=Decimal("0"),
        )
        self.repository.add(item)
        self.database.flush()
        return item

    def item_of_catalog_product(self, user: User, product: SupplierProduct | None, unit: str) -> StoreItem | None:
        if product is None or product.master_product_id is None:
            return None
        items = {item.id: item for item in self.repository.list_items(user.id)}
        for item_id, source in self.repository.list_item_source_products(user.id, list(items)):
            item = items[item_id]
            if (
                source.master_product_id == product.master_product_id
                and source.master_variant_id == product.master_variant_id
                and item.unit.strip().lower() == unit.strip().lower()
            ):
                return self.repository.lock_item(user.id, item_id)
        return None

    def is_other_catalog_product(self, user: User, item: StoreItem, product: SupplierProduct | None) -> bool:
        """Whether this item's received stock is a different catalog product or
        variant than this supplier product. An item never received from a catalog
        listing (added by hand) is not."""
        if product is None or product.master_product_id is None:
            return False
        masters = {
            (source.master_product_id, source.master_variant_id)
            for _item_id, source in self.repository.list_item_source_products(user.id, [item.id])
            if source.master_product_id is not None
        }
        return bool(masters) and (product.master_product_id, product.master_variant_id) not in masters

    def receive_into_stock(
        self, user: User, line: SupplierMaterialRequest, quantity: Decimal, receipt_key: str | None = None
    ) -> StoreItem:
        """What arrived of this line enters the store's stock, with its ledger row and
        its receipt. The caller holds the line locked and has checked the quantity
        against what is still to arrive. Not committed here."""
        item = self.find_or_create_item(user, line)
        item.is_active = True
        if line.price is not None:
            item.unit_cost = line.price
        record_movement(self.database, item, quantity, "PURCHASE_RECEIPT", reference=line.request_code[:8].upper())
        self.repository.add(
            StorePurchaseReceipt(
                order_line_id=line.id,
                store_manager_id=user.id,
                store_item_id=item.id,
                quantity=quantity,
                receipt_key=receipt_key,
            )
        )
        return item

    def receive_line(
        self, line_id: uuid.UUID, user: User, quantity: Decimal | None = None, receipt_key: str | None = None
    ):
        """Delivery confirmed: what actually arrived of this line enters the store's
        stock. Only an order the supplier has accepted can be received, in one go or in
        parts, never beyond what was ordered: the line is locked while its receipts are
        added up. The same receipt sent again (receipt_key) adds nothing."""
        require_complete_profile(user)
        line = self.repository.lock_purchase_line(user.id, line_id)
        if not line:
            raise HTTPException(status_code=404, detail="Purchase not found")
        if receipt_key:
            earlier = self.repository.find_receipt_by_key(receipt_key)
            if earlier is not None:
                # A Mark received already recorded (a retry, a double click): nothing more enters.
                self.repository.rollback()
                if earlier.order_line_id != line.id or earlier.store_manager_id != user.id:
                    raise HTTPException(status_code=409, detail="This receipt reference was already used.")
                item = self.database.get(StoreItem, earlier.store_item_id) if earlier.store_item_id else None
                if item is None:
                    raise HTTPException(status_code=409, detail="This receipt was already recorded.")
                return store_item_payload(item)
        if line.status not in RECEIVABLE_STATUSES:
            raise HTTPException(status_code=409, detail="Only a purchase the supplier has accepted can be received.")
        # Normalized: 1, not 1.000, in what the Store Manager and the engineer read.
        pending = (Decimal(str(line.quantity)) - Decimal(str(self.repository.received_quantity(line.id)))).normalize()
        if pending <= 0:
            raise HTTPException(status_code=409, detail="This delivery was already received in full.")
        quantity = pending if quantity is None else quantity.normalize()
        if quantity > pending:
            raise HTTPException(
                status_code=400, detail=f"Only {pending:f} {line.unit} of {line.material_name} is still to be received."
            )
        if is_count_unit(line.unit) and quantity != quantity.to_integral_value():
            raise HTTPException(
                status_code=400, detail=f"{line.material_name} is counted in {line.unit}: enter a whole number."
            )
        try:
            item = self.receive_into_stock(user, line, quantity, receipt_key)
            # A purchase bought for a Site Engineer request: tell its engineer the goods are in.
            checkout = self.repository.find_paid_checkout(user.id, line.request_code)
            site_request = (
                self.database.get(StoreSiteRequest, checkout.site_request_id)
                if checkout and checkout.site_request_id
                else None
            )
            if site_request is not None:
                create_notification(
                    self.database,
                    site_request.engineer_id,
                    "Goods received by the Store Manager",
                    f"{quantity:f} {line.unit} {line.material_name} for your request {site_request.public_request_id} has reached the store.",
                    category="MATERIAL",
                )
            # Every Site Engineer this store serves: an open Store reloads and shows the new stock.
            for engineer_id in self.repository.list_served_engineer_ids(user.id):
                queue_live_hint(self.database, engineer_id)
            self.repository.commit()
        except IntegrityError:
            # The same receipt_key recorded by a concurrent request: that one counts, this adds nothing.
            self.repository.rollback()
            raise HTTPException(status_code=409, detail="This receipt was already recorded.") from None
        self.repository.refresh(item)
        return store_item_payload(item)

    def list_payments(self, user: User):
        """Every payment, traceable to its purchase: the supplier, project and builder,
        and the supplier order lines it paid for with their order and receipt status."""
        lines_by_code: dict[str, list] = {}
        for line in self.repository.list_purchase_lines(user.id):
            lines_by_code.setdefault(line.request_code, []).append(line)
        receipts = receipts_by_line(self.repository.list_receipts(user.id))
        products = {line.product_id for lines in lines_by_code.values() for line in lines if line.product_id}
        sizes = {
            product.id: product.size
            for product in (self.database.get(SupplierProduct, product_id) for product_id in products)
            if product
        }
        payloads = []
        for row in self.repository.list_payments(user.id):
            payload = payment_payload(row)
            lines = lines_by_code.get(row.request_code, [])
            supplier = (
                self.repository.get_user(row.supplier_id or (lines[0].supplier_id if lines else None))
                if (row.supplier_id or lines)
                else None
            )
            project = (
                self.repository.get_project(row.project_id or (lines[0].project_id if lines else None))
                if (row.project_id or lines)
                else None
            )
            builder = self.repository.get_user(project.contractor_id) if project and project.contractor_id else None
            payload.update(
                {
                    "supplier_name": supplier.name if supplier else "",
                    "project_name": project.title if project else "",
                    "builder_id": builder.id if builder else None,
                    "builder_name": builder.name if builder else "",
                    "order_lines": [
                        {
                            "id": line.id,
                            "product_id": line.product_id,
                            "material_name": line.material_name,
                            "size": sizes.get(line.product_id),
                            "quantity": float(line.quantity),
                            "unit": line.unit,
                            "price": float(line.price) if line.price is not None else None,
                            "status": line.status,
                            **receipt_fields(line, receipts.get(line.id)),
                        }
                        for line in lines
                    ],
                }
            )
            payloads.append(payload)
        return payloads

    def record_payment(self, payload: StorePaymentCreate, user: User):
        require_complete_profile(user)
        method = payload.method.strip().upper()
        if method not in PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail="Choose a valid payment method.")
        # Locking the order's lines keeps two payments from both fitting one balance.
        lines = self.repository.lock_purchase_order(user.id, payload.request_code)
        if not lines:
            raise HTTPException(status_code=404, detail="Purchase not found")
        paid = paid_by_request_code(self.repository.list_payments(user.id)).get(payload.request_code, Decimal("0"))
        balance = order_total(lines) - paid
        if payload.amount > balance:
            raise HTTPException(
                status_code=409, detail=f"The balance on this purchase is Rs {max(balance, Decimal('0')):f}."
            )
        row = StorePaymentRecord(
            store_manager_id=user.id,
            request_code=payload.request_code,
            amount=payload.amount,
            method=method,
            reference=(payload.reference or "").strip() or None,
            note=(payload.note or "").strip() or None,
        )
        self.repository.add(row)
        self.repository.commit()
        self.repository.refresh(row)
        return payment_payload(row)
