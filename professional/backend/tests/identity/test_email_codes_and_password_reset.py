"""E-mail sign-up, the Profile Settings e-mail check, and password reset. E-mail is faked."""

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import User, UserSession
from identity.helpers import STRONG_PASSWORD, FakeEmailSender, create_user, service_overrides, sign_in

NEW_PASSWORD = "Another#Pass456"


@pytest.fixture
def mailbox() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def mail_client(make_client: ClientFactory, mailbox: FakeEmailSender) -> TestClient:
    return make_client(overrides=service_overrides(email=mailbox))


def test_email_sign_up(mail_client: TestClient, mailbox: FakeEmailSender, database: Session) -> None:
    sent = mail_client.post("/api/v1/auth/email/send-code", json={"email": "Neha@Example.in"})
    assert sent.status_code == 200
    assert sent.json()["delivered"] is True
    assert (
        mail_client.post(
            "/api/v1/auth/email/verify-code", json={"email": "neha@example.in", "code": mailbox.last_code()}
        ).status_code
        == 200
    )

    signup = mail_client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Neha",
            "email": "neha@example.in",
            "password": STRONG_PASSWORD,
            "role": "CONTRACTOR",
            "phone": "9876500000",
            "country_of_residence": "India",
            "pincode": "560001",
            "plan_code": "professional",
            "duration_code": "monthly",
        },
    )
    assert signup.status_code == 200, signup.text
    body = signup.json()["user"]
    assert body["role"] == "BUILDER"  # CONTRACTOR is accepted and stored as BUILDER
    assert body["email_verified"] is True
    assert body["contractor_profile"] == {"company_name": "Neha"}
    assert body["subscription_checkout"] == {"plan_code": "PROFESSIONAL", "duration_code": "MONTHLY"}
    assert mailbox.sent[-1]["subject"] == "Welcome to CREWNBUILD"
    stored = database.scalars(select(User)).one()
    assert stored.password_hash.startswith("$argon2id$")


def test_sign_up_needs_a_verified_email_and_a_strong_password(mail_client: TestClient, database: Session) -> None:
    weak = mail_client.post(
        "/api/v1/auth/signup", json={"name": "Neha", "email": "neha@example.in", "password": "short", "role": "OWNER"}
    )
    assert weak.status_code == 422
    unverified = mail_client.post(
        "/api/v1/auth/signup",
        json={"name": "Neha", "email": "neha@example.in", "password": STRONG_PASSWORD, "role": "OWNER"},
    )
    assert unverified.status_code == 422
    assert unverified.json() == {"detail": "Verify your email address before creating the account."}


def test_sign_up_refuses_kuwait_and_unknown_roles(mail_client: TestClient, database: Session) -> None:
    kuwait = mail_client.post(
        "/api/v1/auth/signup",
        json={"name": "N", "email": "n@example.in", "role": "OWNER", "country_of_residence": "Kuwait"},
    )
    assert kuwait.status_code == 422
    admin = mail_client.post(
        "/api/v1/auth/signup",
        json={"name": "Neha", "email": "n@example.in", "password": STRONG_PASSWORD, "role": "MANAGER"},
    )
    assert admin.status_code == 400


def test_an_email_code_for_a_registered_address_is_refused(mail_client: TestClient, database: Session) -> None:
    create_user(database)
    assert mail_client.post("/api/v1/auth/email/send-code", json={"email": "asha@example.in"}).status_code == 409


def test_wrong_codes_are_limited(mail_client: TestClient, mailbox: FakeEmailSender, database: Session) -> None:
    mail_client.post("/api/v1/auth/email/send-code", json={"email": "neha@example.in"})
    code = mailbox.last_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert (
            mail_client.post(
                "/api/v1/auth/email/verify-code", json={"email": "neha@example.in", "code": wrong}
            ).status_code
            == 400
        )
    blocked = mail_client.post("/api/v1/auth/email/verify-code", json={"email": "neha@example.in", "code": code})
    assert blocked.status_code == 429


def test_password_reset_answers_the_same_for_unknown_addresses(mail_client: TestClient, database: Session) -> None:
    response = mail_client.post("/api/v1/auth/password/forgot", json={"email": "nobody@example.in"})
    assert response.status_code == 200
    assert response.json() == {"sent": True, "expires_in_minutes": 10, "resend_after_seconds": 30}


