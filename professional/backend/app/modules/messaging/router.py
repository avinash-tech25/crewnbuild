"""Messaging endpoints under /api/v1 (ported from the old notification_routes.py,
message_routes.py and event_routes.py, in that order; paths and answers unchanged, ids
are UUIDs).

    /notifications...                 the bell
    /messages/...                     conversations and messages (HTTP)
    /messages/ws/{conversation_id}    the chat socket (websocket_router)
    /events/ws                        live dashboard hints (websocket_router)

Chat socket events
    client -> server   message | send_message, read, typing, ping
    server -> client   connected (with the latest messages), message, delivered, read,
                       edit, typing, online, offline, pong, error

The sockets sign in with the session cookie and an allowed Origin at the handshake (no
token in the URL); the chat socket admits only a participant of that conversation, so
nobody receives another conversation's events. Realtime is per process (SC-07).
"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketState

from app.auth.dependencies import current_user
from app.database.session import SessionLocal, get_db
from app.modules.identity.models import User
from app.modules.messaging.live_events import live_events
from app.modules.messaging.models import Message
from app.modules.messaging.notifications import NotificationService
from app.modules.messaging.schemas import ConversationStart, MessageCreate, MessageEdit
from app.modules.messaging.service import MessageService, find_participant
from app.modules.messaging.websocket_service import (
    WS_SESSION_ENDED,
    chat_connections,
    connection_settings,
    guard_session,
    send_json_safe,
    websocket_session_check,
    websocket_user,
)

router = APIRouter(tags=["Users"])
websocket_router = APIRouter(tags=["Live events"])


def get_notification_service(database: Session = Depends(get_db)) -> NotificationService:
    return NotificationService(database)


def get_message_service(database: Session = Depends(get_db)) -> MessageService:
    return MessageService(database)


# ---- notifications ----


@router.get("/notifications")
def fetch_user_notifications(
    user: User = Depends(current_user), service: NotificationService = Depends(get_notification_service)
):
    return service.fetch_user_notifications(user=user)


@router.post("/notifications/read-all")
def mark_notifications_read(
    user: User = Depends(current_user), service: NotificationService = Depends(get_notification_service)
):
    return service.mark_notifications_read(user=user)


@router.post("/notifications/read-module")
def mark_module_notifications_read(
    module: str | None = Query(default=None),
    category: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: NotificationService = Depends(get_notification_service),
):
    return service.mark_module_notifications_read(user=user, module=module, category=category)


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    service: NotificationService = Depends(get_notification_service),
):
    return service.mark_notification_read(user=user, notification_id=notification_id)


# ---- messages ----


async def publish_new_message(messages: MessageService, message: Message, sender: User) -> None:
    """Push a stored message to the conversation's open sockets. Reaching one of the
    receiver's makes it delivered (and tells the sender); reaching none sends the
    receiver the notification instead."""
    conversation_id = message.conversation_id
    await chat_connections.send_to_user(
        conversation_id, sender.id, {"event": "message", "message": messages.serialize_message(message, sender.id)}
    )
    reached = await chat_connections.broadcast(
        conversation_id, {"event": "message", "message": messages.serialize_message(message)}, exclude_user_id=sender.id
    )
    if reached and message.receiver_id:
        messages.mark_delivered(conversation_id, message.receiver_id)
        await chat_connections.send_to_user(
            conversation_id,
            sender.id,
            {"event": "delivered", "user_id": message.receiver_id, "message_ids": [message.id]},
        )
    elif not reached:
        messages.notify_receiver(message, sender)


@router.post("/messages/send")
async def send_message(
    payload: MessageCreate, user: User = Depends(current_user), messages: MessageService = Depends(get_message_service)
):
    message = messages.send_message(payload, user)
    await publish_new_message(messages, message, user)
    messages.database.refresh(message)
    return messages.serialize_message(message, user.id)


@router.put("/messages/{message_id}")
async def edit_message(
    message_id: uuid.UUID,
    payload: MessageEdit,
    user: User = Depends(current_user),
    messages: MessageService = Depends(get_message_service),
):
    """Change the text of one's own message; the conversation sees the change live."""
    message = messages.edit_message(message_id, payload.body, user)
    await chat_connections.send_to_user(
        message.conversation_id, user.id, {"event": "edit", "message": messages.serialize_message(message, user.id)}
    )
    await chat_connections.broadcast(
        message.conversation_id,
        {"event": "edit", "message": messages.serialize_message(message)},
        exclude_user_id=user.id,
    )
    return messages.serialize_message(message, user.id)


@router.post("/messages/start")
def start_conversation(
    payload: ConversationStart,
    user: User = Depends(current_user),
    messages: MessageService = Depends(get_message_service),
):
    return messages.start_conversation(payload=payload, user=user)


@router.get("/messages/conversations")
def fetch_conversations(user: User = Depends(current_user), messages: MessageService = Depends(get_message_service)):
    return messages.fetch_conversations(user=user)


