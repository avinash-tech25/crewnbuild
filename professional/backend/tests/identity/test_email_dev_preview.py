"""EMAIL_DEV_OTP_PREVIEW: in development, an e-mail code that cannot be sent goes back to
a request from this machine instead of 502/503; never logged, never anywhere else."""

import logging
from typing import Any

import pytest
from conftest import FRONTEND_ORIGIN, make_settings
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import InsecureConfigurationError, check_settings
from app.main import create_app
from identity.helpers import FakeEmailSender, create_user, service_overrides

SEND = "/api/v1/auth/email/send-code"


def client_from(address: str, **settings: Any) -> TestClient:
    silent = FakeEmailSender()
    silent.configured = False
    app = create_app(make_settings(**settings))
    for dependency, replacement in service_overrides(email=silent).items():
        app.dependency_overrides[dependency] = replacement

    async def connected_from(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await app({**scope, "client": (address, 5000)}, receive, send)

    return TestClient(connected_from, headers={"Origin": FRONTEND_ORIGIN})


def test_the_preview_answers_this_machine_with_a_working_code(
    database: Session, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_from("127.0.0.1", environment="development", email_dev_otp_preview=True)
    with caplog.at_level(logging.DEBUG):
        answer = client.post(SEND, json={"email": "new@example.in"})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["dev_preview"] is True and body["delivered"] is False and len(body["dev_otp"]) == 6
    assert body["dev_otp"] not in caplog.text
    verified = client.post("/api/v1/auth/email/verify-code", json={"email": "new@example.in", "code": body["dev_otp"]})
    assert verified.status_code == 200, verified.text


def test_the_preview_also_covers_password_reset(database: Session) -> None:
    create_user(database)
    client = client_from("::1", environment="development", email_dev_otp_preview=True)
    answer = client.post("/api/v1/auth/password/forgot", json={"email": "asha@example.in"})
    assert answer.status_code == 200 and len(answer.json()["dev_otp"]) == 6


@pytest.mark.parametrize(
    ("address", "settings"),
    [
        ("192.168.1.20", {"environment": "development", "email_dev_otp_preview": True}),  # another machine
        ("127.0.0.1", {"environment": "development", "email_dev_otp_preview": False}),  # setting off
    ],
)
def test_anywhere_else_the_send_is_refused(database: Session, address: str, settings: dict[str, Any]) -> None:
    answer = client_from(address, **settings).post(SEND, json={"email": "new@example.in"})
    assert answer.status_code == 503 and "dev_otp" not in answer.text


@pytest.mark.parametrize("environment", ["staging", "test", "production"])
def test_only_development_may_switch_it_on(environment: str) -> None:
    with pytest.raises(InsecureConfigurationError, match="EMAIL_DEV_OTP_PREVIEW"):
        check_settings(make_settings(environment=environment, email_dev_otp_preview=True))
