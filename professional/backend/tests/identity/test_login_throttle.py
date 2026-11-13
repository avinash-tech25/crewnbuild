"""Password sign-in throttle (section 6.4), shared through rate_limit_events.

R6 change: 5 failures per account and 20 per address in 15 minutes (was 10 and 50, kept
in each process); the counts are in PostgreSQL, so every process sees them; an attempt
refused by the throttle counts too, so the wait grows while attempts continue."""

from typing import Any

from conftest import FRONTEND_ORIGIN, ClientFactory, make_settings
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.main import create_app
from app.modules.rate_limits.models import RateLimitEvent
from identity.helpers import STRONG_PASSWORD, create_user, sign_in

WRONG = "Wrong#Pass123"


def fail(client: TestClient, email: str = "asha@example.in", **headers: str) -> int:
    return client.post("/api/v1/auth/login", json={"email": email, "password": WRONG}, headers=headers).status_code


def test_five_failures_lock_the_account_even_with_the_right_password(client: TestClient, database: Session) -> None:
    create_user(database)
    assert [fail(client) for _ in range(5)] == [401] * 5
    locked = client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": STRONG_PASSWORD})
    assert locked.status_code == 429
    assert 0 < int(locked.headers["Retry-After"]) <= 15 * 60
    assert locked.json() == {"detail": "Too many failed sign-in attempts. Please wait 15 minutes and try again."}


def test_the_count_is_shared_by_every_process(make_client: ClientFactory, database: Session) -> None:
    create_user(database)
    first, second = make_client(), make_client()  # two apps: two processes' worth of state
    assert [fail(first) for _ in range(3)] + [fail(second) for _ in range(2)] == [401] * 5
    assert fail(first) == 429 and fail(second) == 429


def test_twenty_failures_lock_the_address_for_every_account(client: TestClient, database: Session) -> None:
    create_user(database)
    statuses = [fail(client, email=f"nobody{n}@example.in") for n in range(20)]
    assert statuses == [401] * 20
    assert (
        client.post("/api/v1/auth/login", json={"email": "asha@example.in", "password": STRONG_PASSWORD}).status_code
        == 429
    )


def test_refused_attempts_keep_the_lock_growing(client: TestClient, database: Session) -> None:
    create_user(database)
    for _ in range(5):
        fail(client)
    before = database.scalar(select(RateLimitEvent.id).where(RateLimitEvent.bucket == "login:account").limit(1))
    assert before is not None
    assert fail(client) == 429
    counted = database.scalars(select(RateLimitEvent).where(RateLimitEvent.bucket == "login:account")).all()
    assert len(counted) == 6  # the refused attempt was counted as well


def test_a_successful_sign_in_clears_the_account_count(client: TestClient, database: Session) -> None:
    create_user(database)
    for _ in range(4):
        fail(client)
    sign_in(client)
    assert [fail(client) for _ in range(4)] == [401] * 4  # a fresh allowance


def test_only_hashes_are_stored(client: TestClient, database: Session) -> None:
    create_user(database)
    fail(client)
    rows = database.scalars(select(RateLimitEvent)).all()
    assert {row.bucket for row in rows} == {"login:account", "login:address"}
    assert all(len(row.key_hash) == 64 and "asha" not in row.key_hash for row in rows)


def test_the_address_behind_a_trusted_proxy_is_the_visitor(database: Session) -> None:
    """Behind the proxy (10.0.0.1, trusted), X-Forwarded-For names the visitor, so twenty
    failures from one visitor do not lock out another; an untrusted peer's header is ignored."""
    create_user(database)
    app = create_app(make_settings(trusted_proxy_ips="10.0.0.1"))

    async def from_proxy(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await app({**scope, "client": ("10.0.0.1", 5000)}, receive, send)

    client = TestClient(from_proxy, headers={"Origin": FRONTEND_ORIGIN})
    for n in range(20):
        fail(client, email=f"nobody{n}@example.in", **{"X-Forwarded-For": "203.0.113.7"})
    assert fail(client, email="asha@example.in", **{"X-Forwarded-For": "203.0.113.7"}) == 429
    other = client.post(
        "/api/v1/auth/login",
        json={"email": "asha@example.in", "password": STRONG_PASSWORD},
        headers={"X-Forwarded-For": "203.0.113.8"},
    )
    assert other.status_code == 200
