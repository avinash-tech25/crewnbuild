"""The requester hand-off from Professional and the booking session: single use, role and
status re-read from Professional's view on every request."""

import uuid
from typing import Any

import pytest
from conftest import FRONTEND_ORIGIN, ClientFactory
from fastapi.testclient import TestClient
from helpers import add_requester, csrf, key_pair, professional_handoff, set_requester, sign_handoff
from sqlalchemy.orm import Session

from app.modules.requesters.service import HANDOFF_FAILED_MESSAGE


@pytest.fixture(scope="module")
def keys() -> tuple[str, str]:
    return key_pair()


@pytest.fixture
def client(make_client: ClientFactory, keys: tuple[str, str]) -> TestClient:
    return make_client(professional_handoff_public_key=keys[1])


def detail(answer: Any) -> Any:
    return answer.json().get("detail")


def start(client: TestClient, token: str) -> Any:
    return client.post("/api/v1/requester/session", json={"handoff_token": token})


def test_a_professional_handoff_starts_a_booking_session_once(
    client: TestClient, database: Session, keys: tuple[str, str]
) -> None:
    """End to end: the token is minted by Professional's own code and accepted here."""
    owner_id = add_requester(database, role="OWNER", email=None)  # a phone-only account
    token = professional_handoff(keys[0], owner_id)
    started = start(client, token)
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["requester"]["role"] == "OWNER" and body["requester"]["role_label"] == "House Owner"
    assert body["requester"]["area"] == "MG Road S.O" and body["requester"]["has_service_location"] is True
    assert body["expires_in_seconds"] == 3600
    assert client.cookies.get("par_req_at") and client.cookies.get("par_req_rt")
    assert client.get("/api/v1/requester/me").json()["id"] == str(owner_id)
    assert client.get("/api/v1/requester/session").json()["csrf_token"] == body["csrf_token"]

    # The same hand-off again, from another browser: spent.
    replay = start(TestClient(client.app, headers={"Origin": FRONTEND_ORIGIN}), token)
    assert (replay.status_code, detail(replay)) == (401, "Session expired. Please sign in again.")


def test_the_role_is_read_from_professional_on_every_request(
    client: TestClient, database: Session, keys: tuple[str, str]
) -> None:
    engineer_id = add_requester(database, role="SITE_ENGINEER")
    started = start(client, sign_handoff(keys[0], engineer_id, role="OWNER"))
    assert started.json()["requester"]["role"] == "SITE_ENGINEER"  # the token's role is ignored
    # No longer a Site Engineer (category changed): refused at once.
    set_requester(database, engineer_id, requester_role=None)
    refused = client.get("/api/v1/requester/me")
    assert (refused.status_code, detail(refused)) == (
        403,
        "Book Technician is available to CREWNBUILD House Owners and Site Engineers only.",
    )
    set_requester(database, engineer_id, requester_role="SITE_ENGINEER", status="SUSPENDED")
    assert client.get("/api/v1/requester/me").status_code == 403
    set_requester(database, engineer_id, status="ACTIVE")
    assert client.get("/api/v1/requester/me").status_code == 200

    # Store Managers and other roles come back without a requester role.
    other_id = add_requester(database, role=None)
    other = start(TestClient(client.app, headers={"Origin": FRONTEND_ORIGIN}), sign_handoff(keys[0], other_id))
    assert other.status_code == 403
    unknown = start(TestClient(client.app, headers={"Origin": FRONTEND_ORIGIN}), sign_handoff(keys[0], uuid.uuid4()))
    assert unknown.status_code == 401


def test_bad_handoffs_are_refused(client: TestClient, database: Session, keys: tuple[str, str]) -> None:
    owner_id = add_requester(database)
    message = HANDOFF_FAILED_MESSAGE
    for token in (
        sign_handoff(keys[0], owner_id, iss="octabuild"),
        sign_handoff(keys[0], owner_id, lifetime=120),
        sign_handoff(key_pair()[0], owner_id),
        "x" * 40,
    ):
        answer = start(client, token)
        assert (answer.status_code, detail(answer)) == (401, message)


def test_refresh_and_logout(client: TestClient, database: Session, keys: tuple[str, str]) -> None:
    owner_id = add_requester(database)
    started = start(client, sign_handoff(keys[0], owner_id))
    first = client.cookies.get("par_req_rt")
    refreshed = client.post("/api/v1/requester/refresh")
    assert refreshed.status_code == 200 and client.cookies.get("par_req_rt") != first
    assert started.json()["csrf_token"] == refreshed.json()["csrf_token"]  # one family, one token
    assert client.post("/api/v1/requester/logout", headers=csrf(refreshed)).json() == {"signed_out": True}
    assert client.get("/api/v1/requester/me").status_code == 401
    assert client.post("/api/v1/requester/refresh").status_code == 401


def test_the_two_principals_never_mix(client: TestClient, database: Session, keys: tuple[str, str]) -> None:
    owner_id = add_requester(database)
    start(client, sign_handoff(keys[0], owner_id))
    # A requester session is not a technician session.
    assert client.get("/api/v1/auth/me").status_code == 401
    requester_access = client.cookies.get("par_req_at")
    assert client.get("/api/v1/auth/me", cookies={"par_at": requester_access}).status_code == 401
