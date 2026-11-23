"""The WhatsApp code limits, exactly as in Kuwait-Version (commit 0baa6ab), and nothing more:

    60 s between two codes for one number (sign-up, sign-in and resend alike)
    10 codes per number per rolling 15 minutes
    60 codes per visitor address per rolling hour
    a send confirmed as never made is not counted

Rolling windows, not lockouts: there is no "3 codes, then 30 minutes" lock. A refusal says
how long to wait and sends the same wait as Retry-After. The clock is moved by the test."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.integrations.whatsapp.dovesoft_client import SendOutcome
from app.modules.identity import phone_verification_service as phone_codes
from app.modules.identity.models import OtpSendEvent
from app.modules.identity.phone_verification_service import (
    ADDRESS_SEND_WINDOW,
    MAX_SENDS_PER_ADDRESS,
    MAX_SENDS_PER_PHONE,
    PHONE_SEND_WINDOW,
    RESEND_COOLDOWN_SECONDS,
    subject_hash,
)
from identity.helpers import FakeWhatsApp, create_user
from identity.test_phone_delivery import client_from

ADDRESS = "203.0.113.7"
PHONE = "9876500111"


class Clock:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.now = datetime.now(UTC).replace(microsecond=0)
        monkeypatch.setattr(phone_codes, "utc_now", lambda: self.now)

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    return Clock(monkeypatch)


@pytest.fixture
def whatsapp() -> FakeWhatsApp:
    return FakeWhatsApp()


def signup(client: Any, phone: str = PHONE) -> Any:
    return client.post("/api/v1/auth/phone/send-code", json={"phone": phone})


def login(client: Any, phone: str) -> Any:
    return client.post("/api/v1/auth/phone/login/send-code", json={"phone": phone})


def refused_wait(response: Any) -> int:
    assert response.status_code == 429, response.text
    return int(response.headers["Retry-After"])


def test_the_rule_is_kuwaits() -> None:
    assert RESEND_COOLDOWN_SECONDS == 60
    assert (10, timedelta(minutes=15)) == (MAX_SENDS_PER_PHONE, PHONE_SEND_WINDOW)
    assert (60, timedelta(hours=1)) == (MAX_SENDS_PER_ADDRESS, ADDRESS_SEND_WINDOW)


def test_sixty_seconds_between_codes_for_one_number(database: Session, whatsapp: FakeWhatsApp, clock: Clock) -> None:
    client = client_from(ADDRESS, whatsapp)
    assert signup(client).status_code == 200
    clock.advance(59)
    again = signup(client)
    assert refused_wait(again) == 1
    assert again.json()["detail"] == "Please wait 1 second before asking for a new code."
    # Another number is not held up by this one.
    assert signup(client, "9876500222").status_code == 200
    clock.advance(1)
    assert signup(client).status_code == 200  # exactly 60 s later: the resend goes
    assert len(whatsapp.sent) == 3


def test_the_cooldown_is_the_same_for_sign_in(database: Session, whatsapp: FakeWhatsApp, clock: Clock) -> None:
    create_user(database, email="owner@example.in", phone=PHONE)
    client = client_from(ADDRESS, whatsapp)
    first = login(client, PHONE)
    assert first.json()["resend_after_seconds"] == 60  # the countdown the page shows
    clock.advance(30)
    assert refused_wait(login(client, PHONE)) == 30
    clock.advance(30)
    assert login(client, PHONE).status_code == 200


@pytest.mark.parametrize("send", ["signup", "login"])
def test_ten_codes_per_number_in_any_fifteen_minutes_and_no_lock(
    database: Session, whatsapp: FakeWhatsApp, clock: Clock, send: str
) -> None:
    if send == "login":
        create_user(database, email="owner@example.in", phone=PHONE)
    client = client_from(ADDRESS, whatsapp)

    def ask() -> Any:
        return signup(client) if send == "signup" else login(client, PHONE)

    # Codes 1 to 10, one a minute: every one goes (no lock after the 3rd).
    for index in range(10):
        if index:
            clock.advance(60)
        assert ask().status_code == 200, index
    # The 11th, one minute after the 10th (9 + 1 minutes after the first): refused until
    # the first code is 15 minutes old, i.e. 5 more minutes, never 30.
    clock.advance(60)
    refused = ask()
    assert refused_wait(refused) == 300
    assert refused.json()["detail"] == "Too many codes requested. Please try again in 5 minutes."
    clock.advance(299)
    assert refused_wait(ask()) == 1
    # As in Kuwait, a code leaves the window once it is MORE than 15 minutes old: a request
    # made when the announced wait is over (a moment after, as every real one is) goes.
    clock.advance(1.001)
    assert ask().status_code == 200  # the window rolled: the first code no longer counts
    assert len(whatsapp.sent) == 11


def test_sixty_codes_per_address_in_any_hour(database: Session, whatsapp: FakeWhatsApp, clock: Clock) -> None:
    address_key = subject_hash("IP", ADDRESS)
    # 60 codes from this address over the last 59 minutes (the oldest 59 minutes ago).
    for minute in range(60):
        moment = clock.now - timedelta(minutes=59) + timedelta(seconds=minute * 59)
        database.add(OtpSendEvent(kind="IP", subject_hash=address_key, occurred_at=moment))
    database.commit()
    client = client_from(ADDRESS, whatsapp)
    assert refused_wait(signup(client, "9876500333")) == 60  # until the oldest is an hour old
    assert whatsapp.sent == []
    # Another address is not affected.
    assert signup(client_from("198.51.100.9", whatsapp), "9876500444").status_code == 200
    clock.advance(60.001)
    assert signup(client, "9876500333").status_code == 200


def test_a_send_confirmed_as_never_made_costs_nothing(database: Session, clock: Clock) -> None:
    refusing = FakeWhatsApp(outcome=SendOutcome.REJECTED, http_status=400)
    client = client_from(ADDRESS, refusing)
    for _ in range(12):  # more than the 10 a number may have: none of these counted
        assert signup(client).status_code == 502
    working = client_from(ADDRESS, FakeWhatsApp())
    assert signup(working).status_code == 200
