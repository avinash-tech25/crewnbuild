"""Migration 0003 adds the registration consent columns to technicians (all nullable, no
backfill); downgrade drops them."""

import importlib.util
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from helpers import finished_technician
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261117_0003_terms_and_privacy_consent.py"
COLUMNS = {"terms_version", "privacy_version", "terms_accepted_at"}


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0003; the database is left as the models describe it (upgraded)."""
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


def table_columns(database: Session) -> list[dict]:
    return inspect(database.connection()).get_columns("technicians", schema="partner")


def columns(database: Session) -> set[str]:
    return {column["name"] for column in table_columns(database)}


def test_downgrade_drops_and_upgrade_adds_the_consent_columns(database: Session, migration: ModuleType) -> None:
    technician = finished_technician(database, "done@example.in")
    run(database, migration.downgrade)
    assert not COLUMNS & columns(database)
    run(database, migration.upgrade)
    assert columns(database) >= COLUMNS
    # An account from before keeps NULLs: nothing is backfilled.
    row = database.execute(
        text("SELECT terms_version, privacy_version, terms_accepted_at FROM partner.technicians WHERE id = :id"),
        {"id": technician.id},
    ).one()
    assert tuple(row) == (None, None, None)
    assert all(column["nullable"] for column in table_columns(database) if column["name"] in COLUMNS)
