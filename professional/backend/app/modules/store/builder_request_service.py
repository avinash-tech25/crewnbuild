"""Written requests between a Builder and a Store Manager on that Builder's active
team, either way round (ported from the old builder_request_service.py; same rules
and answers)."""

import uuid

from fastapi import HTTPException

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.identity.models import ROLE_BUILDER, User
from app.modules.projects.access import (
    require_complete_profile,
)
from app.modules.projects.notices import create_request_notification
from app.modules.store.models import BUILDER_REQUEST_CATEGORIES, StoreBuilderRequest
from app.modules.store.repository import StoreManagerRepository
from app.modules.store.schemas import StoreBuilderRequestCreate, StoreBuilderRequestRespond

STORE_MANAGER = "STORE_MANAGER"
BUILDER = "BUILDER"


def side_of(user: User) -> str:
    """Which end of these requests an account is: a Store Manager, or a Builder.
    Everyone else (Site Engineers, suppliers, owners, admins) has no access."""
    if is_store_manager(user):
        return STORE_MANAGER
    if user.role == ROLE_BUILDER:
        return BUILDER
    raise HTTPException(
        status_code=403, detail="Only a Builder and the Store Managers on their team can use these requests."
    )


class StoreBuilderRequestService:
    """Requests between a Builder and a Store Manager on that Builder's active team,
    either way round. Separate from Site Engineer store requests, supplier
    purchases and the House Owner / Supplier `requests` rows. The team
    (builder_engineer_memberships, ACTIVE) is the only source of who may write to
    whom; this service never changes it."""

    def __init__(self, repository: StoreManagerRepository):
        self.repository = repository
        self.database = repository.database

    def counterparts(self, user: User, side: str) -> list[User]:
        """Who this account can write to now: a Store Manager's active builders, or a
        Builder's active Store Managers."""
        if side == STORE_MANAGER:
            return [
                builder
                for builder in (
                    self.repository.get_user(builder_id)
                    for builder_id in self.repository.list_active_builder_ids(user.id)
                )
                if builder and builder.role == ROLE_BUILDER
            ]
        return [member for member in self.repository.list_builder_team_members(user.id) if is_store_manager(member)]

    def payload(self, row: StoreBuilderRequest, user: User, side: str) -> dict:
        manager = self.repository.get_user(row.store_manager_id)
        builder = self.repository.get_user(row.builder_id)
        sent = (row.direction == "STORE_TO_BUILDER") == (side == STORE_MANAGER)
        on_team = (
            self.repository.is_active_team_pair(row.builder_id, row.store_manager_id)
            if row.status == "PENDING"
            else False
        )
        return {
            "id": row.id,
            "direction": row.direction,
            # From the reader's side: what they sent, or what they received.
            "sent_by_me": sent,
            "category": row.category,
            "title": row.title,
            "description": row.description,
            "status": row.status,
            "response": row.response,
            "created_at": local_iso(row.created_at),
            "responded_at": local_iso(row.responded_at) if row.responded_at else None,
            "store_manager_id": row.store_manager_id,
            "store_manager_name": manager.name if manager else "",
            "builder_id": row.builder_id,
            "builder_name": builder.name if builder else "",
            # Only the recipient answers, and only while both are still on the team.
            "can_respond": not sent and on_team,
            "can_withdraw": sent and row.status == "PENDING",
        }

    def list_requests(self, user: User):
        side = side_of(user)
        rows = self.repository.list_builder_requests(
            **({"store_manager_id": user.id} if side == STORE_MANAGER else {"builder_id": user.id})
        )
        return {
            "side": side,
            "counterparts": [{"id": person.id, "name": person.name} for person in self.counterparts(user, side)],
            "requests": [self.payload(row, user, side) for row in rows],
        }

    def create(self, payload: StoreBuilderRequestCreate, user: User):
        side = side_of(user)
        require_complete_profile(user)
        category = payload.category.strip().upper()
        if category not in BUILDER_REQUEST_CATEGORIES:
            raise HTTPException(status_code=400, detail="Choose a valid request type.")
        title, description = payload.title.strip(), payload.description.strip()
        if len(title) < 3 or len(description) < 3:
            raise HTTPException(status_code=400, detail="Enter a title and a description.")
        recipient = self.repository.get_user(payload.counterpart_id)
        if side == STORE_MANAGER:
            builder_id, manager_id, direction = payload.counterpart_id, user.id, "STORE_TO_BUILDER"
            allowed = recipient is not None and recipient.role == ROLE_BUILDER
        else:
            builder_id, manager_id, direction = user.id, payload.counterpart_id, "BUILDER_TO_STORE"
            allowed = recipient is not None and is_store_manager(recipient)
        if not allowed or not self.repository.is_active_team_pair(builder_id, manager_id):
            raise HTTPException(
                status_code=403,
                detail="You can only send a request to a Builder or Store Manager on the same active team.",
            )
        row = StoreBuilderRequest(
            direction=direction,
            store_manager_id=manager_id,
            builder_id=builder_id,
            category=category,
            title=title,
            description=description,
            status="PENDING",
        )
        self.repository.add(row)
        self.database.flush()
        sender_label = "Store Manager" if side == STORE_MANAGER else "Builder"
        create_request_notification(
            self.database,
            recipient.id,
            f"New request from your {sender_label}",
            f"{user.name} ({sender_label}) sent request #{row.id}: {title}.",
            category="MATERIAL",
        )
        self.repository.commit()
        return self.payload(row, user, side)

    def own_request(self, request_id: uuid.UUID, user: User, side: str) -> StoreBuilderRequest:
        """The request, locked, if this account is its Builder or Store Manager.
        Anyone else gets the same 404 as a request that does not exist."""
        row = self.repository.lock_builder_request(request_id)
        mine = row is not None and (
            row.store_manager_id == user.id if side == STORE_MANAGER else row.builder_id == user.id
        )
        if not mine:
            raise HTTPException(status_code=404, detail="Request not found")
        return row

    def respond(self, request_id: uuid.UUID, payload: StoreBuilderRequestRespond, user: User):
        """The recipient accepts or rejects, with an optional answer; once only."""
        side = side_of(user)
        require_complete_profile(user)
        row = self.own_request(request_id, user, side)
        sent = (row.direction == "STORE_TO_BUILDER") == (side == STORE_MANAGER)
        if sent:
            raise HTTPException(status_code=403, detail="Only the recipient can respond to this request.")
        if row.status != "PENDING":
            raise HTTPException(status_code=409, detail=f"This request was already {row.status.lower()}.")
        if not self.repository.is_active_team_pair(row.builder_id, row.store_manager_id):
            raise HTTPException(status_code=403, detail="This Store Manager is no longer on the Builder's team.")
        row.status = "ACCEPTED" if payload.decision == "ACCEPT" else "REJECTED"
        row.response = (payload.response or "").strip() or None
        row.responded_at = naive_utc_now()
        sender_id = row.store_manager_id if row.direction == "STORE_TO_BUILDER" else row.builder_id
        word = row.status.lower()
        create_request_notification(
            self.database,
            sender_id,
            f"Request {word}",
            f"{user.name} {word} your request #{row.id}: {row.title}."
            + (f" Response: {row.response}" if row.response else ""),
            category="MATERIAL",
        )
        self.repository.commit()
        return self.payload(row, user, side)

    def withdraw(self, request_id: uuid.UUID, user: User):
        """The sender takes back their own request while it is still pending."""
        side = side_of(user)
        row = self.own_request(request_id, user, side)
        sent = (row.direction == "STORE_TO_BUILDER") == (side == STORE_MANAGER)
        if not sent:
            raise HTTPException(status_code=403, detail="Only the sender can withdraw this request.")
        if row.status != "PENDING":
            raise HTTPException(status_code=409, detail=f"This request was already {row.status.lower()}.")
        row.status = "WITHDRAWN"
        row.responded_at = naive_utc_now()
        recipient_id = row.builder_id if row.direction == "STORE_TO_BUILDER" else row.store_manager_id
        create_request_notification(
            self.database,
            recipient_id,
            "Request withdrawn",
            f"{user.name} withdrew request #{row.id}: {row.title}.",
            category="MATERIAL",
        )
        self.repository.commit()
        return self.payload(row, user, side)
