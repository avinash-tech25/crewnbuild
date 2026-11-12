"""WhatsApp codes: phone-first sign-up, WhatsApp sign-in, limits, administrators and the
fixed test accounts. WhatsApp itself is faked."""

from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations.whatsapp.dovesoft_client import SendOutcome
from app.modules.identity.models import ROLE_GLOBAL_SUPER_ADMIN, OtpSendEvent, PhoneVerificationCode
from identity.helpers import WHATSAPP_SETTINGS, FakeWhatsApp, create_user, service_overrides

PHONE = "9876543210"


@pytest.fixture
def whatsapp() -> FakeWhatsApp:
    return FakeWhatsApp()


@pytest.fixture
def phone_client(make_client: ClientFactory, whatsapp: FakeWhatsApp) -> TestClient:
    return make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)


def make_phone_client(make_client: ClientFactory, whatsapp: FakeWhatsApp, **settings: Any) -> TestClient:
    return make_client(overrides=service_overrides(whatsapp=whatsapp), **{**WHATSAPP_SETTINGS, **settings})


def test_config_reports_whatsapp_sign_in(phone_client: TestClient, client: TestClient) -> None:
    assert phone_client.get("/api/v1/auth/phone/config").json() == {
        "enabled": True,
        "login": True,
        "dial_code": "+91",
        "digits": 10,
    }
    assert client.get("/api/v1/auth/phone/config").json()["enabled"] is False


def test_phone_first_sign_up(phone_client: TestClient, whatsapp: FakeWhatsApp, database: Session) -> None:
    sent = phone_client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE})
    assert sent.status_code == 200
    assert sent.json() == {"sent": True, "expires_in_minutes": 10, "resend_after_seconds": 60}
    verified = phone_client.post("/api/v1/auth/phone/verify-code", json={"phone": PHONE, "code": whatsapp.last_code()})
    assert verified.status_code == 200
    token = verified.json()["verification_token"]

    signup = phone_client.post(
        "/api/v1/auth/signup",
        json={"name": "Meena", "phone": PHONE, "role": "OWNER", "phone_verification_token": token},
    )
    assert signup.status_code == 200, signup.text
    user = signup.json()["user"]
    assert user["phone"] == PHONE and user["email"] is None and user["role"] == "OWNER"
    # The token completes one sign-up only.
    assert database.scalars(select(PhoneVerificationCode)).first() is None


def test_sign_up_without_the_whatsapp_check_is_refused(phone_client: TestClient, database: Session) -> None:
    response = phone_client.post("/api/v1/auth/signup", json={"name": "Meena", "phone": PHONE, "role": "OWNER"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Verify your mobile number on WhatsApp before creating the account."}


def test_malformed_numbers_are_refused_not_trimmed(phone_client: TestClient, database: Session) -> None:
    for raw in ("+919876543210", "98765", "5876543210", "98765abcde"):
        response = phone_client.post("/api/v1/auth/phone/send-code", json={"phone": raw})
        assert response.status_code == 422, raw


def test_whatsapp_sign_in(phone_client: TestClient, whatsapp: FakeWhatsApp, database: Session) -> None:
    user = create_user(database, phone=PHONE, email=None)
    assert phone_client.post("/api/v1/auth/phone/login/send-code", json={"phone": PHONE}).status_code == 200
    signed_in = phone_client.post(
        "/api/v1/auth/phone/login/verify-code", json={"phone": PHONE, "code": whatsapp.last_code()}
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["id"] == str(user.id)
    assert phone_client.get("/api/v1/auth/session").status_code == 200


def test_a_wrong_or_reused_sign_in_code_gets_one_answer(
    phone_client: TestClient, whatsapp: FakeWhatsApp, database: Session
) -> None:
    create_user(database, phone=PHONE, email=None)
    phone_client.post("/api/v1/auth/phone/login/send-code", json={"phone": PHONE})
    code = whatsapp.last_code()
    wrong = "000000" if code != "000000" else "111111"
    refused = phone_client.post("/api/v1/auth/phone/login/verify-code", json={"phone": PHONE, "code": wrong})
    assert refused.status_code == 400
    assert (
        phone_client.post("/api/v1/auth/phone/login/verify-code", json={"phone": PHONE, "code": code}).status_code
        == 200
    )
    reused = phone_client.post("/api/v1/auth/phone/login/verify-code", json={"phone": PHONE, "code": code})
    assert reused.status_code == 400
    assert reused.json() == refused.json()


def test_unregistered_number_gets_no_code(phone_client: TestClient, whatsapp: FakeWhatsApp, database: Session) -> None:
    response = phone_client.post("/api/v1/auth/phone/login/send-code", json={"phone": PHONE})
    assert response.status_code == 404
    assert whatsapp.sent == []
    # The request still counted against the limits.
    assert len(list(database.scalars(select(OtpSendEvent)))) == 2


def test_resend_cooldown(phone_client: TestClient, database: Session) -> None:
    assert phone_client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE}).status_code == 200
    again = phone_client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE})
    assert again.status_code == 429
    assert int(again.headers["Retry-After"]) <= 60


