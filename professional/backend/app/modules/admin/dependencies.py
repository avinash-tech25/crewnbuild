"""The administrator behind a request, and the permission an admin route needs
(ported from the old current_admin / require_admin, same answers).

Every admin route depends on require_admin("<permission>"), which needs an admin role
AND the named permission. Two routes have no single permission and need the admin role
only, as before: GET /admin/me (who am I) and GET /admin/overview (it computes only the
sections the caller holds permissions for).
"""

from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.accounts.models import ADMIN_SCOPES, AdminProfile
from app.modules.admin.admin_identity import PERMISSIONS, AdminIdentity
from app.modules.identity.models import ADMIN_ROLES, User


def current_admin(user: User = Depends(current_user), database: Session = Depends(get_db)) -> AdminIdentity:
    """403 (not 404) for an ordinary account: the admin API's existence is no secret."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == user.id)).first()
    if not profile:
        # An admin role without a profile has no scope, so there is no safe default.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator profile is missing")
    if profile.scope not in ADMIN_SCOPES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator scope is not recognised")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This administrator account is suspended")
    return AdminIdentity(user, profile)


def require_admin(permission: str) -> Callable[..., AdminIdentity]:
    """Dependency factory: Depends(require_admin("users.view"))."""
    if permission not in PERMISSIONS:
        # Raised at import time, so a mistyped permission breaks the build instead of
        # guarding nothing.
        raise ValueError(f"Unknown permission: {permission}")

    def dependency(admin: AdminIdentity = Depends(current_admin)) -> AdminIdentity:
        if not admin.has(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=f"This action requires the {permission} permission"
            )
        return admin

    dependency.required_permission = permission  # type: ignore[attr-defined]
    return dependency