def test_password_reset_ends_every_session(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    create_user(database)
    sign_in(mail_client)
    other_device = TestClient(mail_client.app, headers={"Origin": "http://localhost:5173"})

    assert other_device.post("/api/v1/auth/password/forgot", json={"email": "asha@example.in"}).status_code == 200
    code = mailbox.last_code()
    assert (
        other_device.post(
            "/api/v1/auth/password/verify-code", json={"email": "asha@example.in", "code": code}
        ).status_code
        == 200
    )
    weak = other_device.post("/api/v1/auth/password/reset", json={"email": "asha@example.in", "password": "weak"})
    assert weak.status_code == 422
    reset = other_device.post(
        "/api/v1/auth/password/reset", json={"email": "asha@example.in", "password": NEW_PASSWORD}
    )
    assert reset.json() == {"reset": True}

    assert mail_client.get("/api/v1/auth/session").status_code == 401
    assert {row.revoke_reason for row in database.scalars(select(UserSession))} == {"password_reset"}
    sign_in(other_device, password=NEW_PASSWORD)


def test_profile_email_is_saved_verified(mail_client: TestClient, mailbox: FakeEmailSender, database: Session) -> None:
    create_user(database, email=None, phone="9876543210", name="Phone Only")
    # A phone-only account signs in another way; sign in by name for the test.
    csrf = sign_in(mail_client, identifier="phone only")
    headers = {"X-CSRF-Token": csrf}
    assert (
        mail_client.post(
            "/api/v1/auth/email/profile/send-code", json={"email": "phone.only@example.in"}, headers=headers
        ).status_code
        == 200
    )
    saved = mail_client.post(
        "/api/v1/auth/email/profile/verify-code",
        json={"email": "phone.only@example.in", "code": mailbox.last_code()},
        headers=headers,
    )
    assert saved.status_code == 200
    assert saved.json()["user"]["email"] == "phone.only@example.in"
    assert saved.json()["user"]["email_verified"] is True


def verified_signup(client: TestClient, mailbox: FakeEmailSender, email: str, **fields: object) -> "object":
    client.post("/api/v1/auth/email/send-code", json={"email": email})
    client.post("/api/v1/auth/email/verify-code", json={"email": email, "code": mailbox.last_code()})
    body = {"name": "Farah", "email": email, "password": STRONG_PASSWORD, "role": "OWNER", **fields}
    return client.post("/api/v1/auth/signup", json=body)


def test_a_non_india_sign_up_keeps_its_country(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    response = verified_signup(
        mail_client,
        mailbox,
        "farah@example.ae",
        country_of_residence="United Arab Emirates",
        phone="501234567",
        pincode="12345",
    )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["country_of_residence"] == "United Arab Emirates"
    stored = database.scalars(select(User)).one()
    assert stored.country_code == "United Arab Emirates"
    # The same session answer after a reload.
    assert mail_client.get("/api/v1/auth/session").json()["user"]["country_of_residence"] == "United Arab Emirates"


def test_the_country_specific_rules_are_unchanged(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    short = verified_signup(
        mail_client, mailbox, "a@example.ae", country_of_residence="United Arab Emirates", phone="1234567"
    )
    assert short.status_code == 422
    assert short.json() == {"detail": "Enter a valid phone number for your country."}
    india = verified_signup(mail_client, mailbox, "b@example.in", country_of_residence="India", phone="98765")
    assert india.json() == {"detail": "Enter a valid 10 digit phone number."}


def test_no_country_means_india(mail_client: TestClient, mailbox: FakeEmailSender, database: Session) -> None:
    response = verified_signup(mail_client, mailbox, "c@example.in", phone="9876500001")
    assert response.json()["user"]["country_of_residence"] == "India"
    assert database.scalars(select(User)).one().country_code == "India"


def test_a_number_is_unique_within_its_country_only(
    mail_client: TestClient, mailbox: FakeEmailSender, database: Session
) -> None:
    create_user(database, email="india@example.in", phone="9876500002")
    same_country = verified_signup(
        mail_client, mailbox, "d@example.in", phone="9876500002", country_of_residence=" india "
    )
    assert same_country.status_code == 409
    abroad = verified_signup(
        mail_client, mailbox, "e@example.ae", phone="9876500002", country_of_residence="United Arab Emirates"
    )
    assert abroad.status_code == 200, abroad.text
