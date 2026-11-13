"""Technician sign-up, sign-in, sessions, passwords and CSRF."""

from datetime import timedelta
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from helpers import STRONG_PASSWORD, FakeEmail, browser_with, csrf, finished_technician, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_email_sender
from app.database.types import naive_utc_now
from app.modules.identity.models import Session as AuthSession
from app.modules.identity.models import Technician


@pytest.fixture
def mailbox() -> FakeEmail:
    return FakeEmail()


@pytest.fixture
def client(make_client: ClientFactory, mailbox: FakeEmail) -> TestClient:
    return make_client(overrides={get_email_sender: lambda: mailbox})


def detail(answer: Any) -> Any:
    return answer.json().get("detail")


def test_sign_up_gives_a_registration_session_only(client: TestClient, mailbox: FakeEmail, database: Session) -> None:
    sent = client.post("/api/v1/auth/signup/send-code", json={"email": " New.Tech@Example.in "})
    assert sent.status_code == 200 and sent.json()["sent"] is True, sent.text
    assert mailbox.sent[-1][0] == "new.tech@example.in"
    wrong = client.post(
        "/api/v1/auth/signup/verify-code",
        json={"email": "new.tech@example.in", "phone": "98765 00100", "code": "000000"},
    )
    assert wrong.status_code == 400
    verified = client.post(
        "/api/v1/auth/signup/verify-code",
        json={"email": "new.tech@example.in", "phone": "98765 00100", "code": mailbox.last_code()},
    )
    assert verified.status_code == 200, verified.text
    body = verified.json()
    assert body["session_type"] == "onboarding" and body["user"]["onboarding"]["step"] == "FACE"
    assert body["user"]["created_at"].endswith("+05:30")
    assert client.cookies.get("par_at") and client.cookies.get("par_rt")
    me = client.get("/api/v1/auth/me")
    assert me.json()["session_type"] == "onboarding" and me.json()["csrf_token"] == body["csrf_token"]
    # The registration session never reaches a dashboard route.
    change = client.put(
        "/api/v1/technicians/me/password",
        json={"current_password": "x", "new_password": "y", "confirm_new_password": "y"},
        headers=csrf(verified),
    )
    assert (change.status_code, detail(change)["code"]) == (403, "ONBOARDING_INCOMPLETE")
    # An unfinished account cannot sign in, and the code is spent.
    assert sign_in(client, "new.tech@example.in").status_code == 401
    again = client.post(
        "/api/v1/auth/signup/verify-code",
        json={"email": "new.tech@example.in", "phone": "9876500100", "code": mailbox.last_code()},
    )
    assert again.status_code == 400
    # Once registered, the address is taken.
    finished_technician(database, "done@example.in")
    taken = client.post("/api/v1/auth/signup/send-code", json={"email": "DONE@example.in"})
    assert (taken.status_code, detail(taken)) == (409, "This email is already registered. Log in instead.")


def test_sign_in_rehashes_an_old_bcrypt_password(client: TestClient, database: Session) -> None:
    technician = finished_technician(database, legacy_bcrypt=True)
    assert technician.password_hash and technician.password_hash.startswith("$2b$")
    assert (sign_in(client, password="Wrong#Pass123").status_code, detail(sign_in(client, password="x"))) == (
        401,
        "Invalid email or password.",
    )
    signed = sign_in(client)
    assert signed.status_code == 200, signed.text
    assert signed.json()["session_type"] == "partner"
    database.expire_all()
    assert database.get(Technician, technician.id).password_hash.startswith("$argon2id$")  # type: ignore[union-attr]
    assert sign_in(client).status_code == 200  # the new hash verifies too


def test_cookie_names_follow_auth_cookie_secure(make_client: ClientFactory, database: Session) -> None:
    finished_technician(database)
    answer = make_client(auth_cookie_secure=True).post(
        "/api/v1/auth/login", json={"email": "ravi@example.in", "password": STRONG_PASSWORD}
    )
    set_cookie = answer.headers.get_list("set-cookie")
    assert any(cookie.startswith("__Host-par_at=") and "Secure" in cookie for cookie in set_cookie)
    assert any(cookie.startswith("__Host-par_rt=") and "HttpOnly" in cookie for cookie in set_cookie)


def test_refresh_rotation_and_reuse(client: TestClient, database: Session) -> None:
    finished_technician(database)
    signed = sign_in(client)
    first_refresh = client.cookies.get("par_rt")
    rotated = client.post("/api/v1/auth/refresh")
    assert rotated.status_code == 200 and client.cookies.get("par_rt") != first_refresh
    # The just-rotated token again, within the grace period: superseded, not theft.
    stale = browser_with(client, par_rt=first_refresh).post("/api/v1/auth/refresh")
    assert (stale.status_code, detail(stale)) == (401, "REFRESH_SUPERSEDED")
    # After the grace period the same replay ends the whole family.
    old = database.scalars(select(AuthSession).where(AuthSession.revoke_reason == "rotated")).one()
    old.revoked_at = naive_utc_now() - timedelta(minutes=5)
    database.commit()
    reuse = browser_with(client, par_rt=first_refresh).post("/api/v1/auth/refresh")
    assert reuse.status_code == 401
    database.expire_all()
    assert all(row.revoked_at is not None for row in database.scalars(select(AuthSession)))
    assert client.get("/api/v1/auth/me").status_code == 401
    assert signed.status_code == 200