def test_per_number_limit(phone_client: TestClient, database: Session) -> None:
    from datetime import timedelta

    from app.modules.identity.phone_verification_service import subject_hash
    from app.modules.identity.session_service import utc_now

    now = utc_now()
    for minute in range(10):
        database.add(
            OtpSendEvent(
                kind="PHONE", subject_hash=subject_hash("PHONE", PHONE), occurred_at=now - timedelta(minutes=minute)
            )
        )
    database.commit()
    response = phone_client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE})
    assert response.status_code == 429
    assert "Too many codes requested" in response.json()["detail"]


def test_a_confirmed_provider_refusal_costs_nothing(make_client: ClientFactory, database: Session) -> None:
    refusing = FakeWhatsApp(outcome=SendOutcome.REJECTED, http_status=400)
    client = make_phone_client(make_client, refusing)
    response = client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE})
    assert response.status_code == 502
    assert list(database.scalars(select(OtpSendEvent))) == []
    assert database.scalars(select(PhoneVerificationCode)).first() is None


def test_an_uncertain_send_keeps_the_cooldown(make_client: ClientFactory, database: Session) -> None:
    client = make_phone_client(make_client, FakeWhatsApp(outcome=SendOutcome.UNCERTAIN, http_status=None))
    assert client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE}).status_code == 502
    assert client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE}).status_code == 429


def test_administrators_sign_in_by_the_number_on_their_admin_profile(
    phone_client: TestClient, whatsapp: FakeWhatsApp, database: Session
) -> None:
    admin = create_user(database, role=ROLE_GLOBAL_SUPER_ADMIN, email="global@example.in", admin_phone=PHONE)
    phone_client.post("/api/v1/auth/phone/login/send-code", json={"phone": PHONE})
    response = phone_client.post(
        "/api/v1/auth/phone/login/verify-code", json={"phone": PHONE, "code": whatsapp.last_code()}
    )
    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(admin.id)


def test_an_administrator_number_in_users_phone_is_not_a_way_in(phone_client: TestClient, database: Session) -> None:
    create_user(database, role="MANAGER", email="manager@example.in", phone=PHONE)
    response = phone_client.post("/api/v1/auth/phone/login/send-code", json={"phone": PHONE})
    assert response.status_code == 403


def test_fixed_test_account_uses_the_code_from_the_environment(
    make_client: ClientFactory, whatsapp: FakeWhatsApp, database: Session
) -> None:
    client = make_phone_client(
        make_client,
        whatsapp,
        test_otp_login_enabled=True,
        test_owner_otp_code="246810",
        test_builder_otp_code="135791",
        test_admin_otp_code="112233",
    )
    create_user(database, phone="9000000001", email=None)
    sent = client.post("/api/v1/auth/phone/login/send-code", json={"phone": "9000000001"})
    assert sent.json()["expires_in_minutes"] == 5
    assert whatsapp.sent == []  # nothing goes to WhatsApp
    response = client.post("/api/v1/auth/phone/login/verify-code", json={"phone": "9000000001", "code": "246810"})
    assert response.status_code == 200


def test_fixed_test_number_needs_its_test_role(
    make_client: ClientFactory, whatsapp: FakeWhatsApp, database: Session
) -> None:
    client = make_phone_client(
        make_client,
        whatsapp,
        test_otp_login_enabled=True,
        test_owner_otp_code="246810",
        test_builder_otp_code="135791",
        test_admin_otp_code="112233",
    )
    create_user(database, phone="9000000002", email=None)  # an OWNER on the Builder's test number
    response = client.post("/api/v1/auth/phone/login/send-code", json={"phone": "9000000002"})
    assert response.status_code == 403


def test_development_preview_returns_the_code_only_to_this_machine(
    make_client: ClientFactory, whatsapp: FakeWhatsApp, database: Session
) -> None:
    client = make_phone_client(make_client, whatsapp, environment="development", whatsapp_dev_otp_preview=True)
    response = client.post("/api/v1/auth/phone/send-code", json={"phone": PHONE})
    assert response.status_code == 200
    body = response.json()
    assert body["dev_preview"] is True
    # The test client is not a loopback address, so the code is not in the reply.
    assert "dev_otp" not in body
    assert whatsapp.sent == []
