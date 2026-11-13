"""What Partner publishes for Professional (technical-architecture.md section 11.2).

* partner.v_professional_bookings: the one read-only view Professional's booking payments
  and account-deletion check read bookings through; SELECT granted to
  crewnbuild_professional only, never the tables.
* REFERENCES on partner.bookings (id) to crewnbuild_professional, so Professional's
  booking_payment_orders.booking_id can reference the booking (ON DELETE RESTRICT).

Created with the tables (create_all, for the tests) and by the Alembic baseline from these
same statements. The grants are given only where the Professional role exists.
"""

from typing import Any

from sqlalchemy import DDL, event, text

from app.database.base import Base

VIEW_NAME = "partner.v_professional_bookings"
PROFESSIONAL_ROLE = "crewnbuild_professional"

CREATE_VIEW_SQL = (
    f"CREATE VIEW {VIEW_NAME} AS "  # noqa: S608 constant SQL
    "SELECT b.id, b.requested_by_user_id, b.requested_by_role, b.status, b.technician_type AS trade, "
    "b.quoted_amount, b.currency, b.completed_at, cs.service_name, t.name AS technician_name "
    "FROM partner.bookings b "
    "LEFT JOIN partner.catalog_services cs ON cs.id = b.catalog_service_id "
    "LEFT JOIN partner.technicians t ON t.id = b.technician_id"
)
GRANT_SQL = (
    f"GRANT USAGE ON SCHEMA partner TO {PROFESSIONAL_ROLE}",
    f"GRANT SELECT ON {VIEW_NAME} TO {PROFESSIONAL_ROLE}",
    f"GRANT REFERENCES (id) ON partner.bookings TO {PROFESSIONAL_ROLE}",
)
DROP_VIEW_SQL = f"DROP VIEW IF EXISTS {VIEW_NAME}"


def professional_role_exists(ddl: object, target: object, bind: Any, **_: object) -> bool:
    found = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": PROFESSIONAL_ROLE}).first()
    return found is not None


def bookings_table_created(ddl: object, target: Any, bind: Any, tables: Any = None, **_: object) -> bool:
    return tables is None or any(table.fullname == "partner.bookings" for table in tables)


def _grants_if_professional(ddl: object, target: Any, bind: Any, **kwargs: Any) -> bool:
    return bookings_table_created(ddl, target, bind, **kwargs) and professional_role_exists(ddl, target, bind)


event.listen(Base.metadata, "after_create", DDL(CREATE_VIEW_SQL).execute_if(callable_=bookings_table_created))  # type: ignore[arg-type]
for statement in GRANT_SQL:
    event.listen(Base.metadata, "after_create", DDL(statement).execute_if(callable_=_grants_if_professional))  # type: ignore[arg-type]
event.listen(Base.metadata, "before_drop", DDL(DROP_VIEW_SQL))
