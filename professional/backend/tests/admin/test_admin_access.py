"""Who reaches the admin API: every /admin route needs an administrator role AND its
permission. Each route is found from the app itself, so a new route is covered too."""

import uuid
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from identity.helpers import create_user
from sqlalchemy.orm import Session

from admin.helpers import create_admin, create_manager, detail, signed_in
from app.modules.admin.dependencies import current_admin
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER

ROLE_ONLY = {"/api/v1/admin/me", "/api/v1/admin/overview"}


def admin_routes(client: TestClient) -> list[tuple[str, str, str | None]]:
    """(method, path with ids filled in, required permission or None) per admin route."""
    found = []
    for route in client.app.routes:  # type: ignore[attr-defined]
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/v1/admin"):
            continue
        permission = None
        for dependency in route.dependant.dependencies:
            permission = permission or getattr(dependency.call, "required_permission", None)
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in sorted(route.methods):
            found.append((method, path, permission))
    return found


def call(client: TestClient, method: str, path: str, headers: dict[str, str]) -> Any:
    if method == "POST" and path.endswith("/ads/image"):
        return client.post(path, headers=headers, files={"file": ("a.png", b"x", "image/png")})
    return client.request(method, path, headers=headers, json={} if method in ("POST", "PATCH", "PUT") else None)


def test_every_admin_route_states_who_may_use_it(client: TestClient) -> None:
    routes = admin_routes(client)
    assert len(routes) == 61  # 35 admin console + 26 Admin > Master Catalog
    for method, path, permission in routes:
        if permission is None:
            assert any(path == role_only for role_only in ROLE_ONLY), f"{method} {path} has no permission"
    # The two role-only routes still resolve the administrator.
    role_only = [r for r in client.app.routes if isinstance(r, APIRoute) and r.path in ROLE_ONLY]  # type: ignore[attr-defined]
    assert all(any(d.call is current_admin for d in r.dependant.dependencies) for r in role_only)


def test_without_a_session_every_admin_route_answers_401(client: TestClient) -> None:
    for method, path, _ in admin_routes(client):
        assert call(client, method, path, {}).status_code == 401, f"{method} {path}"


@pytest.mark.parametrize("role", ["OWNER", ROLE_BUILDER, ROLE_SUPPLIER, ROLE_ENGINEER])
def test_a_non_admin_gets_403_on_every_admin_route(client: TestClient, database: Session, role: str) -> None:
    create_user(database, role=role, email="member@example.in")
    member, headers = signed_in(client, "member@example.in")
    for method, path, _ in admin_routes(client):
        answer = call(member, method, path, headers)
        assert answer.status_code == 403, f"{method} {path}: {answer.status_code} {answer.text}"
        assert detail(answer) == "Administrator access required", f"{method} {path}"


def test_a_manager_without_the_permission_gets_403_on_every_route_that_needs_it(
    client: TestClient, database: Session
) -> None:
    create_manager(database, "audit.view")
    manager, headers = signed_in(client, "manager@example.in")
    for method, path, permission in admin_routes(client):
        if permission is None or permission == "audit.view":
            continue
        answer = call(manager, method, path, headers)
        assert answer.status_code == 403, f"{method} {path}: {answer.status_code}"
        assert detail(answer) == f"This action requires the {permission} permission"
    assert manager.get("/api/v1/admin/audit").status_code == 200
    assert manager.get("/api/v1/admin/me").json()["permissions"] == ["audit.view"]


def test_a_super_admin_holds_every_permission(client: TestClient, database: Session) -> None:
    create_admin(database)
    admin, _ = signed_in(client, "india.admin@example.in")
    me = admin.get("/api/v1/admin/me").json()
    assert me["permissions"] == sorted(me["permission_catalogue"])
    assert me["scope"] == "IN" and me["is_global"] is False and me["phone"] == ""


def test_admin_profile_checks(client: TestClient, database: Session) -> None:
    from app.modules.accounts.models import AdminProfile

    user = create_admin(database)
    admin, _ = signed_in(client, "india.admin@example.in")
    profile = database.query(AdminProfile).filter_by(user_id=user.id).one()
    database.delete(profile)
    database.commit()
    assert detail(admin.get("/api/v1/admin/me")) == "Administrator profile is missing"


def test_a_verification_manager_sees_only_its_screens(client: TestClient, database: Session) -> None:
    create_manager(database, "users.view,verification.view,verification.decide")
    manager, _ = signed_in(client, "manager@example.in")
    expected = {
        "/api/v1/admin/users": 200,
        "/api/v1/admin/verification": 200,
        "/api/v1/admin/projects": 403,
        "/api/v1/admin/leads": 403,
        "/api/v1/admin/admins": 403,
        "/api/v1/admin/audit": 403,
        "/api/v1/admin/reports": 403,
    }
    for path, status in expected.items():
        assert manager.get(path).status_code == status, path
    overview = manager.get("/api/v1/admin/overview").json()
    assert set(overview["attention"]) == {"pending_verifications", "suspended_accounts"}


def test_a_suspended_administrator_gets_the_admin_message(client: TestClient, database: Session) -> None:
    create_admin(database)
    manager_user = create_manager(database, "users.view")
    admin, headers = signed_in(client, "india.admin@example.in")
    manager, _ = signed_in(client, "manager@example.in")
    url = f"/api/v1/admin/admins/{manager_user.id}/deactivate"
    assert admin.post(url, json={"reason": "Left"}, headers=headers).status_code == 200
    for path in ("/api/v1/admin/users", "/api/v1/admin/me", "/api/v1/auth/session"):
        answer = manager.get(path)
        assert answer.status_code == 403, path
        assert detail(answer) == "This administrator account is suspended", path
    # An ordinary suspended account keeps the general text.
    member = create_user(database, email="member@example.in")
    browser, _ = signed_in(client, "member@example.in")
    member.status = "SUSPENDED"
    database.commit()
    assert detail(browser.get("/api/v1/auth/session")) == "This account has been suspended. Contact CREWNBUILD support."
