"""Test setup. Settings are fixed here, before the app is imported, so tests never depend on
a developer's backend/.env, with one exception: the address of the test database.

The database is crewnbuild_test only (section 17), reached as the Partner role. Its
address comes from TEST_DATABASE_URL, or else from the app's own DATABASE_URL with the
database name switched to crewnbuild_test. Neither is printed; any other database name is
refused. Tests that use the database create every table in schema `partner` once, empty
them after each test, and drop them at the end.

Professional's requester view (professional.v_partner_requesters) belongs to
Professional's schema, which the Partner role may read but not create in. The tests point
PROFESSIONAL_SCHEMA at the test schema and create a stand-in table there with the view's
columns (REQUESTERS_STAND_IN), dropped at the end.
"""

import os
import secrets
from collections.abc import Callable, Iterator
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
            return f"postgresql+psycopg://crewnbuild_partner:unset@localhost:5432/{TEST_DATABASE_NAME}"
        url = make_url(configured).set(database=TEST_DATABASE_NAME)
    if url.database != TEST_DATABASE_NAME:
        raise RuntimeError(f"Tests run only against {TEST_DATABASE_NAME}.")
    return url.render_as_string(hide_password=False)


TEST_DATABASE_URL = _test_database_url()
TEST_SCHEMA = "partner"
JWT_SECRET = secrets.token_urlsafe(64)
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["JWT_SECRET_KEY"] = JWT_SECRET
os.environ["PROFESSIONAL_SCHEMA"] = TEST_SCHEMA
os.environ["PROFESSIONAL_HANDOFF_PUBLIC_KEY"] = ""
os.environ["SMTP_PASSWORD"] = ""

# From here on no Settings object reads backend/.env.
from app.core.config import Settings, check_settings, get_settings  # noqa: E402

Settings.model_config["env_file"] = None
get_settings.cache_clear()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.database.base import Base  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.identity.auth_service import login_throttle  # noqa: E402

FRONTEND_ORIGIN = "http://localhost:5373"
REQUESTERS_STAND_IN = f"{TEST_SCHEMA}.v_partner_requesters"


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": TEST_DATABASE_URL,
        "jwt_secret_key": JWT_SECRET,
        "auth_cookie_secure": False,
        "frontend_origin": FRONTEND_ORIGIN,
        "professional_schema": TEST_SCHEMA,
    }
    values.update(overrides)
    return check_settings(Settings(_env_file=None, **values))


@pytest.fixture(scope="session")
def database_tables() -> Iterator[None]:
    try:
        with engine.connect() as connection:
            if connection.execute(text("SELECT current_database()")).scalar() != TEST_DATABASE_NAME:
                raise RuntimeError(f"Tests run only against {TEST_DATABASE_NAME}.")
    except OperationalError:
        pytest.exit(
            "Cannot reach crewnbuild_test as the Partner role: set the crewnbuild_partner password in "
            "DATABASE_URL (partner/backend/.env) or TEST_DATABASE_URL.",
            returncode=3,
        )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {REQUESTERS_STAND_IN}"))
        connection.execute(
            text(
                f"CREATE TABLE {REQUESTERS_STAND_IN} (id uuid PRIMARY KEY, name varchar(150), email varchar(255), "
                "phone varchar(20), status varchar(20), address text, pincode varchar(10), location varchar(180), "
                "requester_role varchar(20))"
            )
        )
    yield
    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {REQUESTERS_STAND_IN}"))
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def database(database_tables: None) -> Iterator[Session]:
    session = SessionLocal()
    login_throttle.reset()
    yield session
    session.rollback()
    session.close()
    with engine.begin() as connection:
        tables = ", ".join(f'"{TEST_SCHEMA}"."{table.name}"' for table in Base.metadata.sorted_tables)
        connection.execute(text(f"TRUNCATE {tables}, {REQUESTERS_STAND_IN}"))


ClientFactory = Callable[..., TestClient]


@pytest.fixture
def make_client(database: Session) -> ClientFactory:
    """A TestClient for an app built with make_settings(**overrides). Requests carry the web
    app's Origin, as a browser's would."""

    def build(overrides: dict[Any, Any] | None = None, **settings: Any) -> TestClient:
        app = create_app(make_settings(**settings))
        for dependency, replacement in (overrides or {}).items():
            app.dependency_overrides[dependency] = replacement
        return TestClient(app, headers={"Origin": FRONTEND_ORIGIN})

    return build
