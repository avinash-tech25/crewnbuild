"""GET /api/v1/health/db (the old /health/db, NFR-13)."""

from typing import Any

import pytest
from conftest import ClientFactory
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1 import health
from app.core.config import Settings


def test_a_healthy_database(make_client: ClientFactory, database: Session) -> None:
    answer = make_client().get("/api/v1/health/db")  # no session needed
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["status"] == "ok" and body["database_reachable"] and body["schema_at_head"]
    assert body["missing_tables"] == [] and body["missing_table_count"] == 0
    assert body["database"] == "crewnbuild_test" and "users" in body["tables"]
    assert body["current_revision"] == body["head_revision"] == []  # no revision until the R5 baseline


def test_behind_the_head_or_missing_a_table_is_503(
    make_client: ClientFactory, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = make_client()
    monkeypatch.setattr(health, "migration_heads", lambda: ["r5_baseline"])
    behind = client.get("/api/v1/health/db")
    assert behind.status_code == 503 and behind.json()["schema_at_head"] is False
    assert behind.json()["head_revision"] == ["r5_baseline"]
    monkeypatch.setattr(health, "migration_heads", lambda: [])

    real_inspect = health.inspect

    class WithoutUsers:
        def __init__(self, connection: Any) -> None:
            self.inspector = real_inspect(connection)

        def get_table_names(self, schema: str) -> list[str]:
            return [name for name in self.inspector.get_table_names(schema=schema) if name != "users"]

    monkeypatch.setattr(health, "inspect", WithoutUsers)
    missing = client.get("/api/v1/health/db")
    assert missing.status_code == 503
    assert (missing.json()["status"], missing.json()["missing_tables"]) == ("degraded", ["users"])


def test_production_names_nothing(
    make_client: ClientFactory, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = make_client()
    monkeypatch.setattr(Settings, "is_production", lambda self: True)
    answer = client.get("/api/v1/health/db")
    assert answer.json() == {
        "status": "ok",
        "database_reachable": True,
        "schema_at_head": True,
        "missing_table_count": 0,
    }


def test_an_unreachable_database_is_503_without_details(
    make_client: ClientFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreachable = create_engine(
        "postgresql+psycopg://nobody:not-a-secret@127.0.0.1:9/none", connect_args={"connect_timeout": 2}
    )
    monkeypatch.setattr(health, "engine", unreachable)
    answer = make_client().get("/api/v1/health/db")
    assert answer.status_code == 503
    assert answer.json() == {"status": "unavailable", "database_reachable": False}
