"""The chat socket's connection table, presence, and the websocket session helpers
(ported from the old websocket_service.py and the old dependencies' websocket_user /
websocket_session_check).

A handshake is admitted like any HTTP request of this API: the session cookie (never a
token in the URL), a live session, an active account, no unpaid builder sign-up, and
an Origin this API lets call it with credentials. The Origin is required: a browser
always sends one, and a page on another site must not open a socket with this
browser's cookies. An open socket re-checks its session every
WEBSOCKET_SESSION_RECHECK_SECONDS and closes once it is signed out, revoked, expired
or suspended. Everything is per process (SC-07).
"""

import asyncio
import contextlib
import logging
import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session
from starlette.requests import HTTPConnection

from app.auth.dependencies import authenticate_access_token
from app.core.config import Settings
from app.core.middleware import is_allowed_origin
from app.core.security.access_tokens import read_access_claims
from app.core.security.session_cookies import access_token_from
from app.modules.billing.signup_checkout import pending_checkout
from app.modules.identity.models import User
from app.modules.identity.repository import SessionRepository
from app.modules.identity.session_service import SessionService
from app.modules.messaging.live_events import live_events

logger = logging.getLogger(__name__)

# Policy violation: the close code a refused handshake gets too.
WS_SESSION_ENDED = 1008


async def send_json_safe(websocket: WebSocket, payload: dict[str, Any]) -> None:
    """Send a payload as JSON (UUIDs and datetimes encoded as on the HTTP endpoints)."""
    await websocket.send_json(jsonable_encoder(payload))


class ChatConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, dict[uuid.UUID, list[WebSocket]]] = defaultdict(lambda: defaultdict(list))

    async def connect(self, conversation_id: uuid.UUID, user_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[conversation_id][user_id].append(websocket)

    def disconnect(self, conversation_id: uuid.UUID, user_id: uuid.UUID, websocket: WebSocket) -> None:
        user_connections = self._connections.get(conversation_id, {}).get(user_id, [])
        if websocket in user_connections:
            user_connections.remove(websocket)
        if not user_connections and conversation_id in self._connections:
            self._connections[conversation_id].pop(user_id, None)
        if conversation_id in self._connections and not self._connections[conversation_id]:
            self._connections.pop(conversation_id, None)

    def in_conversation(self, conversation_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        return bool(self._connections.get(conversation_id, {}).get(user_id))

    def has_user(self, user_id: uuid.UUID) -> bool:
        """Whether this account has any chat socket open in this process."""
        return any(user_id in users for users in self._connections.values())

    async def send_to_user(self, conversation_id: uuid.UUID, user_id: uuid.UUID, payload: dict[str, Any]) -> int:
        connections = [
            (user_id, websocket) for websocket in self._connections.get(conversation_id, {}).get(user_id, [])
        ]
        return await self._send_many(conversation_id, connections, payload)

    async def broadcast(
        self, conversation_id: uuid.UUID, payload: dict[str, Any], exclude_user_id: uuid.UUID | None = None
    ) -> int:
        """Send to everyone connected to this conversation but one; returns how many
        sockets received it. Only a conversation's participants are ever connected to it
        (the handshake checks), so nobody else receives its events."""
        connections = []
        for user_id, user_connections in self._connections.get(conversation_id, {}).items():
            if user_id != exclude_user_id:
                connections.extend((user_id, websocket) for websocket in user_connections)
        return await self._send_many(conversation_id, connections, payload)

    async def _send_many(
        self, conversation_id: uuid.UUID, connections: list[tuple[uuid.UUID, WebSocket]], payload: dict[str, Any]
    ) -> int:
        sent = 0
        for user_id, websocket in connections:
            try:
                await send_json_safe(websocket, payload)
                sent += 1
            except (WebSocketDisconnect, RuntimeError):
                # A peer that went away before its handler unregistered it.
                self.disconnect(conversation_id, user_id, websocket)
        return sent


chat_connections = ChatConnectionManager()


def is_user_online(user_id: uuid.UUID) -> bool:
    """Online = an open chat or dashboard socket in this process."""
    return chat_connections.has_user(user_id) or live_events.has_user(user_id)


def connection_settings(connection: HTTPConnection) -> Settings:
    settings: Settings = connection.app.state.settings
    return settings


def websocket_user(connection: HTTPConnection, database: Session) -> User | None:
    """The signed-in account behind a websocket handshake, or None to refuse it."""
    settings = connection_settings(connection)
    if not is_allowed_origin(connection.headers.get("origin"), settings):
        return None
    try:
        user, _session = authenticate_access_token(access_token_from(connection, settings), database, settings)
    except HTTPException:
        return None
    if pending_checkout(user, database) is not None:
        return None  # a paid sign-up not paid yet: no live channels
    return user


def websocket_session_still_valid(connection: HTTPConnection, database: Session) -> bool:
    """Re-check an open socket against the token it was admitted with: the session
    family must still be live (it survives refreshes; it ends with sign-out, reuse
    detection, a password reset or expiry) and the account active."""
    settings = connection_settings(connection)
    claims = read_access_claims(settings, access_token_from(connection, settings) or "", allow_expired=True)
    if claims is None:
        return False
    if not SessionService(SessionRepository(database), settings).family_is_live(claims):
        return False
    user = database.get(User, claims.user_id)
    return user is not None and user.is_active


def websocket_session_check(connection: HTTPConnection, session_factory: Callable[[], Session]) -> Callable[[], bool]:
    """A no-argument re-check for one open socket, on its own short database session."""

    def still_valid() -> bool:
        database = session_factory()
        try:
            return websocket_session_still_valid(connection, database)
        finally:
            database.close()

    return still_valid


async def guard_session(websocket: WebSocket, still_valid: Callable[[], bool], interval_seconds: float) -> None:
    """Close an open socket once its sign-in no longer passes `still_valid`; a check
    that cannot be completed counts as failed."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            valid = await asyncio.to_thread(still_valid)
        except Exception:
            logger.exception("Could not re-check a websocket session")
            valid = False
        if not valid:
            with contextlib.suppress(Exception):  # already closing
                await websocket.close(code=WS_SESSION_ENDED)
            return
