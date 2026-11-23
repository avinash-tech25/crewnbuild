"""Viswa, the help assistant, under /api/v1/assistant.

    GET    /assistant/welcome               the opening message (no AI call; guests too)
    GET    /assistant/health                is the AI configured and reachable (key-free;
                                            the status and the provider's reason for admins)
    POST   /assistant/chat                  one question; the answer is streamed back as
                                            Server-Sent Events (guests too)
    GET    /assistant/history               the signed-in user's stored chat (30 days)
    DELETE /assistant/history               Clear chat
    PUT    /assistant/messages/{id}/vote    thumbs up / down on one of the user's answers

Who is asking comes only from the session cookie (optional_user / current_user); the
browser never sends a user id or a role. Writes with a session carry X-CSRF-Token (the
CSRF middleware). The AI key stays on this server (provider.py).
"""

import time
import uuid
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import app_settings, current_user, optional_user
from app.core.client_address import visitor_address
from app.core.config import Settings
from app.database.session import SessionLocal, get_db
from app.modules.assistant import service
from app.modules.assistant.provider import OpenAICompatibleProvider, Provider, configured_key
from app.modules.assistant.tools import ADMIN
from app.modules.identity.models import User

router = APIRouter(prefix="/assistant", tags=["Assistant"])


def get_provider(settings: Settings = Depends(app_settings)) -> Provider:
    return OpenAICompatibleProvider(settings)


# One reachability check per base URL and model per minute, so the endpoint cannot be used
# to hammer the provider.
HEALTH_CACHE_SECONDS = 60.0
_health_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def provider_check(settings: Settings, provider: Provider) -> dict[str, Any]:
    check = getattr(provider, "check", None)
    if check is None:
        return {"reachable": True, "status": None, "reason": ""}
    cache_key = (settings.openai_base_url, settings.assistant_model)
    cached = _health_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < HEALTH_CACHE_SECONDS:
        return cached[1]
    result: dict[str, Any] = check()
    _health_cache[cache_key] = (time.monotonic(), result)
    return result


class GuestTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ChatPayload(BaseModel):
    # The real limit is ASSISTANT_MAX_MESSAGE_CHARS (checked in the service, with a clear message).
    message: str = Field(min_length=1, max_length=10000)
    current_page: str = Field("", max_length=300)
    # A guest's own recent turns, kept by their browser (ignored for signed-in users).
    history: list[GuestTurn] = Field(default_factory=list, max_length=20)


class VotePayload(BaseModel):
    vote: Literal["up", "down"] | None = None


@router.get("/welcome")
def assistant_welcome(user: User | None = Depends(optional_user)) -> dict[str, Any]:
    return service.welcome(user)


@router.get("/health")
def assistant_health(
    user: User | None = Depends(optional_user),
    settings: Settings = Depends(app_settings),
    provider: Provider = Depends(get_provider),
) -> dict[str, Any]:
    configured = bool(configured_key(settings))
    report: dict[str, Any] = {"enabled": settings.assistant_enabled, "configured": configured, "reachable": False}
    if settings.assistant_enabled and configured:
        check = provider_check(settings, provider)
        report["reachable"] = bool(check["reachable"])
        if service.role_for(user) == ADMIN:
            report.update(model=settings.assistant_model, status=check["status"], reason=check["reason"])
    return report


@router.post("/chat")
def assistant_chat(
    payload: ChatPayload,
    request: Request,
    user: User | None = Depends(optional_user),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    provider: Provider = Depends(get_provider),
) -> StreamingResponse:
    service.check_available(settings)
    message = service.check_message(settings, payload.message)
    role = service.role_for(user)
    if role is not None:
        service.check_limits(database, settings, user, visitor_address(request, settings.trusted_proxy_ips))
    turn = service.Turn(
        user_id=user.id if user else None,
        role=role,
        message=message,
        page=payload.current_page,
        guest_history=[] if user else service.guest_history([item.model_dump() for item in payload.history], settings),
    )

    def events() -> Iterator[str]:
        # Its own session: the request's may be closed while the answer streams.
        with SessionLocal() as stream_database:
            yield from service.run_turn(turn, settings, provider, stream_database)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/history")
def assistant_history(
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    if service.role_for(user) is None:
        return {"messages": []}
    return {"messages": [service.message_payload(row) for row in service.history_rows(database, settings, user.id)]}


@router.delete("/history")
def clear_assistant_history(user: User = Depends(current_user), database: Session = Depends(get_db)) -> dict[str, Any]:
    return {"deleted": service.clear_history(database, user.id)}


@router.put("/messages/{message_id}/vote")
def vote_on_answer(
    message_id: uuid.UUID,
    payload: VotePayload,
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return service.set_vote(database, user.id, message_id, payload.vote)
