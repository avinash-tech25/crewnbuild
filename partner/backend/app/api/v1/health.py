"""GET /api/v1/health/db (the old Partner /health/db, NFR-13): is the database reachable, is its
schema at the migration head, and are any of the models' tables missing from schema
`partner`.

In production the answer is the status fields only; elsewhere it also names the database,
the revisions and the tables. (The old Partner route also named them in production, and
answered an unreachable database with the driver's error message: neither any more.)
Never a credential or a URL. Answers 503 when the database cannot be reached, is behind the
migration head, or lacks a table, so a load balancer or a deploy check can act on it.
"""

from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import BACKEND_ROOT, PARTNER_SCHEMA
from app.database.base import Base
from app.database.session import engine

VERSION_TABLE = "alembic_version"


def migration_heads() -> list[str]:
    script = ScriptDirectory.from_config(Config(str(BACKEND_ROOT / "alembic.ini")))
    return sorted(script.get_heads())


def database_health(request: Request) -> JSONResponse:
    expected = sorted(table.name for table in Base.metadata.sorted_tables if table.schema == PARTNER_SCHEMA)
    heads = migration_heads()
    try:
        with engine.connect() as connection:
            database = connection.execute(text("SELECT current_database()")).scalar()
            present = set(inspect(connection).get_table_names(schema=PARTNER_SCHEMA))
            current: list[str] = []
            if VERSION_TABLE in present:
                current = sorted(
                    row[0]
                    for row in connection.execute(
                        text(f"SELECT version_num FROM {PARTNER_SCHEMA}.{VERSION_TABLE}")  # noqa: S608 constant
                    )
                )
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database_reachable": False})
    missing = [name for name in expected if name not in present]
    at_head = current == heads
    healthy = at_head and not missing
    body: dict[str, Any] = {
        "status": "ok" if healthy else "degraded",
        "database_reachable": True,
        "schema_at_head": at_head,
        "missing_table_count": len(missing),
    }
    if not request.app.state.settings.is_production():
        body |= {
            "database": database,
            "current_revision": current,
            "head_revision": heads,
            "missing_tables": missing,
            "tables": sorted(present - {VERSION_TABLE}),
        }
    return JSONResponse(status_code=200 if healthy else 503, content=body)
