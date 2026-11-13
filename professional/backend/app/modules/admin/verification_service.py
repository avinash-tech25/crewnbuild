"""The verification queue and the decisions made on it (ported from the old
app/admin/services/verification_service.py, same rules).

The queue is derived: an account is PENDING when it has submitted documents and has no
current decision. Documents are read from the profile's comma-joined string
("Licence: /files/<id>, Insurance: /files/<id>"), never written here.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.local_time import local_today
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import ACTION_VERIFICATION_APPROVED, ACTION_VERIFICATION_REJECTED, record
from app.modules.admin.schemas import VerificationDecision
from app.modules.admin.scope import assert_user_in_scope, scope_users, viewing
from app.modules.identity.models import ROLE_BUILDER, ROLE_SUPPLIER, User, UserVerificationReview
from app.modules.messaging.notifications import add_notification

STATUS_APPROVED = "APPROVED"
STATUS_REJECTED = "REJECTED"
STATUS_MORE_INFO = "MORE_INFO_REQUESTED"
VERIFICATION_STATUSES = (STATUS_APPROVED, STATUS_REJECTED, STATUS_MORE_INFO)
# Only these roles submit documents.
DOCUMENT_ROLES = (ROLE_BUILDER, ROLE_SUPPLIER)


def parse_documents(raw: str | None) -> list[dict[str, str]]:
    """The stored "Type: url, Type: url" string as entries; a bare value is kept as a
    "Document" rather than lost."""
    entries = []
    for chunk in (raw or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        label, separator, url = chunk.partition(":")
        if separator:
            entries.append({"label": label.strip(), "url": url.strip()})
        else:
            entries.append({"label": "Document", "url": chunk})
    return entries


def profile_documents(user: User) -> list[dict[str, str]]:
    for profile in (user.contractor_profile, user.supplier_profile):
        if profile is not None and getattr(profile, "documents", None):
            return parse_documents(profile.documents)
    return []


def current_record(database: Session, user_id: uuid.UUID) -> UserVerificationReview | None:
    return database.scalars(
        select(UserVerificationReview).where(
            UserVerificationReview.user_id == user_id, UserVerificationReview.is_current.is_(True)
        )
    ).first()


def current_records_for(database: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, UserVerificationReview]:
    if not user_ids:
        return {}
    rows = database.scalars(
        select(UserVerificationReview).where(
            UserVerificationReview.user_id.in_(user_ids), UserVerificationReview.is_current.is_(True)
        )
    ).all()
    return {row.user_id: row for row in rows}


def is_verified(review: UserVerificationReview | None) -> bool:
    """An expired approval is not a verification."""
    if review is None or review.status != STATUS_APPROVED:
        return False
    return not (review.expires_on and review.expires_on < local_today())


def queue(database: Session, admin: Any, state: str = "PENDING") -> list[dict[str, Any]]:
    """PENDING (derived), APPROVED, REJECTED or MORE_INFO_REQUESTED, in this scope."""
    state = (state or "PENDING").strip().upper()
    candidates = database.scalars(
        scope_users(select(User), admin).where(User.role.in_(DOCUMENT_ROLES)).order_by(User.created_at.desc())
    ).all()
    decided = {
        review.user_id: review
        for review in database.scalars(
            select(UserVerificationReview).where(UserVerificationReview.is_current.is_(True))
        ).all()
    }
    rows = []
    for user in candidates:
        documents = profile_documents(user)
        review = decided.get(user.id)
        if state == "PENDING":
            # Nothing to review is not the same as awaiting review.
            if review is not None or not documents:
                continue
        elif review is None or review.status != state:
            continue
        rows.append(
            {
                "user_id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "country": user.country_code,
                "company": (
                    user.contractor_profile.company_name
                    if user.contractor_profile
                    else user.supplier_profile.store_name
                    if user.supplier_profile
                    else None
                ),
                "licence_number": user.contractor_profile.license_number if user.contractor_profile else None,
                "documents": documents,
                "status": review.status if review else "PENDING",
                "verified": is_verified(review),
                "reviewer_email": review.reviewer_email if review else None,
                "reviewed_at": review.created_at if review else None,
                "notes": review.notes if review else None,
                "expires_on": review.expires_on if review else None,
                "submitted_at": user.created_at,
            }
        )
    return rows


def decide(
    database: Session,
    admin: AdminIdentity,
    user_id: uuid.UUID,
    *,
    status: str,
    notes: str | None = None,
    expires_on: str | None = None,
    verification_type: str = "IDENTITY",
) -> tuple[UserVerificationReview, User]:
    """Record a decision, retiring (not deleting) any earlier one."""
    status = (status or "").strip().upper()
    if status not in VERIFICATION_STATUSES:
        raise HTTPException(status_code=400, detail="Decision must be APPROVED, REJECTED or MORE_INFO_REQUESTED.")
    target = database.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Account not found")
    assert_user_in_scope(target, admin)
    if status != STATUS_APPROVED and not (notes or "").strip():
        raise HTTPException(status_code=400, detail="Explain what is wrong, so the account holder knows what to fix.")
    expiry = None
    if expires_on:
        try:
            expiry = datetime.fromisoformat(expires_on).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Expiry date must be YYYY-MM-DD.") from None

    for previous in database.scalars(
        select(UserVerificationReview).where(
            UserVerificationReview.user_id == user_id, UserVerificationReview.is_current.is_(True)
        )
    ).all():
        previous.is_current = False

    documents = profile_documents(target)
    review = UserVerificationReview(
        user_id=target.id,
        verification_type=verification_type or "IDENTITY",
        status=status,
        documents_reviewed=", ".join(f"{d['label']}: {d['url']}" for d in documents) or None,
        reviewer_id=admin.user.id,
        reviewer_email=admin.user.email,
        scope=admin.scope,
        notes=(notes or "").strip() or None,
        expires_on=expiry,
        is_current=True,
    )
    database.add(review)
    database.flush()
    return review, target


DECISION_MESSAGES = {
    STATUS_APPROVED: (
        "Your account is verified",
        "Your documents have been checked and your account now carries the verified badge.",
    ),
    STATUS_MORE_INFO: ("More information needed", "We need more from you before your account can be verified."),
    STATUS_REJECTED: ("Verification was not approved", "Your documents could not be accepted."),
}


def notify_decision(database: Session, review: UserVerificationReview) -> None:
    title, body = DECISION_MESSAGES.get(
        review.status, ("Verification updated", "Your verification status has changed.")
    )
    if review.notes:
        body = f"{body} {review.notes}"
    if review.status == STATUS_APPROVED and review.expires_on:
        body = f"{body} It is valid until {review.expires_on:%d %B %Y}."
    add_notification(database, review.user_id, title, body, category="ACCOUNT")


def fetch_verification_queue(
    database: Session, admin: AdminIdentity, state: str, country: str | None
) -> dict[str, Any]:
    rows = queue(database, viewing(admin, country), state)
    return {"state": state.upper(), "scope": admin.scope, "total": len(rows), "accounts": rows}


def decide_verification(
    database: Session, admin: AdminIdentity, user_id: uuid.UUID, payload: VerificationDecision
) -> dict[str, Any]:
    review, target = decide(
        database,
        admin,
        user_id,
        status=payload.status,
        notes=payload.notes,
        expires_on=payload.expires_on,
        verification_type=payload.verification_type,
    )
    # Told before the commit, so the decision and the message land together.
    notify_decision(database, review)
    # Old behaviour kept: MORE_INFO_REQUESTED is logged as verification.rejected.
    action = ACTION_VERIFICATION_APPROVED if review.status == STATUS_APPROVED else ACTION_VERIFICATION_REJECTED
    record(
        database,
        admin,
        action,
        target_type="user",
        target_id=user_id,
        summary=f"Verification {review.status} for {target.role} {target.email}",
        reason=payload.notes,
    )
    database.commit()
    return {
        "user_id": user_id,
        "status": review.status,
        "verified": review.status == STATUS_APPROVED,
        "expires_on": review.expires_on,
    }
