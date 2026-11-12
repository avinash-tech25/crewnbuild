"""Notifications from the project workflows (the old notification_service
create_notification / create_request_notification, same rows)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.messaging.live_events import queue_live_hint
from app.modules.messaging.notifications import add_notification


def create_notification(database: Session, user_id: uuid.UUID, title: str, body: str, *, category: str) -> None:
    add_notification(database, user_id, title, body, category=category)


def create_request_notification(database: Session, user_id: uuid.UUID, title: str, body: str, *, category: str) -> None:
    """A notification for a request-flow change, plus a live hint so that account's open
    dashboards reload once this transaction commits."""
    add_notification(database, user_id, title, body, category=category)
    queue_live_hint(database, user_id)
