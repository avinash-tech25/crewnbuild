"""Who may do what in the identity module. Rules only; no database queries."""

from fastapi import HTTPException

from app.modules.accounts.models import CATEGORY_SITE_ENGINEER, CATEGORY_STORE_MANAGER
from app.modules.identity.models import (
    ADMIN_ROLES,
    ROLE_ENGINEER,
    ROLE_GLOBAL_SUPER_ADMIN,
    ROLE_OWNER,
    ROLE_PROFESSIONAL,
    ROLE_SITE_ENGINEER,
    ROLE_STORE_MANAGER,
    User,
)

SUSPENDED_MESSAGE = "This account has been suspended. Contact CREWNBUILD support."
# A suspended administrator's session is refused with the admin console's own text.
ADMIN_SUSPENDED_MESSAGE = "This administrator account is suspended"
PARTNER_ACCOUNT_MESSAGE = (
    "This account belongs to CREWNBUILD Partner. Please use the CREWNBUILD Partner application to continue."
)
GLOBAL_ADMIN_USE_WHATSAPP = "The Global Super Admin signs in with its mobile number and the WhatsApp code."
HANDOFF_NOT_ALLOWED = "Book Technician is available to House Owners and Site Engineers."


def suspended_message(user: User) -> str:
    return ADMIN_SUSPENDED_MESSAGE if user.role in ADMIN_ROLES else SUSPENDED_MESSAGE


def session_role(user: User) -> str:
    """The role of a session (section 7.1): an Engineer becomes SITE_ENGINEER or
    STORE_MANAGER by category; any other engineer category stays ENGINEER."""
    if user.role == ROLE_ENGINEER and user.engineer_profile is not None:
        if user.engineer_profile.category == CATEGORY_SITE_ENGINEER:
            return ROLE_SITE_ENGINEER
        if user.engineer_profile.category == CATEGORY_STORE_MANAGER:
            return ROLE_STORE_MANAGER
    return user.role


def ensure_may_sign_in(user: User) -> User:
    """The checks every sign-in method and every refresh applies, in this order."""
    if user.role == ROLE_PROFESSIONAL:
        raise HTTPException(status_code=403, detail=PARTNER_ACCOUNT_MESSAGE)
    if not user.is_active:
        raise HTTPException(status_code=403, detail=SUSPENDED_MESSAGE)
    return user


def can_create_partner_handoff(user: User) -> bool:
    """House Owner, or an Engineer whose category is Site Engineer (the same accounts
    Partner accepts). Partner checks again, from the database, on every request."""
    return session_role(user) in (ROLE_OWNER, ROLE_SITE_ENGINEER)


def is_global_super_admin(user: User) -> bool:
    return user.role == ROLE_GLOBAL_SUPER_ADMIN
