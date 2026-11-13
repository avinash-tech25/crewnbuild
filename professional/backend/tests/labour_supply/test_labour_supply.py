"""Labour supply: a Labour Supplier's trades, the Site Engineer's requests to an assigned
supplier, the supplier's decision within free capacity, attendance and completion; who
may reach each (the old 403/404 answers), and what labour supply unblocks elsewhere."""

import uuid
from datetime import date, timedelta

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from projects.helpers import Person, owner
from projects.test_projects import detail
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.labour_supply import links
from app.modules.labour_supply import router as labour_router
from app.modules.weather.repository import WeatherRepository
from labour_supply.helpers import Site, assign, category_supplier, make_site, put, unassign

TODAY = date.today()


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


@pytest.fixture
def site(client: TestClient, database: Session) -> Site:
    return make_site(client, database)


def labour_supplier(
    client: TestClient, database: Session, email: str = "crew@example.in", phone: str = "9876500006"
) -> Person:
    return category_supplier(client, database, "Labor Supplier", email, phone)


def request_body(supplier: Person, **changes: object) -> dict[str, object]:
    return {"supplier_id": str(supplier.user.id), "trade": "mason", "workers_required": 4,
            "start_date": TODAY.isoformat(), **changes}  # fmt: skip


def test_every_labour_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == labour_router.__name__
    ]
    assert len(routes) == 17
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", TODAY.isoformat() if name == "work_date" else str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_a_supplier_manages_only_its_own_trades(client: TestClient, database: Session) -> None:
    crew = labour_supplier(client, database)
    assert "Tile Worker" in crew.get("/labor/trades").json()
    created = crew.post("/labor/services", json={"trade": "mason", "worker_capacity": 10, "skill_level": "Skilled"})
    assert created.status_code == 200, created.text
    service = created.json()
    assert (service["trade"], service["available_workers"]) == ("Mason", 10)
    twice = crew.post("/labor/services", json={"trade": "Mason", "worker_capacity": 1})
    assert (twice.status_code, detail(twice)) == (409, "You already offer Mason. Update that service instead.")
    assert crew.post("/labor/services", json={"trade": "Astronaut", "worker_capacity": 1}).status_code == 422
    base = f"/labor/services/{service['id']}"
    assert crew.patch(base, json={"worker_capacity": 12}).json()["worker_capacity"] == 12
    assert detail(crew.patch(base, json={"worker_capacity": None})) == "worker_capacity cannot be empty."
    assert [row["trade"] for row in crew.get("/labor/services").json()] == ["Mason"]

    rival = labour_supplier(client, database, "rival.crew@example.in", "9876500007")
    for answer in (rival.patch(base, json={"worker_capacity": 1}), rival.delete(base)):
        assert (answer.status_code, detail(answer)) == (404, "Labor service not found")
    material = category_supplier(client, database, "Material Supplier", "stores@example.in", "9876500008")
    refused = material.get("/labor/services")
    assert (refused.status_code, detail(refused)) == (403, "Only a Labor Supplier can use labor endpoints.")
    assert detail(owner(client, database).get("/labor/requests")) == "SUPPLIER role required"
    assert crew.delete(base).json() == {"status": "deleted", "id": service["id"]}


