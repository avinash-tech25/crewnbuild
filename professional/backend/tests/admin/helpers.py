"""Administrators for the admin tests, and signing in as one."""

from typing import Any

from fastapi.testclient import TestClient
from identity.helpers import FakeWhatsApp, create_user, sign_in
from sqlalchemy.orm import Session

from app.modules.accounts.models import AdminProfile
from app.modules.identity.models import ROLE_GLOBAL_SUPER_ADMIN, ROLE_LOCATION_SUPER_ADMIN, ROLE_MANAGER, User

ORIGIN = {"Origin": "http://localhost:5173"}


def create_admin(
    database: Session,
    *,
    role: str = ROLE_LOCATION_SUPER_ADMIN,
    scope: str = "IN",
    permissions: str = "",
    email: str = "india.admin@example.in",
    name: str = "India Admin",
    phone: str = "",
) -> User:
    user = create_user(database, role=role, email=email, name=name)
    database.add(AdminProfile(user_id=user.id, scope=scope, permissions=permissions, phone=phone))
    database.commit()
    return user


def create_manager(database: Session, permissions: str, email: str = "manager@example.in") -> User:
    return create_admin(database, role=ROLE_MANAGER, permissions=permissions, email=email, name="India Manager")


def create_global_admin(database: Session, phone: str = "9876500900") -> User:
    return create_admin(
        database, role=ROLE_GLOBAL_SUPER_ADMIN, scope="GLOBAL", email="global@example.in", name="Global", phone=phone
    )


def browser(client: TestClient) -> TestClient:
    """Another browser on the same app, with its own cookies."""
    return TestClient(client.app, headers=ORIGIN)


def signed_in(client: TestClient, email: str) -> tuple[TestClient, dict[str, str]]:
    """A new browser signed in with a password, and the CSRF header for its writes."""
    other = browser(client)
    return other, {"X-CSRF-Token": sign_in(other, identifier=email)}


def whatsapp_signed_in(client: TestClient, whatsapp: FakeWhatsApp, phone: str) -> tuple[TestClient, dict[str, str]]:
    """The Global Super Admin signs in only with a WhatsApp code."""
    other = browser(client)
    assert other.post("/api/v1/auth/phone/login/send-code", json={"phone": phone}).status_code == 200
    answer = other.post("/api/v1/auth/phone/login/verify-code", json={"phone": phone, "code": whatsapp.last_code()})
    assert answer.status_code == 200, answer.text
    return other, {"X-CSRF-Token": answer.json()["csrf_token"]}


def detail(response: Any) -> Any:
    return response.json().get("detail")
