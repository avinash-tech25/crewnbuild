"""The builder's tools that once came with a paid plan (portfolio, CSV exports, audited cost
adjustments), now open to every builder; and the subscription, coupon, booking-payment and
marketplace-payment API that was removed, which must stay gone."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from conftest import ClientFactory, app_routes
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from labour_supply.helpers import Site, make_site
from projects.helpers import builder
from sqlalchemy import text
from sqlalchemy.orm import Session
from support.test_support import build

from app.auth.public_routes import is_public
from app.modules.admin.admin_identity import PERMISSIONS
from app.modules.billing.models import BOOKING_FOREIGN_KEY
from app.modules.identity.models import User
from app.modules.site_operations.models import DailyCostRegister


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


def code(response: Any) -> tuple[int, Any]:
    body = response.json().get("detail")
    return response.status_code, body.get("code") if isinstance(body, dict) else body


def closed_record(database: Session, site: Site, days_ago: int = 2) -> DailyCostRegister:
    record = DailyCostRegister(
        project_id=uuid.UUID(site.project_id),
        contractor_id=site.builder.user.id,
        created_by_id=site.engineer.user.id,
        work_date=date.today() - timedelta(days=days_ago),
        floor="Ground",
        block="A",
        work_type="Brickwork",
        status="CLOSED",
        labour_cost=Decimal("1000"),
        material_cost=Decimal("500"),
        equipment_cost=Decimal("0"),
        total_expenses=Decimal("1500"),
    )
    database.add(record)
    database.commit()
    return record


# ---- the builder tools ----


def test_every_builder_tool_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in app_routes(client.app)
        if isinstance(route, APIRoute) and route.endpoint.__module__ == "app.modules.billing.router"
    ]
    assert len(routes) == 5  # portfolio, its CSV, a project's CSV, adjustments (list, create)
    for route in routes:
        path = route.path.removeprefix("/api/v1")
        method = sorted(route.methods)[0]
        assert not is_public(method, path), (method, path)
        concrete = path.replace("{project_id}", str(uuid.uuid4())).replace("{register_id}", str(uuid.uuid4()))
        answer = client.request(method, f"/api/v1{concrete}", json={})
        assert answer.status_code == 401, (method, path, answer.status_code)


def test_the_builder_tools_are_open_to_every_builder_and_only_to_builders(
    client: TestClient, database: Session
) -> None:
    site = make_site(client, database)
    record = closed_record(database, site)
    portfolio = site.builder.get("/builder/portfolio").json()
    assert portfolio["advanced"] is True and portfolio["summary"]["project_count"] == 1
    exported = site.builder.get("/builder/portfolio/export.csv")
    assert exported.status_code == 200 and "Rao Residence" in exported.text
    summary = site.builder.get(f"/projects/{site.project_id}/summary.csv")
    assert summary.status_code == 200 and summary.headers["content-type"].startswith("text/csv")
    assert "Brickwork" in summary.text
    # Builders only, and only the project's own builder.
    assert code(site.owner.get("/builder/portfolio")) == (403, "BUILDER_ONLY")
    assert site.owner.get(f"/projects/{site.project_id}/summary.csv").status_code == 403
    stranger = builder(client, database, "other.builder@example.in", "9876500012")
    assert stranger.get(f"/projects/{site.project_id}/summary.csv").status_code in (403, 404)

    path = f"/cost-tool/registers/{record.id}/builder-adjustments"
    correction = {"field_name": "labour_cost", "adjusted_value": 1200, "reason": "Two more masons"}
    saved = site.builder.post(path, json=correction)
    assert saved.status_code == 200, saved.text
    assert saved.json()["fields"]["labour_cost"] == {"original": 1000.0, "effective": 1200.0}
    assert site.builder.post(path, json=correction).status_code == 400  # already the recorded amount
    assert len(site.engineer.get(path).json()["adjustments"]) == 1
    assert site.owner.get(path).status_code == 403
    assert code(site.engineer.post(path, json=correction)) == (403, "BUILDER_ONLY")
    assert stranger.get(path).status_code in (403, 404)
    assert site.builder.get(f"/cost-tool/registers/{uuid.uuid4()}/builder-adjustments").status_code == 404
    database.refresh(record)
    assert record.labour_cost == Decimal("1000")  # the engineer's record is never written
    assert site.builder.get("/builder/portfolio").json()["summary"]["adjusted_totals"]["labour_cost"] == 1200.0


def test_core_tools_are_never_paused_by_a_plan(client: TestClient, database: Session) -> None:
    site = make_site(client, database)
    pid = site.project_id
    user = database.get(User, site.builder.user.id)
    assert user is not None
    user.created_at = datetime.now(UTC) - timedelta(days=400)  # long past the old free month
    database.commit()
    assert site.builder.get(f"/timelines/project/{pid}").status_code == 200
    assert site.builder.get(f"/cost-tool/projects/{pid}/summary").status_code == 200
    legacy = {"project_id": pid, "material_name": "Cement", "quantity": 1, "unit": "bag", "cost": 400}
    assert site.builder.post("/materials/create", json=legacy).status_code == 200
    for path in (f"/timelines/project/{pid}", f"/projects/{pid}/photos", f"/owners/projects/{pid}/analysis"):
        assert site.owner.get(path).status_code == 200, path
    assert site.engineer.get(f"/projects/{pid}/photos").status_code == 200


# ---- the removed payment API ----

REMOVED = [
    ("GET", "/subscriptions/plans"),
    ("GET", "/subscriptions/me"),
    ("GET", "/subscriptions/badges"),
    ("POST", "/subscriptions/orders"),
    ("POST", "/subscriptions/verify"),
    ("POST", "/subscriptions/failures"),
    ("POST", "/subscriptions/reconcile"),
    ("POST", f"/subscriptions/orders/{uuid.uuid4()}/reconcile"),
    ("PATCH", "/subscriptions/signup-plan"),
    ("POST", "/subscriptions/coupons/validate"),
    ("POST", "/subscriptions/mock/checkout"),
    ("POST", "/subscriptions/webhooks/razorpay"),
    ("GET", "/payments/gateway-status"),
    ("GET", "/payments/technician-bookings"),
    ("POST", "/payments/orders"),
    ("POST", "/payments/verify"),
    ("POST", "/payments/failures"),
    ("GET", "/payments/receipts/RCP-1"),
    ("POST", "/payments/mock/checkout"),
    ("POST", "/payments/webhooks/razorpay"),
    ("GET", "/admin/coupons"),
    ("GET", "/admin/subscription-payments"),
    ("GET", "/admin/subscription-payments/summary"),
    ("POST", "/marketplace/checkout/quote"),
    ("POST", "/marketplace/checkout"),
    ("POST", f"/marketplace/orders/{uuid.uuid4()}/verify"),
    ("POST", f"/marketplace/orders/{uuid.uuid4()}/refresh"),
    ("POST", f"/marketplace/orders/{uuid.uuid4()}/resume"),
    ("POST", "/marketplace/webhooks/razorpay"),
    ("GET", "/supplier/paid-orders"),
    ("POST", f"/supplier/paid-orders/{uuid.uuid4()}/decision"),
]


def test_the_payment_api_is_gone(client: TestClient, database: Session) -> None:
    for method, path in REMOVED:
        assert not is_public(method, path), (method, path)
        # Anonymous callers (Razorpay's webhooks among them) are refused before anything runs.
        assert client.request(method, f"/api/v1{path}", json={}).status_code in (401, 404), (method, path)
    signed_in = builder(client, database)
    for method, path in REMOVED:
        answer = signed_in.browser.request(method, f"/api/v1{path}", headers=signed_in.headers, json={})
        assert answer.status_code in (404, 405), (method, path, answer.status_code)


def test_the_payment_admin_permissions_are_gone() -> None:
    assert {"coupons.view", "coupons.manage", "subscriptions.view"}.isdisjoint(PERMISSIONS)


def test_the_partner_booking_foreign_key_waits_for_partner(database: Session) -> None:
    statement = str(BOOKING_FOREIGN_KEY.statement)
    assert "REFERENCES partner.bookings (id) ON DELETE RESTRICT" in statement
    found = database.execute(
        text(
            "SELECT 1 FROM information_schema.table_constraints "
            "WHERE table_name = 'booking_payment_orders' AND constraint_type = 'FOREIGN KEY'"
        )
    ).first()
    assert found is not None  # customer_user_id -> users
    assert (
        database.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema = 'partner' AND table_name = 'bookings'")
        ).first()
        is None
    )
