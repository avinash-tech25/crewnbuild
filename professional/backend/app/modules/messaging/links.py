"""What other modules read from messaging: whether a file is an attachment its sender
sent in a conversation the viewer is in (file access; the old file_repository rule)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.files.file_ownership import file_ids_in
from app.modules.messaging.models import ConversationParticipant, Message


def is_attachment_sent_to(database: Session, sender_id: uuid.UUID, viewer_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    viewer_conversations = select(ConversationParticipant.conversation_id).where(
        ConversationParticipant.user_id == viewer_id
    )
    urls = database.scalars(
        select(Message.attachment_url).where(
            Message.sender_id == sender_id,
            Message.attachment_url.isnot(None),
            Message.conversation_id.in_(viewer_conversations),
        )
    ).all()
    return file_id in file_ids_in(*urls)
