"""What Professional publishes for Partner (technical-architecture.md section 11.1).

* professional.v_partner_requesters: the one read-only view Partner reads House Owners and
  Site Engineers through; SELECT granted to crewnbuild_partner.
* REFERENCES on professional.users (id) to crewnbuild_partner, so Partner's
  bookings.requested_by_user_id can reference the account (ON DELETE RESTRICT).

Created with the tables (create_all, for the tests) and by the Alembic baseline from these
same statements. The grants are given only where the Partner role exists.
"""

from typing import Any

from sqlalchemy import DDL, event, text

from app.core.config import PROFESSIONAL_SCHEMA
from app.database.base import Base

VIEW_NAME = f"{PROFESSIONAL_SCHEMA}.v_partner_requesters"
PARTNER_ROLE = "crewnbuild_partner"

CREATE_VIEW_SQL = (
    f"CREATE VIEW {VIEW_NAME} AS "  # noqa: S608 constant SQL
    "SELECT u.id, u.name, u.email, u.phone, u.status, u.address, u.pincode, u.location, "
    "CASE WHEN u.role = 'OWNER' THEN 'OWNER' "
    "WHEN u.role = 'ENGINEER' AND ep.category = 'SITE_ENGINEER' THEN 'SITE_ENGINEER' "
    "END AS requester_role "
    f"FROM {PROFESSIONAL_SCHEMA}.users u "
    f"LEFT JOIN {PROFESSIONAL_SCHEMA}.engineer_profiles ep ON ep.user_id = u.id "
    "WHERE u.deleted_at IS NULL"
)
GRANT_SQL = (
    f"GRANT USAGE ON SCHEMA {PROFESSIONAL_SCHEMA} TO {PARTNER_ROLE}",
    f"GRANT SELECT ON {VIEW_NAME} TO {PARTNER_ROLE}",
    f"GRANT REFERENCES (id) ON {PROFESSIONAL_SCHEMA}.users TO {PARTNER_ROLE}",
)
DROP_VIEW_SQL = f"DROP VIEW IF EXISTS {VIEW_NAME}"


def partner_role_exists(ddl: object, target: object, bind: Any, **_: object) -> bool:
    return bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": PARTNER_ROLE}).first() is not None


def requester_tables_created(ddl: object, target: Any, bind: Any, tables: Any = None, **_: object) -> bool:
    names = {table.name for table in tables} if tables is not None else {"users", "engineer_profiles"}
    return {"users", "engineer_profiles"} <= names


def _grants_if_partner(ddl: object, target: Any, bind: Any, **kwargs: Any) -> bool:
    return requester_tables_created(ddl, target, bind, **kwargs) and partner_role_exists(ddl, target, bind)


event.listen(Base.metadata, "after_create", DDL(CREATE_VIEW_SQL).execute_if(callable_=requester_tables_created))  # type: ignore[arg-type]
for statement in GRANT_SQL:
    event.listen(Base.metadata, "after_create", DDL(statement).execute_if(callable_=_grants_if_partner))  # type: ignore[arg-type]
event.listen(Base.metadata, "before_drop", DDL(DROP_VIEW_SQL))
