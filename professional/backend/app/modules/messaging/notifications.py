"""Writing an in-app notification (the reading endpoints come with the messaging module)."""

import uuid

from sqlalchemy.orm import Session

from app.modules.messaging.models import Notification


def add_notification(database: Session, user_id: uuid.UUID, title: str, body: str, category: str | None = None) -> None:
    """Staged in the caller's transaction."""
    database.add(Notification(user_id=user_id, title=title, body=body, category=category))
