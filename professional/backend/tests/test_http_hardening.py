"""HTTP hardening (section 14.3, 14.4; R6)."""

from types import SimpleNamespace

from conftest import FRONTEND_ORIGIN, ClientFactory, make_settings
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.http_hardening import API_CONTENT_SECURITY_POLICY, HSTS, security_headers
from app.main import create_app

HEALTH = "/api/v1/health"
LOGIN = "/api/v1/auth/login"
BASE_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "content-security-policy": API_CONTENT_SECURITY_POLICY,
}


def assert_hardened(answer) -> None:  # type: ignore[no-untyped-def]
    for name, value in BASE_HEADERS.items():
        assert answer.headers.get(name) == value, name


def test_every_answer_carries_the_security_headers(make_client: ClientFactory, database: Session) -> None:
    client = make_client()
    assert_hardened(client.get(HEALTH))
    assert_hardened(client.get("/api/v1/auth/session"))  # 401
    assert_hardened(client.get("/api/v1/no-such-route"))  # 404
    preflight = client.options(LOGIN, headers={"Origin": FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST"})
    assert_hardened(preflight)
    assert "strict-transport-security" not in client.get(HEALTH).headers  # not production


def test_hsts_only_in_production_and_the_docs_alone_go_without_csp() -> None:
    production = SimpleNamespace(is_production=lambda: True, is_development=lambda: False)
    development = SimpleNamespace(is_production=lambda: False, is_development=lambda: True)
    assert (b"strict-transport-security", HSTS.encode()) in security_headers(production, "/api/v1/health")  # type: ignore[arg-type]
    assert not any(name == b"strict-transport-security" for name, _ in security_headers(development, "/x"))  # type: ignore[arg-type]
    assert not any(name == b"content-security-policy" for name, _ in security_headers(development, "/docs"))  # type: ignore[arg-type]
    assert any(name == b"content-security-policy" for name, _ in security_headers(production, "/docs"))  # type: ignore[arg-type]


def test_cors_allows_only_the_frontend_and_the_headers_it_uses(make_client: ClientFactory, database: Session) -> None:
    client = make_client()
    allowed = client.options(
        LOGIN,
        headers={
            "Origin": FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert allowed.headers["access-control-allow-credentials"] == "true"
    other = client.options(LOGIN, headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in other.headers
    bearer = client.options(
        LOGIN,
        headers={
            "Origin": FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert bearer.status_code == 400  # sessions are cookies; no Authorization header is allowed


def test_an_oversized_body_is_refused_with_413(make_client: ClientFactory, database: Session) -> None:
    client = make_client(max_json_body_bytes=2048)
    big = {"email": "a@example.in", "password": "x" * 4096}
    announced = client.post(LOGIN, json=big)
    assert (announced.status_code, announced.json()) == (413, {"detail": "The request is too large."})
    assert announced.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert_hardened(announced)

    def chunks():  # no Content-Length: counted as it arrives
        yield b'{"email": "a@example.in", "password": "'
        for _ in range(8):
            yield b"x" * 512
        yield b'"}'

    chunked = client.post(LOGIN, content=chunks(), headers={"Content-Type": "application/json"})
    assert chunked.status_code == 413


def test_a_validation_error_never_echoes_what_was_sent(make_client: ClientFactory, database: Session) -> None:
    client = make_client()
    answer = client.post(LOGIN, json={"email": "a@example.in", "password": {"secret": "Hunter#2-secret"}})
    assert answer.status_code == 422
    assert "Hunter#2-secret" not in answer.text and "input" not in answer.text
    assert set(answer.json()["detail"][0]) <= {"type", "loc", "msg"}


def test_an_unexpected_error_answers_without_internals(database: Session) -> None:
    app = create_app(make_settings())

    @app.get("/api/v1/boom")
    def boom() -> None:
        raise RuntimeError("database password is hunter2")

    answer = TestClient(app, raise_server_exceptions=False).get("/api/v1/boom")
    assert answer.status_code == 500
    assert "hunter2" not in answer.text and "Traceback" not in answer.text and "RuntimeError" not in answer.text
