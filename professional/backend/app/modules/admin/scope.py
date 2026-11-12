"""Country scoping for administrators, decided in one place (ported from the old
app/admin/services/scope.py, same rules).

Accounts are scoped by the country they gave (users.country_code, free text, "India"
by default); a project belongs to the country it is built in. Lists filter; detail
endpoints check the single record. India is the only market.
"""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, false, or_
from sqlalchemy.orm import Session

from app.modules.admin.admin_identity import AdminIdentity, account_locality
from app.modules.identity.models import ADMIN_ROLES, DEFAULT_COUNTRY, User
from app.modules.identity.schemas import INDIA_ONLY_DETAIL, RETIRED_KUWAIT_VALUES

LOCALITY_INDIA = "IN"
SCOPE_COUNTRY_NAMES = {LOCALITY_INDIA: DEFAULT_COUNTRY}
COUNTRY_LOCALITIES = {"IN": LOCALITY_INDIA, "IND": LOCALITY_INDIA, "INDIA": LOCALITY_INDIA}


def refuse_kuwait(value: object) -> None:
    """422 for a request naming Kuwait; anything else passes untouched."""
    if str(value or "").strip().upper() in RETIRED_KUWAIT_VALUES:
        raise HTTPException(status_code=422, detail=INDIA_ONLY_DETAIL)


def locality_code(country: str | None, default: str = "") -> str:
    return COUNTRY_LOCALITIES.get((country or "").strip().upper(), default)


def scope_country_name(scope: str) -> str | None:
    """The country name a scope stands for; None for GLOBAL."""
    return SCOPE_COUNTRY_NAMES.get((scope or "").strip().upper())


def scope_users(statement: Select[Any], admin: Any) -> Select[Any]:
    """Restrict a User query to the administrator's country. Accounts without a country
    count as India (the old rows written before the column existed)."""
    if admin.is_global:
        return statement
    country = scope_country_name(admin.scope)
    if country is None:
        # An unrecognised scope reaches nothing, never everything.
        return statement.where(false())
    if country == DEFAULT_COUNTRY:
        return statement.where(or_(User.country_code == DEFAULT_COUNTRY, User.country_code.is_(None)))
    return statement.where(User.country_code == country)


def assert_user_in_scope(user: User, admin: Any) -> None:
    if admin.is_global:
        return
    if not admin.may_reach(account_locality(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account belongs to another administrative scope"
        )


def load_suspendable_user(database: Session, admin: AdminIdentity, user_id: uuid.UUID) -> User:
    """A marketplace account this administrator may suspend. Administrators are
    suspended under Administrators, where the hierarchy rules apply."""
    target = database.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.id == admin.user.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account.")
    if target.role in ADMIN_ROLES:
        raise HTTPException(
            status_code=400, detail="Administrator accounts are managed under Administrators, not here."
        )
    assert_user_in_scope(target, admin)
    return target


class NarrowedTo:
    """A Global Super Admin looking at one country (read-only presentation)."""

    def __init__(self, admin: AdminIdentity, scope: str) -> None:
        self._admin = admin
        self.scope = scope
        self.is_global = False
        self.user = admin.user

    @property
    def permissions(self) -> set[str]:
        return self._admin.permissions

    def has(self, permission: str) -> bool:
        return self._admin.has(permission)

    def may_reach(self, locality: str | None) -> bool:
        return (locality or "").strip().upper() == self.scope


def viewing(admin: AdminIdentity, country: str | None) -> Any:
    """The administrator, narrowed to one country when a Global Super Admin asks for
    one. Anyone else already has one country and the request is ignored. Kuwait: 422."""
    refuse_kuwait(country)
    wanted = (country or "").strip()
    if not wanted or not admin.is_global:
        return admin
    locality = locality_code(wanted)
    if not locality:
        return admin
    return NarrowedTo(admin, locality)
