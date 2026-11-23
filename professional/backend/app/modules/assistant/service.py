"""One Viswa chat turn, and the stored history around it.

    check_available    off, or no OPENAI_API_KEY: 503 (the rest of the app is unaffected)
    check_limits       per user (window and day) or per guest address, in rate_limit_events: 429
    run_turn           a generator of Server-Sent Events: "delta" text chunks while the AI
                       writes, then one "done" event (the cleaned answer, buttons, suggestions)
                       or one "error" event

Order inside a turn: the message is checked for prompt injection (refused without the AI),
the stored history (signed in) or the guest's own recent turns are added, then the AI may
call up to ASSISTANT_MAX_TOOL_CALLS tools (tools.py) before it must answer. The answer's
buttons come only from the help cards the AI looked at. Signed-in turns are stored;
guests' never are. History older than ASSISTANT_HISTORY_DAYS is purged by the scheduler.
"""

import json
import logging
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.local_time import local_today
from app.database.types import naive_utc_now
from app.modules.assistant.knowledge import Knowledge, get_knowledge
from app.modules.assistant.models import ROLE_ASSISTANT, ROLE_USER, AssistantConversation, AssistantMessage
from app.modules.assistant.prompt import build_system_prompt
from app.modules.assistant.provider import Provider, ProviderError, TextDelta, ToolCalls, configured_key
from app.modules.assistant.safety import clean_answer, looks_like_injection
from app.modules.assistant.tools import (
    ADMIN,
    BUILDER,
    ENGINEER,
    GUEST,
    OWNER,
    ROLE_LABELS,
    SITE_ENGINEER,
    SUPPLIER,
    SUPPLIER_EQUIPMENT,
    SUPPLIER_LABOUR,
    SUPPLIER_MATERIAL,
    ToolContext,
    run_tool,
    tools_for,
)
from app.modules.identity.models import ADMIN_ROLES, ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.identity.policies import session_role
from app.modules.rate_limits import service as rate_limits

logger = logging.getLogger(__name__)

HISTORY_MESSAGES = 20
GUEST_HISTORY_MESSAGES = 10
TURN_SECONDS = 60
MAX_BUTTONS = 3
MAX_SUGGESTIONS = 3

NOT_AVAILABLE = "Viswa is not available right now. Please try again later."
BUSY = "Viswa is busy right now. Please try again in a minute."
SLOW_DOWN = "You have sent a lot of messages. Please wait a few minutes and try again."
TOO_LONG = "Please keep your message under {limit} characters."
REFUSED = (
    "Sorry, I can't help with that. I can only see your own projects and requests, and I can't change how I work "
    "or share my instructions. Is there something about your house or your project I can help with?"
)
NOT_FOR_ROLE = "Viswa is not available for this account."
EMPTY_ANSWER = "Sorry, I couldn't put an answer together. Could you ask in another way?"
SUPPORT_BUTTON = {"label": "Contact support", "path": "/contact-us"}


SUPPLIER_ROLES = {
    "material supplier": SUPPLIER_MATERIAL,
    "labor supplier": SUPPLIER_LABOUR,
    "equipment supplier": SUPPLIER_EQUIPMENT,
}


def role_for(user: User | None) -> str | None:
    """Viswa's role for this session, from the account (never from the browser):
    a guest, a House Owner, a Builder, a Site Engineer or another engineer, a supplier of
    its category, or an administrator. Anything else (a retired account type): None."""
    if user is None:
        return GUEST
    role = str(user.role).upper()
    if role == ROLE_OWNER:
        return OWNER
    if role in (ROLE_BUILDER, "CONTRACTOR"):
        return BUILDER
    if role == ROLE_ENGINEER:
        return SITE_ENGINEER if session_role(user) == SITE_ENGINEER else ENGINEER
    if role == ROLE_SUPPLIER:
        profile = getattr(user, "supplier_profile", None)
        return SUPPLIER_ROLES.get(str(getattr(profile, "supplier_category", "") or "").strip().lower(), SUPPLIER)
    if role in ADMIN_ROLES:
        return ADMIN
    return None


