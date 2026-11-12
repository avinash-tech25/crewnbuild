"""What the platform is telling accounts, and announcements from an administrator
(ported from the old app/admin/services/notification_service.py, same rules).

An announcement writes ordinary notification rows, so it appears where people already
look. Nothing here edits or deletes a notification.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, and_, func, not_, or_, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import ACTION_ANNOUNCEMENT_SENT, record
from app.modules.admin.schemas import Announcement
from app.modules.admin.scope import scope_users, viewing
from app.modules.identity.models import ADMIN_ROLES, ROLE_BUILDER, User
from app.modules.identity.service import LEGACY_BUILDER_ROLE
from app.modules.messaging.models import Notification
from app.modules.messaging.notifications import add_notification

# The keys the console sends, unchanged; CONTRACTOR (Builders) reaches the stored BUILDER.
AUDIENCES = {
    "ALL": "Everyone in your scope",
    "OWNER": "House Owners",
    "CONTRACTOR": "Builders",
    "SUPPLIER": "Suppliers",
    "ENGINEER": "Site Engineers",
    "PROFESSIONAL": "Experts",
}
AUDIENCE_ROLES = {LEGACY_BUILDER_ROLE: ROLE_BUILDER}
MAX_RECIPIENTS = 5000


def visible_to_administrators(statement: Select[Any]) -> Select[Any]:
    """Chat notifications carry a preview of a private message and are never shown to
    administrators (NULL categories are older non-chat rows)."""
    return statement.where(
        or_(Notification.category.is_(None), Notification.category != "MESSAGE"),
        not_(and_(Notification.category.is_(None), Notification.title == "New message")),
    )


def recent(database: Session, admin: Any, *, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """Notifications sent to accounts this administrator is responsible for."""
    recipients = scope_users(select(User.id), admin).subquery()
    if not database.scalar(select(func.count()).select_from(recipients)):
        return {"total": 0, "limit": limit, "offset": offset, "scope": admin.scope, "notifications": []}
    statement = visible_to_administrators(select(Notification).where(Notification.user_id.in_(select(recipients))))
    total = database.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = database.scalars(
        statement.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit)
    ).all()
    people = {user.id: user for user in database.scalars(select(User).where(User.id.in_({r.user_id for r in rows})))}
    unread = statement.where(Notification.is_read.is_(False))
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "scope": admin.scope,
        "unread": database.scalar(select(func.count()).select_from(unread.subquery())) or 0,
        "notifications": [
            {
                "id": row.id,
                "title": row.title,
                "body": row.body,
                "is_read": row.is_read,
                "created_at": local_iso(row.created_at),
                "recipient_id": row.user_id,
                "recipient_name": people[row.user_id].name if row.user_id in people else None,
                "recipient_role": people[row.user_id].role if row.user_id in people else None,
            }
            for row in rows
        ],
    }


def audience_statement(admin: Any, audience: str) -> Select[Any]:
    audience = (audience or "").strip().upper()
    if audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail=f"Choose an audience: {', '.join(AUDIENCES)}")
    # Administrators are not market participants and get no announcements.
    statement = scope_users(select(User), admin).where(User.role.notin_(ADMIN_ROLES))
    if audience != "ALL":
        statement = statement.where(User.role == AUDIENCE_ROLES.get(audience, audience))
    return statement


def audience_size(database: Session, admin: Any, audience: str) -> int:
    return database.scalar(select(func.count()).select_from(audience_statement(admin, audience).subquery())) or 0


def announce(database: Session, admin: AdminIdentity, *, audience: str, title: str, body: str) -> dict[str, Any]:
    title = (title or "").strip()
    body = (body or "").strip()
    if len(title) < 3:
        raise HTTPException(status_code=400, detail="Give the announcement a title.")
    if len(body) < 10:
        raise HTTPException(status_code=400, detail="Write the message people will actually read.")
    recipients = database.scalars(audience_statement(admin, audience)).all()
    if not recipients:
        raise HTTPException(status_code=400, detail="That audience has nobody in it.")
    if len(recipients) > MAX_RECIPIENTS:
        raise HTTPException(
            status_code=400, detail=f"That audience is {len(recipients)} accounts, over the {MAX_RECIPIENTS} limit."
        )
    for user in recipients:
        add_notification(database, user.id, title, body, category="ANNOUNCEMENT")
    return {"audience": audience.strip().upper(), "recipients": len(recipients), "title": title}


def fetch_notifications(
    database: Session, admin: AdminIdentity, *, limit: int, offset: int, country: str | None
) -> dict[str, Any]:
    viewer = viewing(admin, country)
    payload = recent(database, viewer, limit=limit, offset=offset)
    payload["audiences"] = {
        key: {"label": label, "size": audience_size(database, viewer, key)} for key, label in AUDIENCES.items()
    }
    return payload


def send_announcement(database: Session, admin: AdminIdentity, payload: Announcement) -> dict[str, Any]:
    result = announce(database, admin, audience=payload.audience, title=payload.title, body=payload.body)
    record(
        database,
        admin,
        ACTION_ANNOUNCEMENT_SENT,
        target_type="announcement",
        target_id=None,
        summary=f'Announced "{result["title"]}" to {result["recipients"]} {result["audience"]} account(s)',
    )
    database.commit()
    return result