def test_request_accept_attendance_and_complete(client: TestClient, database: Session, site: Site) -> None:
    crew = labour_supplier(client, database)
    service_id = crew.post("/labor/services", json={"trade": "Mason", "worker_capacity": 5}).json()["id"]
    project = f"/projects/{site.project_id}"
    unassigned = site.engineer.post(f"{project}/labor-requests", json=request_body(crew))
    assert (unassigned.status_code, detail(unassigned)) == (
        403,
        "This Labor Supplier is not assigned to you on this project.",
    )
    assign(database, site, crew)
    trades = site.engineer.get(f"{project}/labor-suppliers/{crew.user.id}/services").json()
    assert [(row["trade"], row["available_workers"]) for row in trades] == [("Mason", 5)]
    assert site.builder.get(f"{project}/labor-suppliers/{crew.user.id}/services").status_code == 200

    too_many = site.engineer.post(f"{project}/labor-requests", json=request_body(crew, workers_required=6))
    assert (too_many.status_code, detail(too_many)) == (409, "Only 5 Mason workers are available right now.")
    past = request_body(crew, start_date=(TODAY - timedelta(days=1)).isoformat())
    assert detail(site.engineer.post(f"{project}/labor-requests", json=past)) == "Start date cannot be in the past."
    created = site.engineer.post(f"{project}/labor-requests", json=request_body(crew))
    assert created.status_code == 200, created.text
    request = created.json()
    assert (request["status"], request["supplier_name"], request["trade"]) == ("PENDING", "Rao Stores", "Mason")
    duplicate = site.engineer.post(f"{project}/labor-requests", json=request_body(crew))
    assert duplicate.status_code == 409 and "already have a pending Mason request" in detail(duplicate)
    assert [row["id"] for row in site.builder.get(f"{project}/labor-requests").json()] == [request["id"]]
    assert detail(site.engineer.get(f"{project}/labor-requests", params={"status": "LATER"})).startswith(
        "status must be one of"
    )
    assert crew.get("/labor/requests", params={"status": "pending"}).json()[0]["id"] == request["id"]

    # Another supplier never decides this request: the old 403.
    rival = labour_supplier(client, database, "rival.crew@example.in", "9876500007")
    accept = f"/labor/requests/{request['id']}/accept"
    for answer in (
        rival.post(accept, json={"workers_allocated": 1}),
        rival.post(f"/labor/requests/{request['id']}/reject"),
        rival.get(f"/labor/requests/{request['id']}/daily-records"),
    ):
        assert (answer.status_code, detail(answer)) == (403, "You do not have access to this labor request.")
    assert crew.post(f"/labor/requests/{uuid.uuid4()}/accept", json={"workers_allocated": 1}).status_code == 404
    assert (
        detail(crew.post(accept, json={"workers_allocated": 9})) == "You can allocate at most the 4 workers requested."
    )
    accepted = crew.post(accept, json={"workers_allocated": 3, "decision_note": "Ravi's crew"})
    assert (accepted.json()["status"], accepted.json()["workers_allocated"]) == ("ACCEPTED", 3)
    assert detail(crew.post(accept, json={"workers_allocated": 1})) == "This labor request is accepted."
    low = crew.patch(f"/labor/services/{service_id}", json={"worker_capacity": 2})
    assert low.status_code == 409 and "3 Mason workers are deployed" in detail(low)
    assert crew.delete(f"/labor/services/{service_id}").status_code == 409

    # Attendance, read by the engineer, the supplier and the builder.
    records = f"/labor-requests/{request['id']}/daily-records"
    saved = put(site.engineer, f"{records}/{TODAY.isoformat()}", {"present_count": 2, "absent_count": 1})
    assert saved.json()["present_count"] == 2, saved.text
    again = put(site.engineer, f"{records}/{TODAY.isoformat()}", {"present_count": 3, "overtime_workers": 1,
                                                                  "overtime_hours": 2})  # fmt: skip
    assert (again.json()["present_count"], again.json()["overtime_hours"]) == (3, 2.0)
    over = put(site.engineer, f"{records}/{TODAY.isoformat()}", {"present_count": 4})
    assert detail(over) == "Present + absent + half-day (4) cannot exceed the 3 allocated workers."
    future = put(site.engineer, f"{records}/{(TODAY + timedelta(days=1)).isoformat()}", {"present_count": 1})
    assert detail(future) == "Attendance cannot be recorded for a future date."
    assert len(site.builder.get(records).json()) == 1
    assert len(crew.get(f"/labor/requests/{request['id']}/daily-records").json()) == 1
    assert detail(site.owner.get(records)) == "Access denied"

    later = (TODAY + timedelta(days=30)).isoformat()
    assert site.engineer.patch(f"/labor-requests/{request['id']}", json={"end_date": later}).json()["end_date"] == later
    locked = site.engineer.patch(f"/labor-requests/{request['id']}", json={"workers_required": 2})
    assert detail(locked) == "workers_required can only change while the request is pending."

    # Wired back: trades, deletion history, weather delivery destinations.
    mine = site.builder.get("/contractors/my-suppliers").json()
    assert next(row["categories"] for row in mine if row["store_name"] == "Rao Stores") == ["Mason"]
    project_id = uuid.UUID(site.project_id)
    assert links.builder_history_project_ids(database, site.builder.user.id) == [project_id]
    assert links.supplier_history_project_ids(database, crew.user.id) == [project_id]
    assert links.engineer_history_project_ids(database, site.engineer.user.id) == [project_id]
    assert deletion_blockers.supplier_project_history_titles(database, crew.user.id) == ["Rao Residence"]
    assert WeatherRepository(database).supplier_order_project_ids(crew.user.id) == {project_id}

    completed = site.engineer.post(f"/labor-requests/{request['id']}/complete")
    assert completed.json()["status"] == "COMPLETED"
    assert detail(site.engineer.post(f"/labor-requests/{request['id']}/cancel")) == "This labor request is completed."
    assert WeatherRepository(database).supplier_order_project_ids(crew.user.id) == set()


