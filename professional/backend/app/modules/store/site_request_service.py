"""Site Engineers' requests to their builder's Store Manager: raise, cancel, approve
or reject, hand over in parts; what a request is short of and what was bought for it
(ported from the old site_request_service.py; same rules and answers)."""

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.identity.models import User
from app.modules.marketplace.models import SupplierProduct
from app.modules.projects.access import (
    engineer_has_project_access,
    ensure_role,
    require_complete_profile,
    store_manager_serves_project,
)
from app.modules.projects.notices import create_notification, create_request_notification
from app.modules.store.models import PAYMENT_CREATED, PAYMENT_PAID, StoreSiteRequest, StoreSiteRequestLine
from app.modules.store.purchase_service import RECEIVABLE_STATUSES, product_variant, purchase_id
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import SiteRequestCreate, SiteRequestDecision, SiteRequestIssue
from app.modules.store.stock_service import (
    engineer_item_payload,
    is_count_unit,
    item_sources,
    notify_if_stock_fell,
    record_movement,
    stock_state,
)

# A request still owed something: not yet decided, approved with nothing handed
# over yet, or handed over in part.
OPEN_STATUSES = ("PENDING", "APPROVED", "PARTIALLY_ISSUED")
# Approved and still to be handed over (in full or the rest of it).
ISSUABLE_STATUSES = ("APPROVED", "PARTIALLY_ISSUED")


def ensure_site_engineer(user: User) -> None:
    """A store's customers are the other engineers; a Store Manager does not
    request from a store."""
    ensure_role(user, "ENGINEER")
    if is_store_manager(user):
        raise HTTPException(status_code=403, detail="Store Managers do not raise site requests.")


def request_ref(row: StoreSiteRequest) -> str:
    """The Request ID people see (migration 0049): the request's UUID, never its
    numeric key."""
    return str(row.id)


def parse_request_search(text: str | None) -> uuid.UUID | None | bool:
    """A Request ID typed into search, in any letter case and with or without a
    leading #: its UUID, None when nothing was typed, or False when it is not a
    UUID (which no request can match)."""
    value = (text or "").strip().lstrip("#").strip()
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return False


def remaining_quantity(line: StoreSiteRequestLine) -> Decimal:
    return Decimal(line.quantity) - Decimal(line.issued_quantity or 0)


def issue_batches(times: list[datetime]) -> list[datetime]:
    """One hand-over writes all its ledger rows with one timestamp (hand_over), so
    each distinct time is one hand-over."""
    return sorted(set(times))


def item_masters(repository: StoreManagerRepository, store_manager_id, item_ids) -> dict[uuid.UUID, set]:
    """Per store item, the catalog products received into it."""
    masters: dict[uuid.UUID, set] = {}
    for item_id, product in repository.list_item_source_products(
        store_manager_id, [item_id for item_id in item_ids if item_id]
    ):
        if product.master_product_id is not None:
            masters.setdefault(item_id, set()).add(product.master_product_id)
    return masters


def covers(
    product_name: str | None,
    product: SupplierProduct | None,
    line: StoreSiteRequestLine,
    item,
    masters: dict[uuid.UUID, set],
) -> bool:
    """Whether a supplier product (offered or bought) is what this request line asks
    for: the catalog product received into its store item, or the same name; and,
    for an item kept in one size, that size and no other."""
    same = (
        product is not None
        and product.master_product_id is not None
        and product.master_product_id in masters.get(line.store_item_id, set())
    ) or (product_name or "").strip().lower() == line.item_name.strip().lower()
    if not same:
        return False
    variant = ((item.variant if item is not None else line.item_variant) or "").strip().lower()
    return not variant or (product_variant(product) or "").strip().lower() == variant


def qty(value) -> str:
    """A quantity as people write it: 2, 12.5 -- not 2.000."""
    return format(Decimal(str(value)).normalize(), "f")


def shortage_text(shorts: list[tuple[Decimal, str, str]]) -> str:
    return ", ".join(
        f"{qty(quantity)} {unit}" + (f" {name}" if len(shorts) > 1 else "") for quantity, unit, name in shorts
    )


