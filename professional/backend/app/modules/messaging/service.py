"""Conversations and messages (ported from the old message_service.py and
message_repository.py; same rules and answers).

The module-level helpers (conversation creation, workflow cards, the assignment card's
status) are what other modules (requests, awards, property enquiries) call to post into
a conversation inside their own transaction; MessageService uses the same helpers.

Only a conversation's participants read it, write to it or open its socket ("Conversation
access denied", 403); only the sender edits a message. A REQUEST card never carries the
sender's phone, e-mail or tax ids to a viewer who has no accepted request with them.
"""

import json
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.accounts.profile_lists import split_profile_list
from app.modules.files.file_ownership import own_file_url
from app.modules.identity.models import ROLE_BUILDER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.messaging.models import Conversation, ConversationParticipant, Message
from app.modules.messaging.notifications import add_notification
from app.modules.messaging.schemas import ConversationStart, MessageCreate
from app.modules.messaging.websocket_service import is_user_online
from app.modules.projects.models import Project, ProjectRequest
from app.modules.projects.people import accepted_request_between

# Only plain text can be edited: workflow cards are records, an attachment's caption
# is generated.
EDITABLE_MESSAGE_TYPES = ("TEXT",)
# What a person may send (REST or the chat socket); cards are written by the server.
USER_MESSAGE_TYPES = {"TEXT", "IMAGE", "DOCUMENT", "FILE"}
# The request types a real flow creates; only an accepted one of these opens a request
# card's contact details.
CONTACT_GRANTING_REQUEST_TYPES = (
    "OWNER_TO_CONTRACTOR",
    "CONTRACTOR_TO_OWNER",
    "OWNER_TO_SUPPLIER",
    "SUPPLIER_TO_OWNER",
    "OWNER_TO_ENGINEER",
    "SUPPLIER_TO_CONTRACTOR",
    "CONTRACTOR_TO_SUPPLIER",
    "SITE_ENGINEER_TO_SPECIALIST",
    "PROPERTY_BUYER_TO_SELLER",
)
# The contact fields a PROJECT_REQUEST body can carry: removed on every read, put back
# only for a viewer who may see them.
REQUEST_CONTACT_KEYS = ("sender_phone", "sender_email", "profile_phone", "profile_email")


def as_uuid(value: Any) -> uuid.UUID | None:
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


# ---- conversations and cards (also used by other modules) ----


def direct_conversation_key(first_user_id: uuid.UUID, second_user_id: uuid.UUID) -> str:
    low_id, high_id = sorted([first_user_id, second_user_id])
    return f"direct:{low_id}:{high_id}"


def find_participant(database: Session, conversation_id: Any, user_id: uuid.UUID) -> ConversationParticipant | None:
    return database.scalars(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation_id, ConversationParticipant.user_id == user_id
        )
    ).first()


def find_direct_conversation(database: Session, user_id: uuid.UUID, receiver_id: uuid.UUID) -> Conversation | None:
    direct_key = direct_conversation_key(user_id, receiver_id)
    conversation = database.scalars(select(Conversation).where(Conversation.direct_key == direct_key)).first()
    if conversation:
        return conversation
    participants = database.scalars(
        select(ConversationParticipant)
        .options(selectinload(ConversationParticipant.conversation).selectinload(Conversation.participants))
        .where(ConversationParticipant.user_id == user_id)
    ).all()
    for participant in participants:
        if {item.user_id for item in participant.conversation.participants} == {user_id, receiver_id}:
            participant.conversation.direct_key = direct_key
            participant.conversation.conversation_type = "DIRECT"
            return participant.conversation
    return None


def create_conversation_for_users(database: Session, title: str, user_ids: list[uuid.UUID]) -> Conversation:
    """The direct conversation of two accounts (reused if it exists), staged in the
    caller's transaction."""
    direct_key = direct_conversation_key(user_ids[0], user_ids[1]) if len(set(user_ids)) == 2 else None
    if direct_key:
        existing = database.scalars(select(Conversation).where(Conversation.direct_key == direct_key)).first()
        if existing:
            return existing
    conversation = Conversation(
        title=title, conversation_type="DIRECT" if direct_key else "GROUP", direct_key=direct_key
    )
    database.add(conversation)
    database.flush()
    for user_id in set(user_ids):
        database.add(ConversationParticipant(conversation_id=conversation.id, user_id=user_id))
    database.flush()
    return conversation


