from fastapi.testclient import TestClient

from app.core.config import Settings, check_settings
from app.main import create_app


def test_health_answers_ok_under_api_v1() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_every_response_carries_a_request_id() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/health")
    assert len(response.headers["X-Request-ID"]) == 32


def test_a_well_formed_caller_request_id_is_kept() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/health", headers={"X-Request-ID": "caller-id-12345"})
    assert response.headers["X-Request-ID"] == "caller-id-12345"


def test_unprefixed_health_path_is_not_served() -> None:
    client = TestClient(create_app())
    assert client.get("/health").status_code == 404


def test_api_docs_are_served_only_in_development() -> None:
    testing = TestClient(create_app())
    assert testing.get("/docs").status_code == 404
    assert testing.get("/openapi.json").status_code == 404

    development_settings = check_settings(Settings(_env_file=None, environment="development"))
    development = TestClient(create_app(development_settings))
    assert development.get("/docs").status_code == 200
    assert development.get("/openapi.json").status_code == 200
