"""EMAIL_DEV_OTP_PREVIEW: in development, an e-mail code that cannot be sent goes back to
a request from this machine instead of 503; never logged, never anywhere else."""

import logging
from typing import Any

import pytest
from conftest import FRONTEND_ORIGIN, make_settings
from fastapi.testclient import TestClient
from helpers import finished_technician
from sqlalchemy.orm import Session

from app.auth.dependencies import get_email_sender
from app.core.config import InsecureConfigurationError
from app.main import create_app

SEND = "/api/v1/auth/signup/send-code"


class NoMail:
    configured = False

    def send(self, *_: Any) -> bool:
        return False


def client_from(address: str, **settings: Any) -> TestClient:
    app = create_app(make_settings(**settings))
    app.dependency_overrides[get_email_sender] = NoMail

    async def connected_from(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await app({**scope, "client": (address, 5000)}, receive, send)

    return TestClient(connected_from, headers={"Origin": FRONTEND_ORIGIN})


def test_the_preview_answers_this_machine_with_a_working_code(
    database: Session, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_from("127.0.0.1", environment="development", email_dev_otp_preview=True)
    with caplog.at_level(logging.DEBUG):
        answer = client.post(SEND, json={"email": "new.tech@example.in"})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["dev_preview"] is True and body["delivered"] is False and len(body["dev_otp"]) == 6
    assert body["dev_otp"] not in caplog.text
    verified = client.post(
        "/api/v1/auth/signup/verify-code",
        json={"email": "new.tech@example.in", "phone": "9876543210", "code": body["dev_otp"]},
    )
    assert verified.status_code == 200, verified.text


def test_the_preview_also_covers_password_reset(database: Session) -> None:
    finished_technician(database)
    client = client_from("::1", environment="development", email_dev_otp_preview=True)
    answer = client.post("/api/v1/auth/password-reset/send-code", json={"email": "ravi@example.in"})
    assert answer.status_code == 200 and len(answer.json()["dev_otp"]) == 6


@pytest.mark.parametrize(
    ("address", "settings"),
    [
        ("192.168.1.20", {"environment": "development", "email_dev_otp_preview": True}),
        ("127.0.0.1", {"environment": "development", "email_dev_otp_preview": False}),
    ],
)
def test_anywhere_else_the_send_is_refused(database: Session, address: str, settings: dict[str, Any]) -> None:
    answer = client_from(address, **settings).post(SEND, json={"email": "new.tech@example.in"})
    assert answer.status_code == 503 and "dev_otp" not in answer.text


@pytest.mark.parametrize("environment", ["staging", "test", "production"])
def test_only_development_may_switch_it_on(environment: str) -> None:
    with pytest.raises(InsecureConfigurationError, match="EMAIL_DEV_OTP_PREVIEW"):
        make_settings(environment=environment, email_dev_otp_preview=True)