def create_conversation_message(
    database: Session,
    conversation: Conversation | None,
    sender_id: uuid.UUID,
    body: str,
    message_type: str = "TEXT",
    attachment_url: str | None = None,
    receiver_id: uuid.UUID | None = None,
) -> Message | None:
    """The one way a message is written: a chat message, or a workflow card another
    module posts. Staged in the caller's transaction. The receiver is the conversation's
    other participant (`receiver_id` only for one that has none); the conversation's
    latest message and everyone else's unread count move with it."""
    if conversation is None:
        return None
    database.flush()
    other = database.scalars(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation.id, ConversationParticipant.user_id != sender_id
        )
    ).first()
    created_at = naive_utc_now()
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender_id,
        receiver_id=other.user_id if other else receiver_id,
        body=body,
        attachment_url=attachment_url,
        message_type=message_type,
        created_at=created_at,
    )
    database.add(message)
    conversation.last_message = body
    conversation.last_message_at = created_at
    database.execute(
        update(ConversationParticipant)
        .where(ConversationParticipant.conversation_id == conversation.id, ConversationParticipant.user_id != sender_id)
        .values(unread_count=ConversationParticipant.unread_count + 1)
    )
    return message


def assignment_message_for_request(database: Session, request_id: Any) -> tuple[Message | None, dict[str, Any] | None]:
    """The owner's ASSIGNMENT card for this request (newest first), and its body."""
    wanted = str(request_id)
    for message in database.scalars(
        select(Message).where(Message.message_type == "ASSIGNMENT").order_by(desc(Message.created_at))
    ).all():
        try:
            details = json.loads(message.body)
        except (TypeError, ValueError):
            continue
        if (
            isinstance(details, dict)
            and details.get("kind") == "PROJECT_ASSIGNMENT"
            and str(details.get("request_id")) == wanted
        ):
            return message, details
    return None, None


def update_assignment_message_status(database: Session, request_id: Any, status_value: str) -> None:
    """The status shown on the request's ASSIGNMENT card."""
    message, details = assignment_message_for_request(database, request_id)
    if message and details is not None:
        message.body = json.dumps({**details, "status": status_value})


def message_preview(body: str | None) -> str:
    if not body:
        return ""
    try:
        details = json.loads(body)
        if details.get("kind") == "PROJECT_REQUEST":
            title = details.get("project_title") or "project"
            sender_name = details.get("sender_name") or "Someone"
            return f"REQUEST: {sender_name} sent a request for {title}."
        if details.get("kind") == "PROJECT_ASSIGNMENT":
            title = details.get("project_title") or "project"
            owner_name = details.get("owner_name") or "Owner"
            return f"ASSIGNMENT: {owner_name} wants to assign {title}."
    except (TypeError, ValueError, AttributeError):
        pass
    return body


def user_chat_identity(database: Session, display_user: User) -> dict[str, Any]:
    secondary_name = display_user.address or display_user.role.title()
    if display_user.role == ROLE_OWNER:
        project = database.scalars(
            select(Project).where(Project.owner_id == display_user.id).order_by(desc(Project.created_at))
        ).first()
        secondary_name = project.title if project else (display_user.address or "House Owner")
    elif display_user.role == ROLE_BUILDER and display_user.contractor_profile:
        secondary_name = display_user.contractor_profile.company_name
    elif display_user.role == ROLE_SUPPLIER and display_user.supplier_profile:
        secondary_name = display_user.supplier_profile.store_name
    return {
        "id": display_user.id,
        "role": display_user.role,
        "primary_name": display_user.name,
        "secondary_name": secondary_name,
        "avatar_url": display_user.profile_image_url,
        # An open chat or dashboard socket in this server process right now.
        "online": is_user_online(display_user.id),
    }


