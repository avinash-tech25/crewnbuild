"""The store: a Store Manager's catalog and stock, buying from the builder's suppliers
through the Razorpay mock (checkout, verify, failure, check), goods received in parts
and once only, Site Engineers' requests approved and handed over in parts, Builder <->
Store Manager requests; who may reach each (the old 403/404 answers), and what the store
unblocks elsewhere."""

import uuid
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from labour_supply.helpers import Site, make_site
from marketplace.test_marketplace import accept_between, list_product, make_catalog, supplier
from projects.helpers import Person, builder, person
from projects.test_projects import detail
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.identity.models import ROLE_ENGINEER
from app.modules.store import links
from app.modules.store import router as store_router
from app.modules.weather.repository import WeatherRepository


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage(), razorpay_allow_mock=True)


class Store:
    def __init__(self, site: Site, manager: Person, seller: Person, listing_id: str) -> None:
        self.site, self.manager, self.seller, self.listing_id = site, manager, seller, listing_id


def store_manager(client: TestClient, database: Session, site: Site, email: str = "store@example.in") -> Person:
    """A Store Manager on the site's builder's team."""
    manager = person(client, database, email, "9876500011", ROLE_ENGINEER, specialization="Store Manager")
    complete_store_profile(database, manager)
    code = site.builder.post("/engineers/invite", json={"email": email}).json()["invite_code"]
    joined = manager.post("/engineers/join-team", json={"invite_code": code})
    assert joined.status_code == 200, joined.text
    return manager


def complete_store_profile(database: Session, manager: Person) -> None:
    """A Store Manager's profile also needs a post office and a qualification."""
    manager.user.location = "MG Road S.O, Bengaluru"
    manager.user.engineer_profile.qualification = "Diploma"
    database.commit()


def rival_store_manager(client: TestClient, database: Session) -> Person:
    """A Store Manager on another builder's team."""
    other_builder = builder(client, database, "other.builder@example.in", "9876500012")
    rival = person(
        client, database, "rival.store@example.in", "9876500013", ROLE_ENGINEER, specialization="Store Manager"
    )
    complete_store_profile(database, rival)
    invite = other_builder.post("/engineers/invite", json={"email": "rival.store@example.in"}).json()["invite_code"]
    rival.post("/engineers/join-team", json={"invite_code": invite})
    return rival


@pytest.fixture
def store(client: TestClient, database: Session) -> Store:
    site = make_site(client, database)
    manager = store_manager(client, database, site)
    seller = supplier(client, database)
    listing_id = list_product(seller, make_catalog(database)).json()["id"]
    accept_between(database, site.builder, seller, "CONTRACTOR_TO_SUPPLIER", None)
    return Store(site, manager, seller, listing_id)


def buy(store: Store, quantity: int, **changes: Any) -> Any:
    body = {"project_id": store.site.project_id, "supplier_id": str(store.seller.user.id),
            "items": [{"product_id": store.listing_id, "quantity": quantity}], **changes}  # fmt: skip
    return store.manager.post("/store-manager/purchases/checkout", json=body)


def pay(store: Store, quantity: int, **changes: Any) -> dict[str, Any]:
    """Checkout, the mock Checkout's success, then verify: a paid purchase."""
    checkout = buy(store, quantity, **changes)
    assert checkout.status_code == 201, checkout.text
    payment_id = checkout.json()["payment_id"]
    simulated = store.manager.post(
        "/store-manager/purchases/mock-checkout", json={"payment_id": payment_id, "outcome": "success"}
    ).json()
    verified = store.manager.post(
        "/store-manager/purchases/verify",
        json={
            "payment_id": payment_id,
            **{key: simulated[key] for key in ("razorpay_order_id", "razorpay_payment_id", "razorpay_signature")},
        },
    )
    assert verified.json()["status"] == "PAID", verified.text
    return verified.json()["payment"]


def ask(site: Site, item_id: Any, quantity: int) -> Any:
    """The Site Engineer's request to the store for one product."""
    body = {"project_id": site.project_id, "items": [{"item_id": str(item_id), "quantity": quantity}]}
    return site.engineer.post("/store/site-requests", json=body)


