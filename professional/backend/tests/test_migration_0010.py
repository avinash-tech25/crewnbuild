"""Migration 0010: site_material_usages.daily_record_id becomes nullable (Store usage has no
daily record) and the row gains an optional note; downgrade undoes both while no Store
usage exists."""

import importlib.util
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from test_migration_0007 import run

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261122_0010_store_material_usage.py"


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0010; the database is left as the models describe it (upgraded)."""
    spec = importlib.util.spec_from_file_location("store_material_usage", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    database.rollback()
    if "note" not in usage_columns(database):
        run(database, module.upgrade)


def usage_columns(database: Session) -> dict[str, bool]:
    columns = inspect(database.connection()).get_columns("site_material_usages", schema="professional")
    return {column["name"]: column["nullable"] for column in columns}


def test_downgrade_and_upgrade(database: Session, migration: ModuleType) -> None:
    assert usage_columns(database)["daily_record_id"] is True and "note" in usage_columns(database)
    run(database, migration.downgrade)
    columns = usage_columns(database)
    assert columns["daily_record_id"] is False and "note" not in columns
    run(database, migration.upgrade)
    columns = usage_columns(database)
    assert columns["daily_record_id"] is True and columns["note"] is True
