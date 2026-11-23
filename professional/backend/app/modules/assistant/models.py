"""Viswa's stored chats (signed-in users only; guests are never stored).

    assistant_conversations   one per user (Clear chat deletes its messages)
    assistant_messages        the user's questions and Viswa's answers, oldest first

Kept for ASSISTANT_HISTORY_DAYS (30) and then purged by the scheduler. Both go with the
user (CASCADE), and the account deletion (a soft delete) removes them explicitly.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

ROLE_USER = "user"
ROLE_ASSISTANT = "assistant"


def timestamp_column(name: str) -> Mapped[datetime]:
    return mapped_column(name, NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()"))


class AssistantConversation(UuidPrimaryKeyMixin, Base):
    __tablename__ = "assistant_conversations"
    __table_args__ = (UniqueConstraint("user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = timestamp_column("created_at")
    last_message_at: Mapped[datetime] = timestamp_column("last_message_at")

    messages: Mapped[list["AssistantMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True
    )


class AssistantMessage(UuidPrimaryKeyMixin, Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="role"),
        CheckConstraint("vote IS NULL OR vote IN ('up', 'down')", name="vote"),
        Index("ix_assistant_messages__conversation_id_created_at", "conversation_id", "created_at"),
        Index("ix_assistant_messages__created_at", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    answer_type: Mapped[str | None] = mapped_column(String(30))
    tools_used: Mapped[list[Any] | None] = mapped_column(JSON)
    buttons: Mapped[list[Any] | None] = mapped_column(JSON)
    vote: Mapped[str | None] = mapped_column(String(4))
    created_at: Mapped[datetime] = timestamp_column("created_at")

    conversation: Mapped[AssistantConversation] = relationship(back_populates="messages")
