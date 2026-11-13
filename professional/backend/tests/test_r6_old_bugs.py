"""Old bugs fixed in R6 (each was kept until now, listed in the R6 report)."""

import logging
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from identity.helpers import STRONG_PASSWORD, FakeEmailSender, create_user, service_overrides
from sqlalchemy.orm import Session

from app.core import local_time

APP = Path(__file__).resolve().parents[1] / "app"


# ---- dates are India dates, not the server's ----


def test_local_today_is_india_even_when_utc_is_still_yesterday(monkeypatch: pytest.MonkeyPatch) -> None:
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def, override]
            moment = datetime(2026, 11, 13, 19, 0, tzinfo=UTC)  # 00:30 IST on the 14th
            return moment.astimezone(tz) if tz else moment.replace(tzinfo=None)

    monkeypatch.setattr(local_time, "datetime", Clock)
    assert local_time.local_today() == date(2026, 11, 14)


def test_no_date_is_checked_against_the_servers_clock() -> None:
    offenders = [
        f"{path.relative_to(APP)}:{number}"
        for path in APP.rglob("*.py")
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if "date.today()" in line and not line.lstrip().startswith(("#", '"', "compared"))
    ]
    assert offenders == []


# ---- sign-in by account name ----


def test_an_ambiguous_account_name_signs_nobody_in(client: TestClient, database: Session) -> None:
    create_user(database, name="Asha Rao", email="asha@example.in")
    create_user(database, name="Asha Rao", email="asha.two@example.in", phone="9123456780")
    by_name = client.post("/api/v1/auth/login", json={"email": "asha rao", "password": STRONG_PASSWORD})
    assert (by_name.status_code, by_name.json()) == (401, {"detail": "Invalid username/email or password"})
    by_email = client.post("/api/v1/auth/login", json={"email": "asha.two@example.in", "password": STRONG_PASSWORD})
    assert by_email.status_code == 200


def test_a_unique_account_name_still_signs_in(client: TestClient, database: Session) -> None:
    create_user(database, name="Meena K", email="meena@example.in")
    answer = client.post("/api/v1/auth/login", json={"email": "MEENA k", "password": STRONG_PASSWORD})
    assert answer.status_code == 200


# ---- an undeliverable e-mail code is never logged ----


def test_an_undeliverable_signup_code_is_refused_and_not_logged(
    make_client: ClientFactory, database: Session, caplog: pytest.LogCaptureFixture
) -> None:
    silent = FakeEmailSender()
    silent.configured = False
    client = make_client(environment="development", overrides=service_overrides(email=silent))
    with caplog.at_level(logging.DEBUG):
        answer = client.post("/api/v1/auth/email/send-code", json={"email": "new@example.in"})
    assert answer.status_code == 503
    assert "code is" not in caplog.text and "signup code" not in caplog.text
