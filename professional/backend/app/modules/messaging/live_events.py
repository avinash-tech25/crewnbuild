"""Live "something changed" hints for open dashboards (the /events/ws socket), ported
from the old live_events.py.

A change is still made only by its REST endpoint and read only through the GET
endpoints. After it is COMMITTED, the affected account's open dashboards get one tiny
event, {"event": "requests_changed"}, and reload through those GETs; nothing private
travels on the socket.

queue_live_hint() only records the account on the database session; the hint is sent
from SQLAlchemy's after_commit, and a rollback discards it, so a transaction that fails
never tells anyone it happened. Connections are kept per account in this process's
memory (realtime stays per process, SC-07). Routes that commit run in the thread pool,
so a hint is handed to the event loop thread-safely.
"""

import asyncio
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

REQUESTS_CHANGED = {"event": "requests_changed"}
_PENDING_KEY = "live_hint_user_ids"


class UserEventManager:
    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._loop = asyncio.get_running_loop()
        self._connections[user_id].add(websocket)

    def has_user(self, user_id: uuid.UUID) -> bool:
        return bool(self._connections.get(user_id))

    def disconnect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    def notify(self, user_ids: set[uuid.UUID], payload: dict[str, Any] = REQUESTS_CHANGED) -> None:
        """Send the hint to these accounts' open sockets. Safe from any thread."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        for user_id in user_ids:
            try:
                asyncio.run_coroutine_threadsafe(self._send(user_id, payload), loop)
            except RuntimeError:
                return

    async def _send(self, user_id: uuid.UUID, payload: dict[str, Any]) -> None:
        for websocket in list(self._connections.get(user_id, ())):
            try:
                await websocket.send_json(payload)
            except Exception:
                self.disconnect(user_id, websocket)


live_events = UserEventManager()


def queue_live_hint(database: Session, user_id: Any) -> None:
    """Mark this account for a hint once the current transaction commits."""
    if not user_id:
        return
    try:
        normalized = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        return
    database.info.setdefault(_PENDING_KEY, set()).add(normalized)


@event.listens_for(Session, "after_commit")
def _send_hints_after_commit(session: Session) -> None:
    user_ids = session.info.pop(_PENDING_KEY, None)
    if user_ids:
        try:
            live_events.notify(user_ids)
        except Exception:  # never let a hint break a committed request
            logger.exception("Could not send live dashboard hints")


@event.listens_for(Session, "after_rollback")
def _drop_hints_after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)