def test_every_store_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == store_router.__name__
    ]
    assert len(routes) == 30
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_the_store_catalog_and_stock(client: TestClient, database: Session, store: Store) -> None:
    manager = store.manager
    stocked = manager.post("/store-manager/items", json={"name": "Sand", "category": "Aggregates", "unit": "cft",
                                                         "quantity": 5})  # fmt: skip
    assert detail(stocked).startswith("Stock is added only when goods from a paid supplier purchase are received.")
    created = manager.post("/store-manager/items", json={"name": "Sand", "category": "Aggregates", "unit": "cft"})
    assert created.status_code == 201, created.text
    item = created.json()
    twice = manager.post("/store-manager/items", json={"name": "sand", "category": "Aggregates", "unit": "CFT"})
    assert (twice.status_code, detail(twice)) == (
        409,
        "This product is already in your catalog. Update its stock instead.",
    )
    base = f"/store-manager/items/{item['id']}"
    assert manager.patch(base, json={"low_stock_threshold": 2}).json()["low_stock_threshold"] == 2.0
    assert detail(manager.post(f"{base}/stock", json={"mode": "ADD", "quantity": 1})).startswith("Stock is added only")
    assert (
        detail(manager.post(f"{base}/stock", json={"mode": "REMOVE", "quantity": 1})) == "Only 0.000 cft are in stock."
    )  # the old Decimal text
    assert manager.get(f"{base}/movements").json() == []
    assert [row["name"] for row in manager.get("/store-manager/items").json()] == ["Sand"]
    assert manager.get("/store-manager/overview").json()["item_count"] == 1
    assert [row["title"] for row in manager.get("/store-manager/projects").json()] == ["Rao Residence"]

    # Another Store Manager never reaches this store's product: the old 404.
    rival = rival_store_manager(client, database)
    for answer in (
        rival.patch(base, json={"name": "Mine"}),
        rival.post(f"{base}/stock", json={"mode": "SET", "quantity": 0}),
        rival.get(f"{base}/movements"),
    ):
        assert (answer.status_code, detail(answer)) == (404, "Product not found")
    refused = store.site.engineer.get("/store-manager/items")
    assert (refused.status_code, detail(refused)) == (403, "Store Manager access required")


