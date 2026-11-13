"""Billing: builder plans bought through the Razorpay mock (order, checkout, verify,
failure, reconcile), the signed webhooks, coupons and their admin screens, the payment
history, the premium tools, Book Technician booking payments (Partner's booking view is
faked), and every plan check billing wired back (calendar, photos, cost tool, owner
analysis, legacy logs, HD video, location caps, the paid sign-up)."""

import hashlib
import hmac
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from admin.helpers import create_admin, create_manager, signed_in
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from labour_supply.helpers import Site, make_site
from projects.helpers import Person, builder, engineer, owner
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from support.test_support import build

from app.auth.public_routes import is_public
from app.database.types import naive_utc_now
from app.jobs import subscription_renewal_sweep
from app.modules.accounts.models import BuilderProfile
from app.modules.billing import booking_payment_repository, entitlements, lead_locations
from app.modules.billing.models import (
    BOOKING_FOREIGN_KEY,
    BuilderSubscription,
    PaymentWebhookEvent,
    SubscriptionCouponRedemption,
    SubscriptionPayment,
)
from app.modules.cctv.services.playback import hd_allowed
from app.modules.identity.models import User
from app.modules.messaging.models import Notification
from app.modules.site_operations.models import DailyCostRegister
from app.seeds import seed_subscription_plan_prices as price_seed

WEBHOOK_SECRET = "whsec-test-" + "w" * 24
PRO, PLUS, PREMIUM = ("PROFESSIONAL", "MONTHLY"), ("BUSINESS", "MONTHLY"), ("BUSINESS", "ANNUAL")
PRO_PRICE = 89900


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(
        make_client, FakeEmailSender(), FakeStorage(), razorpay_allow_mock=True, razorpay_webhook_secret=WEBHOOK_SECRET
    )


@pytest.fixture
def prices(database: Session) -> None:
    price_seed.run(database)


def detail(response: Any) -> Any:
    return response.json().get("detail")


def code(response: Any) -> tuple[int, Any]:
    body = detail(response)
    return response.status_code, body.get("code") if isinstance(body, dict) else body


def order(who: Person, plan: tuple[str, str], **extra: Any) -> Any:
    return who.post("/subscriptions/orders", json={"plan_code": plan[0], "duration_code": plan[1], **extra})


def checkout(who: Person, payment_id: str, outcome: str = "success") -> dict[str, Any]:
    simulated = who.post(
        "/subscriptions/mock/checkout", json={"subscription_payment_id": payment_id, "outcome": outcome}
    )
    assert simulated.status_code == 200, simulated.text
    return dict(simulated.json())


def verify(who: Person, payment_id: str, paid: dict[str, Any], **changes: Any) -> Any:
    body = {
        "subscription_payment_id": payment_id,
        "razorpay_order_id": paid["razorpay_order_id"],
        "razorpay_payment_id": paid["razorpay_payment_id"],
        "razorpay_signature": paid["razorpay_signature"],
        **changes,
    }
    return who.post("/subscriptions/verify", json=body)


def buy(who: Person, plan: tuple[str, str]) -> dict[str, Any]:
    created = order(who, plan)
    assert created.status_code == 200, created.text
    payment_id = created.json()["subscription_payment_id"]
    verified = verify(who, payment_id, checkout(who, payment_id))
    assert verified.status_code == 200, verified.text
    return dict(verified.json())


def age(database: Session, who: Person, days: int) -> None:
    """Move the account's creation back, ending its free month after 30 days."""
    user = database.get(User, who.user.id)
    assert user is not None
    user.created_at = datetime.now(UTC) - timedelta(days=days)
    database.commit()


def signed(body: dict[str, Any], secret: str = WEBHOOK_SECRET) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    return raw, {"X-Razorpay-Signature": hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()}


def webhook(client: TestClient, path: str, body: dict[str, Any], **headers: str) -> Any:
    raw, signature = signed(body)
    return client.post(
        f"/api/v1{path}", content=raw, headers={**signature, **headers, "Content-Type": "application/json"}
    )


def payment_event(name: str, order_id: str, payment_id: str, amount: int, **entity: Any) -> dict[str, Any]:
    payment = {"id": payment_id, "order_id": order_id, "amount": amount, "currency": "INR", **entity}
    return {"event": name, "payload": {"payment": {"entity": payment}}}


