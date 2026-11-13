"""Equipment supply: an Equipment Supplier's listings, the Site Engineer's rent and buy
requests to an assigned supplier, the supplier's decision within free stock, usage logs
and completion; who may reach each (the old 403/404 answers), and what equipment supply
unblocks elsewhere."""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from labour_supply.helpers import Site, assign, category_supplier, make_site, put, unassign
from projects.helpers import Person, owner
from projects.test_projects import detail
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.equipment_supply import links
from app.modules.equipment_supply import router as equipment_router
from app.modules.weather.repository import WeatherRepository

TODAY = date.today()
MIXER = {"name": "Concrete Mixer", "category": "Mixers", "condition": "used", "mode": "rent_buy",
         "quantity_total": 5, "daily_rate": 1500, "sale_price": 60000}  # fmt: skip


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


@pytest.fixture
def site(client: TestClient, database: Session) -> Site:
    return make_site(client, database)


def equipment_supplier(
    client: TestClient, database: Session, email: str = "plant@example.in", phone: str = "9876500006"
) -> Person:
    return category_supplier(client, database, "Equipment Supplier", email, phone)


def rent(item_id: str, quantity: int = 2, days: int = 3) -> dict[str, Any]:
    return {"equipment_item_id": item_id, "request_kind": "rent", "quantity": quantity, "rate_unit": "day",
            "start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=days)).isoformat()}  # fmt: skip


def test_every_equipment_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == equipment_router.__name__
    ]
    assert len(routes) == 14
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", TODAY.isoformat() if name == "usage_date" else str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_a_supplier_manages_only_its_own_listings(client: TestClient, database: Session) -> None:
    plant = equipment_supplier(client, database)
    picture = uuid.uuid4()
    created = plant.post("/equipment/items", json={**MIXER, "image_url": f"/files/{picture}"})
    assert created.status_code == 200, created.text
    item = created.json()
    assert (item["mode"], item["available_to_rent"], item["available_to_buy"]) == ("RENT_BUY", 5, 5)
    no_rate = plant.post("/equipment/items", json={**MIXER, "mode": "RENT", "daily_rate": None})
    assert no_rate.status_code == 422
    base = f"/equipment/items/{item['id']}"
    assert plant.patch(base, json={"weekly_rate": 9000}).json()["weekly_rate"] == 9000.0
    no_price = plant.patch(base, json={"sale_price": None})
    assert detail(no_price) == "A BUY or RENT_BUY item needs a sale price."
    assert detail(plant.patch(base, json={"name": None})) == "name cannot be empty."
    assert [row["name"] for row in plant.get("/equipment/items").json()] == ["Concrete Mixer"]

    rival = equipment_supplier(client, database, "rival.plant@example.in", "9876500007")
    for answer in (rival.patch(base, json={"quantity_total": 1}), rival.delete(base)):
        assert (answer.status_code, detail(answer)) == (404, "Equipment item not found")
    crew = category_supplier(client, database, "Labor Supplier", "crew@example.in", "9876500008")
    refused = crew.get("/equipment/items")
    assert (refused.status_code, detail(refused)) == (403, "Only an Equipment Supplier can use equipment endpoints.")
    assert detail(owner(client, database).get("/equipment/requests")) == "SUPPLIER role required"

    # Wired back into file access: a picture on the supplier's own listing.
    assert links.is_equipment_listing_image(database, plant.user.id, picture)
    assert not links.is_equipment_listing_image(database, rival.user.id, picture)
    assert plant.delete(base).json() == {"status": "deactivated", "id": item["id"]}
    assert plant.get("/equipment/items").json()[0]["is_active"] is False


