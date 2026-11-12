"""Live dashboard hints (the /events websocket). NOT PORTED YET: the websocket and its
relay come with the messaging module, which replaces this function. Until then an open
dashboard is not told to refresh; it sees the change on its next load."""

import uuid

from sqlalchemy.orm import Session


def queue_live_hint(database: Session, user_id: uuid.UUID) -> None:
    return None
