"""Migration 0006 removes the old store: its seven tables are dropped, every row of the
removed engineer category is turned back into a plain engineer, and the category check
allows SITE_ENGINEER only. Downgrade recreates the tables empty and the old check."""

import importlib.util
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from identity.helpers import create_user
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.accounts.models import EngineerProfile
from app.modules.identity.models import ROLE_ENGINEER, User

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261116_0006_remove_store_manager_role.py"
REMOVED = "STORE_MANAGER"


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0006; the database is left as the models describe it (upgraded)."""
    spec = importlib.util.spec_from_file_location("remove_store_manager_role", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    database.rollback()
    run(database, module.upgrade)


def run(database: Session, step: Callable[[], None]) -> None:
    with Operations.context(MigrationContext.configure(database.connection())):
        step()
    database.commit()
    database.expire_all()


def exists(database: Session, table: str) -> bool:
    return database.execute(text("SELECT to_regclass(:t)"), {"t": f"professional.{table}"}).scalar() is not None


def profile(database: Session, email: str) -> EngineerProfile:
    return database.query(User).filter(User.email == email).one().engineer_profile


def test_upgrade_clears_the_removed_category_and_drops_the_store(database: Session, migration: ModuleType) -> None:
    # The database as 0005 left it: the store's tables and the two-category check.
    run(database, migration.downgrade)
    assert all(exists(database, table) for table in migration.STORE_TABLES)
    rows = {
        "manager@example.in": ("Store Manager", REMOVED),
        "padded@example.in": ("\t store manager\r\n", None),  # the specialization alone also counts
        "site@example.in": ("Site Engineer", "SITE_ENGINEER"),
        "civil@example.in": ("Civil Engineer", None),
    }
    for index, (email, (specialization, category)) in enumerate(rows.items()):
        user = create_user(database, role=ROLE_ENGINEER, email=email, phone=f"98765003{index:02d}")
        database.execute(
            update(EngineerProfile)
            .where(EngineerProfile.user_id == user.id)
            .values(specialization=specialization, category=category)
        )
    manager_id = database.query(User.id).filter(User.email == "manager@example.in").scalar()
    database.execute(
        text(
            "INSERT INTO professional.store_items (store_manager_user_id, name, category, unit, unit_cost_amount, "
            "quantity, low_stock_threshold) VALUES (:id, 'Cement', 'Cement', 'Bag', 400, 10, 0)"
        ),
        {"id": manager_id},
    )
    database.commit()

    run(database, migration.upgrade)

    assert not any(exists(database, table) for table in migration.STORE_TABLES)
    for email in ("manager@example.in", "padded@example.in"):
        cleared = profile(database, email)
        assert (cleared.specialization, cleared.category) == (None, None), email
    site = profile(database, "site@example.in")
    assert (site.specialization, site.category) == ("Site Engineer", "SITE_ENGINEER")
    civil = profile(database, "civil@example.in")
    assert (civil.specialization, civil.category) == ("Civil Engineer", None)
    with pytest.raises(IntegrityError):
        database.execute(update(EngineerProfile).where(EngineerProfile.id == site.id).values(category=REMOVED))
        database.flush()
    database.rollback()

    # Running it again changes nothing.
    run(database, migration.upgrade)
    assert profile(database, "site@example.in").category == "SITE_ENGINEER"


def test_downgrade_recreates_the_store_tables_empty(database: Session, migration: ModuleType) -> None:
    run(database, migration.downgrade)
    for table in migration.STORE_TABLES:
        assert exists(database, table), table
        assert database.execute(text(f"SELECT count(*) FROM professional.{table}")).scalar() == 0  # noqa: S608
    # The old check is back.
    user = create_user(database, role=ROLE_ENGINEER, email="old@example.in", phone="9876500399")
    database.execute(update(EngineerProfile).where(EngineerProfile.user_id == user.id).values(category=REMOVED))
    database.commit()
    database.execute(update(EngineerProfile).where(EngineerProfile.user_id == user.id).values(category=None))
    database.commit()
