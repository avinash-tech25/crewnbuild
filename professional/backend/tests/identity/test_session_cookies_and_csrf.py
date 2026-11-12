"""Cookie names (decision 2) and the CSRF rules (cookie-only; no header skips the check)."""

from conftest import ClientFactory, make_settings
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security.access_tokens import token_digest
from app.core.security.session_cookies import access_cookie_name, refresh_cookie_name
from app.modules.identity.models import UserSession
from identity.helpers import STRONG_PASSWORD, create_user, sign_in

PROFILE_CODE = "/api/v1/auth/email/profile/send-code"


def test_cookie_names_follow_auth_cookie_secure() -> None:
    secure = make_settings(auth_cookie_secure=True)
    local = make_settings(auth_cookie_secure=False)
    assert (access_cookie_name(secure), refresh_cookie_name(secure)) == ("__Host-pro_at", "__Host-pro_rt")
    assert (access_cookie_name(local), refresh_cookie_name(local)) == ("pro_at", "pro_rt")


def test_secure_sign_in_sets_host_prefixed_secure_cookies(make_client: ClientFactory, database: Session) -> None:
    create_user(database)
    client = make_client(base_url="https://testserver", auth_cookie_secure=True)
    response = client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": STRONG_PASSWORD})
    assert response.status_code == 200
    set_cookies = response.headers.get_list("set-cookie")
    access = next(cookie for cookie in set_cookies if cookie.startswith("__Host-pro_at="))
    refresh = next(cookie for cookie in set_cookies if cookie.startswith("__Host-pro_rt="))
    for cookie in (access, refresh):
        lowered = cookie.lower()
        assert "httponly" in lowered and "secure" in lowered and "path=/" in lowered
        assert "domain=" not in lowered and "samesite=lax" in lowered
    # The secure cookies carry the session.
    assert client.get("/api/v1/auth/session").status_code == 200


def test_local_http_sign_in_sets_unprefixed_cookies_without_secure(client: TestClient, database: Session) -> None:
    create_user(database)
    response = client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": STRONG_PASSWORD})
    set_cookies = response.headers.get_list("set-cookie")
    access = next(cookie for cookie in set_cookies if cookie.startswith("pro_at="))
    assert "secure" not in access.lower()
    assert "httponly" in access.lower()
    assert not any(cookie.startswith("__Host-") for cookie in set_cookies)
    assert client.get("/api/v1/auth/session").status_code == 200


def test_the_session_row_stores_only_the_hash_of_the_csrf_token(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    row = database.scalars(select(UserSession)).one()
    assert row.csrf_secret_hash == token_digest(csrf)
    assert csrf not in (row.csrf_secret_hash, row.refresh_token_hash)


def test_a_write_without_the_csrf_token_is_refused(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    response = client.post(PROFILE_CODE, json={"email": "new@example.in"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "CSRF_FAILED"


def test_a_wrong_csrf_token_is_refused(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    response = client.post(PROFILE_CODE, json={"email": "new@example.in"}, headers={"X-CSRF-Token": "0" * 64})
    assert response.status_code == 403


def test_an_authorization_header_never_skips_the_csrf_check(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    access = client.cookies.get("pro_at")
    for header in (f"Bearer {access}", "Basic eDp5"):
        response = client.post(PROFILE_CODE, json={"email": "new@example.in"}, headers={"Authorization": header})
        assert response.status_code == 403, header
        assert response.json()["detail"]["code"] == "CSRF_FAILED"


def test_a_bearer_token_without_cookies_is_not_a_session(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    access = client.cookies.get("pro_at")
    stranger = TestClient(client.app, headers={"Origin": "http://localhost:5173"})
    assert stranger.get("/api/v1/auth/session", headers={"Authorization": f"Bearer {access}"}).status_code == 401


def test_the_right_token_passes(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    response = client.post(
        "/api/v1/auth/partner-handoff", headers={"X-CSRF-Token": csrf}
    )  # passes CSRF; 503 because no hand-off key is configured
    assert response.status_code == 503


def test_a_foreign_origin_is_refused(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    response = client.post(
        "/api/v1/auth/partner-handoff", headers={"X-CSRF-Token": csrf, "Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ORIGIN_NOT_ALLOWED"


def test_origin_only_paths_need_an_origin_when_cookies_are_present(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    no_origin = TestClient(client.app)
    no_origin.cookies = client.cookies
    response = no_origin.post("/api/v1/auth/logout")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ORIGIN_REQUIRED"
    # With the web app's Origin the same request needs no CSRF token.
    assert client.post("/api/v1/auth/logout").status_code == 200
