"""In-app notifications: writing one (every module) and the bell's reads (ported from
the old notification_service.py and notification_repository.py; same answers).

Each notification has a category; the dashboards read it as a module code. Chat notices
(MESSAGE) stay out of the dashboard list and out of "mark all read", as before. Rows
written without a category fall back to the old text inference.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.modules.identity.models import User
from app.modules.messaging.models import Notification

# The module code the dashboards' badge maps read, per category.
NOTIFICATION_CATEGORY_MODULES = {
    "MATERIAL": "request",
    "LABOR": "request",
    "EQUIPMENT": "request",
    "NEGOTIATION": "request",
    "PROPERTY": "request",
    "ENGINEER": "engineers",
    "PROJECT": "project",
    "ASSIGNMENT": "supplier",
    "SUPPLIER": "supplier",
    "ACCOUNT": "general",
    "ANNOUNCEMENT": "general",
    "MESSAGE": "message",
}


def add_notification(database: Session, user_id: uuid.UUID, title: str, body: str, category: str | None = None) -> None:
    """Staged in the caller's transaction."""
    database.add(Notification(user_id=user_id, title=title, body=body, category=category))


def infer_notification_module(title: str, body: str) -> str:
    content = f"{title} {body}".upper()
    if "MESSAGE" in content:
        return "message"
    if "PURCHASE REQUEST" in content:
        return "request"
    if "QUOTATION" in content or "ASSIGNMENT" in content:
        return "request"
    if "TIMELINE" in content or "MATERIAL LOG" in content or "LABOUR LOG" in content:
        return "project"
    if "SUPPLIER" in content or "PRODUCT" in content:
        return "supplier"
    if "CONTRACTOR" in content:
        return "contractor"
    if "ESTIMATE" in content:
        return "estimate"
    if "ESCROW" in content or "PAYMENT" in content or "MILESTONE" in content:
        return "escrow"
    if "PROJECT" in content:
        return "project"
    if "ENGINEER" in content or "JOIN" in content or "TEAM" in content:
        return "engineers"
    if "REQUEST" in content:
        return "request"
    return "general"


def notification_module(notification: Notification) -> str:
    if notification.category:
        return NOTIFICATION_CATEGORY_MODULES.get(notification.category, "general")
    return infer_notification_module(notification.title, notification.body)


class NotificationService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def unread(self, user: User) -> list[Notification]:
        return list(
            self.database.scalars(
                select(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))
            ).all()
        )

    def fetch_user_notifications(self, user: User) -> list[dict[str, Any]]:
        recent = self.database.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(desc(Notification.created_at))
            .limit(60)
        ).all()
        shown = [item for item in recent if notification_module(item) != "message"][:30]
        return [
            {
                "id": item.id,
                "title": item.title,
                "body": item.body,
                "is_read": item.is_read,
                "module": notification_module(item),
                "category": item.category,
                "created_at": local_iso(item.created_at),
            }
            for item in shown
        ]

    def mark_notifications_read(self, user: User) -> dict[str, Any]:
        for notification in self.unread(user):
            if notification_module(notification) != "message":
                notification.is_read = True
        self.database.commit()
        return {"status": "read"}

    def mark_notification_read(self, user: User, notification_id: uuid.UUID) -> dict[str, Any]:
        """Mark one of the account's own notifications read (another's is not found)."""
        notification = self.database.scalars(
            select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id)
        ).first()
        if notification is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        notification.is_read = True
        self.database.commit()
        return {"status": "read", "id": notification_id}

    def mark_module_notifications_read(
        self, user: User, module: str | None = None, category: str | None = None
    ) -> dict[str, Any]:
        """One module's unread notifications, or (with `category`, comma-separated) those
        of these categories; a row without a category never matches a category."""
        requested_module = (module or "").strip().lower()
        requested_categories = {item.strip().upper() for item in (category or "").split(",") if item.strip()}
        if not requested_module and not requested_categories:
            raise HTTPException(status_code=400, detail="Give a module or a category.")
        for notification in self.unread(user):
            if requested_categories:
                if notification.category in requested_categories:
                    notification.is_read = True
            elif notification_module(notification) == requested_module:
                notification.is_read = True
        self.database.commit()
        return {
            "status": "read",
            "module": requested_module or None,
            "category": sorted(requested_categories) or None,
        }
