"""Writing and reading the administrator audit log (ported from the old
app/admin/services/audit_service.py, same rules).

Every state change an administrator makes goes through `record()`, staged before the
commit that makes the change, so the action and its entry land in one transaction.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.accounts.models import AdminProfile
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.models import AdminAuditLog
from app.modules.admin.scope import viewing
from app.modules.identity.models import User

ACTION_ADMIN_CREATED = "admin.created"
ACTION_ADMIN_UPDATED = "admin.updated"
ACTION_ADVERT_CREATED = "advert.created"
ACTION_ADVERT_UPDATED = "advert.updated"
ACTION_ADVERT_STATUS = "advert.status"
ACTION_ADMIN_DEACTIVATED = "admin.deactivated"
ACTION_ADMIN_REACTIVATED = "admin.reactivated"
ACTION_USER_SUSPENDED = "user.suspended"
ACTION_USER_REACTIVATED = "user.reactivated"
ACTION_VERIFICATION_APPROVED = "verification.approved"
ACTION_VERIFICATION_REJECTED = "verification.rejected"
ACTION_REPORT_RESOLVED = "report.resolved"
ACTION_REPORT_REJECTED = "report.rejected"
ACTION_REPORT_REVIEWING = "report.under_review"
ACTION_ANNOUNCEMENT_SENT = "announcement.sent"
ACTION_ADMIN_PHONE_CHANGED = "admin.phone_changed"


def record(
    database: Session,
    admin: AdminIdentity,
    action: str,
    *,
    summary: str,
    target_type: str | None = None,
    target_id: object | None = None,
    reason: str | None = None,
) -> AdminAuditLog:
    """Stage one entry; the caller commits it together with the change it describes."""
    entry = AdminAuditLog(
        actor_id=admin.user.id,
        actor_email=admin.user.email or "",
        actor_role=admin.user.role,
        scope=admin.scope,
        action=action,
        target_type=target_type,
        target_id=None if target_id is None else str(target_id),
        summary=summary,
        reason=(reason or "").strip() or None,
    )
    database.add(entry)
    return entry


def record_admin_action(
    database: Session, administrator: User, action: str, summary: str, target_type: str, target_id: uuid.UUID
) -> None:
    """An entry for an administrator acting on its own account (the sign-in number
    change), under the scope on its admin profile. Staged like record()."""
    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == administrator.id)).first()
    if profile is None:
        return
    record(
        database,
        AdminIdentity(administrator, profile),
        action,
        summary=summary,
        target_type=target_type,
        target_id=target_id,
    )


def scope_audit(statement: Select[Any], admin: Any) -> Select[Any]:
    """A location administrator reads its own country's entries; Global reads all."""
    if admin.is_global:
        return statement
    return statement.where(AdminAuditLog.scope == admin.scope)


def audit_day(value: str) -> datetime:
    """A YYYY-MM-DD filter, refused rather than ignored when it does not parse."""
    try:
        day = datetime.fromisoformat(value.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be written as YYYY-MM-DD.") from None
    # The old column held naive UTC, so a day is a UTC day.
    return day if day.tzinfo else day.replace(tzinfo=UTC)


def fetch_audit_log(
    database: Session,
    admin: AdminIdentity,
    *,
    action: str | None,
    actor: str | None,
    date_from: str | None,
    date_to: str | None,
    limit: int,
    offset: int,
    country: str | None,
) -> dict[str, Any]:
    viewer = viewing(admin, country)
    statement = scope_audit(select(AdminAuditLog), viewer)
    if action:
        statement = statement.where(AdminAuditLog.action == action.strip())
    if actor:
        statement = statement.where(AdminAuditLog.actor_email == actor.strip().lower())
    if date_from:
        statement = statement.where(AdminAuditLog.created_at >= audit_day(date_from))
    if date_to:
        # The whole day asked for, not up to midnight that morning.
        statement = statement.where(AdminAuditLog.created_at < audit_day(date_to) + timedelta(days=1))

    total = database.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = database.scalars(
        statement.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).offset(offset).limit(limit)
    ).all()
    actions = database.scalars(scope_audit(select(AdminAuditLog.action).distinct(), viewer)).all()
    actors = database.scalars(scope_audit(select(AdminAuditLog.actor_email).distinct(), viewer)).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "scope": admin.scope,
        "actions": sorted(actions),
        "actors": sorted(actors),
        "entries": [
            {
                "id": entry.id,
                "actor_email": entry.actor_email,
                "actor_role": entry.actor_role,
                "scope": entry.scope,
                "action": entry.action,
                "target_type": entry.target_type,
                "target_id": entry.target_id,
                "summary": entry.summary,
                "reason": entry.reason,
                "created_at": entry.created_at,
            }
            for entry in rows
        ],
    }