def check_available(settings: Settings) -> None:
    if not settings.assistant_enabled or not configured_key(settings):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_AVAILABLE)


def check_message(settings: Settings, message: str) -> str:
    text = (message or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Type a message first.")
    if len(text) > settings.assistant_max_message_chars:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=TOO_LONG.format(limit=settings.assistant_max_message_chars),
        )
    return text


def check_limits(database: Session, settings: Settings, user: User | None, address: str | None) -> None:
    window = settings.assistant_rate_limit_window_seconds
    if user is None:
        allowed = rate_limits.hit(
            database, "assistant.guest", address or "unknown", settings.assistant_guest_rate_limit_messages, window
        )
    else:
        key = str(user.id)
        allowed = not rate_limits.blocked(
            database, "assistant.daily", key, settings.assistant_daily_limit, 86400
        ) and rate_limits.hit(database, "assistant.message", key, settings.assistant_rate_limit_messages, window)
        if allowed:
            rate_limits.record(database, "assistant.daily", key)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=SLOW_DOWN)


# ------------------------------------------------------------------ stored history


def conversation_of(database: Session, user_id: uuid.UUID, create: bool = False) -> AssistantConversation | None:
    conversation = database.scalars(
        select(AssistantConversation).where(AssistantConversation.user_id == user_id)
    ).first()
    if conversation is None and create:
        conversation = AssistantConversation(user_id=user_id)
        database.add(conversation)
        database.flush()
    return conversation


def history_rows(
    database: Session, settings: Settings, user_id: uuid.UUID, limit: int | None = None
) -> list[AssistantMessage]:
    """The user's stored messages within the retention period, oldest first."""
    conversation = conversation_of(database, user_id)
    if conversation is None:
        return []
    cutoff = naive_utc_now() - timedelta(days=settings.assistant_history_days)
    query = (
        select(AssistantMessage)
        .where(AssistantMessage.conversation_id == conversation.id, AssistantMessage.created_at >= cutoff)
        .order_by(AssistantMessage.created_at.desc(), AssistantMessage.id.desc())
    )
    if limit:
        query = query.limit(limit)
    return list(reversed(database.scalars(query).all()))


