"""Migration 0011 adds Viswa's two chat tables; downgrade drops them."""

import importlib.util
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from test_migration_0007 import run

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261123_0011_assistant_conversations.py"
TABLES = {"assistant_conversations", "assistant_messages"}


def tables(database: Session) -> set[str]:
    return set(inspect(database.connection()).get_table_names(schema="professional")) & TABLES


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0011; the database is left as the models describe it (upgraded)."""
    spec = importlib.util.spec_from_file_location("assistant_conversations", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    database.rollback()
    if tables(database) != TABLES:
        run(database, module.upgrade)


def test_downgrade_drops_and_upgrade_adds_the_chat_tables(database: Session, migration: ModuleType) -> None:
    assert tables(database) == TABLES
    run(database, migration.downgrade)
    assert tables(database) == set()
    run(database, migration.upgrade)
    assert tables(database) == TABLES
    keys = inspect(database.connection()).get_foreign_keys("assistant_conversations", schema="professional")
    assert [(key["referred_table"], key["options"].get("ondelete")) for key in keys] == [("users", "CASCADE")]
