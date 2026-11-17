"""Sign-up records the Terms of Service and Privacy Policy accepted (app/core/legal.py):
refused with 422 without them or with an old version; stored with the server's time."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.legal import PRIVACY_VERSION, TERMS_VERSION
from app.modules.identity.models import User
from identity.helpers import (
    CONSENT,
    STRONG_PASSWORD,
    WHATSAPP_SETTINGS,
    FakeEmailSender,
    FakeWhatsApp,
    create_user,
    service_overrides,
    sign_in,
)

EMAIL = "neha@example.in"


@pytest.fixture
def mailbox() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def mail_client(make_client: ClientFactory, mailbox: FakeEmailSender) -> TestClient:
    return make_client(overrides=service_overrides(email=mailbox))


def sign_up(client: TestClient, mailbox: FakeEmailSender, **consent: Any) -> Any:
    client.post("/api/v1/auth/email/send-code", json={"email": EMAIL})
    client.post("/api/v1/auth/email/verify-code", json={"email": EMAIL, "code": mailbox.last_code()})
    body = {"name": "Neha", "email": EMAIL, "password": STRONG_PASSWORD, "role": "OWNER", **consent}
    return client.post("/api/v1/auth/signup", json={name: value for name, value in body.items() if value is not None})


def problems(response: Any) -> dict[str, tuple[str, str]]:
    """The 422 field errors, {field: (type, msg)}, in the API's validation shape."""
    assert response.status_code == 422, response.text
    return {problem["loc"][-1]: (problem["type"], problem["msg"]) for problem in response.json()["detail"]}


def no_account(database: Session) -> bool:
    database.expire_all()
    return database.scalars(select(User)).first() is None


@pytest.mark.parametrize(
    ("consent", "field", "error_type"),
    [
        ({"accept_terms": None}, "accept_terms", "missing"),
        ({"accept_terms": False}, "accept_terms", "terms_not_accepted"),
        ({"accept_terms": "yes"}, "accept_terms", "bool_type"),
        ({"terms_version": None}, "terms_version", "missing"),
        ({"privacy_version": None}, "privacy_version", "missing"),
    ],
)
def test_sign_up_without_acceptance_is_refused(
    mail_client: TestClient,
    mailbox: FakeEmailSender,
    database: Session,
    consent: dict[str, Any],
    field: str,
    error_type: str,
) -> None:
    response = sign_up(mail_client, mailbox, **{**CONSENT, **consent})
    assert problems(response)[field][0] == error_type
    assert response.json()["detail"][0]["loc"] == ["body", field]
    assert no_account(database)


def test_sign_up_with_nothing_about_the_terms_names_all_three(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    found = problems(sign_up(mail_client, mailbox))
    assert {field: kind for field, (kind, _msg) in found.items()} == {
        "accept_terms": "missing",
        "terms_version": "missing",
        "privacy_version": "missing",
    }
    assert no_account(database)


def test_an_old_version_is_refused(mail_client: TestClient, mailbox: FakeEmailSender, database: Session) -> None:
    old_terms = problems(sign_up(mail_client, mailbox, **{**CONSENT, "terms_version": "0.9"}))
    assert old_terms == {
        "terms_version": (
            "terms_version_outdated",
            "The Terms of Service have changed. Reload the page and accept the current version.",
        )
    }
    old_privacy = problems(sign_up(mail_client, mailbox, **{**CONSENT, "privacy_version": "0.9"}))
    assert old_privacy["privacy_version"][0] == "privacy_version_outdated"
    assert no_account(database)


def test_acceptance_is_recorded_with_the_servers_time(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    before = datetime.now(UTC)
    # A client's own acceptance time (or any other consent field) is ignored.
    response = sign_up(
        mail_client, mailbox, **CONSENT, terms_accepted_at="2001-01-01T00:00:00Z", accepted_at="2001-01-01T00:00:00Z"
    )
    assert response.status_code == 200, response.text
    user = database.scalars(select(User)).one()
    assert (user.terms_version, user.privacy_version) == (TERMS_VERSION, PRIVACY_VERSION)
    assert user.terms_accepted_at is not None
    assert before - timedelta(seconds=1) <= user.terms_accepted_at <= datetime.now(UTC) + timedelta(seconds=1)
    body = response.json()["user"]
    assert (body["terms_version"], body["privacy_version"]) == (TERMS_VERSION, PRIVACY_VERSION)
    assert datetime.fromisoformat(body["terms_accepted_at"]) == user.terms_accepted_at


def test_phone_first_sign_up_needs_acceptance_too(make_client: ClientFactory, database: Session) -> None:
    whatsapp = FakeWhatsApp()
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    client.post("/api/v1/auth/phone/send-code", json={"phone": "9876543210"})
    token = client.post(
        "/api/v1/auth/phone/verify-code", json={"phone": "9876543210", "code": whatsapp.last_code()}
    ).json()["verification_token"]
    body = {"name": "Meena", "phone": "9876543210", "role": "OWNER", "phone_verification_token": token}
    refused = client.post("/api/v1/auth/signup", json=body)
    assert set(problems(refused)) == {"accept_terms", "terms_version", "privacy_version"}
    assert no_account(database)
    created = client.post("/api/v1/auth/signup", json={**body, **CONSENT})
    assert created.status_code == 200, created.text
    user = database.scalars(select(User)).one()
    assert (user.terms_version, user.privacy_version) == (TERMS_VERSION, PRIVACY_VERSION)
    assert user.terms_accepted_at is not None


def test_existing_accounts_keep_nulls_and_a_profile_update_cannot_set_them(
    client: TestClient, database: Session
) -> None:
    user = create_user(database, phone="9876543210")
    csrf = sign_in(client)
    session = client.get("/api/v1/auth/session").json()["user"]
    assert (session["terms_version"], session["privacy_version"], session["terms_accepted_at"]) == (None, None, None)
    saved = client.patch(
        "/api/v1/auth/complete-profile",
        json={
            "name": "Asha Rao",
            "phone": "9876543210",
            "address": "12 MG Road, Bengaluru",
            "pincode": "560001",
            **CONSENT,
            "terms_accepted_at": "2001-01-01T00:00:00Z",
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["terms_accepted_at"] is None
    database.refresh(user)
    assert (user.terms_version, user.privacy_version, user.terms_accepted_at) == (None, None, None)
