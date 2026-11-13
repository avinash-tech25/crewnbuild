"""Database engine and one session per request.

The engine connects lazily: nothing touches the database until the first query, so
the API (and GET /api/v1/health) starts even when PostgreSQL is down. The database,
roles and schemas are created by infrastructure/database/create_database_and_roles.sql,
and tables only by Alembic; the application never creates either.
"""

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import PROFESSIONAL_SCHEMA, get_settings

SCHEMA = PROFESSIONAL_SCHEMA


def build_engine() -> Engine:
    settings = get_settings()
    # Every connection works in UTC (DB-08), whatever the server's default time zone, so a
    # naive UTC datetime bound in raw SQL means the same instant it does in Python.
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        connect_args={"options": "-c timezone=UTC"},
    )


engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, rolled back if the request fails."""
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