def test_reject_cancel_and_unassigned_suppliers(client: TestClient, database: Session, site: Site) -> None:
    crew = labour_supplier(client, database)
    crew.post("/labor/services", json={"trade": "Mason", "worker_capacity": 5})
    crew.post("/labor/services", json={"trade": "Plumber", "worker_capacity": 2})
    assign(database, site, crew)
    project = f"/projects/{site.project_id}/labor-requests"
    first = site.engineer.post(project, json=request_body(crew)).json()["id"]
    rejected = crew.post(f"/labor/requests/{first}/reject", json={"decision_note": "Busy"})
    assert (rejected.json()["status"], rejected.json()["decision_note"]) == ("REJECTED", "Busy")
    second = site.engineer.post(project, json=request_body(crew, trade="plumber", workers_required=1)).json()["id"]
    raised = site.engineer.patch(f"/labor-requests/{second}", json={"workers_required": 3})
    assert detail(raised) == "Only 2 Plumber workers are available right now."
    stranger = labour_supplier(client, database, "stranger@example.in", "9876500009")
    assert stranger.post(f"/labor-requests/{second}/cancel").status_code == 403  # a supplier is not the engineer
    assert site.engineer.post(f"/labor-requests/{second}/cancel").json()["status"] == "CANCELLED"

    # After the builder unassigns the supplier, a pending request can no longer be accepted.
    third = site.engineer.post(project, json=request_body(crew, workers_required=1)).json()["id"]
    unassign(site, crew)
    refused = crew.post(f"/labor/requests/{third}/accept", json={"workers_allocated": 1})
    assert refused.status_code == 409 and detail(refused).startswith("The builder has unassigned you")
    again = site.engineer.post(project, json=request_body(crew, workers_required=2))
    assert detail(again) == "This Labor Supplier is not assigned to you on this project."
    material = category_supplier(client, database, "Material Supplier", "stores@example.in", "9876500008")
    not_labour = site.engineer.post(project, json=request_body(material))
    assert (not_labour.status_code, detail(not_labour)) == (403, "This supplier is not a Labor Supplier.")
    unknown = site.engineer.post(project, json=request_body(crew, supplier_id=str(uuid.uuid4())))
    assert (unknown.status_code, detail(unknown)) == (404, "Supplier not found")
    assert detail(site.owner.post(project, json=request_body(crew))) == "ENGINEER role required"