def conversation_payload(database: Session, participant: ConversationParticipant, user_id: uuid.UUID) -> dict[str, Any]:
    conversation = participant.conversation
    other_participant = next((item for item in conversation.participants if item.user_id != user_id), None)
    other_user = other_participant.user if other_participant else None
    latest_message = conversation.last_message
    latest_message_at = conversation.last_message_at
    if not latest_message:
        last = database.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(desc(Message.created_at), desc(Message.id))
        ).first()
        if last is not None:
            latest_message, latest_message_at = last.body, last.created_at
    return {
        "id": conversation.id,
        "title": conversation.title,
        "conversation_type": conversation.conversation_type,
        "participant": user_chat_identity(database, other_user) if other_user else None,
        "unread_count": participant.unread_count,
        "latest_message": message_preview(latest_message),
        "latest_message_at": local_iso(latest_message_at),
        "latest_message_time": latest_message_at.strftime("%I:%M %p") if latest_message_at else "",
    }


# ---- the service ----


class MessageService:
    def __init__(self, database: Session) -> None:
        self.database = database
        self._contact_visibility: dict[tuple[uuid.UUID, uuid.UUID], bool] = {}

    def get_participant(self, conversation_id: Any, user_id: uuid.UUID) -> ConversationParticipant:
        participant = find_participant(self.database, conversation_id, user_id)
        if not participant:
            raise HTTPException(status_code=403, detail="Conversation access denied")
        return participant

    # ---- conversations ----

    def start_conversation(self, payload: ConversationStart, user: User) -> dict[str, Any]:
        if payload.receiver_id == user.id:
            raise HTTPException(status_code=400, detail="Cannot start a conversation with yourself")
        receiver = self.database.get(User, payload.receiver_id)
        if not receiver:
            raise HTTPException(status_code=404, detail="Receiver not found")
        conversation = find_direct_conversation(self.database, user.id, receiver.id)
        if not conversation:
            title = payload.title or f"{user.name} and {receiver.name}"
            conversation = create_conversation_for_users(self.database, title, [user.id, receiver.id])
        self.database.commit()
        self.database.refresh(conversation)
        return {
            "id": conversation.id,
            "title": conversation.title,
            "participant": user_chat_identity(self.database, receiver),
        }

    def fetch_conversations(self, user: User) -> list[dict[str, Any]]:
        participants = self.database.scalars(
            select(ConversationParticipant)
            .options(
                selectinload(ConversationParticipant.conversation)
                .selectinload(Conversation.participants)
                .selectinload(ConversationParticipant.user)
            )
            .where(ConversationParticipant.user_id == user.id)
        ).all()
        payloads = [conversation_payload(self.database, item, user.id) for item in participants]
        return sorted(payloads, key=lambda item: item["latest_message_at"] or "", reverse=True)

    def fetch_conversation_messages(
        self, conversation_id: uuid.UUID, search: str | None, limit: int, before_id: uuid.UUID | None, user: User
    ) -> list[dict[str, Any]]:
        """A page of the conversation, oldest first; opening it marks what this account
        received as read (and so delivered)."""
        participant = self.get_participant(conversation_id, user.id)
        self._mark_read(participant)
        statement = select(Message).where(Message.conversation_id == conversation_id)
        if before_id:
            anchor = self.database.get(Message, before_id)
            if anchor:
                statement = statement.where(Message.created_at < anchor.created_at)
        if search:
            # A REQUEST body is stored JSON that may hold contact details, so it is
            # matched against the body this viewer is served, never in SQL.
            needle = search.lower()
            not_request = or_(Message.message_type.is_(None), Message.message_type != "REQUEST")
            text_matches = list(
                self.database.scalars(
                    statement.where(not_request, Message.body.ilike(f"%{search}%"))
                    .order_by(desc(Message.created_at))
                    .limit(limit)
                ).all()
            )
            request_matches = [
                item
                for item in self.database.scalars(
                    statement.where(Message.message_type == "REQUEST").order_by(desc(Message.created_at))
                ).all()
                if needle in (self.serialize_message(item, user.id)["body"] or "").lower()
            ]
            newest_first = sorted(
                text_matches + request_matches, key=lambda item: (item.created_at, item.id), reverse=True
            )
            messages = list(reversed(newest_first[:limit]))
        else:
            messages = list(
                reversed(self.database.scalars(statement.order_by(desc(Message.created_at)).limit(limit)).all())
            )
        self.database.commit()
        return [self.serialize_message(item, user.id) for item in messages]

    def recent_messages(self, conversation_id: uuid.UUID, limit: int = 30) -> list[Message]:
        return list(
            reversed(
                self.database.scalars(
                    select(Message)
                    .where(Message.conversation_id == conversation_id)
                    .order_by(desc(Message.created_at))
                    .limit(limit)
                ).all()
            )
        )

    # ---- send ----

    def send_message(self, payload: MessageCreate, sender: User) -> Message:
        """Store a message from the signed-in account, a participant of the conversation."""
        if not payload.body.strip() and not payload.attachment_url:
            raise HTTPException(status_code=400, detail="Message body or attachment is required")
        conversation = self._resolve_conversation(payload, sender)
        self.get_participant(conversation.id, sender.id)
        message_type = (payload.message_type or ("IMAGE" if payload.attachment_url else "TEXT")).upper()
        if message_type not in USER_MESSAGE_TYPES:
            message_type = "TEXT"
        # An attachment is one of the sender's own uploads, never a free URL.
        attachment_url = own_file_url(self.database, sender, payload.attachment_url, field="Attachment")
        message = create_conversation_message(
            self.database,
            conversation,
            sender.id,
            payload.body,
            message_type,
            attachment_url=attachment_url,
            receiver_id=payload.receiver_id,
        )
        self.database.commit()
        assert message is not None  # noqa: S101 - a conversation was resolved above
        self.database.refresh(message)
        return message

    def notify_receiver(self, message: Message, sender: User) -> None:
        """The notification, for a receiver the message could not reach live."""
        if not message.receiver_id:
            return
        add_notification(
            self.database,
            message.receiver_id,
            "New message",
            f"{sender.name}: {message_preview(message.body)}",
            category="MESSAGE",
        )
        self.database.commit()

    # ---- delivery and read ----

    def mark_delivered(self, conversation_id: uuid.UUID, receiver_id: uuid.UUID) -> int:
        """Everything this participant received here has reached one of their sockets."""
        updated = self.database.execute(
            update(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.receiver_id == receiver_id,
                Message.delivered_at.is_(None),
            )
            .values(delivered_at=naive_utc_now())
        ).rowcount
        self.database.commit()
        return int(updated or 0)

    def mark_read(self, conversation_id: uuid.UUID, user_id: uuid.UUID) -> int:
        participant = self.get_participant(conversation_id, user_id)
        updated_count = self._mark_read(participant)
        self.database.commit()
        return updated_count

    def _mark_read(self, participant: ConversationParticipant) -> int:
        participant.unread_count = 0
        now = naive_utc_now()
        mine = (
            Message.conversation_id == participant.conversation_id,
            Message.receiver_id == participant.user_id,
        )
        # Read implies delivered: a message seen without a socket push gets both.
        self.database.execute(update(Message).where(*mine, Message.delivered_at.is_(None)).values(delivered_at=now))
        return int(
            self.database.execute(update(Message).where(*mine, Message.read_at.is_(None)).values(read_at=now)).rowcount
            or 0
        )

    # ---- edit ----

    def edit_message(self, message_id: uuid.UUID, body: str, editor: User) -> Message:
        """Change the text of one's own plain-text message."""
        message = self.database.get(Message, message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        if message.sender_id != editor.id:
            raise HTTPException(status_code=403, detail="Only the sender can edit this message")
        self.get_participant(message.conversation_id, editor.id)
        if (message.message_type or "TEXT").upper() not in EDITABLE_MESSAGE_TYPES or message.attachment_url:
            raise HTTPException(status_code=400, detail="Only a text message can be edited")
        text = (body or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Message body is required")
        if text == message.body:
            return message
        message.body = text
        message.edited_at = naive_utc_now()
        latest = self.database.scalars(
            select(Message)
            .where(Message.conversation_id == message.conversation_id)
            .order_by(desc(Message.created_at), desc(Message.id))
        ).first()
        if latest is not None and latest.id == message.id:
            conversation = self.database.get(Conversation, message.conversation_id)
            if conversation:
                conversation.last_message = text
        self.database.commit()
        self.database.refresh(message)
        return message

    # ---- payloads ----

    def serialize_message(self, message: Message, current_user_id: uuid.UUID | None = None) -> dict[str, Any]:
        """`current_user_id` is the viewer; without one (a broadcast) a request card
        carries no contact details."""
        body = self._enriched_request_body(message, current_user_id)
        return {
            "id": message.id,
            "messageId": str(message.id),
            "conversation_id": message.conversation_id,
            "conversationId": str(message.conversation_id),
            "sender_id": message.sender_id,
            "senderId": str(message.sender_id),
            "receiver_id": message.receiver_id,
            "receiverId": str(message.receiver_id or ""),
            "message_type": message.message_type,
            "messageType": message.message_type,
            "body": body,
            "content": body,
            "attachment_url": message.attachment_url,
            # The old display text (the stored UTC clock, no zone); createdAt has the offset.
            "created_at": message.created_at.strftime("%d %b %Y, %I:%M %p"),
            "createdAt": local_iso(message.created_at),
            "read": bool(message.read_at),
            "delivered": bool(message.delivered_at or message.read_at),
            "edited": bool(message.edited_at),
            "edited_at": local_iso(message.edited_at),
            "is_mine": message.sender_id == current_user_id if current_user_id is not None else False,
        }

    def _profile_payload(self, user: User, contact_visible: bool = False) -> dict[str, Any]:
        if user.role == ROLE_BUILDER and user.contractor_profile:
            profile = user.contractor_profile
            return {
                "profile_user_id": str(user.id),
                "profile_role": user.role,
                "profile_name": user.name,
                "profile_image_url": user.profile_image_url,
                "profile_title": profile.company_name,
                "profile_subtitle": "Contractor",
                "profile_about": profile.about,
                "profile_rating": user.rating,
                "profile_phone": user.phone,
                "profile_email": user.email,
                "profile_address": user.address,
                "profile_pincode": user.pincode,
                "profile_experience_years": profile.experience_years,
                "profile_completed_projects": profile.completed_projects,
                "profile_services": split_profile_list(profile.services_offered),
                "profile_locations": split_profile_list(profile.service_locations),
                "profile_documents": split_profile_list(profile.documents),
                "profile_gallery": split_profile_list(profile.gallery),
                "profile_logo_url": profile.company_logo_url,
            }
        if user.role == ROLE_SUPPLIER and user.supplier_profile:
            profile = user.supplier_profile
            return {
                "profile_user_id": str(user.id),
                "profile_role": user.role,
                "profile_name": user.name,
                "profile_image_url": profile.store_logo_url or user.profile_image_url,
                "profile_title": profile.store_name,
                "profile_subtitle": "Supplier",
                "profile_about": profile.about,
                "profile_rating": user.rating,
                "profile_phone": user.phone,
                "profile_email": user.email,
                "profile_address": user.address,
                "profile_pincode": user.pincode,
                "profile_categories": split_profile_list(profile.categories),
                "profile_locations": split_profile_list(profile.delivery_locations),
                "profile_documents": split_profile_list(profile.documents),
                "profile_gallery": split_profile_list(profile.gallery),
                "profile_logo_url": profile.store_logo_url,
                # Tax identifiers follow the contact rule.
                "profile_gstin": profile.gstin if contact_visible else "",
                "profile_pan": profile.pan if contact_visible else "",
                "profile_website": profile.website,
                "profile_business_type": profile.business_type,
                "profile_registration_year": profile.registration_year,
                "profile_products": self._supplier_products_payload(user.id),
            }
        return {
            "profile_user_id": str(user.id),
            "profile_role": user.role,
            "profile_name": user.name,
            "profile_image_url": user.profile_image_url,
            "profile_title": user.name,
            "profile_subtitle": user.role.title(),
            "profile_rating": user.rating,
            "profile_phone": user.phone,
            "profile_email": user.email,
            "profile_address": user.address,
            "profile_pincode": user.pincode,
        }

    def _supplier_products_payload(self, supplier_id: uuid.UUID) -> list[dict[str, Any]]:
        """What the supplier currently lists (published catalog listings), newest 12."""
        from app.modules.marketplace.listings import catalog_listings, discounted_price  # marketplace reads people
        from app.modules.marketplace.models import SupplierProduct

        products = self.database.scalars(
            catalog_listings(select(SupplierProduct))
            .where(SupplierProduct.supplier_id == supplier_id, SupplierProduct.is_published.is_(True))
            .order_by(desc(SupplierProduct.created_at))
            .limit(12)
        ).all()
        return [
            {
                "id": str(product.id),
                "name": product.name,
                "category": product.category,
                "image_url": product.display_image_url,
                "features": product.features,
                "unit": product.unit,
                "price": float(product.price or 0),
                "discount_percentage": float(product.discount_percentage or 0),
                "discounted_price": discounted_price(product.price, product.discount_percentage),
                "quantity": product.quantity,
            }
            for product in products
        ]

    def _sender_contact_visible(self, viewer_id: uuid.UUID | None, sender_id: uuid.UUID) -> bool:
        """The sender's phone and e-mail stay private until the two hold an accepted
        request of a kind a real flow creates; the sender always sees their own."""
        if viewer_id is None:
            return False
        if viewer_id == sender_id:
            return True
        key = (viewer_id, sender_id)
        if key not in self._contact_visibility:
            self._contact_visibility[key] = accepted_request_between(
                self.database, viewer_id, sender_id, CONTACT_GRANTING_REQUEST_TYPES
            )
        return self._contact_visibility[key]

    def _enriched_request_body(self, message: Message, viewer_id: uuid.UUID | None = None) -> str:
        if message.message_type != "REQUEST":
            return message.body
        try:
            details = json.loads(message.body)
        except (TypeError, ValueError):
            return message.body
        if not isinstance(details, dict) or details.get("kind") != "PROJECT_REQUEST":
            return message.body
        # Stored contact details and tax ids never leave the server from the stored copy.
        for key in (*REQUEST_CONTACT_KEYS, "profile_gstin", "profile_pan"):
            details.pop(key, None)
        request_id = as_uuid(details.get("request_id"))
        request = self.database.get(ProjectRequest, request_id) if request_id else None
        sender = self.database.get(User, message.sender_id)
        # A card describes the request its own sender sent: only that request's live
        # status is copied onto it.
        if request and request.sender_id == message.sender_id:
            details["status"] = request.status
        if sender:
            contact_visible = self._sender_contact_visible(viewer_id, sender.id)
            details["sender_user_id"] = str(sender.id)
            details.update(self._profile_payload(sender, contact_visible))
            details["sender_phone"] = sender.phone if contact_visible else ""
            details["sender_email"] = sender.email if contact_visible else ""
            if not contact_visible:
                details["profile_phone"] = ""
                details["profile_email"] = ""
        return json.dumps(details, default=str)

    def _resolve_conversation(self, payload: MessageCreate, sender: User) -> Conversation:
        if payload.conversation_id:
            conversation = self.database.get(Conversation, payload.conversation_id)
            if conversation:
                return conversation
        if payload.receiver_id:
            receiver = self.database.get(User, payload.receiver_id)
            if not receiver:
                raise HTTPException(status_code=404, detail="Receiver not found")
            conversation = find_direct_conversation(self.database, sender.id, receiver.id)
            if conversation:
                return conversation
            return create_conversation_for_users(
                self.database, f"{sender.name} and {receiver.name}", [sender.id, receiver.id]
            )
        raise HTTPException(status_code=400, detail="conversation_id or receiver_id is required")
