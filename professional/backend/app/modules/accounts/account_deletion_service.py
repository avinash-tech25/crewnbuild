"""Profile Settings > Delete Account: the account holder deletes their own account.

The form is checked exactly as before (verified e-mail on the account, the word DELETE,
name, role, e-mail and mobile matching the account, a reason). The deletion itself is
now a soft delete with anonymisation (DB-07) instead of the old purge:

* one transaction writes the history row (account_deletion_requests, status DELETED,
  original_user_id kept without a foreign key) and anonymises the account: name, e-mail,
  mobile, address, pincode, location and photo cleared, an unusable password, status
  DELETED and deleted_at set; profile logos, documents, gallery, GSTIN and PAN cleared;
  every session ended and every Google/Microsoft link removed; a supplier's listings
  are deleted, as the old purge deleted them.

Every old refusal is kept, in the old order and with the old answers
(deletion_blockers.py): shared projects, then an open Book Technician booking, builder,
supplier, store and engineer history. The e-mail address and number are free for a new
account afterwards. No e-mail is sent.
"""

import logging
import secrets
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.local_time import to_local_iso, utc_now
from app.core.security.password_hashing import hash_secret
from app.modules.accounts.deletion_blockers import ensure_account_deletable
from app.modules.accounts.models import (
    DELETION_SOURCE_IN_APP,
    DELETION_STATUS_DELETED,
    AccountDeletionRequest,
)
from app.modules.accounts.policies import ensure_may_delete_own_account
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.accounts.repository import AccountRepository
from app.modules.accounts.schemas import AccountDeletionCreate
from app.modules.files.file_ownership import file_ids_in, release_unreferenced_files
from app.modules.identity.models import (
    ROLE_BUILDER,
    STATUS_DELETED,
    User,
    UserOAuthIdentity,
)
from app.modules.identity.repository import SessionRepository
from app.modules.marketplace.account_links import remove_supplier_listings

logger = logging.getLogger(__name__)

ROLE_STORE_MANAGER = "STORE_MANAGER"
# The account roles as people know them. The form also accepts the old CONTRACTOR.
ROLE_LABELS = {
    "OWNER": "House Owner",
    ROLE_BUILDER: "Builder",
    "ENGINEER": "Site Engineer / Engineer",
    ROLE_STORE_MANAGER: "Store Manager",
    "SUPPLIER": "Supplier",
}
LEGACY_ROLE_NAMES = {"CONTRACTOR": ROLE_BUILDER}

REASONS = {
    "NO_LONGER_NEEDED": "I no longer need this account",
    "PROJECT_COMPLETED": "My construction project is complete",
    "USING_ANOTHER_SERVICE": "I am using another service",
    "PRIVACY": "Privacy concerns",
    "TOO_MANY_NOTIFICATIONS": "Too many notifications or messages",
    "DIFFICULT_TO_USE": "The app is difficult to use",
    "DUPLICATE_ACCOUNT": "I have another account",
    "OTHER": "Other",
}
REASON_OTHER = "OTHER"
CONFIRMATION_WORD = "DELETE"
DELETED_ACCOUNT_NAME = "Deleted account"
REVOKED_ACCOUNT_DELETED = "account_deleted"

EMAIL_NOT_VERIFIED = {
    "code": "EMAIL_NOT_VERIFIED",
    "message": "Please verify your registered email address before deleting your account.",
}
DELETE_FAILED = {
    "code": "ACCOUNT_DELETION_FAILED",
    "message": (
        "Your account could not be deleted because of a problem on our side. Nothing was changed. "
        "Please try again later."
    ),
}


def support_mailbox(settings: Settings) -> str:
    """The address the deletion pages give for questions. Nothing is sent to it."""
    return (
        (settings.account_deletion_notify_email or "").strip()
        or (settings.contact_destination_email or "").strip()
        or (settings.smtp_user or "").strip()
    )


def role_options() -> list[dict[str, str]]:
    return [{"value": value, "label": label} for value, label in ROLE_LABELS.items()]


def public_config(settings: Settings) -> dict[str, Any]:
    return {"support_email": support_mailbox(settings) or None, "roles": role_options()}


def account_role_code(user: User) -> str:
    return ROLE_STORE_MANAGER if is_store_manager(user) else user.role


def digits(value: str | None) -> str:
    return "".join(character for character in (value or "") if character.isdigit())


def same_text(left: str | None, right: str | None) -> bool:
    return " ".join((left or "").split()).casefold() == " ".join((right or "").split()).casefold()


def same_phone(entered: str | None, registered: str | None) -> bool:
    entered, registered = digits(entered), digits(registered)
    if not entered or not registered:
        return False
    # The same number with or without its country code.
    return entered == registered or (min(len(entered), len(registered)) >= 10 and entered[-10:] == registered[-10:])


