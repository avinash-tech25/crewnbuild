"""Every projects route: 401 without a session (found from the app), and a happy-path or
access test for each route the other project tests do not reach."""

import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_ENGINEER, ROLE_SUPPLIER
from app.modules.projects import daily_window, router
from projects.helpers import award, builder, create_project, engineer, owner, person
from projects.test_projects import THURSDAY_MORNING, detail


def project_routes(client: TestClient) -> list[tuple[str, str]]:
    found = []
    for route in client.app.routes:  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == router.__name__:
            path = route.path
            for name in route.param_convertors:
                path = path.replace("{" + name + "}", str(uuid.uuid4()))
            found += [(method, path) for method in sorted(route.methods)]
    return found


def test_every_projects_route_needs_a_session(client: TestClient) -> None:
    routes = project_routes(client)
    assert len(routes) == 48
    for method, path in routes:
        assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_negotiation_offers_decline_and_cancel(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    send = {"receiver_id": str(house_builder.user.id), "project_id": project_id, "request_type": "OWNER_TO_CONTRACTOR"}
    request_id = house_owner.post("/project-requests/send", json=send).json()["id"]
    house_builder.post("/project-requests/accept", json={"request_id": request_id, "quotation_amount": 900000})
    opened = house_owner.post("/project-requests/assign", json={"request_id": request_id, "offer_amount": 800000})
    assert opened.json()["status"] == "negotiating", opened.text
    award_id, offer_id = opened.json()["award_id"], opened.json()["offer_id"]
    rejected = house_builder.post(f"/award-offers/{offer_id}/reject")
    assert rejected.json()["offer_status"] == "rejected"
    counter = house_builder.post(f"/awards/{award_id}/offers", json={"amount": 850000, "note": "Steel prices"})
    assert counter.json()["status"] == "negotiating"
    accepted = house_owner.post(f"/award-offers/{counter.json()['offer_id']}/accept", json={"amount": 850000})
    assert accepted.json()["offer_status"] == "accepted"
    declined = house_builder.post(f"/awards/{award_id}/decline")
    assert declined.json()["status"] == "declined"
    assert house_owner.post(f"/awards/{award_id}/cancel").status_code == 409  # already ended

    second = create_project(house_owner, title="Second")["id"]
    send2 = {**send, "project_id": second}
    request2 = house_owner.post("/project-requests/send", json=send2).json()["id"]
    house_builder.post("/project-requests/accept", json={"request_id": request2, "quotation_amount": 10})
    award2 = house_owner.post("/project-requests/assign", json={"request_id": request2}).json()["award_id"]
    assert house_owner.post(f"/awards/{award2}/cancel").json()["status"] == "cancelled"
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    assert stranger.post(f"/awards/{award2}/decline").status_code == 403


def test_confirm_assignment_and_withdraw(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    contract = award(house_owner, house_builder, project_id)
    again = house_builder.post("/project-requests/confirm-assignment", json={"request_id": contract["request_id"]})
    assert (again.status_code, detail(again)) == (409, "This assignment has already been confirmed.")
    assert detail(
        house_owner.post("/project-requests/confirm-assignment", json={"request_id": contract["request_id"]})
    ) == ("CONTRACTOR role required")
    other = create_project(house_owner, title="Other")["id"]
    send = {"receiver_id": str(house_builder.user.id), "project_id": other, "request_type": "OWNER_TO_CONTRACTOR"}
    request_id = house_owner.post("/project-requests/send", json=send).json()["id"]
    assert house_builder.post("/project-requests/withdraw", json={"request_id": request_id}).status_code == 404
    assert house_owner.post("/project-requests/withdraw", json={"request_id": request_id}).json() == {
        "status": "withdrawn"
    }


def test_an_owner_hires_and_removes_a_site_engineer(client: TestClient, database: Session) -> None:
    house_owner, site_engineer = owner(client, database), engineer(client, database)
    project_id = create_project(house_owner, construction_type="SELF_CONSTRUCTION")["id"]
    send = {"receiver_id": str(site_engineer.user.id), "project_id": project_id, "request_type": "OWNER_TO_ENGINEER"}
    request_id = house_owner.post("/project-requests/send", json=send).json()["id"]
    site_engineer.post("/project-requests/accept", json={"request_id": request_id})
    hired = house_owner.post("/project-requests/assign-engineer", json={"request_id": request_id})
    assert hired.json()["status"] == "assigned", hired.text
    assert site_engineer.get(f"/projects/{project_id}").status_code == 200
    removed = house_owner.post(
        f"/projects/{project_id}/unassign-engineer", json={"engineer_id": str(site_engineer.user.id)}
    )
    assert removed.json()["status"] == "unassigned"
    assert site_engineer.get(f"/projects/{project_id}").status_code == 403


def test_specialists_team_requests_and_opportunities(client: TestClient, database: Session) -> None:
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    plumber = person(client, database, "plumber@example.in", "9876500006", ROLE_ENGINEER, specialization="Plumbing")
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)

    candidates = house_builder.get(
        f"/projects/{project_id}/specialist-candidates", params={"category": "Plumbing"}
    ).json()
    assert [row["name"] for row in candidates] == ["plumber"] and candidates[0]["can_request"] is True
    sent = house_builder.post(f"/projects/{project_id}/specialist-request", json={"engineer_id": str(plumber.user.id)})
    assert sent.json()["status"] == "sent", sent.text

    opportunities = site_engineer.get("/engineers/opportunities").json()
    assert [row["project_id"] for row in opportunities] == [project_id]
    assert site_engineer.post(f"/engineers/opportunities/{project_id}/apply").json()["status"] == "applied"
    assert site_engineer.post(f"/engineers/opportunities/{project_id}/apply").status_code == 409

    asked = house_builder.post("/engineers/send-request", json={"engineer_id": str(site_engineer.user.id)})
    assert asked.json()["status"] == "sent"
    relationship = site_engineer.get("/engineers/my-team").json()["incoming_requests"][0]["relationship_id"]
    joined = site_engineer.post(
        "/engineers/join-request/respond", json={"relationship_id": relationship, "action": "ACCEPT"}
    )
    assert joined.json() == {"status": "ACTIVE"}
    other_builder = builder(client, database, "other@example.in", "9876500007")
    request = plumber.post("/engineers/request-join", json={"contractor_id": str(other_builder.user.id)})
    assert request.json()["status"] == "requested", request.text
    pending = other_builder.get("/engineers/my-team").json()["pending_requests"]
    own = plumber.post(
        "/engineers/join-request/respond", json={"relationship_id": pending[0]["relationship_id"], "action": "ACCEPT"}
    )
    assert (own.status_code, detail(own)) == (403, "Only the receiver of a request can accept or reject it.")


def test_suppliers_on_a_project(client: TestClient, database: Session) -> None:
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    supplier = person(client, database, "supplier@example.in", "9876500004", ROLE_SUPPLIER)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    send = {"receiver_id": str(supplier.user.id), "request_type": "CONTRACTOR_TO_SUPPLIER"}
    request_id = house_builder.post("/project-requests/send", json=send).json()["id"]
    supplier.post("/project-requests/accept", json={"request_id": request_id})

    mine = house_builder.get("/contractors/my-suppliers").json()
    assert [row["store_name"] for row in mine] == ["Rao Stores"] and mine[0]["assigned_projects"] == []
    pair = {"supplier_id": str(supplier.user.id), "engineer_id": str(site_engineer.user.id)}
    assigned = house_builder.post(f"/projects/{project_id}/assign-supplier", json=pair)
    assert assigned.json()["status"] == "assigned", assigned.text
    assert [row["name"] for row in site_engineer.get(f"/projects/{project_id}/team-suppliers").json()] == ["supplier"]
    assert [row["title"] for row in supplier.get("/suppliers/my-projects").json()] == ["Rao Residence"]
    assert supplier.get("/suppliers/my-projects").json()[0]["requester"]["role"] == "BUILDER"
    assert house_builder.post(f"/projects/{project_id}/unassign-supplier", json=pair).json()["status"] == "unassigned"
    assert house_owner.get("/contractors/my-suppliers").status_code == 403


def test_a_site_photo_delete(client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    house_owner = owner(client, database)
    assert house_owner.delete(f"/project-photos/{uuid.uuid4()}").status_code == 404
