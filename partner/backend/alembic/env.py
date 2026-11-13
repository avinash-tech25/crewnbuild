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
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.types import TypeDecorator

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


# Foreign keys to the other service's schema. The models create them with a DDL event
# (only once the other schema can be referenced) and the migrations add them explicitly,
# so autogenerate leaves them alone.
CROSS_SCHEMA_KEYS = {"fk_bookings__requested_by_user_id__users"}


def include_object(obj: object, name: str | None, type_: str, reflected: bool, compare_to: object) -> bool:
    # Only this service's tables are compared and migrated.
    if type_ == "table":
        return getattr(obj, "schema", None) == SCHEMA
    return not (type_ == "foreign_key_constraint" and name in CROSS_SCHEMA_KEYS)


def render_item(type_: str, obj: object, autogen_context: object) -> str | bool:
    # A TypeDecorator (NaiveUtcTimestamp) is written as the column type it stores, so the
    # migrations never import application code.
    if type_ == "type" and isinstance(obj, TypeDecorator):
        return f"sa.{obj.impl!r}"
    return False


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
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


PROFESSIONAL_FIRST = (
    "Professional's baseline has not been applied to this database: migrate Professional first "
    "(python scripts/migrate.py does both, in order). Partner needs professional.users and "
    "professional.v_partner_requesters (MG-01)."
)


def require_professional_baseline(connection: Connection) -> None:
    """MG-01: Partner's baseline refers to professional.users and the requester view."""
    found = connection.execute(
        text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'professional' "
            "AND table_name IN ('users', 'v_partner_requesters')"
        )
    ).scalar()
    if found != 2:
        raise SystemExit(PROFESSIONAL_FIRST)


def run_migrations_online() -> None:
    engine = create_engine(database_url())
    with engine.connect() as connection:
        require_professional_baseline(connection)
        # infrastructure/database/create_database_and_roles.sql creates the schema, owned by
        # this service's role; the role has no CREATE on the database, and PostgreSQL checks
        # that even for IF NOT EXISTS, so look first.
        exists = connection.execute(text("SELECT 1 FROM pg_namespace WHERE nspname = :s"), {"s": SCHEMA}).first()
        if exists is None:
            connection.execute(text(f'CREATE SCHEMA "{SCHEMA}"'))
        # End the transaction those statements began, or Alembic would run inside it and
        # leave the commit to us.
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
            render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
