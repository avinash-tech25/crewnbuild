"""WhatsApp code delivery for sign-up and sign-in through the one send path: the same
development preview (development only, the code only to this machine), the same template
and language on a real send (WhatsApp faked), the fixed test accounts 9000000001/2, and the
resend cooldown the countdown is told about."""

from typing import Any

import pytest
from conftest import FRONTEND_ORIGIN, make_settings
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import create_app
from app.modules.identity.models import ROLE_BUILDER
from app.modules.identity.phone_verification_service import RESEND_COOLDOWN_SECONDS, describe_wait
from identity.helpers import WHATSAPP_SETTINGS, FakeWhatsApp, create_user, service_overrides

OWNER_PHONE = "9876543210"
NEW_PHONE = "9876500999"
TEST_CODES = {"test_owner_otp_code": "246810", "test_builder_otp_code": "135791", "test_admin_otp_code": "112233"}


def client_from(address: str, whatsapp: FakeWhatsApp, **settings: Any) -> TestClient:
    """A client whose requests come from `address` (loopback = this machine)."""
    app = create_app(make_settings(**{**WHATSAPP_SETTINGS, **settings}))
    for dependency, replacement in service_overrides(whatsapp=whatsapp).items():
        app.dependency_overrides[dependency] = replacement

    async def connected_from(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await app({**scope, "client": (address, 5000)}, receive, send)

    return TestClient(connected_from, headers={"Origin": FRONTEND_ORIGIN})


def send_signup(client: TestClient, phone: str = NEW_PHONE) -> Any:
    return client.post("/api/v1/auth/phone/send-code", json={"phone": phone})


def send_login(client: TestClient, phone: str = OWNER_PHONE) -> Any:
    return client.post("/api/v1/auth/phone/login/send-code", json={"phone": phone})


@pytest.fixture
def whatsapp() -> FakeWhatsApp:
    return FakeWhatsApp()


def test_the_preview_shows_sign_up_and_sign_in_codes_alike_to_this_machine(
    database: Session, whatsapp: FakeWhatsApp, caplog: pytest.LogCaptureFixture
) -> None:
    create_user(database, email="owner@example.in", phone=OWNER_PHONE)
    local = client_from("127.0.0.1", whatsapp, environment="development", whatsapp_dev_otp_preview=True)
    signup, login = send_signup(local).json(), send_login(local).json()
    for reply in (signup, login):
        assert reply["dev_preview"] is True and len(reply["dev_otp"]) == 6 and reply["sent"] is True
        assert reply["dev_otp"] not in caplog.text  # never logged
    assert whatsapp.sent == []  # nothing goes to WhatsApp in the preview
    # Both codes work.
    verified = local.post("/api/v1/auth/phone/verify-code", json={"phone": NEW_PHONE, "code": signup["dev_otp"]})
    assert verified.status_code == 200, verified.text
    signed_in = local.post(
        "/api/v1/auth/phone/login/verify-code", json={"phone": OWNER_PHONE, "code": login["dev_otp"]}
    )
    assert signed_in.status_code == 200, signed_in.text


@pytest.mark.parametrize(
    ("address", "settings"),
    [
        ("192.168.1.20", {"environment": "development", "whatsapp_dev_otp_preview": True}),  # another machine
        ("127.0.0.1", {"environment": "development", "whatsapp_dev_otp_preview": False}),  # preview off
    ],
)
def test_the_code_is_never_shown_elsewhere(
    database: Session, whatsapp: FakeWhatsApp, address: str, settings: dict[str, Any]
) -> None:
    create_user(database, email="owner@example.in", phone=OWNER_PHONE)
    client = client_from(address, whatsapp, **settings)
    for reply in (send_signup(client), send_login(client)):
        assert reply.status_code == 200 and "dev_otp" not in reply.json()


def test_a_real_send_uses_the_same_template_and_language_for_sign_up_and_sign_in(
    database: Session, whatsapp: FakeWhatsApp
) -> None:
    create_user(database, email="owner@example.in", phone=OWNER_PHONE)
    client = client_from("127.0.0.1", whatsapp)
    assert send_signup(client).json() == {"sent": True, "expires_in_minutes": 10, "resend_after_seconds": 60}
    assert send_login(client).json() == {"sent": True, "expires_in_minutes": 10, "resend_after_seconds": 60}
    signup_message, login_message = whatsapp.sent
    assert (signup_message["phone"], login_message["phone"]) == (NEW_PHONE, OWNER_PHONE)
    assert signup_message["template"] == login_message["template"] == WHATSAPP_SETTINGS["whatsapp_otp_template"]
    assert signup_message.get("language") == login_message.get("language")  # the default language for both
    assert all(len(message["variables"][0]) == 6 for message in whatsapp.sent)
    signed_in = client.post(
        "/api/v1/auth/phone/login/verify-code", json={"phone": OWNER_PHONE, "code": whatsapp.last_code()}
    )
    assert signed_in.status_code == 200


@pytest.mark.parametrize(
    ("phone", "role", "code"), [("9000000001", None, "246810"), ("9000000002", ROLE_BUILDER, "135791")]
)
def test_the_fixed_test_accounts_show_their_code_in_the_preview_and_never_send(
    database: Session, whatsapp: FakeWhatsApp, phone: str, role: str | None, code: str
) -> None:
    create_user(database, phone=phone, email=None, **({"role": role} if role else {}))
    local = client_from("127.0.0.1", whatsapp, environment="development", whatsapp_dev_otp_preview=True,
                        test_otp_login_enabled=True, **TEST_CODES)  # fmt: skip
    reply = send_login(local, phone).json()
    assert reply["dev_preview"] is True and reply["dev_otp"] == code and reply["expires_in_minutes"] == 5
    assert whatsapp.sent == []  # a fixed test number is never messaged
    signed_in = local.post("/api/v1/auth/phone/login/verify-code", json={"phone": phone, "code": code})
    assert signed_in.status_code == 200, signed_in.text


def test_without_the_preview_a_test_account_gets_no_code_in_the_reply(
    database: Session, whatsapp: FakeWhatsApp
) -> None:
    create_user(database, phone="9000000001", email=None)
    client = client_from("127.0.0.1", whatsapp, environment="development", test_otp_login_enabled=True, **TEST_CODES)
    reply = send_login(client, "9000000001").json()
    assert "dev_otp" not in reply and whatsapp.sent == []


def test_the_resend_wait_is_the_one_the_countdown_is_given(database: Session, whatsapp: FakeWhatsApp) -> None:
    create_user(database, email="owner@example.in", phone=OWNER_PHONE)
    client = client_from("127.0.0.1", whatsapp)
    for send in (send_signup, send_login):
        first = send(client)
        assert first.json()["resend_after_seconds"] == RESEND_COOLDOWN_SECONDS == 60
        again = send(client)
        assert again.status_code == 429
        wait = int(again.headers["Retry-After"])
        assert 0 < wait <= 60
        # The message names the same wait as Retry-After ("59 seconds", or "1 minute" for a full 60).
        assert again.json()["detail"] == f"Please wait {describe_wait(wait)} before asking for a new code."
