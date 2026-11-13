"""A Store Manager's purchase from the builder's suppliers, paid through Razorpay TEST
(or the local mock): the Buy list, checkout priced on the server, verify (signature,
then the payment re-read from Razorpay), failure, check, the mock checkout, and the
purchase options for a site request's shortage (ported from the old
purchase_payment_service.py; same rules and answers).

Only a verified, captured payment creates the purchase order and its lines; the stock
enters when the goods are received. Supplier stock a Buy may take is its stock less
what is already promised out of it, counted with the listings locked."""

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.types import naive_utc_now
from app.integrations import razorpay as errors
from app.integrations.razorpay import (
    MOCK_MODE,
    TEST_PAYMENT_NOTICE,
    RazorpayRequestError,
    payment_error,
    verify_checkout_signature,
)
from app.modules.accounts.models import SupplierProfile
from app.modules.identity.models import User
from app.modules.marketplace.listings import (
    catalog_listings,
    supplier_product_payload,
    supplier_product_stock_state,
    tiers_for,
    unit_price_for,
)
from app.modules.marketplace.models import PurchaseOrder, PurchaseOrderItem, SupplierProduct
from app.modules.projects.access import (
    require_complete_profile,
    store_manager_serves_project,
)
from app.modules.projects.models import ProjectRequest
from app.modules.projects.notices import create_notification, create_request_notification
from app.modules.store.models import (
    METHOD_RAZORPAY,
    PAYMENT_CREATED,
    PAYMENT_FAILED,
    PAYMENT_PAID,
    StorePaymentRecord,
    StoreSiteRequest,
)
from app.modules.store.purchase_service import payment_payload, product_variant
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import PurchaseCheckoutCreate
from app.modules.store.site_request_service import (
    OPEN_STATUSES,
    SiteRequestService,
    covers,
    item_masters,
    qty,
    remaining_quantity,
    request_ref,
)

logger = logging.getLogger(__name__)

CURRENCY = "INR"
NOT_FROM_THIS_BUILDER = "This supplier is not on the team of this project's builder."
INSUFFICIENT_SUPPLIER_STOCK = "INSUFFICIENT_SUPPLIER_STOCK"
# How long a started checkout keeps its quantities from other Buys while it is paid.
CHECKOUT_HOLD = timedelta(minutes=30)
BUILDER_SUPPLIER_REQUEST_TYPES = ["CONTRACTOR_TO_SUPPLIER", "SUPPLIER_TO_CONTRACTOR"]


def listing_id(value: Any) -> uuid.UUID | None:
    """A listing id kept in a checkout's JSON snapshot (text), as a UUID."""
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def published_listings(database: Session, supplier_ids: Any) -> list[Any]:
    """(listing, supplier, supplier profile) of these suppliers' published catalog
    listings (the old cart repository's query_published_listings)."""
    return list(
        database.execute(
            catalog_listings(
                select(SupplierProduct, User, SupplierProfile)
                .join(User, SupplierProduct.supplier_id == User.id)
                .outerjoin(SupplierProfile, SupplierProfile.user_id == User.id)
                .where(SupplierProduct.is_published.is_(True), User.id.in_(list(supplier_ids)))
            )
        ).all()
    )


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def stock_refusal(product, available: Decimal) -> str:
    """Why a quantity of this listing cannot be bought, with what it can."""
    if available <= 0:
        return f"{product.name}: Supplier currently has no stock available."
    return (
        f"Insufficient supplier stock. This supplier currently has only {qty(available)} {product.unit} "
        f"of {product.name} available. Please reduce the quantity."
    )


def replenishes(product, item, masters: set) -> bool:
    """Whether a supplier listing is more of this store product: the catalog product
    received into it (else the same name), in the same size or variant and unit."""
    same = (product.master_product_id is not None and product.master_product_id in masters) or (
        product.name or ""
    ).strip().lower() == (item.name or "").strip().lower()
    if not same or (product.unit or "").strip().lower() != (item.unit or "").strip().lower():
        return False
    variant = (item.variant or "").strip().lower()
    return not variant or (product_variant(product) or "").strip().lower() == variant


