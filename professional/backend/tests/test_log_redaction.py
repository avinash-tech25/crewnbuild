"""Log redaction (section 14.2; R6): the real log output, after real flows, holds no
password, token, code, Aadhaar, bank or camera credential, or full phone number."""

import io
import logging
import re
from collections.abc import Iterator

import pytest
import structlog
from conftest import ClientFactory
from fastapi.testclient import TestClient
from identity.helpers import FakeEmailSender, create_user, service_overrides
from sqlalchemy.orm import Session

from app.core.log_redaction import redact_text

PASSWORD = "Wrong#Secret-Pass-77"
AADHAAR = "4567 8912 3456"
ACCOUNT = "123456789012345"
PHONE = "9876543210"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl"
CAMERA = "rtsp://admin:Cam3ra-Pass@10.0.0.5:554/stream"


@pytest.mark.parametrize(
    ("text", "secret"),
    [
        (f"login failed password={PASSWORD}", PASSWORD),
        ("your code is 482913", "482913"),
        (f"Authorization: Bearer {JWT}", JWT),
        ("postgresql+psycopg://crewnbuild:db-pass@db/crewnbuild", "db-pass"),
        (f"aadhaar {AADHAAR}", AADHAAR),
        (f"account {ACCOUNT} saved", ACCOUNT),
        (f"phone {PHONE}", PHONE),
        (CAMERA, "Cam3ra-Pass"),
    ],
)
def test_each_kind_is_removed_from_text(text: str, secret: str) -> None:
    assert secret not in redact_text(text)


def test_identifiers_and_ordinary_numbers_stay() -> None:
    line = "booking 01a1d46b-c711-713e-8e31-123456789012 price 499.00 status_code=200 at 2026-11-13T10:00:00"
    assert redact_text(line) == line
    assert redact_text(f"phone {PHONE}").endswith("3210")  # the last four digits stay


@pytest.fixture
def log_output(make_client: ClientFactory) -> Iterator[tuple[TestClient, io.StringIO, FakeEmailSender]]:
    mailbox = FakeEmailSender()
    client = make_client(overrides=service_overrides(email=mailbox))  # create_app set up the JSON handler
    buffer = io.StringIO()
    handler = logging.getLogger().handlers[0]
    assert isinstance(handler, logging.StreamHandler)
    previous = handler.setStream(buffer)
    yield client, buffer, mailbox
    handler.setStream(previous)


def test_the_log_output_holds_none_of_them(log_output: tuple, database: Session) -> None:  # type: ignore[type-arg]
    client, buffer, mailbox = log_output
    create_user(database)
    # Real flows: a failed sign-in, an e-mail code, a validation error carrying a password.
    client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": PASSWORD})
    client.post("/api/v1/auth/email/send-code", json={"email": "new@example.in"})
    client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": {"x": PASSWORD}})
    code = re.search(r"\b(\d{6})\b", mailbox.sent[-1]["text"]).group(1)  # type: ignore[union-attr]
    # And everything a careless line could do.
    plain = logging.getLogger("app.test")
    plain.warning("sign-in for %s with password=%s token %s", PHONE, PASSWORD, JWT)
    plain.info("aadhaar %s account %s camera %s code %s", AADHAAR, ACCOUNT, CAMERA, code)
    structlog.get_logger("app.test").info("structured", password=PASSWORD, otp=code, account_number=ACCOUNT)
    try:
        raise RuntimeError(f"refused Bearer {JWT} for {CAMERA}")
    except RuntimeError:
        plain.exception("failure")
    output = buffer.getvalue()
    assert output.count("\n") >= 5
    for secret in (PASSWORD, code, JWT, AADHAAR, ACCOUNT, PHONE, "Cam3ra-Pass"):
        assert secret not in output, secret
