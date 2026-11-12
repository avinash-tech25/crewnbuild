"""Who an administrator is and what it may do (ported from the old
app/admin/services/permissions.py; the admin screens come with the admin module).

Access is decided by role, scope (GLOBAL or IN) and named permission. A Global or
Location Super Admin holds every permission; a Manager only those granted on its
admin profile, inside its own scope.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts.models import ADMIN_SCOPES, SCOPE_GLOBAL, AdminProfile
from app.modules.identity.models import (
    ADMIN_ROLES,
    ROLE_GLOBAL_SUPER_ADMIN,
    ROLE_LOCATION_SUPER_ADMIN,
    User,
)

PERMISSIONS = {
    "users.view": "See user accounts and their profiles",
    "users.suspend": "Suspend and reactivate accounts",
    "projects.view": "See projects and their activity",
    "verification.view": "See the verification queue and submitted documents",
    "verification.decide": "Approve, reject or request more documents",
    "reports.view": "See reports and disputes",
    "reports.resolve": "Resolve or reject reports and disputes",
    "audit.view": "Read the audit log",
    "ads.view": "See adverts and how they are performing",
    "ads.manage": "Create, edit, and start or stop adverts",
    "admins.manage": "Create and deactivate administrator accounts",
    "catalog.view": "See the master product catalog",
    "catalog.manage": "Create and edit master products, variants and images",
    "coupons.view": "See builder subscription coupons and their usage",
    "coupons.manage": "Create, edit, and activate or deactivate builder subscription coupons",
    "subscriptions.view": "See builder subscription payment history and collections",
    "deletions.view": "See deleted accounts and their deletion details",
    "deletions.manage": "Not used (the account deletion approval workflow was retired)",
    "support.view": "See support tickets and their conversations",
    "support.manage": "Reply to support tickets and change their status",
}


class AdminIdentity:
    def __init__(self, user: User, profile: AdminProfile) -> None:
        self.user = user
        self.profile = profile
        self.scope = profile.scope
        self.is_global = profile.scope == SCOPE_GLOBAL

    @property
    def permissions(self) -> set[str]:
        if self.user.role in (ROLE_GLOBAL_SUPER_ADMIN, ROLE_LOCATION_SUPER_ADMIN):
            return set(PERMISSIONS)
        return {grant.strip() for grant in (self.profile.permissions or "").split(",") if grant.strip()}

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def may_reach(self, locality: str | None) -> bool:
        return self.is_global or (locality or "").strip().upper() == self.scope


def active_admin_identity(database: Session, user: User) -> AdminIdentity | None:
    """The administrator behind an active admin account with a valid scope, else None."""
    if user.role not in ADMIN_ROLES or not user.is_active:
        return None
    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == user.id)).first()
    if profile is None or profile.scope not in ADMIN_SCOPES:
        return None
    return AdminIdentity(user, profile)


def account_locality(user: User) -> str:
    """The country code an account's data belongs to. India is the only market, so
    every account resolves to IN (the old user_locality)."""
    return "IN"
