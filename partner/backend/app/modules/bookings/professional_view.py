"""The one read-only view Partner publishes for Professional (technical-architecture.md
section 11.2): Professional's booking payments and its account-deletion check read
bookings only through it, never Partner's tables.

Created with the tables (and by Partner's Alembic baseline in R5, from these statements);
the grant is given only where the Professional role exists.
"""

from typing import Any

from sqlalchemy import DDL, event, text

from app.database.base import Base

VIEW_NAME = "partner.v_professional_bookings"
PROFESSIONAL_ROLE = "crewnbuild_professional"

CREATE_VIEW = DDL(
    f"CREATE VIEW {VIEW_NAME} AS "  # noqa: S608 constant SQL
    "SELECT b.id, b.requested_by_user_id, b.requested_by_role, b.status, b.technician_type AS trade, "
    "b.quoted_amount, b.currency, b.completed_at, cs.service_name, t.name AS technician_name "
    "FROM partner.bookings b "
    "LEFT JOIN partner.catalog_services cs ON cs.id = b.catalog_service_id "
    "LEFT JOIN partner.technicians t ON t.id = b.technician_id"
)
GRANT_VIEW = DDL(
    f"GRANT USAGE ON SCHEMA partner TO {PROFESSIONAL_ROLE}; GRANT SELECT ON {VIEW_NAME} TO {PROFESSIONAL_ROLE}"
)
DROP_VIEW = DDL(f"DROP VIEW IF EXISTS {VIEW_NAME}")


def professional_role_exists(ddl: object, target: object, bind: Any, **_: object) -> bool:
    found = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": PROFESSIONAL_ROLE}).first()
    return found is not None


def bookings_table_created(ddl: object, target: Any, bind: Any, tables: Any = None, **_: object) -> bool:
    return tables is None or any(table.fullname == "partner.bookings" for table in tables)


event.listen(Base.metadata, "after_create", CREATE_VIEW.execute_if(callable_=bookings_table_created))  # type: ignore[arg-type]
event.listen(
    Base.metadata,
    "after_create",
    GRANT_VIEW.execute_if(
        callable_=lambda *args, **kwargs: (
            bookings_table_created(*args, **kwargs) and professional_role_exists(*args, **kwargs)
        )
    ),  # type: ignore[arg-type]
)
event.listen(Base.metadata, "before_drop", DROP_VIEW)
