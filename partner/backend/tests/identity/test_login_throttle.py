"""Technician sign-in throttle (section 6.4), shared through rate_limit_events.

R6 change: 5 failures per e-mail and 20 per address in 15 minutes (was 10 and 50, kept in
each process); counted in PostgreSQL, so every process sees them; a refused attempt counts
too, so the wait grows while attempts continue."""

from typing import Any

from conftest import FRONTEND_ORIGIN, ClientFactory, make_settings
from fastapi.testclient import TestClient
from helpers import STRONG_PASSWORD, finished_technician, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.main import create_app
from app.modules.rate_limits.models import RateLimitEvent

WRONG = "Wrong#Pass123"


def test_five_failures_lock_the_account_even_with_the_right_password(
    make_client: ClientFactory, database: Session
) -> None:
    finished_technician(database)
    client = make_client()
    assert [sign_in(client, password=WRONG).status_code for _ in range(5)] == [401] * 5
    locked = sign_in(client)
    assert locked.status_code == 429 and 0 < int(locked.headers["Retry-After"]) <= 900


def test_the_count_is_shared_by_every_process(make_client: ClientFactory, database: Session) -> None:
    finished_technician(database)
    first, second = make_client(), make_client()
    statuses = [sign_in(first, password=WRONG).status_code for _ in range(3)]
    statuses += [sign_in(second, password=WRONG).status_code for _ in range(2)]
    assert statuses == [401] * 5
    assert sign_in(first).status_code == sign_in(second).status_code == 429


def test_twenty_failures_lock_the_address(make_client: ClientFactory, database: Session) -> None:
    finished_technician(database)
    client = make_client()
    assert [sign_in(client, email=f"no{n}@example.in", password=WRONG).status_code for n in range(20)] == [401] * 20
    assert sign_in(client).status_code == 429


def test_success_clears_the_count_and_only_hashes_are_stored(make_client: ClientFactory, database: Session) -> None:
    finished_technician(database)
    client = make_client()
    for _ in range(4):
        sign_in(client, password=WRONG)
    assert sign_in(client).status_code == 200
    assert [sign_in(client, password=WRONG).status_code for _ in range(4)] == [401] * 4
    rows = database.scalars(select(RateLimitEvent)).all()
    assert rows and all(len(row.key_hash) == 64 and "ravi" not in row.key_hash for row in rows)


def test_the_address_behind_a_trusted_proxy_is_the_visitor(database: Session) -> None:
    finished_technician(database)
    app = create_app(make_settings(trusted_proxy_ips="10.0.0.1"))

    async def from_proxy(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await app({**scope, "client": ("10.0.0.1", 5000)}, receive, send)

    client = TestClient(from_proxy, headers={"Origin": FRONTEND_ORIGIN})

    def attempt(email: str, password: str, visitor: str) -> int:
        answer = client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}, headers={"X-Forwarded-For": visitor}
        )
        return answer.status_code

    for n in range(20):
        attempt(f"no{n}@example.in", WRONG, "203.0.113.7")
    assert attempt("ravi@example.in", STRONG_PASSWORD, "203.0.113.7") == 429
    assert attempt("ravi@example.in", STRONG_PASSWORD, "203.0.113.8") == 200