def billing_routes(client: TestClient) -> list[APIRoute]:
    names = ("app.modules.billing.router", "app.modules.billing.booking_payments_router", "app.modules.billing.coupon")
    return [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if (isinstance(route, APIRoute) and route.endpoint.__module__.startswith(names))
        or (isinstance(route, APIRoute) and route.endpoint.__module__ == "app.modules.billing.payment_history_admin")
    ]


# ---- routes ----


def test_every_billing_route_needs_a_session_except_the_reviewed_public_ones(client: TestClient) -> None:
    routes = billing_routes(client)
    assert len(routes) == 31  # 12 subscription + 5 premium + 4 coupon admin + 2 payment history + 8 payments
    public = []
    for route in routes:
        path = route.path.removeprefix("/api/v1")
        method = sorted(route.methods)[0]
        if is_public(method, path):
            public.append((method, path))
            continue
        concrete = path.replace("{receipt_number}", "RCP-1")
        for name in ("{payment_id}", "{project_id}", "{register_id}", "{coupon_id}"):
            concrete = concrete.replace(name, str(uuid.uuid4()))
        answer = client.request(method, f"/api/v1{concrete}", json={})
        assert answer.status_code == 401, (method, path, answer.status_code)
    assert sorted(public) == [
        ("GET", "/payments/gateway-status"),
        ("GET", "/subscriptions/plans"),
        ("POST", "/payments/webhooks/razorpay"),
        ("POST", "/subscriptions/webhooks/razorpay"),
    ]


# ---- plans and purchase ----


def test_plans_are_public_and_priced_by_the_seed(client: TestClient, database: Session) -> None:
    unpriced = client.get("/api/v1/subscriptions/plans").json()
    assert unpriced["unpriced"] == [
        "PROFESSIONAL/MONTHLY",
        "PROFESSIONAL/ANNUAL",
        "BUSINESS/MONTHLY",
        "BUSINESS/ANNUAL",
    ]
    first = price_seed.run(database)
    assert len(first.inserted) == 3 and not first.kept
    again = price_seed.run(database)
    assert not again.inserted and len(again.kept) == 3
    plans = client.get("/api/v1/subscriptions/plans").json()
    assert plans["unpriced"] == ["PROFESSIONAL/ANNUAL"]
    by_code = {plan["code"]: plan for plan in plans["plans"]}
    assert by_code["PROFESSIONAL"]["prices"] == {"MONTHLY": PRO_PRICE, "ANNUAL": None}
    assert by_code["BUSINESS"]["prices"] == {"MONTHLY": 119900, "ANNUAL": 999900}
    assert by_code["FREE"]["limits"] == {"max_locations": 1, "max_leads_per_location": 5}


