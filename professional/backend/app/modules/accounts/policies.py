"""Who may do what to which account. Every accounts endpoint acts on the session's own
account only: no endpoint takes an account id, so another account's profile can be
neither read nor changed through them. These are the role rules on top of that."""

from fastapi import HTTPException

from app.modules.identity.models import ADMIN_ROLES, ROLE_BUILDER, ROLE_ENGINEER, ROLE_PROFESSIONAL, ROLE_SUPPLIER, User


def ensure_supplier(user: User) -> None:
    if user.role != ROLE_SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers have a Supplier Category.")


def ensure_engineer(user: User) -> None:
    if user.role != ROLE_ENGINEER:
        raise HTTPException(status_code=403, detail="Only engineers have an Engineer Category.")


def ensure_has_business_logo(user: User) -> None:
    if user.role not in (ROLE_BUILDER, ROLE_SUPPLIER):
        raise HTTPException(status_code=403, detail="Business logo is available only for builders and suppliers")


def ensure_may_delete_own_account(user: User) -> None:
    if user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Administrator accounts cannot be deleted here.")
    if user.role == ROLE_PROFESSIONAL:
        raise HTTPException(
            status_code=422,
            detail="This account belongs to CREWNBUILD Partner. Delete it from the Partner application.",
        )
