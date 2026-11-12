"""Permission names and the role-to-permission map (technical-architecture.md 7.2).

A permission here says what kind of action a role may take at all; which records it may
touch is the module's policies.py (ownership). Modules add their permissions to this map
as they are ported; identity needs only `handoff:create`.

Administrator permissions are not in this map: they are the named grants on the
administrator's own profile (admin_profiles.permissions), checked by modules/admin/dependencies.py
(require_admin).
"""

from app.modules.identity.models import (
    ROLE_BUILDER,
    ROLE_OWNER,
    ROLE_SITE_ENGINEER,
    ROLE_STORE_MANAGER,
    ROLE_SUPPLIER,
)

HANDOFF_CREATE = "handoff:create"

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    ROLE_OWNER: frozenset({HANDOFF_CREATE}),
    ROLE_BUILDER: frozenset(),
    ROLE_SITE_ENGINEER: frozenset({HANDOFF_CREATE}),
    ROLE_STORE_MANAGER: frozenset(),
    ROLE_SUPPLIER: frozenset(),
}

KNOWN_PERMISSIONS = frozenset().union(*ROLE_PERMISSIONS.values())


def permissions_for_role(role: str) -> frozenset[str]:
    return ROLE_PERMISSIONS.get(role, frozenset())