def test_the_seed_never_changes_prices_in_production(database: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(price_seed, "get_settings", lambda: SimpleNamespace(is_production=lambda: True))
    with pytest.raises(price_seed.SeedRefusedError):
        price_seed.run(database, update=True)
    assert len(price_seed.run(database).inserted) == 3  # missing prices are still added


def test_a_builder_buys_a_plan_at_the_servers_price(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    trial = house_builder.get("/subscriptions/me").json()
    assert (trial["status"], trial["plan_code"], trial["badge"]) == ("TRIAL", "FREE", None)
    assert "portfolio_dashboard" in trial["features"] and "hd_video" not in trial["features"]
    assert trial["usage"]["max_locations"] == 1 and trial["limits_enforced"] is True

    # Whatever amount the browser sends, the order is priced from subscription_plan_prices.
    created = order(house_builder, PRO, amount_paise=100, amount=1)
    assert created.status_code == 200, created.text
    assert created.json()["amount_paise"] == PRO_PRICE and created.json()["gateway_mode"] == "mock"
    payment_id = created.json()["subscription_payment_id"]
    assert order(house_builder, PRO).json()["subscription_payment_id"] == payment_id  # a retry reuses it
    paid = checkout(house_builder, payment_id)

    assert code(verify(house_builder, payment_id, paid, razorpay_signature="0" * 64)) == (
        400,
        "SUBSCRIPTION_SIGNATURE_INVALID",
    )
    assert code(verify(house_builder, payment_id, paid, razorpay_order_id="order_other")) == (
        400,
        "SUBSCRIPTION_ORDER_MISMATCH",
    )
    stranger = builder(client, database, "other.builder@example.in", "9876500012")
    assert code(verify(stranger, payment_id, paid)) == (404, "SUBSCRIPTION_ORDER_NOT_FOUND")

    activated = verify(house_builder, payment_id, paid)
    assert activated.status_code == 200, activated.text
    status = activated.json()["subscription"]
    assert (status["status"], status["plan_code"], status["badge"]) == ("ACTIVE", "PROFESSIONAL", "PRO")
    assert status["history"][0]["amount_paise"] == PRO_PRICE
    assert status["usage"]["max_locations"] == 3
    # The same verify again answers the same; nothing is activated twice.
    assert verify(house_builder, payment_id, paid).status_code == 200
    assert database.scalar(select(text("count(*)")).select_from(BuilderSubscription)) == 1

    # A different tier waits until the plan ends; the same tier renews after it.
    assert code(order(house_builder, PREMIUM)) == (409, "SUBSCRIPTION_PLAN_CHANGE_NOT_ALLOWED")
    renewed = buy(house_builder, PRO)["subscription"]
    assert len(renewed["queued_periods"]) == 1
    assert renewed["queued_periods"][0]["period_start"] == status["current_period"]["period_end"]

    badges = stranger.get(f"/subscriptions/badges?builder_ids={house_builder.user.id},{stranger.user.id},bad")
    assert badges.json() == {"badges": {str(house_builder.user.id): "PRO"}}
    house_owner = owner(client, database)
    assert code(house_owner.get("/subscriptions/me")) == (403, "SUBSCRIPTION_BUILDER_ONLY")
    assert code(order(house_owner, PRO)) == (403, "SUBSCRIPTION_BUILDER_ONLY")


def test_failure_and_recovery(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    payment_id = order(house_builder, PLUS).json()["subscription_payment_id"]
    failed = checkout(house_builder, payment_id, "failure")
    reported = house_builder.post(
        "/subscriptions/failures",
        json={"subscription_payment_id": payment_id, "razorpay_payment_id": failed["razorpay_payment_id"]},
    )
    assert reported.json()["status"] == "FAILED"
    assert house_builder.post("/subscriptions/reconcile").json() == {"status": "NOT_PAID"}

    # Paid in Checkout, but the browser closed before verifying: recovered from the gateway.
    retry = order(house_builder, PLUS).json()["subscription_payment_id"]
    assert retry != payment_id  # a failed attempt stays on record as it was
    checkout(house_builder, retry)
    recovered = house_builder.post(f"/subscriptions/orders/{retry}/reconcile")
    assert recovered.json()["status"] == "ACTIVATED", recovered.text
    assert recovered.json()["subscription"]["badge"] == "PREMIUM"
    assert house_builder.post("/subscriptions/reconcile").json()["status"] == "NOT_PAID"
    assert code(house_builder.post(f"/subscriptions/orders/{uuid.uuid4()}/reconcile")) == (
        404,
        "SUBSCRIPTION_ORDER_NOT_FOUND",
    )


def test_payments_answer_503_without_a_gateway(make_client: ClientFactory, database: Session) -> None:
    client = build(make_client, FakeEmailSender(), FakeStorage())
    house_builder = builder(client, database)
    assert code(order(house_builder, PRO)) == (503, "PAYMENT_GATEWAY_MISCONFIGURED")
    assert client.get("/api/v1/payments/gateway-status").json()["mode"] == "unavailable"


# ---- webhooks ----


def test_the_subscription_webhook(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    created = order(house_builder, PRO).json()
    order_id, payment_id = created["razorpay_order_id"], f"pay_{uuid.uuid4().hex[:14]}"
    path = "/subscriptions/webhooks/razorpay"
    captured = payment_event("payment.captured", order_id, payment_id, PRO_PRICE, status="captured", method="upi")

    raw, _ = signed(captured)
    forged = client.post(f"/api/v1{path}", content=raw, headers={"X-Razorpay-Signature": "0" * 64})
    assert code(forged) == (400, "WEBHOOK_SIGNATURE_INVALID")
    assert code(client.post(f"/api/v1{path}", content=raw)) == (400, "WEBHOOK_SIGNATURE_INVALID")
    wrong_amount = payment_event("payment.captured", order_id, payment_id, 100, status="captured")
    assert webhook(client, path, wrong_amount, **{"X-Razorpay-Event-Id": "evt_1"}).json()["outcome"] == "mismatch"

    assert webhook(client, path, captured, **{"X-Razorpay-Event-Id": "evt_2"}).json()["outcome"] == "activated"
    assert webhook(client, path, captured, **{"X-Razorpay-Event-Id": "evt_2"}).json()["outcome"] == "duplicate_event"
    assert database.scalar(select(text("count(*)")).select_from(PaymentWebhookEvent)) == 2
    assert house_builder.get("/subscriptions/me").json()["status"] == "ACTIVE"

    dispute = {"event": "payment.dispute.created", "payload": {"dispute": {"entity": {"payment_id": payment_id}}}}
    assert webhook(client, path, dispute, **{"X-Razorpay-Event-Id": "evt_3"}).json()["outcome"] == "dispute_opened"
    refund = payment_event("payment.refunded", order_id, payment_id, PRO_PRICE, amount_refunded=PRO_PRICE)
    assert webhook(client, path, refund, **{"X-Razorpay-Event-Id": "evt_4"}).json()["outcome"] == "refunded"
    database.expire_all()
    period = database.scalars(select(BuilderSubscription)).one()
    assert (period.status, period.revoked_reason) == ("REVOKED", "REFUNDED")
    assert house_builder.get("/subscriptions/me").json()["status"] == "TRIAL"


def test_a_webhook_without_a_secret_is_refused(make_client: ClientFactory) -> None:
    client = build(make_client, FakeEmailSender(), FakeStorage(), razorpay_allow_mock=True)
    for path in ("/subscriptions/webhooks/razorpay", "/payments/webhooks/razorpay"):
        assert code(webhook(client, path, {"event": "order.paid"})) == (503, "WEBHOOK_NOT_CONFIGURED")


# ---- coupons ----


def test_coupons_from_the_admin_screen_to_checkout(client: TestClient, database: Session, prices: None) -> None:
    create_admin(database)
    admin, admin_headers = signed_in(client, "india.admin@example.in")
    today = date.today()
    body = {"code": " save 100 ", "discount_amount": "100", "starts_on": str(today), "expires_on": str(today)}
    created = admin.post("/api/v1/admin/coupons", json=body, headers=admin_headers)
    assert created.status_code == 201, created.text
    coupon = created.json()
    assert (coupon["code"], coupon["discount_minor"], coupon["max_per_builder"]) == ("SAVE100", 10000, 1)
    assert admin.post("/api/v1/admin/coupons", json=body, headers=admin_headers).status_code == 409
    # Crash fixed: an amount past the bigint column (or NaN) was a 500.
    for amount in ("1e30", "NaN"):
        huge = admin.post(
            "/api/v1/admin/coupons", json={**body, "code": "HUGE1", "discount_amount": amount}, headers=admin_headers
        )
        assert (huge.status_code, detail(huge)) == (400, "Enter a valid amount.")

    house_builder = builder(client, database)
    quoted = house_builder.post("/subscriptions/coupons/validate", json={"code": "save100"}).json()
    assert len(quoted["quotes"]) == 3
    one = house_builder.post(
        "/subscriptions/coupons/validate",
        json={"code": "SAVE100", "plan_code": "PROFESSIONAL", "duration_code": "MONTHLY"},
    ).json()
    assert (one["original_amount_paise"], one["discount_paise"], one["final_amount_paise"]) == (
        PRO_PRICE,
        10000,
        PRO_PRICE - 10000,
    )
    missing = house_builder.post("/subscriptions/coupons/validate", json={"code": "NOPE99"})
    assert code(missing) == (404, "COUPON_INVALID")

    discounted = order(house_builder, PRO, coupon_code="save100").json()
    assert discounted["amount_paise"] == PRO_PRICE - 10000 and discounted["coupon_code"] == "SAVE100"
    payment_id = discounted["subscription_payment_id"]
    assert verify(house_builder, payment_id, checkout(house_builder, payment_id)).status_code == 200
    redemption = database.scalars(select(SubscriptionCouponRedemption)).one()
    assert redemption.status == "REDEEMED"
    used = house_builder.post("/subscriptions/coupons/validate", json={"code": "SAVE100"})
    assert code(used) == (409, "COUPON_BUILDER_LIMIT")

    listed = admin.get("/api/v1/admin/coupons").json()
    assert listed["coupons"][0]["redeemed_count"] == 1 and listed["scope"] == "IN"
    coupon_path = f"/api/v1/admin/coupons/{coupon['id']}"
    changed = admin.patch(coupon_path, json={"max_redemptions": 5}, headers=admin_headers)
    assert changed.json()["max_redemptions"] == 5, changed.text
    off = admin.post(f"{coupon_path}/status", json={"active": False}, headers=admin_headers)
    assert off.json()["state"] == "INACTIVE"
    another = builder(client, database, "other.builder@example.in", "9876500012")
    assert code(another.post("/subscriptions/coupons/validate", json={"code": "SAVE100"})) == (409, "COUPON_INACTIVE")
    assert admin.patch(f"/api/v1/admin/coupons/{uuid.uuid4()}", json={}, headers=admin_headers).status_code == 404

    # The read-only payment history: the mock payment is listed but kept out of the money.
    history = admin.get("/api/v1/admin/subscription-payments").json()
    assert history["total"] == 1 and history["payments"][0]["coupon_code"] == "SAVE100"
    assert history["payments"][0]["discount_minor"] == 10000
    summary = admin.get("/api/v1/admin/subscription-payments/summary").json()
    assert summary["mock_payment_count"] == 1 and summary["totals"]["gross_minor"] == 0
    assert admin.get("/api/v1/admin/subscription-payments?month=3").status_code == 400

    create_manager(database, permissions="coupons.view")
    manager, _ = signed_in(client, "manager@example.in")
    assert manager.get("/api/v1/admin/coupons").status_code == 200
    assert manager.get("/api/v1/admin/subscription-payments").status_code == 403


# ---- the paid sign-up ----


def test_a_paid_sign_up_pays_before_anything_else(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == house_builder.user.id)).one()
    profile.signup_plan_code, profile.signup_duration_code = "BUSINESS", "ANNUAL"
    database.commit()
    assert code(house_builder.get("/project-requests/incoming")) == (403, "SUBSCRIPTION_CHECKOUT_REQUIRED")
    assert code(order(house_builder, PRO)) == (409, "SUBSCRIPTION_SIGNUP_PLAN_MISMATCH")
    changed = house_builder.patch(
        "/subscriptions/signup-plan", json={"plan_code": "PROFESSIONAL", "duration_code": "MONTHLY"}
    )
    assert changed.json() == {"subscription_checkout": {"plan_code": "PROFESSIONAL", "duration_code": "MONTHLY"}}
    bad = house_builder.patch("/subscriptions/signup-plan", json={"plan_code": "BUSINESS", "duration_code": "WEEKLY"})
    assert code(bad) == (400, "SUBSCRIPTION_PLAN_NOT_AVAILABLE")
    buy(house_builder, PRO)
    assert house_builder.get("/project-requests/incoming").status_code == 200
    closed = house_builder.patch("/subscriptions/signup-plan", json={"plan_code": "FREE"})
    assert code(closed) == (409, "SUBSCRIPTION_SIGNUP_PLAN_CLOSED")


# ---- the plan checks billing wired back ----


def test_core_tools_follow_the_builders_plan(client: TestClient, database: Session, prices: None) -> None:
    site = make_site(client, database)
    pid = site.project_id
    assert site.builder.get(f"/timelines/project/{pid}").status_code == 200  # the free month
    assert hd_allowed(database, site.builder.user) is False  # HD is Premium only

    age(database, site.builder, 40)  # the free month is over and nothing was bought
    assert code(site.builder.get(f"/timelines/project/{pid}")) == (403, "FREE_ACCESS_EXPIRED")
    assert code(site.builder.get(f"/cost-tool/projects/{pid}/summary")) == (403, "FREE_ACCESS_EXPIRED")
    legacy = {"project_id": pid, "material_name": "Cement", "quantity": 1, "unit": "bag", "cost": 400}
    assert code(site.builder.post("/materials/create", json=legacy)) == (403, "FREE_ACCESS_EXPIRED")
    for path in (f"/timelines/project/{pid}", f"/projects/{pid}/photos", f"/owners/projects/{pid}/analysis"):
        assert code(site.owner.get(path)) == (403, "BUILDER_SUBSCRIPTION_EXPIRED"), path
    assert code(site.engineer.get(f"/projects/{pid}/photos")) == (403, "BUILDER_SUBSCRIPTION_EXPIRED")
    # The engineer's own records are never gated.
    assert site.engineer.get(f"/cost-tool/projects/{pid}/summary").status_code == 200

    with pytest.raises(Exception) as refused:
        lead_locations.require_location_count(database, site.builder.user, "A 560001, B 570001", "A 560001")
    assert refused.value.detail["limit"] == 1  # type: ignore[attr-defined]

    buy(site.builder, PRO)
    database.expire_all()
    for path in (f"/timelines/project/{pid}", f"/cost-tool/projects/{pid}/summary"):
        assert site.builder.get(path).status_code == 200, path
    for path in (f"/timelines/project/{pid}", f"/projects/{pid}/photos", f"/owners/projects/{pid}/analysis"):
        assert site.owner.get(path).status_code == 200, path
    lead_locations.require_location_count(database, site.builder.user, "A 560001, B 570001", "A 560001")
    assert lead_locations.limited_plan(database, site.builder.user) == "PROFESSIONAL"
    assert hd_allowed(database, site.builder.user) is False
    assert hd_allowed(database, site.owner.user) is True  # never gated for the owner


def test_hd_video_comes_with_premium(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    buy(house_builder, PREMIUM)
    assert hd_allowed(database, house_builder.user) is True
    assert entitlements.subscription_state(database, house_builder.user.id).badge == "PREMIUM"


# ---- premium tools ----


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


def test_the_premium_tools(client: TestClient, database: Session, prices: None) -> None:
    site = make_site(client, database)
    record = closed_record(database, site)
    portfolio = site.builder.get("/builder/portfolio").json()
    assert portfolio["advanced"] is False and portfolio["summary"]["project_count"] == 1
    assert code(site.builder.get("/builder/portfolio/export.csv")) == (403, "SUBSCRIPTION_REQUIRED")
    summary = site.builder.get(f"/projects/{site.project_id}/summary.csv")
    assert summary.status_code == 200 and summary.headers["content-type"].startswith("text/csv")
    assert "Brickwork" in summary.text
    assert site.owner.get(f"/projects/{site.project_id}/summary.csv").status_code == 403

    path = f"/cost-tool/registers/{record.id}/builder-adjustments"
    correction = {"field_name": "labour_cost", "adjusted_value": 1200, "reason": "Two more masons"}
    saved = site.builder.post(path, json=correction)
    assert saved.status_code == 200, saved.text
    assert saved.json()["fields"]["labour_cost"] == {"original": 1000.0, "effective": 1200.0}
    assert site.builder.post(path, json=correction).status_code == 400  # already the recorded amount
    assert len(site.engineer.get(path).json()["adjustments"]) == 1
    assert site.owner.get(path).status_code == 403
    assert code(site.engineer.post(path, json=correction)) == (403, "SUBSCRIPTION_BUILDER_ONLY")
    assert site.builder.get(f"/cost-tool/registers/{uuid.uuid4()}/builder-adjustments").status_code == 404
    database.refresh(record)
    assert record.labour_cost == Decimal("1000")  # the engineer's record is never written

    buy(site.builder, PREMIUM)
    advanced = site.builder.get("/builder/portfolio").json()
    assert advanced["advanced"] is True
    assert advanced["summary"]["adjusted_totals"]["labour_cost"] == 1200.0
    exported = site.builder.get("/builder/portfolio/export.csv")
    assert exported.status_code == 200 and "Rao Residence" in exported.text


# ---- lifecycle notices ----


def notices(database: Session, who: Person) -> list[str]:
    database.expire_all()
    return list(database.scalars(select(Notification.title).where(Notification.user_id == who.user.id)).all())


def test_expiry_and_reminder_notices_go_out_once(client: TestClient, database: Session, prices: None) -> None:
    site = make_site(client, database)
    buy(site.builder, PRO)
    age(database, site.builder, 60)
    period = database.scalars(select(BuilderSubscription)).one()
    now = naive_utc_now()
    period.subscription_start, period.subscription_end = now - timedelta(days=29), now + timedelta(days=1)
    database.commit()

    site.builder.get("/subscriptions/me")
    site.builder.get("/subscriptions/me")
    assert notices(database, site.builder).count("Your plan expires soon") == 1
    assert "Builder subscription ending soon" in notices(database, site.owner)
    assert "Builder subscription ending soon" in notices(database, site.engineer)

    period.subscription_start, period.subscription_end = now - timedelta(days=31), now - timedelta(days=1)
    database.commit()
    assert subscription_renewal_sweep.run(database) == 1
    assert subscription_renewal_sweep.run(database) == 1
    assert notices(database, site.builder).count("Your plan has ended") == 1
    assert notices(database, site.owner).count("Builder subscription expired") == 1
    assert site.builder.get("/subscriptions/me").json()["status"] == "EXPIRED"
    assert code(site.builder.get("/builder/portfolio")) == (403, "SUBSCRIPTION_EXPIRED")


def test_the_free_month_ends_with_one_notice(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    age(database, house_builder, 31)
    assert house_builder.get("/subscriptions/me").json()["status"] == "NONE"
    house_builder.get("/subscriptions/me")
    assert notices(database, house_builder).count(entitlements.FREE_ACCESS_EXPIRED_TITLE) == 1


# ---- Book Technician booking payments ----


class FakeBookings:
    """Partner's booking view (partner.v_professional_bookings), faked."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def add(self, requester: User, **changes: Any) -> uuid.UUID:
        booking_id = uuid.uuid4()
        self.rows.append(
            {
                "id": booking_id,
                "requested_by_user_id": requester.id,
                "requested_by_role": requester.role,
                "status": "COMPLETED",
                "technician_type": "PLUMBER",
                "quoted_amount": Decimal("500.00"),
                "currency": "INR",
                "completed_at": datetime.now(UTC),
                "service_name": "Tap repair",
                "technician_name": "Ravi",
                **changes,
            }
        )
        return booking_id

    def source(self, database: Session, where: str, parameters: dict[str, Any]) -> list[Any]:
        if "booking" in parameters:
            found = [row for row in self.rows if row["id"] == parameters["booking"]]
        else:
            found = [
                row
                for row in self.rows
                if row["requested_by_user_id"] == parameters["customer"] and row["status"] == "COMPLETED"
            ]
        return [SimpleNamespace(_mapping=row) for row in found]


@pytest.fixture
def bookings(monkeypatch: pytest.MonkeyPatch) -> FakeBookings:
    fake = FakeBookings()
    monkeypatch.setattr(booking_payment_repository, "booking_source", fake.source)
    return fake


def test_the_house_owner_pays_a_completed_booking(
    client: TestClient, database: Session, bookings: FakeBookings
) -> None:
    house_owner = owner(client, database)
    paid_booking = bookings.add(house_owner.user)
    open_booking = bookings.add(house_owner.user, status="IN_PROGRESS")
    unpriced = bookings.add(house_owner.user, quoted_amount=None)
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    theirs = bookings.add(stranger.user)

    listed = {row["booking_id"]: row for row in house_owner.get("/payments/technician-bookings").json()}
    assert listed[str(paid_booking)]["payment_status"] == "UNPAID"
    assert listed[str(paid_booking)]["amount_paise"] == 50000
    assert listed[str(unpriced)]["payment_status"] == "NOT_PAYABLE"
    assert str(open_booking) not in listed

    def create(booking_id: uuid.UUID, **extra: Any) -> Any:
        return house_owner.post("/payments/orders", json={"booking_id": str(booking_id), **extra})

    assert code(create(open_booking)) == (409, "BOOKING_NOT_COMPLETED")
    assert code(create(unpriced)) == (409, "PAYMENT_NOT_AVAILABLE")
    assert code(create(theirs)) == (404, "BOOKING_NOT_FOUND")
    house_engineer = engineer(client, database)
    assert code(house_engineer.post("/payments/orders", json={"booking_id": str(paid_booking)})) == (
        403,
        "PAYMENT_OWNER_ONLY",
    )
    assert code(house_engineer.get("/payments/technician-bookings")) == (403, "PAYMENT_OWNER_ONLY")

    created = create(paid_booking, amount_paise=1)  # the browser's amount is never read
    assert created.status_code == 200, created.text
    assert created.json()["amount_paise"] == 50000 and created.json()["booking_reference"].startswith("SR-")
    order_id = created.json()["payment_order_id"]
    simulated = house_owner.post("/payments/mock/checkout", json={"payment_order_id": order_id, "outcome": "success"})
    paid = simulated.json()
    body = {
        "payment_order_id": order_id,
        "razorpay_order_id": paid["razorpay_order_id"],
        "razorpay_payment_id": paid["razorpay_payment_id"],
        "razorpay_signature": "0" * 64,
    }
    assert code(house_owner.post("/payments/verify", json=body)) == (400, "PAYMENT_SIGNATURE_INVALID")
    verified = house_owner.post("/payments/verify", json={**body, "razorpay_signature": paid["razorpay_signature"]})
    assert verified.status_code == 200, verified.text
    receipt = verified.json()["receipt"]
    assert receipt["total_paid_rupees"] == "500.00" and receipt["house_owner"] == house_owner.user.name
    assert receipt["issued_at"].endswith("+05:30")

    assert code(create(paid_booking)) == (409, "BOOKING_ALREADY_PAID")
    number = receipt["receipt_number"]
    assert house_owner.get(f"/payments/receipts/{number}").json()["receipt_number"] == number
    assert code(stranger.get(f"/payments/receipts/{number}")) == (404, "RECEIPT_NOT_FOUND")
    listed = {row["booking_id"]: row for row in house_owner.get("/payments/technician-bookings").json()}
    assert listed[str(paid_booking)]["payment_status"] == "PAID"

    # A failed attempt on another booking is recorded and never paid.
    second = bookings.add(house_owner.user)
    second_order = create(second).json()["payment_order_id"]
    failed = house_owner.post("/payments/failures", json={"payment_order_id": second_order, "code": "DECLINED"})
    assert failed.json()["status"] == "FAILED"
    assert client.get("/api/v1/payments/gateway-status").json()["mode"] == "mock"


def test_the_booking_webhook(client: TestClient, database: Session, bookings: FakeBookings) -> None:
    house_owner = owner(client, database)
    booking_id = bookings.add(house_owner.user)
    created = house_owner.post("/payments/orders", json={"booking_id": str(booking_id)}).json()
    path, order_id = "/payments/webhooks/razorpay", created["razorpay_order_id"]
    raw, _ = signed({"event": "order.paid"})
    assert code(client.post(f"/api/v1{path}", content=raw, headers={"X-Razorpay-Signature": "x"})) == (
        400,
        "WEBHOOK_SIGNATURE_INVALID",
    )
    event = payment_event("payment.captured", order_id, "pay_hook1", 50000, status="captured", method="card")
    assert webhook(client, path, event).json()["outcome"] == "paid"
    assert webhook(client, path, event).json()["outcome"] == "duplicate"
    assert webhook(client, path, payment_event("payment.captured", "order_x", "pay_x", 1)).json()["outcome"] == (
        "unknown_order"
    )
    listed = house_owner.get("/payments/technician-bookings").json()
    assert listed[0]["payment_status"] == "PAID"


def test_no_bookings_before_partner_publishes_its_view(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    assert house_owner.get("/payments/technician-bookings").json() == []
    missing = house_owner.post("/payments/orders", json={"booking_id": str(uuid.uuid4())})
    assert code(missing) == (404, "BOOKING_NOT_FOUND")


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


def test_subscription_payments_keep_their_builder(client: TestClient, database: Session, prices: None) -> None:
    house_builder = builder(client, database)
    buy(house_builder, PRO)
    payment = database.scalars(select(SubscriptionPayment)).one()
    assert payment.builder_id == house_builder.user.id and payment.status == "PAID"
    with pytest.raises(Exception, match="foreign key"):
        database.execute(text("DELETE FROM professional.users WHERE id = :id"), {"id": house_builder.user.id})
    database.rollback()