def supplier_label(supplier: User | None) -> str:
    if supplier is None:
        return ""
    profile = supplier.supplier_profile
    return (profile.store_name if profile and profile.store_name else None) or supplier.name


class PurchasePaymentService:
    def __init__(self, repository: StoreManagerRepository, client):
        self.repository = repository
        self.database = repository.database
        self.client = client

    # ---------------------------------------------------------------- scope

    def served_project(self, user: User, project_id: uuid.UUID):
        project = self.repository.get_project(project_id)
        if not project or not store_manager_serves_project(self.database, user, project):
            raise HTTPException(status_code=403, detail="Choose a project of a builder whose team you are on.")
        return project

    def builder_supplier_ids(self, builder_id) -> set:
        """The suppliers this builder has accepted (either side sent the request):
        the same relationship approved_supplier_ids_for reads, for ONE builder."""
        ids = set()
        rows = self.database.execute(
            select(ProjectRequest.sender_id, ProjectRequest.receiver_id).where(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(BUILDER_SUPPLIER_REQUEST_TYPES),
                or_(ProjectRequest.sender_id == builder_id, ProjectRequest.receiver_id == builder_id),
            )
        ).all()
        for sender_id, receiver_id in rows:
            if sender_id == builder_id:
                ids.add(receiver_id)
            elif receiver_id == builder_id:
                ids.add(sender_id)
        return ids

    # ---------------------------------------------------------------- supplier stock

    def available_quantities(self, products, buyer_id) -> dict[uuid.UUID, Decimal]:
        """Per listing, what this Store Manager's Buy may still take of it (see the
        module note), never below zero. Their own open checkouts are not held against
        them: a closed payment window must not block paying again."""
        ids = [product.id for product in products]
        committed = self.repository.committed_supplier_quantities(ids)
        held: dict[uuid.UUID, Decimal] = {}
        for row in self.repository.list_open_checkouts(naive_utc_now() - CHECKOUT_HOLD):
            if row.store_manager_id == buyer_id:
                continue
            for item in row.items or []:
                product_id = listing_id(item.get("product_id"))
                if product_id in ids:
                    held[product_id] = held.get(product_id, Decimal("0")) + Decimal(str(item["quantity"]))
        return {
            product.id: max(
                Decimal(str(product.quantity or 0))
                - Decimal(str(committed.get(product.id, 0)))
                - held.get(product.id, Decimal("0")),
                Decimal("0"),
            )
            for product in products
        }

    def stock_shortfall(self, row: StorePaymentRecord) -> tuple[str | None, list[dict]]:
        """Counted again with the listings locked: why this checkout's quantities can
        no longer be supplied, and the latest available per short line; or (None, [])."""
        wanted: dict[uuid.UUID, Decimal] = {}
        for item in row.items or []:
            product_id = listing_id(item["product_id"])
            wanted[product_id] = wanted.get(product_id, Decimal("0")) + Decimal(str(item["quantity"]))
        products = self.repository.lock_supplier_products(row.supplier_id, list(wanted)) if row.supplier_id else []
        available = self.available_quantities(products, row.store_manager_id)
        by_id = {product.id: product for product in products}
        short = []
        for product_id, quantity in wanted.items():
            product = by_id.get(product_id)
            left = available.get(product_id, Decimal("0"))
            if product is None or quantity > left:
                short.append(
                    {
                        "product_id": str(product_id),
                        "name": product.name if product else "",
                        "unit": product.unit if product else "",
                        "requested": float(quantity),
                        "available": float(left),
                    }
                )
        if not short:
            return None, []
        first = by_id.get(short[0]["product_id"])
        message = (
            stock_refusal(first, Decimal(str(short[0]["available"])))
            if first
            else "A product of this purchase is no longer sold by this supplier."
        )
        return message, short

    # ---------------------------------------------------------------- Buy list

    def list_buy_products(self, user: User, project_id: uuid.UUID, item_id: uuid.UUID | None = None):
        """The Buy offers; with `item_id`, only those that replenish that store
        product: the same catalog product received into it (or the same name), the
        same size or variant, sold in the same unit."""
        project = self.served_project(user, project_id)
        supplier_ids = self.builder_supplier_ids(project.contractor_id)
        item = None
        if item_id is not None:
            item = next(iter(self.repository.list_items_by_ids(user.id, [item_id])), None)
            if item is None:
                raise HTTPException(status_code=404, detail="Product not found")
        if not supplier_ids:
            return {"products": [], "supplier_count": 0}
        rows = published_listings(self.database, supplier_ids)
        if item is not None:
            masters = item_masters(self.repository, user.id, [item.id]).get(item.id, set())
            rows = [row for row in rows if replenishes(row[0], item, masters)]
        products = []
        available = self.available_quantities([product for product, _supplier, _profile in rows], user.id)
        for product, supplier, profile in rows:
            master = product.master_product
            products.append(
                {
                    **supplier_product_payload(product),
                    "subcategory": master.subcategory.name
                    if master is not None and master.subcategory is not None
                    else None,
                    "supplier_id": supplier.id,
                    "supplier_name": supplier.name,
                    "store_name": profile.store_name if profile else "",
                    "stock_state": supplier_product_stock_state(product.quantity, product.low_stock_threshold),
                    # What a Buy can take now: the supplier's stock less what is already
                    # promised out of it. `quantity` stays the supplier's own stock figure.
                    "available_quantity": float(available[product.id]),
                }
            )
        products.sort(key=lambda item: (item["category"] or "", item["name"] or ""))
        return {"products": products, "supplier_count": len(supplier_ids)}

    # ---------------------------------------------------------------- checkout

    def checkout(self, payload: PurchaseCheckoutCreate, user: User):
        require_complete_profile(user)
        project = self.served_project(user, payload.project_id)
        if payload.supplier_id not in self.builder_supplier_ids(project.contractor_id):
            raise HTTPException(status_code=403, detail=NOT_FROM_THIS_BUILDER)
        product_ids = [line.product_id for line in payload.items]
        if len(set(product_ids)) != len(product_ids):
            raise HTTPException(status_code=400, detail="List each product once.")
        supplier = self.repository.get_user(payload.supplier_id)
        # The listings locked (id order) until this checkout is saved, and what each
        # can still supply counted under that lock: the browser's figure is not used.
        locked = {
            product.id: product for product in self.repository.lock_supplier_products(payload.supplier_id, product_ids)
        }
        available = self.available_quantities(list(locked.values()), user.id)
        cart, total = [], Decimal("0")
        chosen = []
        for requested in payload.items:
            product = locked.get(requested.product_id)
            product = product if product is not None and product.is_published else None
            if not product or product.id not in locked:
                self.database.rollback()
                raise HTTPException(status_code=400, detail="A selected product is no longer sold by this supplier.")
            left = available[product.id]
            if requested.quantity > left:
                self.database.rollback()
                raise payment_error(
                    409,
                    INSUFFICIENT_SUPPLIER_STOCK,
                    stock_refusal(product, left),
                    product_id=str(product.id),
                    name=product.name,
                    unit=product.unit,
                    available=float(left),
                    requested=float(requested.quantity),
                )
            # The unit price an order would be charged for this quantity (bulk tier or normal).
            unit_price, _tier = unit_price_for(product, float(requested.quantity), tiers_for(self.database, product.id))
            unit_price = money(Decimal(str(unit_price)))
            chosen.append((product, requested.quantity))
            line_total = money(unit_price * requested.quantity)
            total += line_total
            cart.append(
                {
                    "product_id": str(product.id),
                    "name": product.name,
                    "category": product.category,
                    "unit": product.unit,
                    "quantity": str(requested.quantity),
                    "unit_price": str(unit_price),
                    "line_total": str(line_total),
                }
            )
        total = money(total)
        amount_paise = int(total * 100)
        if amount_paise <= 0:
            raise HTTPException(status_code=400, detail="This order has no amount to pay.")

        # Buying to cover a Site Engineer request's shortage: that request, for the same project.
        site_request = None
        if payload.site_request_id is not None:
            site_request = self.repository.lock_site_request(user.id, payload.site_request_id)
            if site_request is None or site_request.status not in OPEN_STATUSES:
                self.database.rollback()
                raise HTTPException(status_code=404, detail="That request is not waiting for stock.")
            if site_request.project_id != project.id:
                self.database.rollback()
                raise HTTPException(status_code=400, detail="Buy for the request's own project.")
            refusal = self.over_procurement(user, site_request, chosen)
            if refusal:
                self.database.rollback()
                raise HTTPException(status_code=409, detail=refusal)

        request_code = uuid4().hex
        try:
            order = self.client.create_order(
                amount_paise,
                CURRENCY,
                receipt=f"sm_{request_code[:20]}",
                notes={"purpose": "store_purchase", "reference": request_code[:8].upper(), "mode": "test"},
            )
        except RazorpayRequestError as error:
            logger.warning("store_purchase.order_failed reference=%s reason=%s", request_code[:8], error)
            raise payment_error(
                502, errors.GATEWAY_UNAVAILABLE, "The payment gateway is unavailable. Please try again."
            )
        if order.amount_paise != amount_paise or order.currency != CURRENCY:
            raise payment_error(502, errors.AMOUNT_MISMATCH, "The payment gateway returned an unexpected amount.")

        row = StorePaymentRecord(
            store_manager_id=user.id,
            request_code=request_code,
            amount=total,
            method=METHOD_RAZORPAY,
            status=PAYMENT_CREATED,
            supplier_id=supplier.id,
            project_id=project.id,
            items=cart,
            razorpay_order_id=order.id,
            gateway_mode=self.client.mode,
            site_request_id=site_request.id if site_request else None,
        )
        if site_request is not None and not self.repository.list_site_request_payments(site_request.id):
            # The first purchase for this request: its engineer learns stock is on the way.
            create_notification(
                self.database,
                site_request.engineer_id,
                "Additional stock is being procured",
                f"{user.name} is buying more stock from {supplier_label(supplier)} for your request {request_ref(site_request)}.",
                category="MATERIAL",
            )
        self.repository.add(row)
        self.repository.commit()
        self.repository.refresh(row)
        logger.info(
            "store_purchase.order_ready reference=%s order=%s amount_paise=%s mode=%s",
            request_code[:8],
            order.id,
            amount_paise,
            self.client.mode,
        )
        return {
            **self.checkout_payload(row, supplier, project),
            # What the shared Razorpay Checkout opener reads.
            "key_id": self.client.key_id,
            "amount_paise": amount_paise,
            "currency": CURRENCY,
            "booking_reference": request_code[:8].upper(),
            "service_name": f"Purchase from {supplier_label(supplier)}",
            "customer_name": user.name,
            "customer_email": getattr(user, "email", None),
            "notice": TEST_PAYMENT_NOTICE,
        }

    def checkout_payload(self, row: StorePaymentRecord, supplier: User | None = None, project=None) -> dict:
        supplier = supplier or (self.repository.get_user(row.supplier_id) if row.supplier_id else None)
        project = project or (self.repository.get_project(row.project_id) if row.project_id else None)
        return {
            **payment_payload(row),
            "payment_id": row.id,
            "razorpay_order_id": row.razorpay_order_id,
            "gateway_mode": row.gateway_mode,
            "supplier_id": row.supplier_id,
            "supplier_name": supplier_label(supplier),
            "project_id": row.project_id,
            "project_name": project.title if project else "",
            "lines": [
                {
                    "product_id": item["product_id"],
                    "name": item["name"],
                    "category": item.get("category"),
                    "unit": item["unit"],
                    "quantity": float(item["quantity"]),
                    "unit_price": float(item["unit_price"]),
                    "line_total": float(item["line_total"]),
                }
                for item in (row.items or [])
            ],
        }

    # ---------------------------------------------------------------- verify

    def checkout_row(self, user: User, payment_id: uuid.UUID) -> StorePaymentRecord:
        row = self.repository.lock_payment(user.id, payment_id)
        if not row or row.method != METHOD_RAZORPAY:
            self.database.rollback()
            raise payment_error(404, errors.ORDER_NOT_FOUND, "Payment not found.")
        return row

    def verify(
        self,
        user: User,
        payment_id: uuid.UUID,
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str,
    ):
        row = self.checkout_row(user, payment_id)
        if row.status == PAYMENT_PAID:
            # A repeated callback for the payment already recorded: the same answer, nothing redone.
            if row.razorpay_payment_id == razorpay_payment_id:
                self.database.rollback()
                return self.paid_result(row, user)
            self.database.rollback()
            raise payment_error(409, errors.ALREADY_PAID, "This purchase is already paid.")
        if row.gateway_mode != self.client.mode:
            self.database.rollback()
            raise payment_error(
                409, errors.GATEWAY_MODE_CHANGED, "Payment settings changed. Please start the payment again."
            )
        # The id that counts is OUR stored one; the client's must merely agree with it.
        if razorpay_order_id != row.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, errors.ORDER_MISMATCH, "This payment does not belong to this order.")
        if not verify_checkout_signature(
            self.client.signing_secret(), row.razorpay_order_id, razorpay_payment_id, razorpay_signature
        ):
            self.database.rollback()
            logger.warning("store_purchase.signature_invalid order=%s", row.razorpay_order_id)
            raise payment_error(
                400, errors.SIGNATURE_INVALID, "Payment verification failed. The purchase was not recorded as paid."
            )
        try:
            payment = self.client.fetch_payment(razorpay_payment_id)
            if payment.order_id == row.razorpay_order_id and payment.status == "authorized":
                self.release_if_short(row, user)
                payment = self.client.capture_payment(payment.id, int(money(row.amount) * 100), CURRENCY)
        except RazorpayRequestError as error:
            self.database.rollback()
            logger.warning("store_purchase.fetch_failed order=%s reason=%s", row.razorpay_order_id, error)
            raise payment_error(
                502, errors.GATEWAY_UNAVAILABLE, "The payment could not be confirmed. Please try again."
            )
        return self.settle(row, user, payment)

    def release_if_short(self, row: StorePaymentRecord, user: User) -> None:
        """An authorized payment not yet captured: if the supplier can no longer supply
        it, it is not captured (Razorpay releases the authorization) and the checkout
        is FAILED. Nothing is bought and no money is taken."""
        message, short = self.stock_shortfall(row)
        if not message:
            return
        logger.warning("store_purchase.released_short reference=%s", row.request_code[:8])
        self.mark_failed(row, user, f"Supplier stock changed before payment: {message}")
        raise payment_error(409, INSUFFICIENT_SUPPLIER_STOCK, f"{message} The payment was not taken.", lines=short)

    def settle(self, row: StorePaymentRecord, user: User, payment):
        """Razorpay's own record of a payment decides; row is locked by the caller."""
        if payment.order_id != row.razorpay_order_id:
            self.database.rollback()
            raise payment_error(400, errors.ORDER_MISMATCH, "This payment does not belong to this order.")
        if payment.amount_paise != int(money(row.amount) * 100) or payment.currency != CURRENCY:
            self.database.rollback()
            raise payment_error(400, errors.AMOUNT_MISMATCH, "The payment amount does not match the order amount.")
        if payment.status == "failed":
            self.mark_failed(row, user, payment.error_description or payment.error_code)
            raise payment_error(402, errors.PAYMENT_FAILED, "Payment failed. No stock was added; please try again.")
        if payment.status != "captured":
            self.database.rollback()
            raise payment_error(409, errors.PAYMENT_NOT_COMPLETED, "The payment has not completed yet.")
        return self.finalize(row, user, payment.id)

    def finalize(self, row: StorePaymentRecord, user: User, razorpay_payment_id: str):
        """Verified: the purchase, the stock and PAID, together or not at all."""
        if row.project_id is None or row.supplier_id is None:
            self.database.rollback()
            raise HTTPException(
                status_code=409,
                detail="The project or supplier of this purchase no longer exists. Contact CREWNBUILD support.",
            )
        # Money already taken is never lost: the purchase is recorded even if the
        # supplier's stock has since gone, and the Store Manager is told so plainly
        # (the supplier then accepts what it can and rejects the rest, as before).
        stock_warning, _short = self.stock_shortfall(row)
        try:
            # The purchase, on the table the supplier's screens read. The stock is
            # not here: it enters when the goods are received (PurchaseService.receive_line,
            # once the supplier has accepted), through the once-only receipt.
            order = PurchaseOrder(
                order_number=row.request_code, project_id=row.project_id, buyer_id=user.id, supplier_id=row.supplier_id
            )
            self.repository.add(order)
            for item in row.items or []:
                self.repository.add(
                    PurchaseOrderItem(
                        order=order,
                        product_id=listing_id(item["product_id"]),
                        material_name=item["name"],
                        category=item.get("category"),
                        price=Decimal(item["unit_price"]),
                        quantity=float(item["quantity"]),
                        unit=item["unit"],
                        created_at=naive_utc_now(),
                    )
                )
            row.status = PAYMENT_PAID
            row.razorpay_payment_id = razorpay_payment_id
            row.reference = razorpay_payment_id
            row.failure_reason = None
            row.paid_at = naive_utc_now()
            project = self.repository.get_project(row.project_id)
            reference = row.request_code[:8].upper()
            summary = ", ".join(
                f"{float(item['quantity']):g} {item['unit']} {item['name']}" for item in row.items or []
            )
            create_request_notification(
                self.database,
                row.supplier_id,
                f"New paid purchase order from {user.name} (Store Manager)",
                f"Purchase #{reference} · {summary} · Paid Rs {money(row.amount)} (Razorpay TEST)"
                + (f" · Project: {project.title}" if project else ""),
                category="MATERIAL",
            )
            create_notification(
                self.database,
                user.id,
                "Payment successful",
                f"Purchase #{reference} from {supplier_label(self.repository.get_user(row.supplier_id))}: Rs {money(row.amount)} paid for {summary}. "
                "It enters your Catalog when you receive the goods.",
                category="MATERIAL",
            )
            if stock_warning:
                create_notification(
                    self.database,
                    user.id,
                    "Supplier stock changed during payment",
                    f"Purchase #{reference} was paid, but {stock_warning} The supplier may not be able to accept all of it.",
                    category="MATERIAL",
                )
            if row.site_request_id is not None:
                site_request = self.repository.database.get(StoreSiteRequest, row.site_request_id)
                if site_request is not None:
                    create_notification(
                        self.database,
                        site_request.engineer_id,
                        "Supplier purchase completed",
                        f"The stock for your request {request_ref(site_request)} has been bought ({summary}) and is on its way to the store.",
                        category="MATERIAL",
                    )
            self.repository.commit()
        except IntegrityError:
            # Another request recorded this payment first (or the same receipt): nothing of ours is kept.
            self.database.rollback()
            raise payment_error(409, errors.ALREADY_PAID, "This payment was already recorded.")
        logger.info("store_purchase.paid reference=%s payment=%s", row.request_code[:8], razorpay_payment_id)
        if stock_warning:
            logger.warning("store_purchase.paid_short reference=%s", row.request_code[:8])
            return {**self.paid_result(row, user), "stock_warning": stock_warning}
        return self.paid_result(row, user)

    def paid_result(self, row: StorePaymentRecord, user: User):
        return {"status": PAYMENT_PAID, "payment": self.checkout_payload(row)}

    # ---------------------------------------------------------------- shortage

    def over_procurement(self, user: User, site_request, chosen) -> str | None:
        """Why this purchase would buy more of a request's shortage than is still to
        buy (what is short minus what is already ordered and not yet received), or None."""
        lines = self.repository.list_request_lines(site_request.id)
        items = {
            item.id: item
            for item in self.repository.list_items_by_ids(
                user.id, [line.store_item_id for line in lines if line.store_item_id]
            )
        }
        masters = item_masters(self.repository, user.id, [line.store_item_id for line in lines])
        state = {
            line["id"]: line for line in SiteRequestService(self.repository).request_payload(site_request)["lines"]
        }
        buying: dict[uuid.UUID, Decimal] = {}
        for product, quantity in chosen:
            line = next(
                (line for line in lines if covers(product.name, product, line, items.get(line.store_item_id), masters)),
                None,
            )
            if line is not None:
                buying[line.id] = buying.get(line.id, Decimal("0")) + Decimal(str(quantity))
        for line in lines:
            if line.id not in buying:
                continue
            to_procure, on_order = Decimal(str(state[line.id]["to_procure"])), Decimal(str(state[line.id]["on_order"]))
            if buying[line.id] <= to_procure:
                continue
            if to_procure <= 0 and on_order > 0:
                return (
                    f"Procurement pending – {qty(on_order)} {line.unit} of {line.item_name} is already ordered for request {request_ref(site_request)}. "
                    "Receive that delivery before buying more."
                )
            if to_procure <= 0:
                return f"Request {request_ref(site_request)} is not short of {line.item_name}: nothing needs to be bought for it."
            return (
                f"Only {qty(to_procure)} {line.unit} more of {line.item_name} is needed for request {request_ref(site_request)}"
                + (f" ({qty(on_order)} {line.unit} is already ordered)." if on_order > 0 else ".")
            )
        return None

    def purchase_options(self, user: User, request_id: uuid.UUID):
        """For each product a request is short of: how much is missing, and the
        builder's suppliers selling that product, with their price and stock."""
        site_request = self.repository.lock_site_request(user.id, request_id)
        self.database.rollback()
        if site_request is None:
            raise HTTPException(status_code=404, detail="Request not found")
        project = self.repository.get_project(site_request.project_id)
        supplier_ids = self.builder_supplier_ids(project.contractor_id) if project else set()
        # A request rejected or handed over in full is short of nothing.
        lines = self.repository.list_request_lines(site_request.id) if site_request.status in OPEN_STATUSES else []
        items = {
            item.id: item
            for item in self.repository.list_items_by_ids(
                user.id, [line.store_item_id for line in lines if line.store_item_id]
            )
        }
        # An item's catalog product, from the purchases received into it.
        master_ids = item_masters(self.repository, user.id, list(items))
        state = (
            {line["id"]: line for line in SiteRequestService(self.repository).request_payload(site_request)["lines"]}
            if lines
            else {}
        )
        listings = []
        if supplier_ids:
            listings = published_listings(self.database, supplier_ids)
        result = []
        for line in lines:
            item = items.get(line.store_item_id)
            available = Decimal(item.quantity) if item else Decimal("0")
            # Only what the request is still owed: a part already handed over is not short.
            shortage = remaining_quantity(line) - available
            if shortage <= 0:
                continue
            options = []
            # Bought already and not yet received: only the rest is still to buy.
            on_order = Decimal(str(state.get(line.id, {}).get("on_order", 0)))
            to_procure = max(shortage - on_order, Decimal("0"))
            for product, supplier, profile in listings:
                # The same catalog product or name; a shortage of one size is bought in that size.
                if not covers(product.name, product, line, item, master_ids):
                    continue
                options.append(
                    {
                        **supplier_product_payload(product),
                        "supplier_id": supplier.id,
                        "supplier_name": supplier.name,
                        "store_name": profile.store_name if profile else "",
                        "can_cover": float(product.quantity or 0) >= float(to_procure),
                    }
                )
            options.sort(key=lambda option: (not option["can_cover"], option["price"] or 0))
            result.append(
                {
                    "line_id": line.id,
                    "item_id": line.store_item_id,
                    "item_name": line.item_name,
                    "unit": line.unit,
                    "requested": float(line.quantity),
                    "issued": float(line.issued_quantity or 0),
                    "available": float(available),
                    "shortage": float(shortage),
                    "on_order": float(min(on_order, shortage)),
                    "to_procure": float(to_procure),
                    "project_id": site_request.project_id,
                    "options": options,
                }
            )
        return {"request_id": site_request.id, "project_id": site_request.project_id, "lines": result}

    # ---------------------------------------------------------------- failure / pending

    def mark_failed(self, row: StorePaymentRecord, user: User, reason: str | None) -> None:
        first_time = row.status != PAYMENT_FAILED
        row.status = PAYMENT_FAILED
        row.failure_reason = (reason or "Payment failed")[:255]
        if first_time:
            create_notification(
                self.database,
                user.id,
                "Payment failed",
                f"Purchase #{row.request_code[:8].upper()} was not paid ({row.failure_reason}). No stock was added.",
                category="MATERIAL",
            )
        self.repository.commit()

    def report_failure(self, user: User, payment_id: uuid.UUID, code: str | None, description: str | None):
        """Checkout said the payment failed. Recorded as FAILED -- never as paid --
        and a later successful attempt on the same order can still be verified."""
        row = self.checkout_row(user, payment_id)
        if row.status == PAYMENT_PAID:
            self.database.rollback()
            return self.checkout_payload(row)
        self.mark_failed(row, user, description or code)
        return self.checkout_payload(row)

    def check(self, user: User, payment_id: uuid.UUID):
        """A checkout still open: ask Razorpay what happened to its order."""
        row = self.checkout_row(user, payment_id)
        if row.status == PAYMENT_PAID:
            self.database.rollback()
            return self.paid_result(row, user)
        if row.gateway_mode != self.client.mode:
            self.database.rollback()
            raise payment_error(
                409, errors.GATEWAY_MODE_CHANGED, "Payment settings changed. Please start the payment again."
            )
        try:
            payments = self.client.fetch_order_payments(row.razorpay_order_id)
            authorized = next((item for item in payments if item.status == "authorized"), None)
            if authorized is not None and not any(item.status == "captured" for item in payments):
                self.release_if_short(row, user)
                payments = [self.client.capture_payment(authorized.id, int(money(row.amount) * 100), CURRENCY)]
        except RazorpayRequestError as error:
            self.database.rollback()
            logger.warning("store_purchase.check_failed order=%s reason=%s", row.razorpay_order_id, error)
            raise payment_error(502, errors.GATEWAY_UNAVAILABLE, "The payment could not be checked. Please try again.")
        captured = next((item for item in payments if item.status == "captured"), None)
        if captured is not None:
            return self.settle(row, user, captured)
        failed = next((item for item in payments if item.status == "failed"), None)
        if failed is not None and row.status == PAYMENT_CREATED:
            self.mark_failed(row, user, failed.error_description or failed.error_code)
            return {"status": PAYMENT_FAILED, "payment": self.checkout_payload(row)}
        status = row.status
        payload = self.checkout_payload(row)
        self.database.rollback()
        return {"status": status, "payment": payload}

    def mock_checkout(self, user: User, payment_id: uuid.UUID, succeed: bool):
        """Stand-in for Razorpay Checkout while no TEST keys are set (RAZORPAY_ALLOW_MOCK). Refused otherwise."""
        if self.client.mode != MOCK_MODE:
            raise payment_error(404, errors.MOCK_DISABLED, "Not available.")
        row = self.checkout_row(user, payment_id)
        self.database.rollback()
        if row.gateway_mode != MOCK_MODE or row.status == PAYMENT_PAID:
            raise payment_error(
                409,
                errors.ALREADY_PAID if row.status == PAYMENT_PAID else errors.GATEWAY_MODE_CHANGED,
                "This payment cannot be simulated.",
            )
        payment, signature = self.client.simulate_checkout(
            row.razorpay_order_id, int(money(row.amount) * 100), CURRENCY, succeed
        )
        return {
            "succeeded": succeed,
            "razorpay_order_id": row.razorpay_order_id,
            "razorpay_payment_id": payment.id,
            "razorpay_signature": signature,
            "error_code": payment.error_code,
            "error_description": payment.error_description,
        }
