"""Test setup. Settings are fixed here, before the app is imported, so tests never depend on
a developer's backend/.env, with one exception: the address of the test database.

The database is crewnbuild_test only (section 17). Its address comes from
TEST_DATABASE_URL, or else from the app's own DATABASE_URL with the database name
switched to crewnbuild_test. Neither is printed. Any other database name is refused.
Tests that use the database create every table in schema `professional` once, empty
them after each test (children first, only the tables written), and drop them at the end.
"""

import os
import secrets
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.engine import make_url

TEST_DATABASE_NAME = "crewnbuild_test"


def _test_database_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL", "").strip()
    if explicit:
        url = make_url(explicit)
    else:
        from app.core.config import Settings

        configured = Settings().database_url.get_secret_value().strip()
        if not configured:
            return f"postgresql+psycopg://crewnbuild_professional:unset@localhost:5432/{TEST_DATABASE_NAME}"
        url = make_url(configured).set(database=TEST_DATABASE_NAME)
    if url.database != TEST_DATABASE_NAME:
        raise RuntimeError(f"Tests run only against {TEST_DATABASE_NAME}.")
    return url.render_as_string(hide_password=False)


TEST_DATABASE_URL = _test_database_url()
JWT_SECRET = secrets.token_urlsafe(64)
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["JWT_SECRET_KEY"] = JWT_SECRET
os.environ["TEST_OTP_LOGIN_ENABLED"] = "false"
os.environ["RAZORPAY_ALLOW_MOCK"] = "false"

# From here on no Settings object reads backend/.env.
from app.core.config import Settings, check_settings, get_settings  # noqa: E402

Settings.model_config["env_file"] = None
get_settings.cache_clear()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import PROFESSIONAL_SCHEMA  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402

FRONTEND_ORIGIN = "http://localhost:5173"


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": TEST_DATABASE_URL,
        "jwt_secret_key": JWT_SECRET,
        "auth_cookie_secure": False,
        "frontend_origin": FRONTEND_ORIGIN,
    }
    values.update(overrides)
    return check_settings(Settings(_env_file=None, **values))


@pytest.fixture(scope="session")
def database_tables() -> Iterator[None]:
    with engine.connect() as connection:
        if connection.execute(text("SELECT current_database()")).scalar() != TEST_DATABASE_NAME:
            raise RuntimeError(f"Tests run only against {TEST_DATABASE_NAME}.")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    stamp_head(engine, PROFESSIONAL_SCHEMA)
    yield
    unstamp(engine, PROFESSIONAL_SCHEMA)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def database(database_tables: None) -> Iterator[Session]:
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()
    empty_written_tables()


def qualified(table: Any) -> str:
    return f'"{table.schema}"."{table.name}"'


def empty_written_tables() -> None:
    """Empty every table the test wrote to, and only those, children first.

    One query finds the tables holding rows. Each is emptied with DELETE (milliseconds),
    in reverse dependency order so no foreign key is in the way; a table whose own
    trigger forbids DELETE (the append-only admin audit log), or whose DELETE is refused
    because two tables reference each other, is TRUNCATEd (CASCADE). The old
    TRUNCATE ... CASCADE of all ~100 tables cost ~1.8 s per test. Tests keep their real
    commits, and every test still starts with every table empty.
    """
    tables = list(Base.metadata.sorted_tables)
    probe = " UNION ALL ".join(
        f"SELECT {index} WHERE EXISTS (SELECT 1 FROM {qualified(table)})"  # noqa: S608 (our own table names)
        for index, table in enumerate(tables)
    )
    with engine.begin() as connection:
        written = [tables[index] for (index,) in connection.execute(text(probe))]
        guarded = {
            name
            for (name,) in connection.execute(
                text(
                    "SELECT DISTINCT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = :schema"
                ),
                {"schema": PROFESSIONAL_SCHEMA},
            )
        }
        refused = [table for table in written if table.name in guarded]
        for table in reversed(written):
            if table.name in guarded:
                continue
            try:
                with connection.begin_nested():
                    connection.execute(text(f"DELETE FROM {qualified(table)}"))  # noqa: S608 (our own table names)
            except IntegrityError:
                # Two tables referencing each other (project_awards and their offers).
                refused.append(table)
        if refused:
            connection.execute(text(f"TRUNCATE {', '.join(qualified(table) for table in refused)} CASCADE"))


ClientFactory = Callable[..., TestClient]


@pytest.fixture
def make_client(database: Session) -> ClientFactory:
    """A TestClient for an app built with make_settings(**overrides). Requests carry the
    web app's Origin, as a browser's would."""

    def build(
        base_url: str = "http://testserver", overrides: dict[Any, Any] | None = None, **settings: Any
    ) -> TestClient:
        app = create_app(make_settings(**settings))
        for dependency, replacement in (overrides or {}).items():
            app.dependency_overrides[dependency] = replacement
        return TestClient(app, base_url=base_url, headers={"Origin": FRONTEND_ORIGIN})

    return build


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return make_client()


def stamp_head(engine: Any, schema: str) -> None:
    """Record the Alembic head in {schema}.alembic_version, as a migrated database has it:
    create_all builds the same tables as the migrations (scripts/migrate.py --check)."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend = Path(__file__).resolve().parents[1]
    heads = ScriptDirectory.from_config(Config(str(backend / "alembic.ini"))).get_heads()
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE IF EXISTS "{schema}".alembic_version'))
        connection.execute(text(f'CREATE TABLE "{schema}".alembic_version (version_num varchar(32) PRIMARY KEY)'))
        for head in heads:
            connection.execute(text(f'INSERT INTO "{schema}".alembic_version VALUES (:v)'), {"v": head})  # noqa: S608 our schema


def unstamp(engine: Any, schema: str) -> None:
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE IF EXISTS "{schema}".alembic_version'))


def app_routes(app: Any) -> list[Any]:
    """Every route as the app serves it, with its full path (/api/v1/...).

    FastAPI 0.16x keeps an included router as one entry in app.routes; the routes behind
    it are listed by iter_route_contexts. Each is a copy of the APIRoute (or
    APIWebSocketRoute) with the served path and methods, so tests read it as before."""
    import copy

    from fastapi.routing import iter_route_contexts

    routes = []
    for context in iter_route_contexts(app.routes):
        route = copy.copy(context.route)
        route.path = context.path
        if context.methods is not None:
            route.methods = set(context.methods)
        routes.append(route)
    return routes