def test_logout_ends_the_session(client: TestClient, database: Session) -> None:
    finished_technician(database)
    sign_in(client)
    assert client.get("/api/v1/auth/me").status_code == 200
    access = client.cookies.get("par_at")
    assert client.post("/api/v1/auth/logout").json() == {"message": "Signed out."}
    assert browser_with(client, par_at=access).get("/api/v1/auth/me").status_code == 401


def test_csrf_on_cookie_writes(client: TestClient, database: Session) -> None:
    finished_technician(database)
    signed = sign_in(client)
    body = {
        "current_password": STRONG_PASSWORD,
        "new_password": "Other#Pass456",
        "confirm_new_password": "Other#Pass456",
    }
    missing = client.put("/api/v1/technicians/me/password", json=body)
    assert (missing.status_code, detail(missing)["code"]) == (403, "CSRF_FAILED")
    # An Authorization header does not skip the check (sessions are cookie-only).
    bearer = client.put("/api/v1/technicians/me/password", json=body, headers={"Authorization": "Bearer x"})
    assert detail(bearer)["code"] == "CSRF_FAILED"
    foreign = client.put(
        "/api/v1/technicians/me/password", json=body, headers={**csrf(signed), "Origin": "https://evil.example"}
    )
    assert detail(foreign)["code"] == "ORIGIN_NOT_ALLOWED"
    no_origin = client.post("/api/v1/auth/refresh", headers={"Origin": ""})
    assert detail(no_origin)["code"] == "ORIGIN_REQUIRED"
    changed = client.put("/api/v1/technicians/me/password", json=body, headers=csrf(signed))
    assert changed.json() == {"message": "Your password has been changed."}, changed.text
    # Every session ends with the change, this one included.
    assert client.get("/api/v1/auth/me").status_code == 401
    assert sign_in(client, password="Other#Pass456").status_code == 200


def test_forgot_password(client: TestClient, mailbox: FakeEmail, database: Session) -> None:
    finished_technician(database)
    other = TestClient(client.app, headers={"Origin": "http://localhost:5373"})
    sign_in(other)
    neutral = "If an account exists for this email, a reset code has been sent."
    assert (
        client.post("/api/v1/auth/password-reset/send-code", json={"email": "nobody@example.in"}).json()["message"]
        == neutral
    )
    assert (
        client.post("/api/v1/auth/password-reset/send-code", json={"email": "ravi@example.in"}).json()["message"]
        == neutral
    )
    verified = client.post(
        "/api/v1/auth/password-reset/verify-code", json={"email": "ravi@example.in", "code": mailbox.last_code()}
    )
    assert verified.status_code == 200, verified.text
    token = verified.json()["reset_token"]
    mismatch = {"reset_token": token, "new_password": "New#Pass7890", "confirm_new_password": "Nope#Pass7890"}
    assert client.post("/api/v1/auth/password-reset/reset", json=mismatch).status_code == 422
    reset = {"reset_token": token, "new_password": "New#Pass7890", "confirm_new_password": "New#Pass7890"}
    assert client.post("/api/v1/auth/password-reset/reset", json=reset).status_code == 200
    # Used once: the token is bound to the old password hash.
    again = client.post("/api/v1/auth/password-reset/reset", json=reset)
    assert (again.status_code, detail(again)) == (400, "This password reset has expired. Please start again.")
    assert other.get("/api/v1/auth/me").status_code == 401  # the other sign-in ended
    assert sign_in(client, password="New#Pass7890").status_code == 200


def test_throttle_and_suspension(client: TestClient, make_client: ClientFactory, database: Session) -> None:
    technician = finished_technician(database)
    throttled = make_client(login_max_failures_per_email=2)
    for _ in range(2):
        assert sign_in(throttled, password="Wrong#Pass123").status_code == 401
    assert sign_in(throttled).status_code == 429
    signed_in = TestClient(client.app, headers={"Origin": "http://localhost:5373"})
    assert sign_in(signed_in).status_code == 200
    technician.status = "SUSPENDED"
    database.commit()
    suspended = signed_in.get("/api/v1/auth/me")
    assert (suspended.status_code, detail(suspended)) == (
        403,
        "This account has been suspended. Contact CREWNBUILD support.",
    )
    assert sign_in(client).status_code == 403


def test_bad_input_is_422_without_echo(client: TestClient) -> None:
    answer = client.post("/api/v1/auth/login", json={"email": "x" * 300, "password": "secret-value"})
    assert answer.status_code == 422
    assert answer.json()["detail"] == "Some of the information sent is not valid."
    assert "secret-value" not in answer.text and "x" * 300 not in answer.text
    assert client.post("/api/v1/auth/signup/send-code", json={"email": "not-an-email"}).status_code == 422
