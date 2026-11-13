"""Password sign-in, the session answer, refresh rotation and reuse detection, sign-out."""

from datetime import timedelta

import bcrypt
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security.access_tokens import token_digest
from app.modules.identity.models import ROLE_BUILDER, ROLE_GLOBAL_SUPER_ADMIN, ROLE_MANAGER, User, UserSession
from app.modules.identity.session_service import utc_now
from identity.helpers import STRONG_PASSWORD, create_user, sign_in


def refresh(client: TestClient) -> "object":
    return client.post("/api/v1/auth/refresh")


def test_password_sign_in_returns_the_account_and_a_csrf_token(client: TestClient, database: Session) -> None:
    user = create_user(database)
    response = client.post("/api/v1/auth/login", json={"email": "ASHA@example.in", "password": STRONG_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["id"] == str(user.id)
    assert body["user"]["role"] == "OWNER"
    assert body["user"]["country_of_residence"] == "India"
    assert body["user"]["owner_profile"]["budget"] == 0.0
    assert len(body["csrf_token"]) == 64
    assert "pro_at" in response.cookies and "pro_rt" in response.cookies


def test_wrong_password_and_unknown_account_get_the_same_answer(client: TestClient, database: Session) -> None:
    create_user(database)
    wrong = client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": "Wrong#Pass123"})
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@example.in", "password": "Wrong#Pass123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid username/email or password"}


def test_sign_in_by_account_name_still_works(client: TestClient, database: Session) -> None:
    create_user(database, name="Asha Rao")
    sign_in(client, identifier="asha rao")


def test_suspended_and_partner_accounts_cannot_sign_in(client: TestClient, database: Session) -> None:
    create_user(database, email="suspended@example.in", status="SUSPENDED")
    create_user(database, email="partner@example.in", role="PROFESSIONAL", phone="")
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "suspended@example.in", "password": STRONG_PASSWORD}
        ).status_code
        == 403
    )
    partner = client.post("/api/v1/auth/login", json={"email": "partner@example.in", "password": STRONG_PASSWORD})
    assert partner.status_code == 403
    assert "CREWNBUILD Partner" in partner.json()["detail"]


def test_global_super_admin_has_no_password_sign_in(client: TestClient, database: Session) -> None:
    create_user(database, email="global@example.in", role=ROLE_GLOBAL_SUPER_ADMIN)
    response = client.post("/api/v1/auth/login", json={"email": "global@example.in", "password": STRONG_PASSWORD})
    assert response.status_code == 403


def test_a_legacy_bcrypt_hash_is_replaced_by_argon2id_after_sign_in(client: TestClient, database: Session) -> None:
    legacy = bcrypt.hashpw(STRONG_PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
    user = create_user(database, password_hash=legacy)
    sign_in(client)
    database.expire_all()
    stored = database.get(User, user.id)
    assert stored is not None
    assert stored.password_hash.startswith("$argon2id$")
    # The new hash still accepts the same password.
    client.post("/api/v1/auth/logout")
    sign_in(client)


def test_session_answer_after_a_reload(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    assert response.json()["csrf_token"] == csrf


def test_no_cookie_is_401(client: TestClient, database: Session) -> None:
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid token"}


def test_refresh_rotates_the_refresh_token_and_keeps_the_csrf_token(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    first_refresh = client.cookies.get("pro_rt")
    response = client.post("/api/v1/auth/refresh")
    assert response.status_code == 200
    assert response.json()["csrf_token"] == csrf
    assert client.cookies.get("pro_rt") != first_refresh

    old_row = database.scalars(
        select(UserSession).where(UserSession.refresh_token_hash == token_digest(first_refresh or ""))
    ).one()
    assert old_row.revoke_reason == "rotated"
    assert old_row.replaced_by_session_id is not None
    assert client.get("/api/v1/auth/session").status_code == 200


def test_a_just_rotated_token_is_superseded_not_stolen(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    first_refresh = client.cookies.get("pro_rt") or ""
    assert client.post("/api/v1/auth/refresh").status_code == 200
    second_tab = client.post("/api/v1/auth/refresh", cookies={"pro_rt": first_refresh})
    assert second_tab.status_code == 401
    assert second_tab.json() == {"detail": "REFRESH_SUPERSEDED"}
    assert "set-cookie" not in second_tab.headers  # the newer cookies are kept
    assert client.get("/api/v1/auth/session").status_code == 200


def test_reusing_an_old_refresh_token_ends_the_whole_family(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    first_refresh = client.cookies.get("pro_rt") or ""
    assert client.post("/api/v1/auth/refresh").status_code == 200
    # Move the rotation outside the grace period: the copy is now a stolen token.
    old_row = database.scalars(
        select(UserSession).where(UserSession.refresh_token_hash == token_digest(first_refresh))
    ).one()
    old_row.revoked_at = utc_now() - timedelta(seconds=60)
    database.commit()

    stolen = TestClient(client.app, headers={"Origin": "http://localhost:5173"})
    assert stolen.post("/api/v1/auth/refresh", cookies={"pro_rt": first_refresh}).status_code == 401
    # The legitimate browser is signed out too.
    assert client.get("/api/v1/auth/session").status_code == 401
    reasons = set(database.scalars(select(UserSession.revoke_reason)))
    assert "reuse" in reasons


def test_an_idle_session_expires(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    for row in database.scalars(select(UserSession)):
        row.last_used_at = utc_now() - timedelta(days=31)
    database.commit()
    assert client.get("/api/v1/auth/session").status_code == 401
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_a_suspension_ends_existing_sessions(client: TestClient, database: Session) -> None:
    user = create_user(database)
    sign_in(client)
    user.status = "SUSPENDED"
    database.commit()
    assert client.get("/api/v1/auth/session").status_code == 403
    assert client.post("/api/v1/auth/refresh").status_code == 403


def test_logout_ends_the_session_and_clears_the_cookies(client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(client)
    access = client.cookies.get("pro_at") or ""
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"signed_out": True}
    assert client.get("/api/v1/auth/session", cookies={"pro_at": access}).status_code == 401


def test_refresh_without_a_cookie_is_401(client: TestClient, database: Session) -> None:
    response = client.post("/api/v1/auth/refresh")
    assert response.status_code == 401
    assert response.json() == {"detail": "Session expired. Please sign in again."}


def test_password_sign_in_is_for_administrators_where_whatsapp_sign_in_is_on(
    make_client: "object", database: Session
) -> None:
    from identity.helpers import WHATSAPP_SETTINGS

    client = make_client(**WHATSAPP_SETTINGS)  # type: ignore[operator]
    create_user(database, email="builder@example.in", role=ROLE_BUILDER)
    create_user(database, email="manager@example.in", role=ROLE_MANAGER)
    refused = client.post("/api/v1/auth/login", json={"email": "builder@example.in", "password": STRONG_PASSWORD})
    assert refused.status_code == 403
    assert refused.json() == {"detail": "Sign in with your mobile number and the WhatsApp code."}
    sign_in(client, identifier="manager@example.in")
