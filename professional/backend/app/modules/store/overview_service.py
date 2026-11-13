"""The Store Manager's overview and the projects a purchase can be for (ported from
the old overview_service.py; same answers)."""

from decimal import Decimal

from app.modules.identity.models import User
from app.modules.store.models import METHOD_RAZORPAY, PAYMENT_CREATED
from app.modules.store.purchase_service import PurchaseService
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.site_request_service import ISSUABLE_STATUSES
from app.modules.store.stock_service import movement_payload, stock_state, store_item_payload


class OverviewService:
    def __init__(self, repository: StoreManagerRepository):
        self.repository = repository

    def fetch_overview(self, user: User):
        items = self.repository.list_items(user.id, active_only=True)
        requests = self.repository.list_site_requests(user.id)
        orders = PurchaseService(self.repository).list_orders(user)
        states = [stock_state(item) for item in items]
        # Stock is only added up within one unit: bags and kilograms do not sum.
        stock_by_unit: dict[str, Decimal] = {}
        for item in items:
            stock_by_unit[item.unit] = stock_by_unit.get(item.unit, Decimal("0")) + Decimal(item.quantity)
        checkouts_waiting = sum(
            1
            for row in self.repository.list_payments(user.id)
            if row.method == METHOD_RAZORPAY and row.status == PAYMENT_CREATED
        )
        return {
            "total_stock": [
                {"unit": unit, "quantity": float(quantity)} for unit, quantity in sorted(stock_by_unit.items())
            ],
            # Supplier purchases not finished: a checkout not yet paid, or paid goods not yet received.
            "pending_purchases": checkouts_waiting
            + sum(
                1
                for order in orders
                if any(not line["received"] and line["status"] != "REJECTED" for line in order["lines"])
            ),
            "low_stock_items": [store_item_payload(item) for item, state in zip(items, states) if state != "IN_STOCK"][
                :10
            ],
            "recent_movements": [
                movement_payload(row, item) for row, item in self.repository.list_recent_movements(user.id, 10)
            ],
            "recent_purchases": [
                {
                    key: order[key]
                    for key in (
                        "request_code",
                        "reference_code",
                        "purchase_id",
                        "supplier_name",
                        "project_name",
                        "created_at",
                        "total",
                        "paid",
                        "balance",
                    )
                }
                | {"received": all(line["received"] for line in order["lines"] if line["status"] != "REJECTED")}
                for order in orders[:5]
            ],
            "item_count": len(items),
            "low_stock_count": states.count("LOW_STOCK"),
            "out_of_stock_count": states.count("OUT_OF_STOCK"),
            "stock_value": float(
                sum((Decimal(item.quantity) * Decimal(item.unit_cost) for item in items), Decimal("0"))
            ),
            "pending_requests": sum(1 for row in requests if row.status == "PENDING"),
            # Approved and still owed products: nothing handed over yet, or the rest of it.
            "approved_requests": sum(1 for row in requests if row.status in ISSUABLE_STATUSES),
            "awaiting_receipt": sum(1 for order in orders if any(line["can_receive"] for line in order["lines"])),
            "balance_due": round(sum(order["balance"] for order in orders), 2),
            "total_paid": round(sum(order["paid"] for order in orders), 2),
            "builder_count": len(self.repository.list_active_builder_ids(user.id)),
        }

    def list_projects(self, user: User):
        """The projects of this Store Manager's builders: what a purchase can be for."""
        projects = self.repository.list_builder_projects(self.repository.list_active_builder_ids(user.id))
        return [
            {"id": project.id, "title": project.title, "pincode": project.pincode, "project_city": project.project_city}
            for project in projects
        ]
