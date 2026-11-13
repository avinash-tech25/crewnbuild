"""The admin console: accounts and administrators (with the old escalation and
validation checks), verification, reports, announcements, the audit log and the
overview. Project screens answer empty until the projects module is ported."""

import uuid

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from identity.helpers import WHATSAPP_SETTINGS, FakeWhatsApp, create_user, service_overrides
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from admin.helpers import create_admin, create_global_admin, create_manager, signed_in, whatsapp_signed_in
from app.modules.accounts.models import AdminProfile, BuilderProfile
from app.modules.admin.models import AdminAuditLog
from app.modules.identity.models import ROLE_BUILDER, ROLE_MANAGER, User
from app.modules.messaging.models import Notification

PASSWORD = "Crewnbuild!Admin1"


@pytest.fixture
def india(client: TestClient, database: Session) -> tuple[TestClient, dict[str, str], User]:
    user = create_admin(database)
    browser, headers = signed_in(client, "india.admin@example.in")
    return browser, headers, user


def new_admin(email: str, role: str = "MANAGER", scope: str = "IN", permissions: list[str] | None = None) -> dict:
    body = {"name": "Test User", "email": email, "password": PASSWORD, "role": role, "scope": scope}
    if permissions is not None:
        body["permissions"] = permissions
    return body


def audit_actions(database: Session) -> list[str]:
    database.expire_all()
    return list(database.scalars(select(AdminAuditLog.action).order_by(AdminAuditLog.created_at)))


def test_users_list_detail_and_suspension(india, database: Session) -> None:
    admin, headers, _ = india
    builder = create_user(database, role=ROLE_BUILDER, email="builder@example.in", phone="9876500001")
    create_user(database, email="owner@example.in", phone="9876500002")
    listing = admin.get("/api/v1/admin/users").json()
    assert listing["total"] == 2 and listing["scope"] == "IN"
    assert {row["email"] for row in listing["users"]} == {"builder@example.in", "owner@example.in"}
    # The console's old CONTRACTOR filter finds the stored BUILDER.
    builders = admin.get("/api/v1/admin/users", params={"role": "CONTRACTOR"}).json()["users"]
    assert [row["verification_status"] for row in builders] == ["PENDING"]
    assert admin.get("/api/v1/admin/users", params={"country": "Kuwait"}).status_code == 422

    one = admin.get(f"/api/v1/admin/users/{builder.id}").json()
    assert one["profile"]["company_name"] == "Rao Builders" and one["projects_owned"] == []
    assert admin.get(f"/api/v1/admin/users/{uuid.uuid4()}").status_code == 404
    # Crash fixed: a malformed id is a 422, not a 500.
    assert admin.get("/api/v1/admin/users/999999").status_code == 422

    member, _ = signed_in(admin, "builder@example.in")
    assert admin.post(f"/api/v1/admin/users/{builder.id}/suspend", json={}, headers=headers).status_code == 400
    suspended = admin.post(f"/api/v1/admin/users/{builder.id}/suspend", json={"reason": "Fraud"}, headers=headers)
    assert suspended.json() == {"user_id": str(builder.id), "status": "SUSPENDED"}
    assert member.get("/api/v1/auth/session").status_code == 403  # ends existing sessions at once
    assert admin.post(f"/api/v1/admin/users/{builder.id}/reactivate", json={}, headers=headers).status_code == 200
    assert audit_actions(database) == ["user.suspended", "user.reactivated"]


def test_the_old_escalation_checks(make_client: ClientFactory, database: Session) -> None:
    whatsapp = FakeWhatsApp()
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    global_user = create_global_admin(database)
    create_admin(database)
    manager = create_manager(database, "users.view")
    global_admin, global_headers = whatsapp_signed_in(client, whatsapp, "9876500900")
    india, india_headers = signed_in(client, "india.admin@example.in")
    managed, manager_headers = signed_in(client, "manager@example.in")

    def make(browser: TestClient, headers: dict[str, str], body: dict) -> int:
        return browser.post("/api/v1/admin/admins", json=body, headers=headers).status_code

    assert make(global_admin, global_headers, new_admin("a@example.in", "GLOBAL_SUPER_ADMIN", "GLOBAL")) == 403
    assert make(india, india_headers, new_admin("b@example.in", "LOCATION_SUPER_ADMIN")) == 403
    assert make(india, india_headers, new_admin("c@example.in", permissions=["admins.manage"])) == 403
    assert make(india, india_headers, new_admin("d@example.in", permissions=["everything.all"])) == 400
    assert make(managed, manager_headers, new_admin("e@example.in", permissions=["users.view"])) == 403
    assert make(india, india_headers, new_admin("f@example.in", scope="KU", permissions=["users.view"])) == 422
    url = f"/api/v1/admin/admins/{global_user.id}/deactivate"
    assert india.post(url, json={"reason": "x"}, headers=india_headers).status_code == 403
    url = f"/api/v1/admin/users/{manager.id}/suspend"
    assert india.post(url, json={"reason": "x"}, headers=india_headers).status_code == 400

    # Validation.
    weak = {**new_admin("g@example.in", permissions=["users.view"]), "password": "abc"}
    assert make(india, india_headers, weak) == 422
    assert make(india, india_headers, new_admin("h@example.in", permissions=[])) == 400

    # A Global Super Admin creates a Location Super Admin; the account and its entry land together.
    created = global_admin.post(
        "/api/v1/admin/admins", json=new_admin("loc@example.in", "LOCATION_SUPER_ADMIN"), headers=global_headers
    )
    assert created.status_code == 201, created.text
    assert created.json()["scope"] == "IN" and created.json()["permissions"] == []
    # R6: the refused manager request above is in the log too (AZ-05).
    assert audit_actions(database) == ["access.denied", "admin.created"]
    assert make(global_admin, global_headers, new_admin("LOC@example.in", "LOCATION_SUPER_ADMIN")) == 409


