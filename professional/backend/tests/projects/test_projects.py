"""Projects: creating and reading a project, who else may (the old 403/404 answers), the
quotation -> award -> contract run, teams and Site Engineers, the daily timeline, and
deleting an unstarted project."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_SUPPLIER
from app.modules.projects import daily_window
from app.modules.projects.models import EscrowMilestone, ProjectRequest
from projects.helpers import PROJECT, award, builder, create_project, engineer, owner, person

THURSDAY_MORNING = datetime(2026, 11, 12, 10, 0, tzinfo=timezone(timedelta(minutes=330)))


def detail(response) -> str:  # type: ignore[no-untyped-def]
    return response.json()["detail"]


def test_an_owner_creates_lists_and_reads_a_project(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    refused = house_owner.post("/projects/create", json={**PROJECT, "start_date": None})
    assert (refused.status_code, detail(refused)) == (422, "Enter both the project start date and end date")
    project = create_project(house_owner)
    assert project["contractor_id"] is None and project["budget"] == 1000000.0
    milestones = database.scalars(select(EscrowMilestone).order_by(EscrowMilestone.sort_order)).all()
    assert [(m.name, float(m.amount)) for m in milestones] == [
        ("Foundation", 250000.0),
        ("Structure", 450000.0),
        ("Finishing", 300000.0),
    ]
    listed = house_owner.get("/owners/projects").json()
    assert [row["id"] for row in listed] == [project["id"]]
    assert listed[0]["owner_name"] == "owner" and listed[0]["contract_status"] == "none"
    assert listed[0]["schedule_status"] in ("not_started", "in_progress")
    read = house_owner.get(f"/projects/{project['id']}").json()
    assert read["title"] == "Rao Residence" and read["original_budget"] == 1000000.0
    edited = house_owner.patch(f"/projects/{project['id']}/requirement", json={**PROJECT, "title": "Rao Villa"})
    assert edited.json()["title"] == "Rao Villa"


def test_others_get_the_old_answers(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    project_id = create_project(house_owner)["id"]
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    some_builder = builder(client, database)
    site_engineer = engineer(client, database)
    supplier = person(client, database, "supplier@example.in", "9876500004", ROLE_SUPPLIER)
    missing = uuid.uuid4()

    for who in (stranger, some_builder, site_engineer):
        answer = who.get(f"/projects/{project_id}")
        assert (answer.status_code, detail(answer)) == (403, "Project activity access denied")
        assert who.get(f"/timelines/project/{project_id}").status_code == 403
    assert (stranger.get(f"/projects/{missing}").status_code, detail(stranger.get(f"/projects/{missing}"))) == (
        404,
        "Project not found",
    )
    assert stranger.get("/projects/12").status_code == 422  # a malformed id
    edit = stranger.patch(f"/projects/{project_id}/requirement", json=PROJECT)
    assert (edit.status_code, detail(edit)) == (403, "Only the project owner can edit requirements")
    deleted = stranger.delete(f"/projects/{project_id}")
    assert (deleted.status_code, detail(deleted)) == (404, "Project not found")
    photos = stranger.get(f"/projects/{project_id}/photos")
    assert (photos.status_code, detail(photos)) == (403, "Project photo access denied")
    award_view = site_engineer.get(f"/projects/{project_id}/award")
    assert (award_view.status_code, detail(award_view)) == (403, "Assignment access denied")
    team = some_builder.get(f"/projects/{project_id}/specialist-team")
    assert (team.status_code, detail(team)) == (403, "Only assigned builder can manage this project")
    suppliers = supplier.get(f"/projects/{project_id}/suppliers")
    assert (suppliers.status_code, detail(suppliers)) == (403, "Access denied")
    engineer_view = stranger.get(f"/projects/{project_id}/engineer")
    assert (engineer_view.status_code, detail(engineer_view)) == (403, "You do not have access to this project")
    progress = house_owner.patch(f"/projects/{project_id}/progress", json={"completion_percentage": 10})
    assert progress.status_code == 403  # only an assigned Site Engineer, then 410
    assert some_builder.get("/owners/projects").json() == []  # a quotation is not an award


def test_quotation_award_and_contract(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    rival = builder(client, database, "rival@example.in", "9876500005")
    project_id = create_project(house_owner)["id"]
    contract = award(house_owner, house_builder, project_id)
    assert contract["contract_amount"] == 900000.0 and contract["escrow_resized"] is True
    milestones = database.scalars(select(EscrowMilestone).order_by(EscrowMilestone.sort_order)).all()
    assert [float(m.amount) for m in milestones] == [225000.0, 405000.0, 270000.0]

    board = house_builder.get("/owners/projects").json()
    assert [row["id"] for row in board] == [project_id] and board[0]["contract_amount"] == 900000.0
    assert house_builder.get(f"/projects/{project_id}").status_code == 200
    assert rival.get(f"/projects/{project_id}").status_code == 403
    panel = house_owner.get(f"/projects/{project_id}/award").json()["award"]
    assert panel["phase"] == "contract_confirmed" and panel["assigned"] is True and panel["actions"] == ["unassign"]
    again = rival.post(
        "/project-requests/send",
        json={"receiver_id": str(house_owner.user.id), "project_id": project_id, "request_type": "CONTRACTOR_TO_OWNER",
              "quotation_amount": 1},
    )  # fmt: skip
    assert (again.status_code, detail(again)) == (400, "This project already has a builder")
    blocked = house_owner.delete(f"/projects/{project_id}")
    assert (blocked.status_code, detail(blocked)) == (
        409,
        "This project has an assigned builder and cannot be deleted.",
    )


def test_request_rules_and_private_contact(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    send = {"receiver_id": str(house_builder.user.id), "project_id": project_id, "request_type": "OWNER_TO_CONTRACTOR"}
    assert detail(house_owner.post("/project-requests/send", json={**send, "request_type": "ANYTHING"})) == (
        "Unsupported request type"
    )
    to_self = house_owner.post("/project-requests/send", json={**send, "receiver_id": str(house_owner.user.id)})
    assert (to_self.status_code, detail(to_self)) == (400, "You cannot send a request to yourself")
    request_id = house_owner.post("/project-requests/send", json=send).json()["id"]
    duplicate = house_owner.post("/project-requests/send", json=send)
    assert (duplicate.status_code, detail(duplicate)) == (409, "Request already sent")

    incoming = house_builder.get("/project-requests/incoming").json()
    assert incoming[0]["profile_phone"] == "" and incoming[0]["can_view_contact"] is False
    no_quote = house_builder.post("/project-requests/accept", json={"request_id": request_id})
    assert (no_quote.status_code, detail(no_quote)) == (400, "Quotation amount is required")
    house_builder.post("/project-requests/accept", json={"request_id": request_id, "quotation_amount": 5})
    incoming = house_builder.get("/project-requests/incoming").json()
    assert incoming[0]["profile_phone"] == "9876500001" and incoming[0]["status"] == "accepted"
    assert incoming[0]["property_listing_id"] is None
    again = house_builder.post("/project-requests/reject", json={"request_id": request_id})
    assert (again.status_code, detail(again)) == (409, "This request has already been accepted.")
    foreign = house_owner.post("/project-requests/reject", json={"request_id": request_id})
    assert foreign.status_code == 404  # only the receiver answers


def test_a_team_engineer_on_an_awarded_project(client: TestClient, database: Session) -> None:
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    invitation = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()
    joined = site_engineer.post("/engineers/join-team", json={"invite_code": invitation["invite_code"]})
    assert joined.json()["status"] == "joined", joined.text
    team = house_builder.get("/engineers/my-team").json()
    assert [row["name"] for row in team["active"]] == ["engineer"] and team["invitations"] == []

    assigned = house_builder.post(
        f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)}
    )
    assert assigned.json()["status"] == "assigned", assigned.text
    assert site_engineer.get(f"/projects/{project_id}").status_code == 200
    mine = site_engineer.get("/engineers/my-projects").json()
    assert [row["id"] for row in mine] == [project_id] and mine[0]["contract_amount"] == 900000.0
    assert house_owner.get(f"/projects/{project_id}/engineer").json()["engineer"]["name"] == "engineer"

    second = create_project(house_owner, title="Second site")["id"]
    database.execute(ProjectRequest.__table__.update().values(status="accepted"))  # no-op for the rule below
    busy = house_builder.post(f"/projects/{second}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    assert busy.status_code == 403  # the second project is not awarded to this builder
    removed = house_owner.delete(f"/projects/{project_id}")
    assert removed.status_code == 409


def test_the_daily_timeline(client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})

    form = {"title": "Footings", "description": "Poured.", "date": "2026-11-12", "completion_status": "active"}
    url = f"/timelines/create?project_id={project_id}"
    closed = site_engineer.post(url, data={**form, "date": "2026-11-11"})
    assert closed.status_code == 409
    saved = site_engineer.post(url, data=form)
    assert saved.status_code == 200, saved.text
    assert saved.json()["date"] == "2026-11-12T00:00:00" and saved.json()["created_by_name"] == "engineer"
    entries = house_owner.get(f"/timelines/project/{project_id}").json()
    assert [entry["title"] for entry in entries] == ["Footings"]
    assert house_builder.get(f"/timelines/project/{project_id}").status_code == 200
    builder_write = house_builder.post(url, data=form)
    assert builder_write.status_code == 403
    gone = site_engineer.patch(f"/projects/{project_id}/progress", json={"completion_percentage": 10})
    assert gone.status_code == 410


def test_an_unstarted_project_is_deleted_with_its_requests(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    house_owner.post(
        "/project-requests/send",
        json={
            "receiver_id": str(house_builder.user.id),
            "project_id": project_id,
            "request_type": "OWNER_TO_CONTRACTOR",
        },
    )
    assert house_owner.delete(f"/projects/{project_id}").json() == {"deleted": True, "project_id": project_id}
    database.expire_all()
    assert database.scalars(select(ProjectRequest)).all() == []
    assert database.scalars(select(EscrowMilestone)).all() == []
    assert house_owner.get(f"/projects/{project_id}").status_code == 404


def test_bad_input_answers_4xx_not_500(client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    house_owner, house_builder = owner(client, database), builder(client, database)
    site_engineer = engineer(client, database)
    revoke = house_builder.post("/engineers/invite/revoke", json={"invitation_id": "not-an-id"})
    assert (revoke.status_code, detail(revoke)) == (404, "Invitation not found or already processed.")
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    form = {"title": "x", "description": "y", "date": "12/11/2026", "completion_status": "active"}
    bad_date = site_engineer.post(f"/timelines/create?project_id={project_id}", data=form)
    assert (bad_date.status_code, detail(bad_date)) == (422, "Enter a valid activity date")
