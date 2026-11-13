"""GET /api/v1/health and /api/v1/health/db."""

from conftest import ClientFactory
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import create_app


def test_health_answers_ok_under_api_v1() -> None:
    client = TestClient(create_app())
    assert client.get("/api/v1/health").json() == {"status": "ok", "application": "partner"}
    assert client.get("/health").status_code == 404
    assert len(client.get("/api/v1/health").headers["X-Request-ID"]) == 32


def test_database_health(make_client: ClientFactory, database: Session) -> None:
    body = make_client().get("/api/v1/health/db").json()
    assert body["status"] == "ok" and body["missing_tables"] == []
    assert {"technicians", "sessions", "email_otp_codes"} <= set(body["tables"])
