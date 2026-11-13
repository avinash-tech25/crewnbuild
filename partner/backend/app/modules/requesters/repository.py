"""Who may book a technician: Professional's read-only view (technical-architecture.md 11.1).

    professional.v_partner_requesters (id, name, email, phone, status, address, pincode,
                                       location, requester_role)

The view is the contract between the services: Partner never maps Professional's tables.
`requester_role` is OWNER for a House Owner, SITE_ENGINEER for an Engineer whose category
is SITE_ENGINEER, and NULL for everyone else (refused). Deleted accounts are not in it.
`email` is nullable (phone-only accounts). There is no write method.

The schema is PROFESSIONAL_SCHEMA (professional; the tests point it at a stand-in).
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

REQUESTERS_VIEW = "v_partner_requesters"
COLUMNS = "id, name, email, phone, status, address, pincode, location, requester_role"
REQUESTER_OWNER = "OWNER"
REQUESTER_SITE_ENGINEER = "SITE_ENGINEER"
REQUESTER_ROLES = (REQUESTER_OWNER, REQUESTER_SITE_ENGINEER)
REQUESTER_ROLE_LABELS = {REQUESTER_OWNER: "House Owner", REQUESTER_SITE_ENGINEER: "Site Engineer"}


@dataclass(frozen=True)
class Requester:
    id: uuid.UUID
    name: str | None
    email: str | None
    phone: str | None
    status: str | None
    address: str | None
    pincode: str | None
    location: str | None
    requester_role: str | None

    @property
    def is_active(self) -> bool:
        return (self.status or "ACTIVE").upper() == "ACTIVE"

    @property
    def area(self) -> str | None:
        """The branch of "Branch, District, State" that Professional stores as location."""
        first = (self.location or "").split(",")[0].strip()
        return first or None


class RequesterRepository:
    def __init__(self, database: Session, professional_schema: str) -> None:
        self.database = database
        # A plain identifier, checked by the settings (validate_database).
        self.view = f'"{professional_schema}".{REQUESTERS_VIEW}'

    def get(self, account_id: Any) -> Requester | None:
        if account_id is None:
            return None
        # The view name is a checked schema name and a constant; the id is a bound parameter.
        statement = f"SELECT {COLUMNS} FROM {self.view} WHERE id = :id"  # noqa: S608
        row = self.database.execute(
            text(statement),
            {"id": account_id},
        ).first()
        return Requester(**dict(row._mapping)) if row else None