def test_rent_buy_usage_and_complete(client: TestClient, database: Session, site: Site) -> None:
    plant = equipment_supplier(client, database)
    item_id = plant.post("/equipment/items", json=MIXER).json()["id"]
    project = f"/projects/{site.project_id}"
    unassigned = site.engineer.post(f"{project}/equipment-requests", json=rent(item_id))
    assert (unassigned.status_code, detail(unassigned)) == (
        403,
        "This Equipment Supplier is not assigned to you on this project.",
    )
    assign(database, site, plant)
    listed = site.engineer.get(f"{project}/equipment-suppliers/{plant.user.id}/items").json()
    assert [(row["name"], row["available_to_rent"]) for row in listed] == [("Concrete Mixer", 5)]
    one_date = site.engineer.get(
        f"{project}/equipment-suppliers/{plant.user.id}/items", params={"start_date": TODAY.isoformat()}
    )
    assert detail(one_date) == "Give both start_date and end_date, or neither."
    assert site.builder.get(f"{project}/equipment-suppliers/{plant.user.id}/items").status_code == 200

    rental = site.engineer.post(f"{project}/equipment-requests", json=rent(item_id))
    assert rental.status_code == 200, rental.text
    rental_id = rental.json()["id"]
    assert (rental.json()["unit_price"], rental.json()["status"], rental.json()["item_name"]) == (
        1500.0, "PENDING", "Concrete Mixer",
    )  # fmt: skip
    hourly = site.engineer.post(f"{project}/equipment-requests", json={**rent(item_id), "rate_unit": "hour"})
    assert detail(hourly) == "Concrete Mixer has no hourly rate."
    buy = {"equipment_item_id": item_id, "request_kind": "buy", "quantity": 4}
    purchase_id = site.engineer.post(f"{project}/equipment-requests", json=buy).json()["id"]
    assert len(site.builder.get(f"{project}/equipment-requests").json()) == 2
    assert plant.get("/equipment/requests", params={"status": "pending"}).status_code == 200

    # Another supplier never decides these requests: the old 403.
    rival = equipment_supplier(client, database, "rival.plant@example.in", "9876500007")
    for answer in (
        rival.post(f"/equipment/requests/{rental_id}/accept"),
        rival.post(f"/equipment/requests/{rental_id}/reject"),
        rival.post(f"/equipment/requests/{rental_id}/complete"),
    ):
        assert (answer.status_code, detail(answer)) == (403, "You do not have access to this equipment request.")
    assert plant.post(f"/equipment/requests/{uuid.uuid4()}/accept").status_code == 404

    assert plant.post(f"/equipment/requests/{rental_id}/accept").json()["status"] == "ACCEPTED"
    oversold = plant.post(f"/equipment/requests/{purchase_id}/accept")
    assert (oversold.status_code, detail(oversold)) == (409, "Only 3 x Concrete Mixer are available to sell.")
    rejected = plant.post(f"/equipment/requests/{purchase_id}/reject", json={"decision_note": "Reserved"})
    assert rejected.json()["status"] == "REJECTED"
    reserved = plant.patch(f"/equipment/items/{item_id}", json={"quantity_total": 1})
    assert detail(reserved) == "2 units are reserved by accepted rentals; the quantity cannot go below that."

    usage = f"/equipment-requests/{rental_id}/usage"
    logged = put(site.engineer, f"{usage}/{TODAY.isoformat()}", {"hours_used": 6, "notes": "Slab"})
    assert logged.json()["hours_used"] == 6.0, logged.text
    assert put(site.engineer, f"{usage}/{TODAY.isoformat()}", {"hours_used": 7}).json()["hours_used"] == 7.0
    too_long = put(site.engineer, f"{usage}/{TODAY.isoformat()}", {"hours_used": 49})
    assert detail(too_long) == "2 unit(s) can be used at most 48 hours in a day."
    outside = put(site.engineer, f"{usage}/{(TODAY - timedelta(days=1)).isoformat()}", {"hours_used": 1})
    assert detail(outside) == "This date is outside the rental period."
    assert len(site.builder.get(usage).json()) == 1 and len(plant.get(usage).json()) == 1
    assert detail(site.owner.get(usage)) == "Access denied"

    # Wired back: deletion history and weather delivery destinations.
    project_id = uuid.UUID(site.project_id)
    assert links.builder_history_project_ids(database, site.builder.user.id) == [project_id]
    assert links.engineer_history_project_ids(database, site.engineer.user.id) == [project_id]
    assert deletion_blockers.supplier_project_history_titles(database, plant.user.id) == ["Rao Residence"]
    assert WeatherRepository(database).supplier_order_recipient_ids(project_id) == {plant.user.id}

    returned = plant.post(f"/equipment/requests/{rental_id}/complete")
    assert returned.json()["status"] == "COMPLETED"
    assert detail(site.engineer.post(f"/equipment-requests/{rental_id}/cancel")) == (
        "This equipment request is completed."
    )
    assert WeatherRepository(database).supplier_order_project_ids(plant.user.id) == set()


def test_cancel_and_unassigned_suppliers(client: TestClient, database: Session, site: Site) -> None:
    plant = equipment_supplier(client, database)
    item_id = plant.post("/equipment/items", json=MIXER).json()["id"]
    assign(database, site, plant)
    project = f"/projects/{site.project_id}/equipment-requests"
    first = site.engineer.post(project, json=rent(item_id, quantity=1)).json()["id"]
    assert site.engineer.post(f"/equipment-requests/{first}/cancel").json()["status"] == "CANCELLED"
    second = site.engineer.post(project, json=rent(item_id, quantity=1)).json()["id"]
    assert detail(plant.post(f"/equipment-requests/{second}/cancel")) == "ENGINEER role required"
    unassign(site, plant)
    refused = plant.post(f"/equipment/requests/{second}/accept")
    assert refused.status_code == 409 and detail(refused).startswith("The builder has unassigned you")
    assert detail(site.engineer.post(project, json=rent(item_id))) == (
        "This Equipment Supplier is not assigned to you on this project."
    )
    missing = site.engineer.post(project, json=rent(str(uuid.uuid4())))
    assert (missing.status_code, detail(missing)) == (404, "Equipment item not found")
    assert detail(site.owner.post(project, json=rent(item_id))) == "ENGINEER role required"
    assert site.engineer.post(project, json={**rent(item_id), "rate_unit": None}).status_code == 422