def test_buy_receive_request_and_issue(client: TestClient, database: Session, store: Store) -> None:
    manager, site = store.manager, store.site
    offers = manager.get("/store-manager/buy/products", params={"project_id": site.project_id}).json()
    assert [row["id"] for row in offers["products"]] == [store.listing_id] and offers["supplier_count"] == 1
    too_many = buy(store, 500)
    assert too_many.status_code == 409 and detail(too_many)["code"] == "INSUFFICIENT_SUPPLIER_STOCK"
    payment = pay(store, 10)
    code = payment["request_code"]
    assert (payment["amount"], payment["gateway_mode"], payment["method"]) == (3600.0, "mock", "RAZORPAY")
    order = manager.get("/store-manager/purchases").json()[0]
    assert (order["total"], order["paid"], order["payment_status"]) == (3600.0, 3600.0, "PAID")
    line_id = order["lines"][0]["id"]
    refused = manager.post(f"/store-manager/purchases/lines/{line_id}/receive")
    assert detail(refused) == "Only a purchase the supplier has accepted can be received."
    accepted = store.seller.post(f"/supplier/purchase-requests/{code}/respond", json={"action": "ACCEPT"})
    assert accepted.json()[0]["status"] == "ACCEPTED", accepted.text

    # Received in parts, and a retried receipt adds nothing.
    receive = f"/store-manager/purchases/lines/{line_id}/receive"
    first = manager.post(receive, json={"quantity": 6, "receipt_key": "receipt-0001"})
    assert first.json()["quantity"] == 6.0, first.text
    assert manager.post(receive, json={"quantity": 6, "receipt_key": "receipt-0001"}).json()["quantity"] == 6.0
    assert (
        detail(manager.post(receive, json={"quantity": 9}))
        == "Only 4 BAG of OPC 53 Grade Cement is still to be received."
    )
    assert manager.post(receive).json()["quantity"] == 10.0
    item = manager.get("/store-manager/items").json()[0]
    assert (item["name"], item["brand"], item["variant"], item["quantity"]) == (
        "OPC 53 Grade Cement",
        "Dalmia",
        "50 kg",
        10.0,
    )
    over = manager.post("/store-manager/payments", json={"request_code": code, "amount": 1, "method": "CASH"})
    assert detail(over) == "The balance on this purchase is Rs 0.00."
    assert manager.get("/store-manager/payments").json()[0]["order_lines"][0]["received_quantity"] == 10.0

    # The Site Engineer asks the store; the Store Manager approves and hands over in parts.
    stores = site.engineer.get("/store/site-stores", params={"project_id": site.project_id}).json()
    assert [entry["items"][0]["quantity"] for entry in stores] == [10.0]
    asked = ask(site, item["id"], 4)
    assert asked.status_code == 201, asked.text
    request = asked.json()
    assert request["public_request_id"] == str(request["id"]) and request["can_approve"] is True
    assert (
        manager.get("/store-manager/requests", params={"search": f"#{request['id']}"}).json()[0]["id"] == request["id"]
    )
    assert manager.get("/store-manager/requests", params={"search": "not-a-uuid"}).json() == []
    approved = manager.post(f"/store-manager/requests/{request['id']}/approve", json={"note": "Ok"})
    assert approved.json()["status"] == "APPROVED"
    line = approved.json()["lines"][0]["id"]
    part = manager.post(
        f"/store-manager/requests/{request['id']}/issue", json={"lines": [{"line_id": line, "quantity": 1}]}
    )
    assert part.json()["status"] == "PARTIALLY_ISSUED", part.text
    assert manager.post(f"/store-manager/requests/{request['id']}/issue").json()["status"] == "ISSUED"
    mine = site.engineer.get("/store/site-requests/mine").json()
    assert mine[0]["stage"] == "FULFILLED" and mine[0]["received_by"] == site.engineer.user.name
    cancel = site.engineer.post(f"/store/site-requests/{request['id']}/cancel")
    assert cancel.status_code == 409 and "only a pending request can be cancelled" in detail(cancel)
    assert manager.get("/store-manager/requests/{}/purchase-options".format(request["id"])).json()["lines"] == []

    # A short request is offered the builder's suppliers; a failed checkout stays unpaid.
    short = ask(site, item["id"], 9).json()
    refused = manager.post(f"/store-manager/requests/{short['id']}/approve", json={})
    assert detail(refused).startswith("Insufficient stock. Please purchase the remaining 3 BAG")
    options = manager.get(f"/store-manager/requests/{short['id']}/purchase-options").json()
    assert options["lines"][0]["to_procure"] == 3.0 and len(options["lines"][0]["options"]) == 1
    failing = buy(store, 3, site_request_id=short["id"]).json()["payment_id"]
    failed = manager.post("/store-manager/purchases/failure", json={"payment_id": failing, "description": "Declined"})
    assert (failed.json()["status"], failed.json()["failure_reason"]) == ("FAILED", "Declined")
    checked = manager.post(f"/store-manager/purchases/payments/{failing}/check").json()
    assert checked["status"] == "FAILED"
    assert site.engineer.post(f"/store/site-requests/{short['id']}/cancel").json()["status"] == "CANCELLED"

    # Another Store Manager never reaches these purchases or requests: the old 404s.
    rival = rival_store_manager(client, database)
    assert detail(rival.post(receive)) == "Purchase not found"
    assert detail(rival.post(f"/store-manager/requests/{request['id']}/issue")) == "Request not found"
    assert rival.post(f"/store-manager/purchases/payments/{payment['id']}/check").status_code == 404
    assert detail(rival.get("/store-manager/buy/products", params={"project_id": site.project_id})) == (
        "Choose a project of a builder whose team you are on."
    )

    # Wired back: deletion history, listing deletion, weather.
    # 2 requests, 2 payments and 2 receipts (the retried receipt added none).
    assert links.store_manager_history_count(database, manager.user.id) == 6
    assert (
        deletion_blockers.supplier_transaction_history_count(database, store.seller.user.id) == 3
    )  # 1 line, 2 payments
    assert links.payment_count_for_listing(database, uuid.UUID(store.listing_id)) == 2
    assert detail(store.seller.delete(f"/supplier-products/{store.listing_id}")).endswith("payments are kept.")
    assert links.engineer_request_project_ids(database, site.engineer.user.id) == [uuid.UUID(site.project_id)]
    weather = WeatherRepository(database)
    assert weather.store_request_project_ids(manager.user.id) == set()  # both requests are closed


