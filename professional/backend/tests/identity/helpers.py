"""Shared builders for the identity tests: accounts, sign-in, and fakes for the outside
services (e-mail, WhatsApp)."""

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security.password_hashing import hash_secret
from app.integrations.whatsapp.dovesoft_client import SendOutcome, SendResult
from app.modules.accounts.models import AdminProfile, BuilderProfile, EngineerProfile, OwnerProfile
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User

STRONG_PASSWORD = "Strong#Pass123"


def create_user(
    database: Session,
    *,
    role: str = ROLE_OWNER,
    name: str = "Asha Rao",
    email: str | None = "asha@example.in",
    phone: str = "",
    password: str = STRONG_PASSWORD,
    password_hash: str | None = None,
    status: str = "ACTIVE",
    specialization: str | None = None,
    admin_phone: str | None = None,
) -> User:
    user = User(
        name=name,
        email=email,
        email_verified_at=datetime.now(UTC) if email else None,
        phone=phone,
        password_hash=password_hash or hash_secret(password),
        role=role,
        status=status,
        address="12 MG Road, Bengaluru",
        pincode="560001",
    )
    database.add(user)
    database.flush()
    if role == ROLE_OWNER:
        database.add(OwnerProfile(user_id=user.id))
    elif role == ROLE_BUILDER:
        database.add(BuilderProfile(user_id=user.id, company_name="Rao Builders"))
    elif role == ROLE_ENGINEER:
        database.add(EngineerProfile(user_id=user.id, specialization=specialization))
    if admin_phone is not None:
        database.add(AdminProfile(user_id=user.id, scope="GLOBAL", phone=admin_phone))
    database.commit()
    database.refresh(user)
    return user


def sign_in(client: TestClient, identifier: str = "asha@example.in", password: str = STRONG_PASSWORD) -> str:
    """Password sign-in; returns the CSRF token from the answer."""
    response = client.post("/api/v1/auth/login", json={"email": identifier, "password": password})
    assert response.status_code == 200, response.text
    token: str = response.json()["csrf_token"]
    return token


@dataclass
class FakeEmailSender:
    """Records every message instead of sending it."""

    configured: bool = True
    sent: list[dict[str, str]] = field(default_factory=list)

    def send_email(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        self.sent.append({"to": to_email, "subject": subject, "text": text_body})
        return self.configured

    def send_welcome_email(self, to_email: str, name: str | None = None) -> bool:
        return self.send_email(to_email, "Welcome to CREWNBUILD", "welcome")

    def last_code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.sent[-1]["text"])
        assert match, "no code in the last message"
        return match.group(1)


@dataclass
class FakeWhatsApp:
    """Records each send; answers `outcome`."""

    outcome: SendOutcome = SendOutcome.ACCEPTED
    http_status: int | None = 200
    sent: list[dict[str, Any]] = field(default_factory=list)

    def send(self, phone: str, template: str, variables: list[str], language: str | None = None) -> SendResult:
        self.sent.append({"phone": phone, "template": template, "variables": variables})
        return SendResult(self.outcome, self.http_status)

    def last_code(self) -> str:
        return str(self.sent[-1]["variables"][0])


WHATSAPP_SETTINGS: dict[str, Any] = {
    "whatsapp_enabled": True,
    "whatsapp_signup_otp_enabled": True,
    "whatsapp_api_url": "https://whatsapp.example.test/send",
    "whatsapp_api_key": "test-key",
    "whatsapp_waba_number": "919999999999",
    "whatsapp_otp_template": "otp_template",
    "whatsapp_auth_header": "Key",
    "whatsapp_success_field": "messages[0].message_status",
    "whatsapp_success_value": "accepted",
}


def service_overrides(email: FakeEmailSender | None = None, whatsapp: FakeWhatsApp | None = None) -> dict[Any, Any]:
    """dependency_overrides that swap the outside services for the fakes."""
    from fastapi import Depends

    from app.auth.dependencies import app_settings
    from app.core.config import Settings
    from app.database.session import get_db
    from app.modules.identity.phone_verification_service import PhoneVerificationService
    from app.modules.identity.router import get_email_sender, get_phone_verification_service

    overrides: dict[Any, Any] = {}
    if email is not None:
        overrides[get_email_sender] = lambda: email
    if whatsapp is not None:

        def phone_service(
            database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
        ) -> PhoneVerificationService:
            return PhoneVerificationService(database, settings, whatsapp=whatsapp)  # type: ignore[arg-type]

        overrides[get_phone_verification_service] = phone_service
    return overrides