def request_stage(status: str, short: bool, procurement_open: bool) -> str:
    """The one word a request is shown as: the stored status, or for an open request
    what it is waiting for."""
    if status in ("REJECTED", "CANCELLED"):
        return status
    if status == "ISSUED":
        return "FULFILLED"
    if status == "PARTIALLY_ISSUED":
        return "PARTIALLY_FULFILLED"
    if short and procurement_open:
        return "PROCUREMENT_PENDING"
    if short:
        return "PARTIALLY_AVAILABLE"
    return status


class SiteRequestService:
    def __init__(self, repository: StoreManagerRepository):
        self.repository = repository
        self.database = repository.database

    def procurement(self, row: StoreSiteRequest, lines, items) -> tuple[list[dict], dict[uuid.UUID, dict]]:
        """The supplier purchases bought for this request (site_request_id), and per
        request line what they ordered, what has reached the store and what is still
        on order (paid, not rejected, not yet received). A purchase line counts for
        the request line it covers (same catalog product or name, same size).
        Nothing financial: the engineer reads this too."""
        payments = self.repository.list_site_request_payments(row.id)
        paid = {payment.request_code: payment for payment in payments if payment.status == PAYMENT_PAID}
        # Over all of a line's receipts: a line can arrive in parts (migration 0048).
        received_lines: dict[uuid.UUID, Decimal] = {}
        for receipt, line in self.repository.list_receipts_for_codes(list(paid)):
            received_lines[line.id] = received_lines.get(line.id, Decimal("0")) + Decimal(receipt.quantity)
        masters = item_masters(self.repository, row.store_manager_id, [line.store_item_id for line in lines])
        per_line = {
            line.id: {"ordered": Decimal("0"), "received": Decimal("0"), "on_order": Decimal("0")} for line in lines
        }
        orders: dict[str, dict] = {}
        for payment in payments:
            if payment.status == PAYMENT_CREATED:
                orders[payment.request_code] = {
                    "reference_code": payment.request_code[:8].upper(),
                    "purchase_id": purchase_id(payment.request_code),
                    "status": "AWAITING_PAYMENT",
                    "supplier_name": "",
                    "lines": [],
                }
        for bought in self.repository.list_purchase_lines_for_codes(list(paid)):
            got = received_lines.get(bought.id, Decimal("0"))
            # Received in full; a part received leaves the rest on order.
            received = got >= Decimal(str(bought.quantity))
            if bought.request_code not in orders:
                supplier = self.repository.get_user(bought.supplier_id) if bought.supplier_id else None
                orders[bought.request_code] = {
                    "reference_code": bought.request_code[:8].upper(),
                    "purchase_id": purchase_id(bought.request_code),
                    "status": "ORDERED",
                    "supplier_name": supplier.name if supplier else "",
                    "lines": [],
                }
            order = orders[bought.request_code]
            order["lines"].append(
                {
                    "item_name": bought.material_name,
                    "unit": bought.unit,
                    "quantity": float(bought.quantity),
                    "supplier_status": bought.status,
                    "received": received,
                }
            )
            if bought.status == "REJECTED":
                continue
            product = self.database.get(SupplierProduct, bought.product_id) if bought.product_id else None
            target = next(
                (
                    line
                    for line in lines
                    if covers(bought.material_name, product, line, items.get(line.store_item_id), masters)
                ),
                None,
            )
            if target is None:
                continue
            totals = per_line[target.id]
            totals["ordered"] += Decimal(str(bought.quantity))
            totals["received"] += got
            totals["on_order"] += max(Decimal(str(bought.quantity)) - got, Decimal("0"))
        for order in orders.values():
            live = [line for line in order["lines"] if line["supplier_status"] != "REJECTED"]
            if order["status"] == "ORDERED" and live and all(line["received"] for line in live):
                order["status"] = "RECEIVED"
            elif order["status"] == "ORDERED" and not live:
                order["status"] = "REJECTED"
        return list(orders.values()), per_line

    def request_payload(self, row: StoreSiteRequest) -> dict:
        project = self.repository.get_project(row.project_id)
        engineer = self.repository.get_user(row.engineer_id)
        manager = self.repository.get_user(row.store_manager_id)
        builder = self.repository.get_user(project.contractor_id) if project and project.contractor_id else None
        lines = self.repository.list_request_lines(row.id)
        items = {
            item.id: item
            for item in self.repository.list_items_by_ids(
                row.store_manager_id, [line.store_item_id for line in lines if line.store_item_id]
            )
        }
        purchases, procured = self.procurement(row, lines, items)
        is_open = row.status in OPEN_STATUSES
        approved = row.status in ("APPROVED", "PARTIALLY_ISSUED", "ISSUED")
        line_payloads = []
        for line in lines:
            item = items.get(line.store_item_id)
            available = Decimal(item.quantity) if item else Decimal("0")
            remaining = remaining_quantity(line) if row.status not in ("REJECTED", "CANCELLED") else Decimal("0")
            bought = procured[line.id]
            # Only received goods are stock. What is ordered and not yet received does
            # not reduce the shortage; it only means less is left to buy.
            shortage = max(remaining - available, Decimal("0")) if is_open else Decimal("0")
            on_order = bought["on_order"] if is_open else Decimal("0")
            line_payloads.append(
                {
                    "id": line.id,
                    "item_id": line.store_item_id,
                    "item_name": line.item_name,
                    "variant": line.item_variant,
                    "category": item.category if item else None,
                    "unit": line.unit,
                    "quantity": float(line.quantity),
                    "approved_quantity": float(line.quantity) if approved else 0.0,
                    "issued": float(line.issued_quantity or 0),
                    "remaining": float(remaining),
                    "available": float(available),
                    # What the store cannot hand over from what it holds now.
                    "shortage": float(shortage),
                    "ordered": float(bought["ordered"]),
                    "received": float(bought["received"]),
                    # Bought for this shortage and not yet received; what is still to buy.
                    "on_order": float(min(on_order, shortage)),
                    "to_procure": float(max(shortage - on_order, Decimal("0"))),
                }
            )
        short = is_open and any(line["shortage"] for line in line_payloads)
        procurement_open = any(order["status"] in ("AWAITING_PAYMENT", "ORDERED") for order in purchases)
        return {
            "id": row.id,
            # The Request ID shown and searched everywhere, the same for the request's whole life.
            "public_request_id": request_ref(row),
            "status": row.status,
            "stage": request_stage(row.status, short, procurement_open),
            "procurement_status": ("NONE" if not purchases else "PENDING" if procurement_open else "RECEIVED"),
            "purchases": purchases,
            "note": row.note,
            "decision_note": row.decision_note,
            # Who decided (the request's own Store Manager, the only one who can) and
            # who the material was handed to (the engineer who asked for it).
            "approved_by": manager.name if manager and approved else None,
            "received_by": engineer.name if engineer and row.status in ("PARTIALLY_ISSUED", "ISSUED") else None,
            "issued_quantity": {line["id"]: line["issued"] for line in line_payloads},
            "short": short,
            "timeline": self.timeline(row, short),
            "project_id": row.project_id,
            "project_name": project.title if project else "",
            # The builder whose team this store serves: the request's project's builder.
            "builder_id": builder.id if builder else None,
            "builder_name": builder.name if builder else "",
            "engineer_id": row.engineer_id,
            "engineer_name": engineer.name if engineer else "",
            "store_manager_id": row.store_manager_id,
            "store_manager_name": manager.name if manager else "",
            "created_at": local_iso(row.created_at),
            "decided_at": local_iso(row.decided_at) if row.decided_at else None,
            "issued_at": local_iso(row.issued_at) if row.issued_at else None,
            "lines": line_payloads,
            # Something still owed that the store holds now.
            "can_issue": row.status in ISSUABLE_STATUSES
            and any(line["remaining"] and line["available"] for line in line_payloads),
            # Only the engineer's own undecided request can be withdrawn.
            "can_cancel": row.status == "PENDING",
            # Approved only once the store holds all of it (a shortage is bought and
            # received first).
            "can_approve": row.status == "PENDING" and not short,
        }

    def timeline(self, row: StoreSiteRequest, short: bool) -> list[dict]:
        """The request's history from what the database recorded: submitted, the
        purchases made to cover its shortage (started, paid, received), the decision
        and the hand-overs. A shortage still open has no moment of its own: it is
        the request's present state."""
        events = [{"event": "SUBMITTED", "at": row.created_at}]
        if row.status == "PENDING":
            events.append({"event": "WAITING", "at": None})
        if short:
            events.append({"event": "SHORTAGE", "at": None})
        payments = self.repository.list_site_request_payments(row.id)
        for payment in payments:
            events.append({"event": "PROCUREMENT_STARTED", "at": payment.created_at})
            if payment.status == "PAID":
                events.append({"event": "PURCHASE_COMPLETED", "at": payment.paid_at})
        paid_codes = [payment.request_code for payment in payments if payment.status == "PAID"]
        for receipt, _line in self.repository.list_receipts_for_codes(paid_codes):
            events.append({"event": "GOODS_RECEIVED", "at": receipt.received_at})
        if row.decided_at:
            events.append(
                {"event": row.status if row.status in ("REJECTED", "CANCELLED") else "APPROVED", "at": row.decided_at}
            )
        # Every hand-over but the one that completed the request was a part of it.
        batches = issue_batches(self.repository.list_request_issue_times(row.id))
        partial = batches[:-1] if row.status == "ISSUED" else batches
        events.extend({"event": "PARTIALLY_ISSUED", "at": moment} for moment in partial)
        if row.issued_at:
            events.append({"event": "ISSUED", "at": row.issued_at})
        timed = sorted((event for event in events if event["at"]), key=lambda event: event["at"])
        current = [event for event in events if not event["at"]]
        return [
            {"event": event["event"], "at": local_iso(event["at"]) if event["at"] else None}
            for event in timed + current
        ]

    # ---- Store Manager
    def list_requests(self, status: str | None, user: User, search: str | None = None):
        public_id = parse_request_search(search)
        if public_id is False:
            return []
        return [
            self.request_payload(row)
            for row in self.repository.list_site_requests(user.id, (status or "").strip().upper() or None, public_id)
        ]

    def own_request(self, request_id: uuid.UUID, user: User) -> StoreSiteRequest:
        row = self.repository.lock_site_request(user.id, request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        return row

    def decide(self, request_id: uuid.UUID, approved: bool, payload: SiteRequestDecision, user: User):
        """Reject, or approve. Approving moves no stock: the request leaves Requests
        for Approvals, where the Store Manager issues it (issue), all at once or in
        parts. A product the store is short of is not a reason to refuse: the rest
        is issued once the shortage has been bought and received."""
        require_complete_profile(user)
        row = self.own_request(request_id, user)
        if row.status != "PENDING":
            raise HTTPException(
                status_code=409, detail=f"This request was already {row.status.lower().replace('_', ' ')}"
            )
        if approved:
            # Approval waits for the stock: a shortage is bought and received first.
            lines = self.repository.list_request_lines(row.id)
            items = {
                item.id: item
                for item in self.repository.list_items_by_ids(
                    user.id, [line.store_item_id for line in lines if line.store_item_id]
                )
            }
            shorts = []
            for line in lines:
                held = Decimal(items[line.store_item_id].quantity) if line.store_item_id in items else Decimal("0")
                if remaining_quantity(line) > held:
                    shorts.append((remaining_quantity(line) - held, line.unit, line.item_name))
            if shorts:
                raise HTTPException(
                    status_code=409,
                    detail=f"Insufficient stock. Please purchase the remaining {shortage_text(shorts)} from an assigned Supplier before approving this request.",
                )
        row.decision_note = (payload.note or "").strip() or None
        project = self.repository.get_project(row.project_id)
        row.status = "APPROVED" if approved else "REJECTED"
        row.decided_at = naive_utc_now()
        word = "approved" if approved else "rejected"
        create_request_notification(
            self.database,
            row.engineer_id,
            f"Store request {word}",
            f"{user.name} {word} your request {request_ref(row)} for {project.title if project else 'your project'}."
            + (f" Note: {row.decision_note}" if row.decision_note else ""),
            category="MATERIAL",
        )
        self.repository.commit()
        return self.request_payload(row)

    def locked_stock(self, row: StoreSiteRequest, user: User):
        """The request's lines and their store items, locked in id order: two
        approvals or issues spending the same stock wait for each other."""
        lines = self.repository.list_request_lines(row.id)
        items = {
            item.id: item
            for item in self.repository.lock_items(
                user.id, [line.store_item_id for line in lines if line.store_item_id]
            )
        }
        return lines, items

    def issue(self, request_id: uuid.UUID, user: User, payload: SiteRequestIssue | None = None):
        """Hand over what an approved request is still owed, under row locks, so two
        issues cannot spend the same stock: per line the quantity the Store Manager
        entered, or, with none entered, as much as the store holds."""
        require_complete_profile(user)
        row = self.own_request(request_id, user)
        if row.status not in ISSUABLE_STATUSES:
            raise HTTPException(status_code=409, detail="Only an approved request still owed products can be issued.")
        lines, items = self.locked_stock(row, user)
        wanted = self.issue_quantities(payload, lines, items) if payload and payload.lines is not None else None
        if wanted is None and not any(
            remaining_quantity(line) > 0 and line.store_item_id in items and items[line.store_item_id].quantity > 0
            for line in lines
        ):
            raise HTTPException(
                status_code=409,
                detail="Nothing this request still needs is in stock. Receive the purchase for its shortage first.",
            )
        self.hand_over(row, user, lines, items, self.repository.get_project(row.project_id), wanted)
        self.repository.commit()
        return self.request_payload(row)

    @staticmethod
    def issue_quantities(payload: SiteRequestIssue, lines, items) -> dict[uuid.UUID, Decimal]:
        """The quantities entered for an issue, checked against what is owed and held."""
        by_id = {line.id: line for line in lines}
        wanted: dict[uuid.UUID, Decimal] = {}
        for entry in payload.lines:
            line = by_id.get(entry.line_id)
            if line is None:
                raise HTTPException(status_code=400, detail="A product is not part of this request.")
            if entry.line_id in wanted:
                raise HTTPException(status_code=400, detail="List each product once.")
            owed = remaining_quantity(line)
            if entry.quantity > owed:
                raise HTTPException(
                    status_code=400, detail=f"{line.item_name}: only {qty(owed)} {line.unit} is still owed."
                )
            item = items.get(line.store_item_id)
            held = Decimal(item.quantity) if item else Decimal("0")
            if entry.quantity > held:
                raise HTTPException(
                    status_code=409, detail=f"{line.item_name}: the store holds {qty(held)} {line.unit}."
                )
            if is_count_unit(line.unit) and entry.quantity != entry.quantity.to_integral_value():
                raise HTTPException(
                    status_code=400, detail=f"{line.item_name} is counted in {line.unit}: enter a whole number."
                )
            wanted[entry.line_id] = entry.quantity
        if not wanted:
            raise HTTPException(status_code=400, detail="Enter a quantity to issue.")
        return wanted

    def hand_over(
        self, row: StoreSiteRequest, user: User, lines, items, project, wanted: dict[uuid.UUID, Decimal] | None = None
    ) -> None:
        """Deduct, per line, what is still owed as far as the stock covers it (or, with
        `wanted`, the quantity entered for it), with its ledger row, and set the
        request ISSUED (all of it handed over), PARTIALLY_ISSUED (some) or leave it
        APPROVED (none yet). Not committed here."""
        previous_states = {item.id: stock_state(item) for item in items.values()}
        handed: list[str] = []
        moment = naive_utc_now()
        for line in lines:
            item = items.get(line.store_item_id)
            give = min(remaining_quantity(line), Decimal(item.quantity)) if item else Decimal("0")
            if wanted is not None:
                give = min(give, wanted.get(line.id, Decimal("0")))
            if give <= 0:
                continue
            record_movement(self.database, item, -give, "ISSUE", reference=f"REQUEST-{row.id}", at=moment)
            line.issued_quantity = Decimal(line.issued_quantity or 0) + give
            handed.append(f"{give:g} {line.unit} {line.item_name}")
        for item in items.values():
            notify_if_stock_fell(self.database, item, previous_states[item.id])
        if not handed:
            return
        project_name = project.title if project else "your project"
        if all(remaining_quantity(line) <= 0 for line in lines):
            row.status = "ISSUED"
            row.issued_at = moment
            create_request_notification(
                self.database,
                row.engineer_id,
                "Store request issued",
                f"{user.name} issued your request {request_ref(row)} for {project_name}.",
                category="MATERIAL",
            )
            return
        row.status = "PARTIALLY_ISSUED"
        owed = ", ".join(
            f"{remaining_quantity(line):g} {line.unit} {line.item_name}"
            for line in lines
            if remaining_quantity(line) > 0
        )
        create_request_notification(
            self.database,
            row.engineer_id,
            "Store request partly issued",
            f"{user.name} issued {', '.join(handed)} for your request {request_ref(row)} ({project_name}). Still to come: {owed}.",
            category="MATERIAL",
        )

    # ---- Site Engineer
    def list_stores(self, project_id: uuid.UUID | None, user: User):
        """The stores serving this engineer's projects: the Store Managers on each
        project's builder team, with what they keep."""
        ensure_site_engineer(user)
        stores: dict = {}
        for project in self.repository.list_engineer_projects(user.id):
            if (project_id is not None and project.id != project_id) or not project.contractor_id:
                continue
            for member in self.repository.list_builder_team_members(project.contractor_id):
                if not is_store_manager(member):
                    continue
                if member.id not in stores:
                    items = self.repository.list_items(member.id, active_only=True)
                    # The picture and description of the supplier product received into each item.
                    sources = item_sources(self.repository, member.id, items)
                    stores[member.id] = {
                        "store_manager_id": member.id,
                        "store_manager_name": member.name,
                        "location": member.location,
                        "project_ids": [],
                        # Supplier deliveries accepted but not yet received: not stock
                        # yet, so not offered here (a count only, nothing financial).
                        "awaiting_receipt": self.awaiting_receipt(member.id),
                        # No purchase price or other financial detail for the engineer.
                        "items": [
                            engineer_item_payload(
                                item,
                                **{
                                    key: sources.get(item.id, {}).get(key)
                                    for key in ("image_url", "description", "subcategory")
                                },
                            )
                            for item in items
                        ],
                    }
                store = stores[member.id]
                store["project_ids"].append(project.id)
        return list(stores.values())

    def awaiting_receipt(self, store_manager_id) -> int:
        received: dict[uuid.UUID, Decimal] = {}
        for receipt in self.repository.list_receipts(store_manager_id):
            received[receipt.order_line_id] = received.get(receipt.order_line_id, Decimal("0")) + Decimal(
                receipt.quantity
            )
        return sum(
            1
            for line in self.repository.list_purchase_lines(store_manager_id)
            if line.status in RECEIVABLE_STATUSES and received.get(line.id, Decimal("0")) < Decimal(str(line.quantity))
        )

    def create_request(self, payload: SiteRequestCreate, user: User):
        ensure_site_engineer(user)
        require_complete_profile(user)
        project = self.repository.get_project(payload.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not engineer_has_project_access(self.database, project.id, user.id):
            raise HTTPException(
                status_code=403, detail="Only an actively assigned Site Engineer can request for this project."
            )
        manager = self.project_store_manager(project, payload.store_manager_id)
        item_ids = [line.item_id for line in payload.items]
        if len(set(item_ids)) != len(item_ids):
            raise HTTPException(status_code=400, detail="List each product once.")
        items = {item.id: item for item in self.repository.list_items_by_ids(manager.id, item_ids) if item.is_active}
        if len(items) != len(item_ids):
            raise HTTPException(status_code=400, detail="A selected product is not available from this store.")
        for line in payload.items:
            item = items[line.item_id]
            if is_count_unit(item.unit) and line.quantity != line.quantity.to_integral_value():
                raise HTTPException(
                    status_code=400, detail=f"{item.name} is counted in {item.unit}: enter a whole number."
                )
        row = StoreSiteRequest(
            store_manager_id=manager.id,
            engineer_id=user.id,
            project_id=project.id,
            note=(payload.note or "").strip() or None,
        )
        self.repository.add(row)
        self.database.flush()
        for line in payload.items:
            item = items[line.item_id]
            self.repository.add(
                StoreSiteRequestLine(
                    request_id=row.id,
                    store_item_id=item.id,
                    item_name=item.name,
                    item_variant=item.variant,
                    unit=item.unit,
                    quantity=line.quantity,
                    issued_quantity=Decimal("0"),
                )
            )
        summary = ", ".join(
            f"{line.quantity:g} {items[line.item_id].unit} {items[line.item_id].name}"
            + (f" ({items[line.item_id].variant})" if items[line.item_id].variant else "")
            for line in payload.items
        )
        create_request_notification(
            self.database,
            manager.id,
            "New store request",
            f"{user.name} (Site Engineer) requested {summary} for {project.title}. Request ID {request_ref(row)}.",
            category="MATERIAL",
        )
        create_notification(
            self.database,
            user.id,
            "Material request sent to the Store Manager",
            f"Your request {request_ref(row)} for {project.title} was sent to {manager.name} (Store Manager).",
            category="MATERIAL",
        )
        self.repository.commit()
        return self.request_payload(row)

    def project_store_manager(self, project, store_manager_id) -> User:
        """The Store Manager a request for this project goes to: one on the project
        builder's active team. Never a supplier: with no Store Manager there, the
        request is refused, not sent elsewhere."""
        if store_manager_id is not None:
            manager = self.repository.get_user(store_manager_id)
            if not manager or not store_manager_serves_project(self.database, manager, project):
                raise HTTPException(status_code=403, detail="This Store Manager does not serve this project.")
            return manager
        managers = (
            [
                member
                for member in self.repository.list_builder_team_members(project.contractor_id)
                if is_store_manager(member)
            ]
            if project.contractor_id
            else []
        )
        if not managers:
            raise HTTPException(
                status_code=409,
                detail="No Store Manager is assigned to this project's Builder team. Ask your Builder to add one; the request was not sent.",
            )
        if len(managers) > 1:
            raise HTTPException(
                status_code=400,
                detail="This Builder has more than one Store Manager. Choose the store to request from.",
            )
        return managers[0]

    def cancel_request(self, request_id: uuid.UUID, user: User):
        """The engineer withdraws their own request while it is still PENDING: nothing
        was approved or handed over, so no stock moves."""
        ensure_site_engineer(user)
        row = self.repository.lock_engineer_request(user.id, request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        if row.status != "PENDING":
            raise HTTPException(
                status_code=409,
                detail=f"This request was already {row.status.lower().replace('_', ' ')}; only a pending request can be cancelled.",
            )
        row.status = "CANCELLED"
        row.decided_at = naive_utc_now()
        project = self.repository.get_project(row.project_id)
        create_request_notification(
            self.database,
            row.store_manager_id,
            "Store request cancelled",
            f"{user.name} cancelled request {request_ref(row)} for {project.title if project else 'their project'}.",
            category="MATERIAL",
        )
        self.repository.commit()
        return self.request_payload(row)

    def list_my_requests(self, project_id: uuid.UUID | None, user: User, search: str | None = None):
        ensure_site_engineer(user)
        public_id = parse_request_search(search)
        if public_id is False:
            return []
        return [
            self.request_payload(row) for row in self.repository.list_engineer_requests(user.id, project_id, public_id)
        ]
