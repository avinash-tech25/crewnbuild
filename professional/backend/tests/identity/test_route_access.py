"""Every route is private unless listed in PUBLIC_ROUTES (AZ-01); role and permission
checks; the builder checkout rule; the account's own session list (off by default)."""

import pytest
from conftest import ClientFactory
from fastapi import Depends, FastAPI, HTTPException
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.router import MODULE_ROUTERS
from app.auth.dependencies import Principal, require_permission, require_roles
from app.auth.permissions import HANDOFF_CREATE
from app.auth.public_routes import PUBLIC_ROUTES
from app.modules.accounts.models import BuilderProfile
from app.modules.identity.models import ROLE_BUILDER
from identity.helpers import create_user, sign_in


def module_routes() -> list[tuple[str, str]]:
    routes = []
    for router in MODULE_ROUTERS:
        # Included sub-routers are listed through iter_route_contexts (FastAPI 0.16x).
        for context in iter_route_contexts(router.routes):
            assert isinstance(context.route, APIRoute)
            routes.extend((method, context.path) for method in sorted(context.methods or ()))
    return routes


def test_every_public_route_exists() -> None:
    assert set(module_routes()) >= PUBLIC_ROUTES


def test_every_other_route_needs_a_session(client: TestClient, database: Session) -> None:
    private = [route for route in module_routes() if route not in PUBLIC_ROUTES]
    assert private, "expected private routes"
    for method, path in private:
        url = "/api/v1" + path.replace("{session_id}", "00000000-0000-7000-8000-000000000000")
        response = client.request(method, url, json={})
        assert response.status_code == 401, (method, path, response.status_code)


def test_require_roles_and_permission() -> None:
    with pytest.raises(ValueError, match="Unknown permission"):
        require_permission("nothing:here")

    app = FastAPI()

    def fake_principal(role: str) -> Principal:
        return Principal(
            user=None,
            session=None,
            role=role,
            permissions=frozenset({HANDOFF_CREATE}) if role == "OWNER" else frozenset(),
        )  # type: ignore[arg-type]

    @app.get("/owners")
    def owners_only(principal: Principal = Depends(require_roles("OWNER"))) -> dict[str, str]:
        return {"role": principal.role}

    @app.get("/handoff")
    def handoff(principal: Principal = Depends(require_permission(HANDOFF_CREATE))) -> dict[str, str]:
        return {"role": principal.role}

    from app.auth.dependencies import current_principal

    for role, expected in (("OWNER", 200), ("BUILDER", 403)):
        app.dependency_overrides[current_principal] = lambda role=role: fake_principal(role)
        client = TestClient(app)
        assert client.get("/owners").status_code == expected
        assert client.get("/handoff").status_code == expected


def test_a_builder_with_an_unpaid_plan_may_only_use_onboarding_routes(
    make_client: ClientFactory, database: Session
) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    pem = (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        .decode()
    )
    builder = create_user(database, role=ROLE_BUILDER)
    profile = database.query(BuilderProfile).filter(BuilderProfile.user_id == builder.id).one()
    profile.signup_plan_code, profile.signup_duration_code = "BUSINESS", "ANNUAL"
    database.commit()

    client = make_client(partner_handoff_private_key=pem)
    response = client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": "Strong#Pass123"})
    assert response.json()["user"]["subscription_checkout"] == {"plan_code": "BUSINESS", "duration_code": "ANNUAL"}
    csrf = response.json()["csrf_token"]
    assert client.get("/api/v1/auth/session").status_code == 200
    refused = client.post("/api/v1/auth/partner-handoff", headers={"X-CSRF-Token": csrf})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "SUBSCRIPTION_CHECKOUT_REQUIRED"


def test_session_list_is_off_by_default(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    assert client.get("/api/v1/auth/sessions").status_code == 404


def test_session_list_and_revoke_when_switched_on(make_client: ClientFactory, database: Session) -> None:
    create_user(database, email="asha@example.in")
    create_user(database, email="ravi@example.in", name="Ravi")
    laptop = make_client(session_list_enabled=True)
    phone = TestClient(laptop.app, headers={"Origin": "http://localhost:5173"})
    other = TestClient(laptop.app, headers={"Origin": "http://localhost:5173"})
    csrf = sign_in(laptop)
    sign_in(phone)
    other_csrf = sign_in(other, identifier="ravi@example.in")

    listed = laptop.get("/api/v1/auth/sessions").json()["items"]
    assert len(listed) == 2
    assert sum(item["is_current"] for item in listed) == 1
    phone_session = next(item for item in listed if not item["is_current"])

    # Another account cannot end it: 404, not 403.
    assert (
        other.delete(f"/api/v1/auth/sessions/{phone_session['id']}", headers={"X-CSRF-Token": other_csrf}).status_code
        == 404
    )
    ended = laptop.delete(f"/api/v1/auth/sessions/{phone_session['id']}", headers={"X-CSRF-Token": csrf})
    assert ended.status_code == 200
    assert phone.get("/api/v1/auth/session").status_code == 401
    assert laptop.get("/api/v1/auth/session").status_code == 200


def test_http_exception_keeps_the_detail_body() -> None:
    # Errors keep the {"detail": ...} shape until R7.
    app = FastAPI()

    @app.get("/x")
    def refuse() -> None:
        raise HTTPException(status_code=409, detail="nope")

    assert TestClient(app).get("/x").json() == {"detail": "nope"}


def test_the_access_gate_reads_the_served_path_of_a_nested_route(make_client: ClientFactory, database: Session) -> None:
    """FastAPI 0.16x: a route inside a nested router is checked under its full served path,
    so it can never pass for a public route that happens to share its inner path."""
    from fastapi import APIRouter

    from app.auth.dependencies import enforce_route_access

    client = make_client()
    outer = APIRouter(prefix="/zz-nested", dependencies=[Depends(enforce_route_access)])
    inner = APIRouter(prefix="/auth")

    @inner.post("/login")  # the inner path equals the public POST /auth/login
    def look_alike() -> dict[str, bool]:
        return {"reached": True}

    outer.include_router(inner)
    client.app.include_router(outer, prefix="/api/v1")  # type: ignore[attr-defined]
    answer = client.post("/api/v1/zz-nested/auth/login")
    assert answer.status_code == 401
