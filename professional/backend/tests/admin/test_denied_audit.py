"""Refused administrator requests are written to the audit log (AZ-05; R6, porting-todo #42)."""

from fastapi.testclient import TestClient
from identity.helpers import create_user, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from admin.helpers import create_manager, signed_in
from app.modules.admin.models import AdminAuditLog


def denied(database: Session) -> list[AdminAuditLog]:
    database.expire_all()
    return list(
        database.scalars(
            select(AdminAuditLog).where(AdminAuditLog.action == "access.denied").order_by(AdminAuditLog.created_at)
        )
    )


def test_an_ordinary_account_refused_by_the_admin_api_is_logged(client: TestClient, database: Session) -> None:
    owner = create_user(database)
    sign_in(client)
    answer = client.get("/api/v1/admin/users")
    assert (answer.status_code, answer.json()) == (403, {"detail": "Administrator access required"})
    [entry] = denied(database)
    assert (entry.actor_id, entry.actor_role, entry.scope) == (owner.id, "OWNER", "NONE")
    assert entry.target_type == "route" and entry.target_id == "/api/v1/admin/users"
    assert entry.summary == "GET /api/v1/admin/users refused: Administrator access required"


def test_a_missing_permission_is_logged_under_the_admins_scope(client: TestClient, database: Session) -> None:
    manager = create_manager(database, permissions="users.view")
    browser, _headers = signed_in(client, "manager@example.in")
    assert browser.get("/api/v1/admin/reports").status_code == 403
    [entry] = denied(database)
    assert (entry.actor_id, entry.scope) == (manager.id, "IN")
    assert "requires the reports." in entry.summary


def test_a_retry_loop_writes_one_entry_a_minute(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    for _ in range(5):
        assert client.get("/api/v1/admin/users").status_code == 403
    assert client.get("/api/v1/admin/reports").status_code == 403  # another route: its own entry
    assert [entry.target_id for entry in denied(database)] == ["/api/v1/admin/users", "/api/v1/admin/reports"]


def test_signed_out_requests_are_not_logged(client: TestClient, database: Session) -> None:
    assert client.get("/api/v1/admin/users").status_code == 401
    assert denied(database) == []