def test_managing_a_manager(india, client: TestClient, database: Session) -> None:
    admin, headers, _ = india
    created = admin.post(
        "/api/v1/admin/admins", json=new_admin("ops@example.in", permissions=["users.view"]), headers=headers
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["user_id"]
    presets = admin.get("/api/v1/admin/manager-presets").json()
    assert [preset["key"] for preset in presets["presets"]] == ["VERIFICATION", "OPERATIONS", "ADVERTS"]
    assert "admins.manage" not in {entry["key"] for entry in presets["permissions"]}

    url = f"/api/v1/admin/admins/{user_id}"
    assert admin.patch(url, json={}, headers=headers).status_code == 400  # nothing changed
    changed = admin.patch(url, json={"permissions": ["users.view", "reports.view"], "reason": "More"}, headers=headers)
    assert changed.json()["permissions"] == ["reports.view", "users.view"]
    assert admin.post(f"{url}/deactivate", json={"reason": "Left"}, headers=headers).json()["status"] == "SUSPENDED"
    ops, _ = TestClient(client.app, headers={"Origin": "http://localhost:5173"}), None
    assert ops.post("/api/v1/auth/login", json={"email": "ops@example.in", "password": PASSWORD}).status_code == 403
    assert admin.post(f"{url}/reactivate", json={}, headers=headers).json()["status"] == "ACTIVE"
    listing = admin.get("/api/v1/admin/admins").json()["admins"]
    assert {row["email"] for row in listing} == {"india.admin@example.in", "ops@example.in"}
    assert admin.post(f"/api/v1/admin/admins/{uuid.uuid4()}/deactivate", json={}, headers=headers).status_code == 404
    assert audit_actions(database) == ["admin.created", "admin.updated", "admin.deactivated", "admin.reactivated"]
    entry = admin.get("/api/v1/admin/audit", params={"action": "admin.updated"}).json()
    assert entry["total"] == 1 and entry["entries"][0]["reason"] == "More"
    assert admin.get("/api/v1/admin/audit", params={"date_from": "12-11-2026"}).status_code == 400


def test_the_audit_log_is_append_only(india, database: Session) -> None:
    admin, headers, _ = india
    builder = create_user(database, role=ROLE_BUILDER, email="builder@example.in")
    admin.post(f"/api/v1/admin/users/{builder.id}/suspend", json={"reason": "Check"}, headers=headers)
    for statement in (
        "UPDATE professional.admin_audit_logs SET summary = 'tampered'",
        "DELETE FROM professional.admin_audit_logs",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            database.execute(text(statement))
        database.rollback()
    assert audit_actions(database) == ["user.suspended"]


def test_verification_queue_and_decision(india, database: Session) -> None:
    admin, headers, _ = india
    builder = create_user(database, role=ROLE_BUILDER, email="builder@example.in")
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    profile.documents = "Licence: /files/abc, /files/def"
    database.commit()
    pending = admin.get("/api/v1/admin/verification").json()
    assert pending["total"] == 1
    assert pending["accounts"][0]["documents"] == [
        {"label": "Licence", "url": "/files/abc"},
        {"label": "Document", "url": "/files/def"},
    ]
    url = f"/api/v1/admin/verification/{builder.id}"
    assert admin.post(url, json={"status": "REJECTED"}, headers=headers).status_code == 400
    assert admin.post(url, json={"status": "MAYBE"}, headers=headers).status_code == 400
    approved = admin.post(url, json={"status": "APPROVED", "expires_on": "2030-01-31"}, headers=headers)
    assert approved.json()["verified"] is True
    assert admin.get("/api/v1/admin/verification").json()["total"] == 0
    assert admin.get("/api/v1/admin/verification", params={"state": "APPROVED"}).json()["total"] == 1
    notice = database.scalars(select(Notification).where(Notification.user_id == builder.id)).one()
    assert notice.title == "Your account is verified" and "31 January 2030" in notice.body
    assert audit_actions(database) == ["verification.approved"]


def test_reports_are_resolved(india, client: TestClient, database: Session) -> None:
    admin, headers, _ = india
    create_user(database, email="reporter@example.in")
    subject = create_user(database, email="subject@example.in", name="Ravi")
    reporter, reporter_headers = signed_in(client, "reporter@example.in")
    report = {
        "subject_type": "user",
        "subject_id": str(subject.id),
        "category": "CONDUCT",
        "description": "Was rude on site.",
    }
    report_id = reporter.post("/api/v1/reports", json=report, headers=reporter_headers).json()["id"]

    assert admin.get("/api/v1/admin/reports", params={"status": "OPEN"}).json()["total"] == 1
    url = f"/api/v1/admin/reports/{report_id}"
    assert admin.post(url, json={"status": "RESOLVED"}, headers=headers).status_code == 400
    resolved = admin.post(url, json={"status": "RESOLVED", "note": "Warned the builder."}, headers=headers)
    assert resolved.json()["status"] == "RESOLVED" and resolved.json()["resolution_note"] == "Warned the builder."
    assert (
        admin.post(f"/api/v1/admin/reports/{uuid.uuid4()}", json={"status": "NEW"}, headers=headers).status_code == 404
    )
    # Crash fixed: the old integer id route answered 500 for a UUID; a malformed id is now 422.
    assert admin.post("/api/v1/admin/reports/1", json={"status": "NEW"}, headers=headers).status_code == 422
    assert audit_actions(database) == ["report.resolved"]


def test_announcements(india, database: Session) -> None:
    admin, headers, _ = india
    builder = create_user(database, role=ROLE_BUILDER, email="builder@example.in")
    create_user(database, email="owner@example.in")
    audiences = admin.get("/api/v1/admin/notifications").json()["audiences"]
    assert audiences["CONTRACTOR"] == {"label": "Builders", "size": 1}
    assert audiences["ALL"]["size"] == 2  # administrators are not an audience
    body = {"audience": "CONTRACTOR", "title": "Site safety", "body": "Helmets on every site from Monday."}
    sent = admin.post("/api/v1/admin/notifications", json=body, headers=headers)
    assert sent.status_code == 201 and sent.json() == {
        "audience": "CONTRACTOR",
        "recipients": 1,
        "title": "Site safety",
    }
    assert database.scalars(select(Notification.user_id)).all() == [builder.id]
    assert admin.post("/api/v1/admin/notifications", json={**body, "audience": "X"}, headers=headers).status_code == 400
    seen = admin.get("/api/v1/admin/notifications").json()
    assert seen["total"] == 1 and seen["notifications"][0]["recipient_role"] == ROLE_BUILDER
    assert audit_actions(database) == ["announcement.sent"]


def test_overview_and_project_screens(make_client: ClientFactory, database: Session) -> None:
    whatsapp = FakeWhatsApp()
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    create_global_admin(database)
    create_user(database, role=ROLE_BUILDER, email="builder@example.in", status="SUSPENDED")
    admin, _ = whatsapp_signed_in(client, whatsapp, "9876500900")
    overview = admin.get("/api/v1/admin/overview").json()
    assert overview["is_global"] is True
    assert overview["attention"]["suspended_accounts"] == 1 and overview["attention"]["stalled_requests"] == 0
    assert overview["attention_by_country"]["IN"]["suspended_accounts"] == 1
    assert overview["countries"][0]["accounts"] == 1 and overview["countries"][0]["administrators"] == 0
    narrowed = admin.get("/api/v1/admin/overview", params={"country": "India"}).json()
    assert narrowed["attention_by_country"] is None
    assert admin.get("/api/v1/admin/projects").json()["projects"] == []
    assert admin.get("/api/v1/admin/leads").json()["requests"] == []
    assert admin.get(f"/api/v1/admin/projects/{uuid.uuid4()}").status_code == 404
    me = admin.get("/api/v1/admin/me").json()
    assert me["is_global"] is True and me["phone"] == "9876500900"


def test_an_administrator_phone_change_is_audited(database: Session) -> None:
    from app.modules.admin.audit_log import record_admin_action

    manager = create_admin(database, role=ROLE_MANAGER, permissions="users.view")
    record_admin_action(
        database, manager, "admin.phone_changed", "Changed own sign-in mobile number", "user", manager.id
    )
    database.commit()
    entry = database.scalars(select(AdminAuditLog)).one()
    assert (entry.action, entry.scope, entry.target_id) == ("admin.phone_changed", "IN", str(manager.id))
    assert database.scalars(select(AdminProfile)).one().user_id == manager.id