def mismatch(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": "DETAILS_MISMATCH", "field": field, "message": message})


def email_verified(user: User) -> bool:
    return bool(user.email and user.email_verified)


def deletion_form(user: User, settings: Settings) -> dict[str, Any]:
    """What the Delete Account form shows, filled in from the account."""
    return {
        "account": {
            "name": user.name,
            "role": account_role_code(user),
            "email": user.email or None,
            "phone": user.phone or None,
            "email_verified": email_verified(user),
        },
        "roles": role_options(),
        "reasons": [{"value": value, "label": label} for value, label in REASONS.items()],
        "support_email": support_mailbox(settings) or None,
    }


def personal_file_ids(user: User) -> set[Any]:
    """The files the account's own profile shows: photo, logos, documents, gallery."""
    sources: list[str | None] = [user.profile_image_url]
    if user.contractor_profile is not None:
        builder = user.contractor_profile
        sources += [builder.company_logo_url, builder.documents, builder.gallery]
    if user.supplier_profile is not None:
        supplier = user.supplier_profile
        sources += [supplier.store_logo_url, supplier.documents, supplier.gallery]
    if user.engineer_profile is not None:
        sources.append(user.engineer_profile.profile_image_url)
    return file_ids_in(*sources)


def anonymise(user: User) -> None:
    """Clear every personal field of the account and its profiles (DB-07)."""
    user.name = DELETED_ACCOUNT_NAME
    user.email = None
    user.email_verified_at = None
    user.phone = ""
    user.password_hash = hash_secret(secrets.token_urlsafe(32))
    user.address = ""
    user.pincode = ""
    user.location = None
    user.profile_image_url = None
    if user.owner_profile is not None:
        owner = user.owner_profile
        owner.project_title = None
        owner.project_description = None
        owner.contact_preference = None
    if user.contractor_profile is not None:
        builder = user.contractor_profile
        builder.company_logo_url = None
        builder.license_number = None
        builder.gstin = None
        builder.pan = None
        builder.documents = None
        builder.gallery = None
    if user.supplier_profile is not None:
        supplier = user.supplier_profile
        supplier.store_logo_url = None
        supplier.gstin = None
        supplier.pan = None
        supplier.documents = None
        supplier.gallery = None
    if user.engineer_profile is not None:
        engineer = user.engineer_profile
        engineer.license_number = None
        engineer.profile_image_url = None


class AccountDeletionService:
    def __init__(self, database: Session, settings: Settings) -> None:
        self.database = database
        self.settings = settings
        self.repository = AccountRepository(database)

    def validate(self, user: User, payload: AccountDeletionCreate) -> tuple[str, str | None]:
        ensure_may_delete_own_account(user)
        if not email_verified(user):
            raise HTTPException(status_code=403, detail=EMAIL_NOT_VERIFIED)
        if not payload.confirm_deletion:
            raise HTTPException(
                status_code=422, detail="Confirm that you understand your account will be permanently deleted."
            )
        if payload.confirmation_text != CONFIRMATION_WORD:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CONFIRMATION_TEXT",
                    "field": "confirmation_text",
                    "message": "Type DELETE to confirm account deletion.",
                },
            )
        if not same_text(payload.full_name, user.name):
            raise mismatch("full_name", "The name does not match this account.")
        role = payload.role.strip().upper()
        role = LEGACY_ROLE_NAMES.get(role, role)
        if role not in ROLE_LABELS or role != account_role_code(user):
            raise mismatch("role", "The account role you selected does not match this account.")
        if user.email:
            if not same_text(payload.email, user.email):
                raise mismatch("email", "The email address does not match the one registered on this account.")
        elif (payload.email or "").strip():
            raise mismatch("email", "This account has no registered email address.")
        if not same_phone(payload.phone, user.phone):
            raise mismatch("phone", "The mobile number does not match the one registered on this account.")
        reason_code = payload.reason_code.strip().upper()
        if reason_code not in REASONS:
            raise HTTPException(status_code=422, detail="Choose a reason for deleting your account.")
        details = (payload.reason_details or "").strip() or None
        if reason_code == REASON_OTHER and not details:
            raise HTTPException(status_code=422, detail="Tell us briefly why you are deleting your account.")
        return reason_code, details

    def delete_own_account(self, user: User, payload: AccountDeletionCreate) -> dict[str, Any]:
        """Record the deletion and anonymise the account, in one transaction."""
        reason_code, details = self.validate(user, payload)
        ensure_account_deletable(self.database, user)

        now = utc_now()
        role_code = account_role_code(user)
        files_to_release = personal_file_ids(user)
        try:
            history = AccountDeletionRequest(
                reference=f"DEL-{now:%Y%m%d}-{secrets.token_hex(3).upper()}",
                source=DELETION_SOURCE_IN_APP,
                user_id=user.id,
                original_user_id=user.id,
                account_name=user.name,
                account_email=user.email,
                account_created_at=user.created_at,
                submitted_name=" ".join(payload.full_name.split()),
                submitted_email=(payload.email or "").strip(),
                submitted_phone=payload.phone.strip(),
                submitted_role=role_code,
                account_role=role_code,
                email_matches_account=bool(user.email),
                reason_code=reason_code,
                reason=details,
                status=DELETION_STATUS_DELETED,
                policy_accepted_at=now,
                deleted_at=now,
                deletion_summary={
                    "deleted_by": "ACCOUNT_HOLDER",
                    "method": "SOFT_DELETE_ANONYMISED",
                    "personal_files_unlinked": sorted(str(file_id) for file_id in files_to_release),
                },
            )
            self.database.add(history)
            anonymise(user)
            # The old purge deleted a supplier's listings; deletion is refused while any
            # of them has order history (deletion_blockers).
            remove_supplier_listings(self.database, user.id)
            user.status = STATUS_DELETED
            user.deleted_at = now
            SessionRepository(self.database).revoke_all_for_user(user.id, REVOKED_ACCOUNT_DELETED, now)
            self.database.execute(delete(UserOAuthIdentity).where(UserOAuthIdentity.user_id == user.id))
            self.database.commit()
        except Exception:
            self.database.rollback()
            logger.exception("account_deletion.failed user=%s", user.id)
            raise HTTPException(status_code=500, detail=DELETE_FAILED) from None
        logger.info("account_deletion.deleted reference=%s role=%s", history.reference, history.account_role)
        release_unreferenced_files(self.database, user, files_to_release)
        return {
            "deleted": True,
            "reference": history.reference,
            "deleted_at": to_local_iso(history.deleted_at, self.settings),
        }
