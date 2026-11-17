"""Registration records the Terms of Service and Privacy Policy accepted
(app/core/legal.py): the step that creates the account (POST /auth/signup/verify-code)
is refused with 422 without them or with an old version, and stores them with the
server's time."""

from datetime import timedelta
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from helpers import CONSENT, FakeEmail, csrf, finished_technician
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_email_sender
from app.core.legal import PRIVACY_VERSION, TERMS_VERSION
from app.database.types import naive_utc_now
from app.modules.identity.models import Technician

EMAIL = "new.tech@example.in"
INVALID_INPUT = "Some of the information sent is not valid."


@pytest.fixture
def mailbox() -> FakeEmail:
    return FakeEmail()


@pytest.fixture
def client(make_client: ClientFactory, mailbox: FakeEmail) -> TestClient:
    return make_client(overrides={get_email_sender: lambda: mailbox})


def register(client: TestClient, mailbox: FakeEmail, **consent: Any) -> Any:
    assert client.post("/api/v1/auth/signup/send-code", json={"email": EMAIL}).status_code == 200
    body = {"email": EMAIL, "phone": "9876500100", "code": mailbox.last_code(), **consent}
    return client.post(
        "/api/v1/auth/signup/verify-code", json={name: value for name, value in body.items() if value is not None}
    )


def field_errors(answer: Any) -> dict[str, str]:
    assert answer.status_code == 422, answer.text
    assert answer.json()["detail"] == INVALID_INPUT
    return {item["field"]: item["message"] for item in answer.json()["fields"]}


def no_account(database: Session) -> bool:
    database.expire_all()
    return database.scalars(select(Technician)).first() is None


@pytest.mark.parametrize(
    ("consent", "field", "message"),
    [
        ({"accept_terms": None}, "accept_terms", "Field required"),
        (
            {"accept_terms": False},
            "accept_terms",
            "Accept the Terms of Service and the Privacy Policy to create an account.",
        ),
        ({"terms_version": None}, "terms_version", "Field required"),
        ({"privacy_version": None}, "privacy_version", "Field required"),
        (
            {"terms_version": "0.9"},
            "terms_version",
            "The Terms of Service have changed. Reload the page and accept the current version.",
        ),
        (
            {"privacy_version": "0.9"},
            "privacy_version",
            "The Privacy Policy has changed. Reload the page and accept the current version.",
        ),
    ],
)
def test_registration_without_acceptance_or_with_an_old_version_is_refused(
    client: TestClient, mailbox: FakeEmail, database: Session, consent: dict[str, Any], field: str, message: str
) -> None:
    answer = register(client, mailbox, **{**CONSENT, **consent})
    assert field_errors(answer) == {field: message}
    assert no_account(database)
    assert not client.cookies.get("par_at")


def test_registration_with_nothing_about_the_terms_names_all_three(
    client: TestClient, mailbox: FakeEmail, database: Session
) -> None:
    assert set(field_errors(register(client, mailbox))) == {"accept_terms", "terms_version", "privacy_version"}
    assert no_account(database)


def test_acceptance_is_recorded_with_the_servers_time(
    client: TestClient, mailbox: FakeEmail, database: Session
) -> None:
    before = naive_utc_now()
    # A client's own acceptance time is ignored.
    answer = register(client, mailbox, **CONSENT, terms_accepted_at="2001-01-01T00:00:00Z")
    assert answer.status_code == 200, answer.text
    technician = database.scalars(select(Technician)).one()
    assert (technician.terms_version, technician.privacy_version) == (TERMS_VERSION, PRIVACY_VERSION)
    assert technician.terms_accepted_at is not None
    assert before - timedelta(seconds=1) <= technician.terms_accepted_at <= naive_utc_now() + timedelta(seconds=1)
    user = answer.json()["user"]
    assert (user["terms_version"], user["privacy_version"]) == (TERMS_VERSION, PRIVACY_VERSION)
    assert user["terms_accepted_at"].endswith("+05:30")
    me = client.get("/api/v1/auth/me", headers=csrf(answer)).json()
    assert me["terms_accepted_at"] == user["terms_accepted_at"]


def test_existing_accounts_keep_nulls(client: TestClient, database: Session) -> None:
    technician = finished_technician(database, "done@example.in")
    database.refresh(technician)
    assert (technician.terms_version, technician.privacy_version, technician.terms_accepted_at) == (None, None, None)