def test_site_requests_need_a_store_and_weather_sees_open_ones(client: TestClient, database: Session) -> None:
    site = make_site(client, database)
    missing = ask(site, str(uuid.uuid4()), 1)
    assert (missing.status_code, detail(missing)) == (
        409,
        "No Store Manager is assigned to this project's Builder team. "
        "Ask your Builder to add one; the request was not sent.",
    )
    manager = store_manager(client, database, site)
    item = manager.post("/store-manager/items", json={"name": "Sand", "category": "Aggregates", "unit": "cft"}).json()
    asked = ask(site, item["id"], 1).json()
    assert WeatherRepository(database).store_request_project_ids(manager.user.id) == {uuid.UUID(site.project_id)}
    assert WeatherRepository(database).store_request_recipient_ids(uuid.UUID(site.project_id)) == {manager.user.id}
    rejected = manager.post(f"/store-manager/requests/{asked['id']}/reject", json={"note": "Out of season"})
    assert (rejected.json()["status"], rejected.json()["decision_note"]) == ("REJECTED", "Out of season")
    assert detail(manager.post("/store/site-requests", json={"project_id": site.project_id, "items": [
        {"item_id": item["id"], "quantity": 1}]})) == "Store Managers do not raise site requests."  # fmt: skip
    assert detail(site.engineer.post(f"/store/site-requests/{uuid.uuid4()}/cancel")) == "Request not found"


def test_builder_and_store_manager_requests(client: TestClient, database: Session) -> None:
    site = make_site(client, database)
    manager = store_manager(client, database, site)
    listed = manager.get("/store-builder-requests").json()
    assert listed["side"] == "STORE_MANAGER" and listed["counterparts"][0]["id"] == str(site.builder.user.id)
    body = {"counterpart_id": str(site.builder.user.id), "category": "delivery", "title": "Truck access",
            "description": "Gate is locked after 6pm."}  # fmt: skip
    sent = manager.post("/store-builder-requests", json=body)
    assert sent.status_code == 201, sent.text
    request_id = sent.json()["id"]
    assert detail(manager.post(f"/store-builder-requests/{request_id}/respond", json={"decision": "ACCEPT"})) == (
        "Only the recipient can respond to this request."
    )
    answered = site.builder.post(
        f"/store-builder-requests/{request_id}/respond", json={"decision": "ACCEPT", "response": "Will open it"}
    )
    assert (answered.json()["status"], answered.json()["response"]) == ("ACCEPTED", "Will open it")
    second = manager.post("/store-builder-requests", json={**body, "title": "Second"}).json()["id"]
    assert detail(site.builder.post(f"/store-builder-requests/{second}/withdraw")) == (
        "Only the sender can withdraw this request."
    )
    assert manager.post(f"/store-builder-requests/{second}/withdraw").json()["status"] == "WITHDRAWN"
    stranger = builder(client, database, "other.builder@example.in", "9876500012")
    assert detail(stranger.post(f"/store-builder-requests/{second}/withdraw")) == "Request not found"
    assert detail(site.engineer.get("/store-builder-requests")) == (
        "Only a Builder and the Store Managers on their team can use these requests."
    )


def test_payments_answer_503_without_razorpay(make_client: ClientFactory, database: Session) -> None:
    client = build(make_client, FakeEmailSender(), FakeStorage())
    site = make_site(client, database)
    manager = store_manager(client, database, site)
    refused = manager.get("/store-manager/buy/products", params={"project_id": site.project_id})
    assert refused.status_code == 503 and detail(refused)["code"] == "PAYMENT_GATEWAY_MISCONFIGURED"
    assert manager.get("/store-manager/payments").status_code == 200
