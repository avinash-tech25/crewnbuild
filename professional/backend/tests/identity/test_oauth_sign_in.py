"""Google sign-in: start, state check, account creation, and refusals. The provider's
token exchange is faked; nothing leaves the machine."""

import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity import oauth_sign_in_service
from app.modules.identity.models import User, UserOAuthIdentity
from identity.helpers import create_user

GOOGLE_SETTINGS = {"google_client_id": "client-123", "google_client_secret": "secret-456"}


def google_id_token(nonce: str, email: str = "kiran@gmail.com", verified: bool = True) -> str:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": "client-123",
        "sub": "google-subject-1",
        "email": email,
        "email_verified": verified,
        "name": "Kiran",
        "nonce": nonce,
        "exp": int(time.time()) + 300,
    }
    return jwt.encode(claims, "provider-key-not-checked-by-the-service-0123456789", algorithm="HS256")


@pytest.fixture
def google_client(make_client: ClientFactory, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, dict[str, Any]]:
    provider: dict[str, Any] = {"email": "kiran@gmail.com", "verified": True}

    async def fake_exchange(provider_name: str, code: str, *args: Any) -> dict[str, Any]:
        return {"id_token": google_id_token(provider["nonce"], provider["email"], provider["verified"])}

    monkeypatch.setattr(oauth_sign_in_service, "exchange_code", fake_exchange)
    client = make_client(**GOOGLE_SETTINGS)
    client.follow_redirects = False
    return client, provider


def start(client: TestClient, provider: dict[str, Any], role: str = "OWNER") -> str:
    response = client.get(f"/api/v1/auth/oauth/google/start?role={role}")
    assert response.status_code == 302
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    provider["nonce"] = query["nonce"][0]
    return query["state"][0]


def test_unconfigured_provider_answers_503(client: TestClient, database: Session) -> None:
    assert client.get("/api/v1/auth/oauth/google/start").status_code == 503


def test_google_sign_up_creates_an_account_and_a_session(
    google_client: tuple[TestClient, dict[str, Any]], database: Session
) -> None:
    client, provider = google_client
    state = start(client, provider, role="CONTRACTOR")
    response = client.get(f"/api/v1/auth/oauth/google/callback?code=abc&state={state}")
    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:5173/oauth/callback"
    assert "pro_at=" in response.headers.get("set-cookie", "")

    user = database.scalars(select(User)).one()
    assert (user.email, user.role, user.email_verified) == ("kiran@gmail.com", "BUILDER", True)
    assert database.scalars(select(UserOAuthIdentity)).one().subject == "google-subject-1"
    assert client.get("/api/v1/auth/session").status_code == 200


def test_a_state_that_does_not_match_is_refused(
    google_client: tuple[TestClient, dict[str, Any]], database: Session
) -> None:
    client, provider = google_client
    start(client, provider)
    response = client.get("/api/v1/auth/oauth/google/callback?code=abc&state=forged")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "OAUTH_STATE_INVALID"


def test_an_existing_email_is_not_signed_in_by_a_provider(
    google_client: tuple[TestClient, dict[str, Any]], database: Session
) -> None:
    create_user(database, email="kiran@gmail.com")
    client, provider = google_client
    state = start(client, provider)
    response = client.get(f"/api/v1/auth/oauth/google/callback?code=abc&state={state}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "OAUTH_ACCOUNT_EXISTS"


def test_an_unverified_provider_email_is_refused(
    google_client: tuple[TestClient, dict[str, Any]], database: Session
) -> None:
    client, provider = google_client
    provider["verified"] = False
    state = start(client, provider)
    response = client.get(f"/api/v1/auth/oauth/google/callback?code=abc&state={state}")
    assert response.status_code == 403
