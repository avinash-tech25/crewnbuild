"""Messaging tables (technical-architecture.md section 10, domain Messaging).

    conversations               integer key -> UUID
    conversation_participants   integer key -> UUID; unique (conversation, user)
    messages                    integer key -> UUID; sender_id -> sender_user_id,
                                receiver_id -> receiver_user_id
    notifications               integer key -> UUID; FK user_id CASCADE (a notice exists
                                only for its account)

The Python attribute names stay the old ones (sender_id, receiver_id ...) so the ported
service and the API keys are unchanged. A message's state is timestamps, each NULL
until it happens: delivered_at, read_at, edited_at. Times are timestamptz read as naive
UTC (NaiveUtcTimestamp), as the old code compared and formatted them.

Delete rules (9.3): participants and messages go with their conversation (CASCADE); a
participant row goes with its account (CASCADE, as before; accounts are soft-deleted);
a message keeps its sender (RESTRICT) and loses a receiver that goes (SET NULL).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, CreatedAtMixin, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


class Conversation(UuidPrimaryKeyMixin, Base):
    __tablename__ = "conversations"

    title: Mapped[str] = mapped_column(String(180), nullable=False)
    conversation_type: Mapped[str] = mapped_column(String(40), nullable=False, default="DIRECT")
    # "direct:<low user id>:<high user id>" for a two-person conversation.
    direct_key: Mapped[str | None] = mapped_column(String(120), unique=True)
    last_message: Mapped[str | None] = mapped_column(Text)
    last_message_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp, index=True)
    created_at: Mapped[datetime] = created_at_column()

    participants = relationship(
        "ConversationParticipant", back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True
    )


class ConversationParticipant(UuidPrimaryKeyMixin, Base):
    __tablename__ = "conversation_participants"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    conversation = relationship("Conversation", back_populates="participants")
    user = relationship("User")


class Message(UuidPrimaryKeyMixin, Base):
    """One chat message, or a workflow card (REQUEST, QUOTATION, ASSIGNMENT) another
    module posts into a conversation."""

    __tablename__ = "messages"
    __table_args__ = (
        # A conversation's history, newest first.
        Index("ix_messages__conversation_id_created_at", "conversation_id", "created_at"),
        # Marking a receiver's messages in one conversation delivered or read.
        Index(
            "ix_messages__conversation_id_receiver_user_id_unread",
            "conversation_id",
            "receiver_user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        "sender_user_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    receiver_id: Mapped[uuid.UUID | None] = mapped_column(
        "receiver_user_id", ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    message_type: Mapped[str] = mapped_column(String(30), nullable=False, default="TEXT")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_url: Mapped[str | None] = mapped_column(String(500))
    delivered_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    read_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    edited_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()


class Notification(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # NULL for notices written without a category.
    category: Mapped[str | None] = mapped_column(String(20))