def message_payload(row: AssistantMessage) -> dict[str, Any]:
    return {
        "id": row.id,
        "role": row.role,
        "text": row.content,
        "answer_type": row.answer_type,
        "buttons": row.buttons or [],
        "vote": row.vote,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def clear_history(database: Session, user_id: uuid.UUID) -> int:
    conversation = conversation_of(database, user_id)
    if conversation is None:
        return 0
    result = database.execute(delete(AssistantMessage).where(AssistantMessage.conversation_id == conversation.id))
    database.commit()
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


def delete_user_conversations(database: Session, user_id: uuid.UUID) -> None:
    """For the account deletion (a soft delete, so the foreign key's CASCADE does not fire)."""
    database.execute(delete(AssistantConversation).where(AssistantConversation.user_id == user_id))


def set_vote(database: Session, user_id: uuid.UUID, message_id: uuid.UUID, vote: str | None) -> dict[str, Any]:
    """Thumbs up / down on one of the user's own answers; anyone else's message is 404."""
    row = database.scalars(
        select(AssistantMessage)
        .join(AssistantConversation, AssistantMessage.conversation_id == AssistantConversation.id)
        .where(
            AssistantMessage.id == message_id,
            AssistantConversation.user_id == user_id,
            AssistantMessage.role == ROLE_ASSISTANT,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    row.vote = vote
    database.commit()
    return {"id": row.id, "vote": row.vote}


def purge_old_history(database: Session, days: int) -> int:
    """The scheduler's job: messages older than the retention period, then empty chats."""
    cutoff = naive_utc_now() - timedelta(days=days)
    removed = database.execute(delete(AssistantMessage).where(AssistantMessage.created_at < cutoff))
    database.execute(
        delete(AssistantConversation).where(
            AssistantConversation.last_message_at < cutoff,
            ~AssistantConversation.messages.any(),
        )
    )
    database.commit()
    return int(removed.rowcount or 0)  # type: ignore[attr-defined]


# ------------------------------------------------------------------ the welcome (no AI)

WELCOME = {
    GUEST: ("Ask me how Crew&Build works or how much your house could cost.",
            ["How much will my house cost?", "How do I hire a builder?", "What is Crew&Build?"]),
    OWNER: ("Ask me about your projects, quotations and orders, or how anything in Crew&Build works.",
            ["What is the status of my project?", "Did any builder send a quotation?", "How do I hire a builder?"]),
    BUILDER: ("Ask me about your requests, projects, site engineers and costs.",
              ["Any new requests for me?", "How are my project costs?", "How do I add a site engineer?"]),
    SITE_ENGINEER: ("Ask me about your assigned projects, orders, the store and your daily records.",
                    ["Which projects am I assigned to?", "Where are my orders?", "How do I record material usage?"]),
    ENGINEER: ("Ask me about opportunities, your profile or how Crew&Build works.",
               ["Any opportunities for me?", "How do I join a builder's team?", "How do I update my profile?"]),
    SUPPLIER_MATERIAL: ("Ask me about your orders, listings and stock, or how Crew&Build works.",
                        ["Any new orders?", "Which products are low on stock?", "How do I add a product?"]),
    SUPPLIER_LABOUR: ("Ask me about your labour requests, services and clients.",
                      ["Any new labour requests?", "How many workers are available?", "How do I add a service?"]),
    SUPPLIER_EQUIPMENT: ("Ask me about your equipment requests, inventory and clients.",
                         ["Any new equipment requests?", "What equipment have I listed?", "How do I add equipment?"]),
    SUPPLIER: ("Ask me how to set up your supplier account and how Crew&Build works.",
               ["How do I choose my supplier type?", "How do I find clients?", "What is Crew&Build?"]),
    ADMIN: ("I can explain the admin screens and show the overview counts your permissions allow.",
            ["What needs attention?", "How do I review a verification?", "Where are reports?"]),
}  # fmt: skip


def welcome(user: User | None) -> dict[str, Any]:
    role = role_for(user)
    if role is None:
        return {"message": NOT_FOR_ROLE, "suggestions": []}
    text, suggestions = WELCOME[role]
    first_name = (user.name or "").split(" ")[0] if user else ""
    greeting = f"Hi {first_name}, I'm Viswa." if first_name else "Hi, I'm Viswa, your Crew&Build helper."
    return {"message": f"{greeting} {text}", "suggestions": suggestions, "role": ROLE_LABELS.get(role, role)}


# ------------------------------------------------------------------ one turn


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@dataclass
class Turn:
    user_id: uuid.UUID | None
    role: str | None
    message: str
    page: str = ""
    guest_history: list[dict[str, str]] = field(default_factory=list)


def guest_history(raw: list[dict[str, Any]] | None, settings: Settings) -> list[dict[str, str]]:
    """A guest's own last turns, kept by their browser: user / assistant text only, capped."""
    turns = []
    for item in (raw or [])[-GUEST_HISTORY_MESSAGES:]:
        role = item.get("role") if isinstance(item, dict) else None
        text = str(item.get("text") or "")[: settings.assistant_max_message_chars] if role else ""
        if role in (ROLE_USER, ROLE_ASSISTANT) and text.strip():
            turns.append({"role": role, "content": text})
    return turns


def buttons_and_suggestions(knowledge: Knowledge, role: str, context: ToolContext) -> tuple[list[dict], list[str]]:
    buttons: list[dict[str, str]] = []
    suggestions: list[str] = []
    for card in context.cards_seen:
        for label, path in card.buttons:
            if path not in {button["path"] for button in buttons}:
                buttons.append({"label": label, "path": path})
        for next_id in card.next:
            linked = knowledge.card(role, next_id)
            if linked and linked.title not in suggestions:
                suggestions.append(linked.title)
    return buttons[:MAX_BUTTONS], suggestions[:MAX_SUGGESTIONS]


def store_turn(
    database: Session, user_id: uuid.UUID, question: str, answer: str, answer_type: str, tools: list[str], buttons: list
) -> uuid.UUID:
    conversation = conversation_of(database, user_id, create=True)
    now = naive_utc_now()
    database.add(AssistantMessage(conversation_id=conversation.id, role=ROLE_USER, content=question, created_at=now))
    reply = AssistantMessage(
        conversation_id=conversation.id,
        role=ROLE_ASSISTANT,
        content=answer,
        answer_type=answer_type,
        tools_used=tools,
        buttons=buttons,
        created_at=now + timedelta(microseconds=1),
    )
    database.add(reply)
    conversation.last_message_at = now
    database.commit()
    return reply.id


def run_turn(turn: Turn, settings: Settings, provider: Provider, database: Session) -> Iterator[str]:
    """The SSE stream of one turn. `database` is a session owned by the stream (the
    request's own session may already be closed while the response streams)."""
    knowledge = get_knowledge()
    user = database.get(User, turn.user_id) if turn.user_id else None
    role = turn.role
    stored = user is not None and role is not None  # guests and unsupported roles: nothing kept

    def finish(answer: str, answer_type: str, tools: list[str], buttons: list, suggestions: list[str]) -> str:
        message_id = (
            store_turn(database, user.id, turn.message, answer, answer_type, tools, buttons) if stored else None  # type: ignore[union-attr]
        )
        return sse(
            "done",
            {
                "message_id": message_id,
                "answer": answer,
                "answer_type": answer_type,
                "buttons": buttons,
                "suggestions": suggestions,
            },
        )

    try:
        if role is None:
            yield finish(NOT_FOR_ROLE, "feature_missing", [], [], [])
            return
        if looks_like_injection(turn.message):
            logger.info("assistant refused a prompt-injection attempt")
            yield finish(REFUSED, "refused", [], [SUPPORT_BUTTON], [])
            return

        first_name = (user.name or "").split(" ")[0] if user else ""
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": build_system_prompt(knowledge, role, first_name, turn.page, local_today())}
        ]
        if stored:
            messages += [
                {"role": row.role, "content": row.content}
                for row in history_rows(database, settings, user.id, HISTORY_MESSAGES)  # type: ignore[union-attr]
            ]
        else:
            messages += turn.guest_history
        messages.append({"role": "user", "content": turn.message})

        context = ToolContext(database=database, user=user, role=role, knowledge=knowledge)
        tool_schemas = [tool.schema() for tool in tools_for(role)]
        deadline = time.monotonic() + TURN_SECONDS
        answer = ""
        calls_made = 0
        while True:
            offered = tool_schemas if calls_made < settings.assistant_max_tool_calls else []
            text = ""
            requested: list = []
            for event in provider.stream(messages, offered):
                if time.monotonic() > deadline:
                    raise ProviderError("The turn took too long.")
                if isinstance(event, TextDelta):
                    text += event.text
                    yield sse("delta", {"text": event.text})
                elif isinstance(event, ToolCalls):
                    requested = event.calls
            if not requested or not offered:
                answer = text
                break
            requested = requested[: max(0, settings.assistant_max_tool_calls - calls_made)]
            calls_made += len(requested)
            messages.append(
                {
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {"name": call.name, "arguments": call.arguments},
                            # Gemini's thought_signature must come back with its call.
                            **({"extra_content": call.extra_content} if call.extra_content else {}),
                        }
                        for call in requested
                    ],
                }
            )
            for call in requested:
                result = run_tool(context, call.name, call.arguments)
                messages.append(
                    {"role": "tool", "tool_call_id": call.id, "content": json.dumps({"data": result}, default=str)}
                )

        allowed_paths = knowledge.allowed_paths(role)
        cleaned = clean_answer(answer, allowed_paths) or EMPTY_ANSWER
        buttons, suggestions = buttons_and_suggestions(knowledge, role, context)
        yield finish(cleaned, "answered", context.tools_used, buttons, suggestions)
    except ProviderError as error:
        # The status and the provider's own message, key-free (see provider.ProviderError).
        logger.warning("assistant provider failed: %s", error)
        database.rollback()
        yield sse("error", {"message": BUSY})
    except Exception:
        logger.exception("assistant turn failed")
        database.rollback()
        yield sse("error", {"message": BUSY})
