"""Site operations: the daily record (calendar) with its photos, the cost tool (labour and
attendance, materials and stock, purchases, expenses, machinery, payments), the builder's
summary and the owner's analysis, the deprecated logs, who may reach them (the old
403/404 answers), and what they now unblock in projects."""

import json
import uuid
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import PNG, FakeStorage
from identity.helpers import FakeEmailSender
from projects.helpers import Person, award, builder, create_project, engineer, owner
from projects.test_projects import THURSDAY_MORNING, detail
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.projects import daily_window
from app.modules.site_operations import router as site_router
from app.modules.site_operations import service as site_service

DAY = "2026-11-12"


@pytest.fixture
def client(make_client: ClientFactory, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    monkeypatch.setattr(site_service, "local_workflow_now", lambda: THURSDAY_MORNING)
    return build(make_client, FakeEmailSender(), FakeStorage(), aws_site_images_bucket_in="site-images")


class Site:
    def __init__(self, house_owner: Person, house_builder: Person, site_engineer: Person, project_id: str) -> None:
        self.owner, self.builder, self.engineer, self.project_id = house_owner, house_builder, site_engineer, project_id


@pytest.fixture
def site(client: TestClient, database: Session) -> Site:
    house_owner, house_builder = owner(client, database), builder(client, database)
    site_engineer = engineer(client, database)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    return Site(house_owner, house_builder, site_engineer, project_id)


def workflow(site: Site, **changes: Any) -> Any:
    form = {"work_date": DAY, "work_title": "Footings", "labour_worker_count": "6", "labour_cost": "4800",
            "material_cost": "1200", "detailed_remarks": "Poured", **changes}  # fmt: skip
    return site.engineer.post(
        f"/projects/{site.project_id}/daily-workflow", data=form, files={"images": ("s.png", PNG, "image/png")}
    )


def test_every_site_route_needs_a_session(client: TestClient) -> None:
    routes = [r for r in client.app.routes if isinstance(r, APIRoute) and r.endpoint.__module__ == site_router.__name__]  # type: ignore[attr-defined]
    assert len(routes) == 12
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_the_daily_record_its_photos_and_who_reads_it(client: TestClient, database: Session, site: Site) -> None:
    saved = workflow(site)
    assert saved.status_code == 200, saved.text
    register = saved.json()["register"]
    assert register["status"] == "IN_PROGRESS" and register["day_number"] == 1 and register["labour_cost"] == 4800
    assert register["created_at"].endswith("+05:30")
    summary = site.builder.get(f"/cost-tool/projects/{site.project_id}/summary", params={"work_date": DAY}).json()
    assert summary["dashboard"]["labour_cost"] == 4800.0 and summary["dashboard"]["estimated_budget"] == 900000.0
    assert summary["workflow"]["local_date"] == DAY
    entries = site.owner.get(f"/timelines/project/{site.project_id}").json()
    assert entries[0]["title"] == "Footings" and len(entries[0]["images"]) == 1

    owner_summary = site.owner.get(f"/cost-tool/projects/{site.project_id}/summary")
    assert (owner_summary.status_code, detail(owner_summary)) == (
        403,
        "Project cost records are available to the builder and the assigned Site Engineer only",
    )
    analysis = site.owner.get(f"/owners/projects/{site.project_id}/analysis").json()
    assert analysis["dashboard"]["labour_cost"] == 4800.0 and analysis["expenses"] == []
    assert set(analysis["registers"][0]) == {"id", "work_date", "work_type", "material_cost", "labour_cost",
                                             "equipment_cost", "total_expenses", "boq_activity"}  # fmt: skip
    assert detail(site.builder.get(f"/owners/projects/{site.project_id}/analysis")) == "OWNER role required"
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    refused = stranger.get(f"/owners/projects/{site.project_id}/analysis")
    assert (refused.status_code, detail(refused)) == (403, "You can only view the analysis of your own project")
    assert stranger.get(f"/owners/projects/{uuid.uuid4()}/analysis").status_code == 404
    assert stranger.get(f"/cost-tool/projects/{site.project_id}/summary").status_code == 403
    assert (
        site.builder.get(f"/cost-tool/projects/{site.project_id}/summary", params={"work_date": "x"}).status_code == 422
    )

    # Wired back: recorded work starts the project, and the open day's photo can be deleted.
    started = site.owner.delete(f"/projects/{site.project_id}")
    assert (started.status_code, detail(started)) == (409, "This project has already started and cannot be deleted.")
    photo_id = site.owner.get(f"/projects/{site.project_id}/photos").json()[0]["id"]
    assert site.owner.delete(f"/project-photos/{photo_id}").status_code == 403
    assert site.engineer.delete(f"/project-photos/{photo_id}").json() == {"deleted": True}

    closed = workflow(site, action="CLOSED")
    assert closed.json()["register"]["status"] == "CLOSED"
    assert (workflow(site).status_code, detail(workflow(site))) == (409, "This day is completed and cannot be edited")


def test_the_daily_record_refuses_bad_input(site: Site) -> None:
    assert detail(workflow(site, work_date="2026-11-11")).startswith("Daily record is closed after")
    assert detail(workflow(site, work_date="12/11/2026")) == "Enter a valid work date"  # crash fixed
    assert detail(workflow(site, action="LATER")) == "Invalid daily workflow action"
    assert detail(workflow(site, planned_quantity="lots")) == "Planned quantity must be a number."
    unknown = json.dumps([{"material_name": "Cement", "quantity_used": 1, "product_id": str(uuid.uuid4())}])
    assert detail(workflow(site, material_usage=unknown)) == "Unknown product for Cement."  # crash fixed
    outsider = site.builder.post(
        f"/projects/{site.project_id}/daily-workflow", data={"work_date": DAY, "work_title": "x"}
    )
    assert detail(outsider) == "Only an actively assigned Site Engineer can update project activity"


def test_the_cost_tool(site: Site, client: TestClient, database: Session) -> None:
    body = {"project_id": site.project_id, "work_date": DAY, "floor": "Ground", "block": "A", "work_type": "Footings"}
    opened = site.engineer.post("/cost-tool/registers", json=body)
    assert opened.status_code == 200, opened.text
    register_id = opened.json()["register"]["id"]
    base = f"/cost-tool/registers/{register_id}"

    labour = {"labour_category": "Mason", "worker_name": "Ravi", "worker_count": 2, "daily_wage": 800}
    labour |= {"attendance_status": "Half Day", "overtime_hours": 1, "overtime_rate": 100, "advance_paid": 50}
    entry = site.engineer.post(f"{base}/labour", json=labour).json()["entry"]
    assert (entry["regular_amount"], entry["overtime_amount"], entry["payable_amount"]) == (800, 200, 950)
    purchase = {"supplier_name": "Local Traders", "material": "Cement", "quantity": 100, "unit": "Bag", "rate": 400,
                "transport_cost": 500, "loading_cost": 0, "unloading_cost": 0, "gst_percent": 18, "discount": 0,
                "purchase_date": DAY, "minimum_stock": 20}  # fmt: skip
    bought = site.engineer.post(f"{base}/material-purchases", json=purchase).json()
    assert bought["entry"]["total_amount"] == 47790
    usage = {
        "material": "Cement",
        "opening_stock": 100,
        "quantity_used": 85,
        "unit": "Bag",
        "rate": 400,
        "minimum_stock": 20,
    }
    used = site.engineer.post(f"{base}/material-usage", json=usage).json()
    assert used["summary"]["inventory_alerts"] == ["Only 15 Bag Cement remaining."]
    expense = {"category": "Water", "amount": 300, "expense_date": DAY}
    assert site.engineer.post(f"{base}/expenses", json=expense).json()["entry"]["amount"] == 300
    machine = {"machine": "Mixer", "hours": 2, "rate_per_hour": 250, "operator_charge": 100, "fuel_cost": 0,
               "maintenance_cost": 0}  # fmt: skip
    assert site.engineer.post(f"{base}/machinery", json=machine).json()["entry"]["total_cost"] == 600
    payment = {"direction": "OUT", "payment_type": "Cash", "party_name": "Local Traders", "amount": 40000,
               "payment_date": DAY}  # fmt: skip
    paid = site.engineer.post(f"{base}/payments", json=payment).json()
    assert paid["summary"]["supplier_ledger"][0]["pending_amount"] == 7790
    assert detail(site.engineer.post(f"{base}/payments", json={**payment, "direction": "SIDEWAYS"})) == (
        "Payment direction must be IN or OUT"
    )

    other = engineer(client, database, "other.engineer@example.in", "9876500008")
    assert other.post(f"{base}/expenses", json=expense).status_code == 403
    assert site.engineer.post(f"/cost-tool/registers/{uuid.uuid4()}/expenses", json=expense).status_code == 404
    assert other.post("/cost-tool/registers", json=body).status_code == 403
    titles = deletion_blockers.builder_history_project_titles(database, site.builder.user.id)
    assert titles == ["Rao Residence"]


def test_the_deprecated_logs(site: Site, client: TestClient, database: Session) -> None:
    material = {"project_id": site.project_id, "material_name": "Sand", "quantity": 3, "unit": "Tonne", "cost": 4500}
    logged = site.builder.post("/materials/create", json=material)
    assert logged.status_code == 200 and logged.json()["material_name"] == "Sand"
    labour = {"project_id": site.project_id, "labour_count": 4, "labour_cost": 3200, "work_date": f"{DAY}T09:00:00"}
    assert site.builder.post("/labour/create", json=labour).json()["labour_count"] == 4
    rival = builder(client, database, "rival@example.in", "9876500005")
    refused = rival.post("/materials/create", json=material)
    assert (refused.status_code, detail(refused)) == (403, "Only assigned builder can manage this project")
    assert detail(site.engineer.post("/labour/create", json=labour)) == "CONTRACTOR role required"
