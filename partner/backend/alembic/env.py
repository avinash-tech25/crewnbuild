"""Alembic environment for the Partner API (technical-architecture.md 16.2).

Only schema `partner` is compared and migrated; the version table is
partner.alembic_version (MG-02). Professional's schema (its tables and the requester view
Partner reads) is never reflected or touched. Professional is always migrated before
Partner (MG-01).
"""

import importlib
import pkgutil
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, text

import app.modules
from app.core.config import get_settings
from app.database.base import Base
from app.database.session import SCHEMA

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def import_all_models() -> None:
    """Register every table on Base.metadata by importing each module's models.py."""
    for module_info in pkgutil.iter_modules(app.modules.__path__):
        try:
            importlib.import_module(f"app.modules.{module_info.name}.models")
        except ModuleNotFoundError as error:
            if error.name != f"app.modules.{module_info.name}.models":
                raise


import_all_models()
target_metadata = Base.metadata


def include_name(name: str | None, type_: str, parent_names: dict[str, str | None]) -> bool:
    # Reflect only this service's schema.
    if type_ == "schema":
        return name == SCHEMA
    return True


def include_object(obj: object, name: str | None, type_: str, reflected: bool, compare_to: object) -> bool:
    # Only this service's tables are compared and migrated.
    if type_ == "table":
        return getattr(obj, "schema", None) == SCHEMA
    return True


def database_url() -> str:
    return get_settings().database_url.get_secret_value()


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_name=include_name,
        include_object=include_object,
        version_table="alembic_version",
        version_table_schema=SCHEMA,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url())
    with engine.connect() as connection:
        # A no-op when infrastructure/database/create_database_and_roles.sql already created it.
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            include_name=include_name,
            include_object=include_object,
            version_table="alembic_version",
            version_table_schema=SCHEMA,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
