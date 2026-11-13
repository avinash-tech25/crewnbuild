"""Log redaction (section 14.2; R6): the real log output, after real flows, holds no
password, token, code, Aadhaar, bank or camera credential, or full phone number."""

import io
import logging

import pytest
import structlog

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


def test_the_log_output_holds_none_of_them(client, onboard, mailbox, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Real flows: registration with an e-mail code, Aadhaar and a password, then a payout
    account; the legacy client built the app, so its JSON handler is the one read here."""
    import legacy
    from legacy import bearer

    buffer = io.StringIO()
    handler = logging.getLogger().handlers[0]
    assert isinstance(handler, logging.StreamHandler)
    previous = handler.setStream(buffer)
    try:
        aadhaar = legacy.valid_aadhaar()
        monkeypatch.setattr(legacy, "valid_aadhaar", lambda: aadhaar)
        technician = onboard()
        code = mailbox.last_code(technician["user"]["email"])
        client.put(
            "/technicians/me/bank-account",
            headers=bearer(technician["access_token"]),
            json={
                "account_holder_name": "Test Painter",
                "bank_name": "Test Bank",
                "account_number": ACCOUNT,
                "confirm_account_number": ACCOUNT,
                "ifsc": "SBIN0001234",
            },
        )
        client.post("/auth/login", json={"email": technician["user"]["email"], "password": PASSWORD})
        plain = logging.getLogger("app.test")
        plain.warning("sign-in for %s with password=%s token %s", PHONE, PASSWORD, JWT)
        plain.info("aadhaar %s / %s account %s camera %s code %s", AADHAAR, aadhaar, ACCOUNT, CAMERA, code)
        structlog.get_logger("app.test").info("structured", password=PASSWORD, otp=code, account_number=ACCOUNT)
        try:
            raise RuntimeError(f"refused Bearer {JWT} for {CAMERA}")
        except RuntimeError:
            plain.exception("failure")
    finally:
        handler.setStream(previous)
    output = buffer.getvalue()
    assert output.count(chr(10)) >= 5
    grouped = f"{aadhaar[:4]} {aadhaar[4:8]} {aadhaar[8:]}"
    for secret in (PASSWORD, code, JWT, AADHAAR, aadhaar, grouped, ACCOUNT, PHONE, "Cam3ra-Pass"):
        assert secret not in output, secret
