"""Request bodies of messaging (the old schemas/messaging.py; same fields, ids are UUIDs)."""

import uuid

from pydantic import BaseModel


class MessageCreate(BaseModel):
    conversation_id: uuid.UUID | None = None
    receiver_id: uuid.UUID | None = None
    body: str
    attachment_url: str | None = None
    message_type: str | None = "TEXT"


class ConversationStart(BaseModel):
    receiver_id: uuid.UUID
    title: str | None = None


class MessageEdit(BaseModel):
    body: str
