"""Migration 0007 adds the sign-up consent columns to users (all nullable, no backfill);
downgrade drops them."""

import importlib.util
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from identity.helpers import create_user
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261117_0007_terms_and_privacy_consent.py"
COLUMNS = {"terms_version", "privacy_version", "terms_accepted_at"}


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0007; the database is left as the models describe it (upgraded)."""
    spec = importlib.util.spec_from_file_location("terms_and_privacy_consent", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    database.rollback()
    if not columns(database) >= COLUMNS:
        run(database, module.upgrade)


def run(database: Session, step: Callable[[], None]) -> None:
    with Operations.context(MigrationContext.configure(database.connection())):
        step()
    database.commit()
    database.expire_all()


def columns(database: Session) -> set[str]:
    return {column["name"] for column in inspect(database.connection()).get_columns("users", schema="professional")}


def test_downgrade_drops_and_upgrade_adds_the_consent_columns(database: Session, migration: ModuleType) -> None:
    user = create_user(database)
    run(database, migration.downgrade)
    assert not COLUMNS & columns(database)
    run(database, migration.upgrade)
    assert columns(database) >= COLUMNS
    # An account from before keeps NULLs: nothing is backfilled.
    row = database.execute(
        text("SELECT terms_version, privacy_version, terms_accepted_at FROM professional.users WHERE id = :id"),
        {"id": user.id},
    ).one()
    assert tuple(row) == (None, None, None)
    nullable = {
        column["name"]: column["nullable"]
        for column in inspect(database.connection()).get_columns("users", schema="professional")
    }
    assert all(nullable[name] for name in COLUMNS)