@router.get("/messages/conversation/{conversation_id}")
def fetch_conversation_messages(
    conversation_id: uuid.UUID,
    search: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    before_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    messages: MessageService = Depends(get_message_service),
):
    return messages.fetch_conversation_messages(
        conversation_id=conversation_id, search=search, limit=limit, before_id=before_id, user=user
    )


# ---- sockets ----


@websocket_router.websocket("/messages/ws/{conversation_id}")
async def conversation_websocket(websocket: WebSocket, conversation_id: uuid.UUID) -> None:
    database = SessionLocal()
    messages = MessageService(database)
    user_id = None
    guard = None
    try:
        # The session cookie and Origin at the handshake; only a participant is admitted.
        user = websocket_user(websocket, database)
        if not user or find_participant(database, conversation_id, user.id) is None:
            await websocket.close(code=WS_SESSION_ENDED)
            return
        user_id = user.id
        still_valid = websocket_session_check(websocket, SessionLocal)
        await chat_connections.connect(conversation_id, user_id, websocket)
        # Sign-out, revocation, expiry or suspension also ends this open socket.
        guard = asyncio.create_task(
            guard_session(websocket, still_valid, connection_settings(websocket).websocket_session_recheck_seconds)
        )
        if messages.mark_delivered(conversation_id, user_id):
            await chat_connections.broadcast(
                conversation_id, {"event": "delivered", "user_id": user_id}, exclude_user_id=user_id
            )
        await send_json_safe(
            websocket,
            {
                "event": "connected",
                "conversation_id": conversation_id,
                "user_id": user_id,
                "messages": [
                    messages.serialize_message(item, user_id) for item in messages.recent_messages(conversation_id)
                ],
            },
        )
        await chat_connections.broadcast(
            conversation_id, {"event": "online", "user_id": user_id}, exclude_user_id=user_id
        )
        while True:
            # End the transaction before waiting, so the pooled connection is not held.
            database.rollback()
            incoming = await websocket.receive_json()
            if websocket.application_state != WebSocketState.CONNECTED:
                break  # closed by the session guard while a frame was in flight
            event_name = incoming.get("event") if isinstance(incoming, dict) else None
            if event_name in ["message", "send_message"]:
                # A write re-checks the session at once.
                if not await asyncio.to_thread(still_valid):
                    await websocket.close(code=WS_SESSION_ENDED)
                    break
                try:
                    message = messages.send_message(
                        MessageCreate(
                            conversation_id=conversation_id,
                            receiver_id=incoming.get("receiver_id"),
                            body=(incoming.get("body") or incoming.get("content") or "").strip(),
                            attachment_url=incoming.get("attachment_url"),
                            message_type=incoming.get("message_type") or incoming.get("messageType") or "TEXT",
                        ),
                        user,
                    )
                except HTTPException as error:
                    await send_json_safe(websocket, {"event": "error", "detail": error.detail})
                    continue
                except ValueError:
                    # Crash fixed: a malformed receiver_id used to end the socket with an error.
                    await send_json_safe(websocket, {"event": "error", "detail": "Invalid message"})
                    continue
                await publish_new_message(messages, message, user)
                continue
            if event_name == "typing":
                await chat_connections.broadcast(
                    conversation_id, {"event": "typing", "user_id": user_id}, exclude_user_id=user_id
                )
                continue
            if event_name == "read":
                updated_count = messages.mark_read(conversation_id, user_id)
                await chat_connections.broadcast(
                    conversation_id,
                    {"event": "read", "user_id": user_id, "count": updated_count},
                    exclude_user_id=user_id,
                )
                continue
            if event_name == "ping":
                await send_json_safe(websocket, {"event": "pong"})
                continue
            await send_json_safe(websocket, {"event": "error", "detail": "Unsupported websocket event"})
    except WebSocketDisconnect:
        pass
    finally:
        if guard is not None:
            guard.cancel()
        if user_id is not None:
            chat_connections.disconnect(conversation_id, user_id, websocket)
            if not chat_connections.in_conversation(conversation_id, user_id):
                await chat_connections.broadcast(
                    conversation_id, {"event": "offline", "user_id": user_id}, exclude_user_id=user_id
                )
        database.close()


@websocket_router.websocket("/events/ws")
async def events_websocket(websocket: WebSocket) -> None:
    """The per-account live events socket: only ever SENDS {"event": "requests_changed"}
    to this account; the client may send {"event": "ping"}."""
    database = SessionLocal()
    try:
        user = websocket_user(websocket, database)
    finally:
        database.close()
    if not user:
        await websocket.close(code=WS_SESSION_ENDED)
        return
    user_id = user.id
    await live_events.connect(user_id, websocket)
    guard = asyncio.create_task(
        guard_session(
            websocket,
            websocket_session_check(websocket, SessionLocal),
            connection_settings(websocket).websocket_session_recheck_seconds,
        )
    )
    try:
        while True:
            incoming = await websocket.receive_json()
            if websocket.application_state != WebSocketState.CONNECTED:
                break
            if isinstance(incoming, dict) and incoming.get("event") == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: S110 - bad JSON or a dropped link just ends this socket
        pass
    finally:
        guard.cancel()
        live_events.disconnect(user_id, websocket)
