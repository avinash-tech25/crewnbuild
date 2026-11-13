"""Project requests: sending, answering, withdrawing, and the owner's choice of a
builder (award) or a Site Engineer (ported from the old project_request_service.py, same
rules and answers).

A request's chat lines are written as before. Property enquiries (property_enquiries, once rows of the requests
table) are in the incoming list and answered by accept and reject, as before.
"""

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.accounts.profile_completion import is_store_manager
from app.modules.billing import lead_locations
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.messaging.live_events import queue_live_hint
from app.modules.messaging.service import create_conversation_for_users, create_conversation_message
from app.modules.projects.access import (
    ENGINEER_ALREADY_WORKING_DETAIL,
    ensure_engineer_can_take_project,
    ensure_role,
    require_complete_profile,
)
from app.modules.projects.award_service import (
    award_agreed_amount,
    award_message,
    carry_last_agreed_amount,
    commit_award_change,
    confirm_award,
    exact_amount,
    get_awarded_contract,
    lock_award,
    money_label,
    open_award_offer,
    project_work_started_reason,
    resize_escrow_to_contract,
    submit_award_offer,
)
from app.modules.projects.models import (
    AWARD_AWAITING_BUILDER,
    AWARD_CONFIRMED,
    AWARD_NEGOTIATING,
    ContractorEngineer,
    Project,
    ProjectAward,
    ProjectEngineer,
    ProjectRequest,
)
from app.modules.projects.notices import create_request_notification
from app.modules.projects.people import can_view_private_contact, request_counterparty_profile_payload
from app.modules.projects.request_repository import ProjectRequestRepository
from app.modules.projects.request_types import (
    OWNER_BUILDER_REQUEST_TYPES,
    OWNER_ENGINEER_REQUEST_TYPE,
    PROPERTY_REQUEST_TYPE,
    SEND_REQUEST_TYPES,
    SPECIALIST_REQUEST_TYPE,
    builder_id_on_request,
    owner_id_on_request,
    request_notification_category,
)
from app.modules.projects.schemas import AssignDecision, ProjectRequestCreate, RequestDecision
from app.modules.projects.team_service import (
    SITE_ENGINEER_CATEGORY,
    engineer_category_of,
    specialist_requests_for_project,
)
from app.modules.property import links as property_links


def dumps_with_ids(value: dict[str, Any]) -> str:
    """json.dumps with UUIDs (ids and keys) written as text."""
    return json.dumps(value, default=str)


def builder_team_members(database: Session, builder_id: Any) -> list[User]:
    """A builder's active team (the old StoreManagerRepository.list_builder_team_members)."""
    return list(
        database.scalars(
            select(User)
            .join(ContractorEngineer, ContractorEngineer.engineer_id == User.id)
            .where(ContractorEngineer.contractor_id == builder_id, ContractorEngineer.status == "ACTIVE")
        ).all()
    )


OWNER_BUILDER_REQUEST_LOCK_NAMESPACE = 2802
BUILDER_LEAD_LIMIT_LOCK_NAMESPACE = 2803


def ensure_request_pending(request: ProjectRequest) -> None:
    """Accept and reject answer a request that is still waiting for an answer."""
    if request.status != "pending":
        raise HTTPException(status_code=409, detail=f"This request has already been {request.status}.")


def request_message_payload(request: ProjectRequest, user: User, receiver: User, project: Project | None) -> str:
    owner_user = user if user.role == ROLE_OWNER else receiver if receiver.role == ROLE_OWNER else None
    owner_profile = owner_user.owner_profile if owner_user else None
    # No phone or email in the stored body: the receiver has not accepted yet.
    # MessageService adds them when the message is read, for a viewer allowed
    # to see them.
    return dumps_with_ids(
        {
            "kind": "PROJECT_REQUEST",
            "request_id": request.id,
            "project_id": project.id if project else None,
            "request_type": request.request_type,
            "status": request.status,
            "sender_name": user.name,
            "sender_role": user.role,
            "receiver_name": receiver.name,
            "receiver_role": receiver.role,
            **request_counterparty_profile_payload(user, can_view_contact=False),
            "project_title": project.title
            if project
            else (owner_profile.project_title if owner_profile else "General request"),
            "project_description": project.description
            if project
            else (owner_profile.project_description if owner_profile else ""),
            "project_address": project.address if project else (owner_user.address if owner_user else user.address),
            "project_pincode": project.pincode if project else (owner_user.pincode if owner_user else user.pincode),
            "building_type": project.building_type
            if project
            else (owner_profile.building_type if owner_profile else ""),
            "construction_type": project.construction_type
            if project
            else (owner_profile.construction_type if owner_profile else ""),
            "budget": float(project.budget if project else (owner_profile.budget_amount if owner_profile else 0) or 0),
            "quotation_amount": float(request.quotation_amount or 0),
            "quotation_created_at": request.quotation_created_at.isoformat() if request.quotation_created_at else None,
            "land_area": project.land_area if project else (owner_profile.land_area if owner_profile else 0),
            "floors": project.floors if project else (owner_profile.floors if owner_profile else 0),
            "created_at": request.created_at.isoformat() if request.created_at else naive_utc_now().isoformat(),
        }
    )


def assignment_message_payload(
    request: ProjectRequest, owner: User, contractor: User, project: Project, status_value: str = "pending"
) -> str:
    return dumps_with_ids(
        {
            "kind": "PROJECT_ASSIGNMENT",
            "request_id": request.id,
            "project_id": project.id,
            "status": status_value,
            # str() for the two user ids, for the same reason as the request body
            # above: json.dumps cannot encode a uuid.UUID. request_id and
            # project_id are integers and are left alone.
            "owner_id": str(owner.id),
            "owner_name": owner.name,
            "contractor_id": str(contractor.id),
            "contractor_name": contractor.name,
            "project_title": project.title,
            "project_description": project.description,
            "project_address": project.address,
            "project_pincode": project.pincode,
            "building_type": project.building_type,
            "construction_type": project.construction_type,
            "budget": float(project.budget or 0),
            "quotation_amount": float(request.quotation_amount or 0),
            "land_area": project.land_area,
            "floors": project.floors,
            "floor_type": project.floor_type,
            "created_at": naive_utc_now().isoformat(),
        }
    )


class ProjectRequestService:
    def __init__(self, repository: ProjectRequestRepository):
        self.repository = repository
        self.database = repository.database

    def send_project_request(self, payload: ProjectRequestCreate, user: User):
        if payload.request_type not in SEND_REQUEST_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported request type")
        require_complete_profile(user)
        receiver = self.repository.get_user(payload.receiver_id)
        if not receiver:
            raise HTTPException(status_code=404, detail="Request receiver not found")
        if receiver.id == user.id:
            raise HTTPException(status_code=400, detail="You cannot send a request to yourself")

        project = None
        if payload.project_id:
            project = self.repository.get_project(payload.project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")
        # A project is closed to further builder requests when it has been AWARDED,
        # which is `projects.contractor_id`. It used to also be closed as soon as any
        # one request on it reached "accepted" -- but an accepted request is a
        # shortlisted quotation, not an award, so that shut the bidding the moment
        # the owner said yes to the first builder and made comparing quotations
        # impossible. The `project.contractor_id` guards below are the real gate.

        if payload.request_type == "OWNER_TO_CONTRACTOR":
            ensure_role(user, "OWNER")
            if receiver.role != ROLE_BUILDER:
                raise HTTPException(status_code=400, detail="Selected user is not a builder")
            if project:
                if project.owner_id != user.id:
                    raise HTTPException(status_code=403, detail="You can only send requests for your own project")
                if project.construction_type == "SELF_CONSTRUCTION":
                    raise HTTPException(status_code=400, detail="Self-construction projects cannot be sent to builders")
                if project.contractor_id:
                    raise HTTPException(status_code=400, detail="This project already has a builder")
                if receiver.pincode != project.pincode:
                    raise HTTPException(status_code=400, detail="Builder pincode does not match this project")
            elif receiver.pincode != user.pincode:
                raise HTTPException(status_code=400, detail="Builder pincode does not match your profile")

        elif payload.request_type == "CONTRACTOR_TO_OWNER":
            ensure_role(user, "CONTRACTOR")
            if receiver.role != ROLE_OWNER:
                raise HTTPException(status_code=400, detail="Selected user is not a house owner")
            if payload.quotation_amount is not None and payload.quotation_amount <= 0:
                raise HTTPException(status_code=400, detail="Quotation amount must be greater than zero")
            # The account's pincode or any saved service location's (India builders).
            builder_pincodes = lead_locations.lead_pincodes(self.database, user) or [user.pincode]
            if project:
                if project.owner_id != receiver.id:
                    raise HTTPException(status_code=400, detail="Project owner does not match request receiver")
                if project.construction_type == "SELF_CONSTRUCTION":
                    raise HTTPException(status_code=400, detail="Self-construction projects cannot be sent to builders")
                if project.contractor_id:
                    raise HTTPException(status_code=400, detail="This project already has a builder")
                if project.pincode not in builder_pincodes:
                    raise HTTPException(status_code=400, detail="Project pincode does not match your profile")
            elif receiver.pincode not in builder_pincodes:
                raise HTTPException(status_code=400, detail="House owner pincode does not match your builder profile")
            lead_pincode = project.pincode if project else receiver.pincode

        elif payload.request_type == "OWNER_TO_SUPPLIER":
            ensure_role(user, "OWNER")
            if not project:
                raise HTTPException(
                    status_code=400, detail="Create a self-construction project before contacting a supplier"
                )
            if project.owner_id != user.id:
                raise HTTPException(status_code=403, detail="You can only send requests for your own project")
            if project.construction_type != "SELF_CONSTRUCTION":
                raise HTTPException(
                    status_code=400, detail="Supplier requests are available for self-construction projects"
                )
            if receiver.role != ROLE_SUPPLIER:
                raise HTTPException(status_code=400, detail="Selected user is not a supplier")
            if receiver.pincode != project.pincode:
                raise HTTPException(status_code=400, detail="Supplier pincode does not match this project")

        elif payload.request_type == "SUPPLIER_TO_OWNER":
            ensure_role(user, "SUPPLIER")
            if not project:
                raise HTTPException(status_code=400, detail="Self-construction project is required")
            if receiver.role != ROLE_OWNER:
                raise HTTPException(status_code=400, detail="Selected user is not a house owner")
            if project.owner_id != receiver.id:
                raise HTTPException(status_code=400, detail="Project owner does not match request receiver")
            if project.construction_type != "SELF_CONSTRUCTION":
                raise HTTPException(status_code=400, detail="Suppliers can contact self-construction projects only")
            if user.pincode != project.pincode:
                raise HTTPException(status_code=400, detail="Project pincode does not match your supplier profile")

        elif payload.request_type == OWNER_ENGINEER_REQUEST_TYPE:
            ensure_role(user, "OWNER")
            if receiver.role != ROLE_ENGINEER:
                raise HTTPException(status_code=400, detail="Selected user is not a site engineer")
            if not project:
                raise HTTPException(status_code=400, detail="Choose the project you want a site engineer for")
            if project.owner_id != user.id:
                raise HTTPException(status_code=403, detail="You can only send requests for your own project")
            if project.construction_type != "SELF_CONSTRUCTION":
                raise HTTPException(
                    status_code=400, detail="A builder-managed project gets its site engineer from the builder"
                )
            # The same category rule the builder's assignment already enforces, so a
            # specialist cannot be hired into the Site Engineer slot by either route.
            if engineer_category_of(receiver) != SITE_ENGINEER_CATEGORY:
                raise HTTPException(
                    status_code=400,
                    detail=f"Only an Engineer whose category is {SITE_ENGINEER_CATEGORY} can be hired as the project Site Engineer.",
                )
            if self.repository.find_active_project_engineer_id(project.id):
                raise HTTPException(status_code=400, detail="This project already has a site engineer")
            # An engineer already working on another running project cannot be
            # asked for this one. Checked before anything is written, so a refused
            # request leaves no row and no notification behind.
            if self.repository.engineers_working_on_a_project([receiver.id], exclude_project_id=project.id):
                raise HTTPException(status_code=409, detail=ENGINEER_ALREADY_WORKING_DETAIL)

        elif payload.request_type == "SUPPLIER_TO_CONTRACTOR":
            ensure_role(user, "SUPPLIER")
            if receiver.role != ROLE_BUILDER:
                raise HTTPException(status_code=400, detail="Selected user is not a builder")
            if receiver.pincode != user.pincode:
                raise HTTPException(status_code=400, detail="Builder pincode does not match your supplier profile")

        elif payload.request_type == "CONTRACTOR_TO_SUPPLIER":
            ensure_role(user, "CONTRACTOR")
            if receiver.role != ROLE_SUPPLIER:
                raise HTTPException(status_code=400, detail="Selected user is not a supplier")
            if receiver.pincode != user.pincode:
                raise HTTPException(status_code=400, detail="Supplier pincode does not match your builder profile")

        else:
            # Unreachable while SEND_REQUEST_TYPES and the branches above agree;
            # kept so a type added to one without the other is refused, not waved through.
            raise HTTPException(status_code=400, detail="Unsupported request type")

        existing_request = self.repository.find_existing_request(
            user.id, payload.receiver_id, payload.project_id, payload.request_type
        )
        if existing_request:
            raise HTTPException(status_code=409, detail="Request already sent")

        # House Owner ↔ Builder: one live thread per owner, builder and project,
        # whichever of them opened it. The check above only looks in the sender's
        # own direction, so a builder could answer an owner's pending request with a
        # second request of their own (or the other way round). A rejected request
        # blocks nothing; a pending or accepted one blocks both directions.
        if payload.request_type in OWNER_BUILDER_REQUEST_TYPES:
            # Two opposite-direction sends at the same moment would each pass the
            # check before either is written. A transaction-scoped advisory lock on
            # the pair and project makes the second wait for the first; it is
            # released when this transaction commits or rolls back.
            low_id, high_id = sorted([user.id, receiver.id])
            self.repository.lock_owner_builder_pair(
                OWNER_BUILDER_REQUEST_LOCK_NAMESPACE,
                f"{low_id}:{high_id}:{payload.project_id if payload.project_id is not None else '-'}",
            )
            live_thread = self.repository.find_live_owner_builder_thread(payload.project_id, user.id, receiver.id)
            if live_thread:
                if live_thread.sender_id == user.id:
                    detail = "Request already sent"
                elif live_thread.status == "pending":
                    detail = f"{receiver.name} has already sent you a request for this project. Accept or reject it from your requests."
                else:
                    detail = f"You already have an accepted request with {receiver.name} for this project."
                raise HTTPException(status_code=409, detail=detail)

        # For Supplier ↔ House Owner requests, also check the opposite direction for
        # the same project: only one active thread may exist per owner/supplier/
        # project, so a supplier can never push a request back at an owner who has
        # already asked them (and an owner cannot re-ask while the supplier's own
        # invitation is open). Accepted threads are excluded from Find Clients, so
        # this keeps a duplicate from ever being created through that flow.
        owner_supplier_types = ["SUPPLIER_TO_OWNER", "OWNER_TO_SUPPLIER"]
        if payload.request_type in owner_supplier_types:
            thread_exists = self.repository.find_owner_supplier_thread_id(
                owner_supplier_types, payload.project_id, user.id, payload.receiver_id
            )
            if thread_exists:
                raise HTTPException(status_code=409, detail="Request already sent")

        # For Supplier ↔ Contractor requests, also check if an accepted relationship
        # already exists in EITHER direction, preventing duplicate requests.
        supplier_contractor_types = ["SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER"]
        if payload.request_type in supplier_contractor_types:
            accepted_exists = self.repository.find_accepted_supplier_contractor_id(
                supplier_contractor_types, user.id, payload.receiver_id
            )
            if accepted_exists:
                raise HTTPException(status_code=409, detail="Request already accepted")

            # Also check for pending requests in EITHER direction
            pending_exists = self.repository.find_pending_supplier_contractor_id(
                supplier_contractor_types, user.id, payload.receiver_id
            )
            if pending_exists:
                raise HTTPException(status_code=409, detail="Request already pending")

        if payload.request_type == "CONTRACTOR_TO_OWNER":
            # At most the plan's open leads per location. Serialised per builder so
            # two sends at the same moment cannot both take the last slot.
            self.repository.lock_owner_builder_pair(BUILDER_LEAD_LIMIT_LOCK_NAMESPACE, str(user.id))
            lead_locations.require_lead_slot(self.database, user, lead_pincode)

        request = ProjectRequest(
            sender_id=user.id,
            receiver_id=payload.receiver_id,
            project_id=payload.project_id,
            request_type=payload.request_type,
            quotation_amount=payload.quotation_amount if payload.request_type == "CONTRACTOR_TO_OWNER" else None,
            quotation_created_at=naive_utc_now()
            if payload.request_type == "CONTRACTOR_TO_OWNER" and payload.quotation_amount
            else None,
        )
        self.repository.add(request)
        self.repository.flush()
        conversation_title = project.title if project else f"{user.name} and {receiver.name}"
        conversation = create_conversation_for_users(self.database, conversation_title, [user.id, payload.receiver_id])
        request_context = f" for {project.title}" if project else ""
        create_conversation_message(
            self.database,
            conversation,
            user.id,
            request_message_payload(request, user, receiver, project),
            "REQUEST",
        )
        create_request_notification(
            self.database,
            payload.receiver_id,
            "New request",
            f"{payload.request_type}: {user.name} sent a request{request_context}.",
            category=request_notification_category(payload.request_type),
        )
        self.repository.commit()
        self.repository.refresh(request)
        return request

    def fetch_incoming_requests(self, user: User):
        # When the user is a Builder, exclude OWNER_TO_CONTRACTOR requests that
        # reference a Self-Construction project — those belong in the Supplier flow.
        base_filter = or_(ProjectRequest.sender_id == user.id, ProjectRequest.receiver_id == user.id)
        if user.role == ROLE_BUILDER:
            self_construction_project_ids = [
                project.id for project in self.repository.list_self_construction_project_ids()
            ]
            if self_construction_project_ids:
                base_filter = and_(
                    base_filter,
                    or_(
                        ProjectRequest.project_id.is_(None),
                        ProjectRequest.project_id.notin_(self_construction_project_ids),
                    ),
                )
        requests: list[Any] = self.repository.list_requests(base_filter)
        # Property enquiries (property_enquiries, once rows of this list), newest first
        # with the rest, as when they were requests.
        enquiries = property_links.enquiries_of(self.database, user.id)
        if enquiries:
            requests = sorted([*requests, *enquiries], key=lambda item: item.created_at, reverse=True)
        # Property enquiries name their listing. Loaded in one query so the seller's
        # request list can say which property each request is about without a query
        # per row. Requests that are not property enquiries carry NULL here and are
        # completely unaffected.
        payload = []
        for item in requests:
            display_user = item.receiver if item.sender_id == user.id else item.sender
            owner_profile = item.sender.owner_profile or item.receiver.owner_profile
            project_owner = (
                item.sender
                if item.sender.owner_profile
                else item.receiver
                if item.receiver.owner_profile
                else display_user
            )
            # An owner sees a builder's contact on a project's request row only
            # when a request on THAT project is accepted, not because of another
            # project's. Every other pairing keeps the per-person rule.
            scoped_project_id = (
                item.project_id if user.role == ROLE_OWNER and display_user.role == ROLE_BUILDER else None
            )
            contact_visible = can_view_private_contact(self.database, user, display_user, scoped_project_id)
            payload.append(
                {
                    "id": item.id,
                    "is_sender": item.sender_id == user.id,
                    "is_receiver": item.receiver_id == user.id,
                    "sender_id": item.sender_id,
                    "receiver_id": item.receiver_id,
                    "sender_name": display_user.name,
                    "sender_role": display_user.role,
                    "sender_address": display_user.address,
                    "sender_pincode": display_user.pincode,
                    **request_counterparty_profile_payload(display_user, contact_visible),
                    "can_view_contact": contact_visible,
                    "project_id": item.project_id,
                    "project_title": item.project.title
                    if item.project
                    else (owner_profile.project_title if owner_profile else "General"),
                    "project_description": item.project.description
                    if item.project
                    else (owner_profile.project_description if owner_profile else ""),
                    "project_address": item.project.address if item.project else project_owner.address,
                    "project_pincode": item.project.pincode if item.project else project_owner.pincode,
                    "building_type": item.project.building_type
                    if item.project
                    else (owner_profile.building_type if owner_profile else ""),
                    "construction_type": item.project.construction_type
                    if item.project
                    else (owner_profile.construction_type if owner_profile else ""),
                    "budget": item.project.budget
                    if item.project
                    else (owner_profile.budget_amount if owner_profile else 0),
                    "land_area": item.project.land_area
                    if item.project
                    else (owner_profile.land_area if owner_profile else 0),
                    "floors": item.project.floors if item.project else (owner_profile.floors if owner_profile else 0),
                    "site_status": owner_profile.site_status if owner_profile else "",
                    "start_timeline": owner_profile.start_timeline if owner_profile else "",
                    "design_status": owner_profile.design_status if owner_profile else "",
                    "contact_preference": owner_profile.contact_preference if owner_profile else "",
                    "request_type": item.request_type,
                    "status": item.status,
                    # Present only on a property enquiry; None on every existing request,
                    # so nothing that reads this payload today sees any change.
                    **property_links.property_request_payload(
                        item.listing if item.request_type == PROPERTY_REQUEST_TYPE else None
                    ),
                    "quotation_amount": float(item.quotation_amount or 0),
                    # Stored naive UTC (datetime.utcnow). Sent as ISO 8601 with the
                    # offset: the "%d %b %Y, %I:%M %p" text had no zone, so browsers
                    # read the UTC clock as their own and a new request showed as
                    # "6 hours ago" in India. created_at_iso stays as an alias.
                    "quotation_created_at": local_iso(item.quotation_created_at) if item.quotation_created_at else "",
                    "created_at_iso": local_iso(item.created_at),
                    "created_at": local_iso(item.created_at),
                }
            )
        return payload

    def accept_project_request(self, payload: RequestDecision, user: User):
        # Locked so two answers to one request cannot both see it pending.
        request = self.repository.lock_request(payload.request_id)
        if request is None:
            return self.answer_property_enquiry(payload, user, accepted=True)
        if request.receiver_id != user.id:
            raise HTTPException(status_code=404, detail="Request not found")
        require_complete_profile(user)
        # Only pending -> accepted. Accepting again used to repeat the quotation,
        # messages and notifications, and could revive a rejected request.
        ensure_request_pending(request)
        # Several specialists in one category may hold a pending invitation at the
        # same time; the first to accept takes the slot. This closes that race so a
        # later acceptance cannot displace the engineer already assigned. Scoped to
        # the specialist request type, so no other request flow is affected.
        if request.request_type == SPECIALIST_REQUEST_TYPE and request.project_id:
            category = engineer_category_of(user)
            for other in specialist_requests_for_project(self.database, request.project_id):
                if other.id == request.id or other.status != "accepted":
                    continue
                holder = self.repository.get_user(other.receiver_id)
                if holder and engineer_category_of(holder) == category:
                    raise HTTPException(
                        status_code=409,
                        detail=f"{category} on this project was already filled by {holder.name}.",
                    )
        if user.role == ROLE_BUILDER and request.request_type == "OWNER_TO_CONTRACTOR":
            if not payload.quotation_amount or payload.quotation_amount <= 0:
                raise HTTPException(status_code=400, detail="Quotation amount is required")
            request.quotation_amount = payload.quotation_amount
            request.quotation_created_at = naive_utc_now()
        request.status = "accepted"
        conversation = None
        if request.request_type == OWNER_ENGINEER_REQUEST_TYPE and request.project_id:
            # Accepting puts the engineer on the owner's shortlist; it does not
            # assign the project. The owner picks one accepted engineer afterwards,
            # exactly as they pick between accepted builder quotations.
            project = self.repository.get_project(request.project_id)
            conversation = create_conversation_for_users(
                self.database,
                project.title if project else "Site engineer request",
                [request.sender_id, request.receiver_id],
            )
        elif request.project_id and "CONTRACTOR" in request.request_type:
            # Accepting shortlists the builder; it does not award the project.
            #
            # This branch used to set `project.contractor_id` when an owner accepted
            # a CONTRACTOR_TO_OWNER request, so the first builder the owner said yes
            # to won the project outright — the owner never got to compare
            # quotations. The owner-initiated OWNER_TO_CONTRACTOR path never did
            # that, and the whole design says it should not: see the comment on
            # assign_project_to_contractor, and the identical wording on the
            # OWNER_ENGINEER_REQUEST_TYPE branch just above ("exactly as they pick
            # between accepted builder quotations").
            #
            # Awarding is `/project-requests/assign` and nothing else.
            project = self.repository.get_project(request.project_id)
            if project:
                contractor_id = request.sender_id if user.role == ROLE_OWNER else user.id
                conversation = create_conversation_for_users(
                    self.database, project.title, [project.owner_id, contractor_id]
                )
        else:
            conversation = create_conversation_for_users(
                self.database, "Material request", [request.sender_id, request.receiver_id]
            )
        if not conversation:
            conversation = create_conversation_for_users(
                self.database, "Request", [request.sender_id, request.receiver_id]
            )
        if request.quotation_amount:
            quote_body = f"QUOTATION: {user.name} accepted your request with a quotation of ₹{float(request.quotation_amount):,.0f}."
            create_conversation_message(self.database, conversation, user.id, quote_body, "QUOTATION")
            create_request_notification(
                self.database,
                request.sender_id,
                "Quotation received",
                quote_body,
                category=request_notification_category(request.request_type),
            )
        else:
            create_conversation_message(
                self.database, conversation, user.id, f"REQUEST ACCEPTED: {user.name} accepted your request.", "REQUEST"
            )
            create_request_notification(
                self.database,
                request.sender_id,
                "Request accepted",
                "Your request is accepted.",
                category=request_notification_category(request.request_type),
            )
        if request.request_type in ("SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER"):
            # The builder's Store Managers can buy from this supplier now: an open Buy list reloads.
            builder_id = request.sender_id if request.request_type == "CONTRACTOR_TO_SUPPLIER" else request.receiver_id
            for member in builder_team_members(self.database, builder_id):
                if is_store_manager(member):
                    queue_live_hint(self.database, member.id)
        self.repository.commit()
        return {"status": "accepted"}

    def assign_project_to_contractor(self, payload: AssignDecision, user: User):
        ensure_role(user, "OWNER")
        # "Negotiate": an opening counter-offer is checked before anything is written.
        opening_offer = exact_amount(payload.offer_amount) if payload.offer_amount is not None else None
        request = self.repository.get(payload.request_id)
        # Both directions of the owner/builder conversation end in an accepted
        # quotation the owner may choose from, so both are assignable here. Only
        # OWNER_TO_CONTRACTOR was, which left an accepted CONTRACTOR_TO_OWNER
        # quotation with no way to be awarded at all -- and that missing path is
        # what the auto-assignment in accept_project_request was standing in for.
        if not request or request.request_type not in OWNER_BUILDER_REQUEST_TYPES:
            raise HTTPException(status_code=404, detail="Accepted builder request not found")
        if owner_id_on_request(request) != user.id:
            raise HTTPException(status_code=404, detail="Accepted builder request not found")
        if request.status != "accepted":
            raise HTTPException(status_code=400, detail="Builder must accept with quotation before assignment")
        project = self.repository.lock_project(request.project_id) if request.project_id else None
        if not project or project.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.contractor_id:
            raise HTTPException(status_code=400, detail="This project already has an assigned builder")
        # An assignment made after work has started could never be confirmed,
        # negotiated, declined or cancelled (see ensure_assignment_open), so it would
        # sit on "awaiting builder" for good. It is refused here instead. A planned
        # start date that has arrived is not work: the owner sees a warning only.
        started = project_work_started_reason(self.database, project)
        if started:
            raise HTTPException(
                status_code=409,
                detail=f"This project has already started ({started}), so a builder can no longer be assigned to it through a quotation.",
            )
        contractor = self.repository.get_user(builder_id_on_request(request))
        if not contractor or contractor.role != ROLE_BUILDER:
            raise HTTPException(status_code=404, detail="Builder not found")
        # A builder who declined this project's assignment is not offered it again.
        if self.repository.find_declined_award_id(project.id, contractor.id):
            raise HTTPException(
                status_code=409,
                detail=f"{contractor.name} declined this project's assignment and cannot be assigned to it again.",
            )

        # One award is live per project. An unassigned one is a negotiation still
        # running (or agreed) with one builder: Assign on that same quotation
        # assigns it; any other quotation waits until it is cancelled.
        active = self.repository.lock_active_award(project.id)
        if active and active.request_id != request.id:
            other = self.repository.get_user(active.builder_id)
            raise HTTPException(
                status_code=409,
                detail=f"A negotiation with {other.name if other else 'another builder'} is in progress on this project. Cancel it before choosing another builder.",
            )
        if active and opening_offer is not None:
            raise HTTPException(
                status_code=409,
                detail="A negotiation with this builder is already in progress. Answer or counter it in the request.",
            )
        if active and open_award_offer(self.database, active.id, lock=True):
            raise HTTPException(
                status_code=409,
                detail="Answer the open offer first. The project can be assigned once an amount is agreed.",
            )

        if active:
            award = active
        else:
            award = ProjectAward(
                project_id=project.id,
                request_id=request.id,
                builder_id=contractor.id,
                status=AWARD_AWAITING_BUILDER,
                created_at=naive_utc_now(),
            )
            self.repository.add(award)

        if opening_offer is not None:
            # "Negotiate": an award for the negotiation and the owner's opening
            # offer, through the same offer path as any counter-offer and in this
            # transaction. The project is NOT assigned -- contractor_id stays empty,
            # no ASSIGNMENT card, no "Project assigned" -- until the owner assigns
            # it explicitly. If the offer is refused, nothing is kept.
            try:
                self.repository.flush()
                offer = submit_award_offer(self.database, award, project, user, opening_offer, payload.offer_note)
            except HTTPException:
                self.repository.rollback()
                raise
            commit_award_change(self.database)
            return {
                "status": "negotiating",
                "project_id": project.id,
                "builder_id": contractor.id,
                "award_id": offer["award_id"],
                "offer_id": offer["offer_id"],
                "award_status": offer["status"],
            }

        # The builder confirms the final amount BEFORE the owner may assign.
        # Without a confirmed award, Assign is refused -- or, on a quotation with
        # no award yet, it only sends that quotation to the builder to confirm
        # (a new, unassigned award). Nothing is assigned on this path.
        if award.status != AWARD_CONFIRMED:
            if active:
                raise HTTPException(
                    status_code=409,
                    detail=f"Waiting for {contractor.name} to confirm the final quotation. You can assign the project once they confirm.",
                )
            self.repository.flush()
            # A round after an ended one starts from the amount last agreed.
            carried = carry_last_agreed_amount(self.database, award)
            quote_text = money_label(award_agreed_amount(self.database, award, request), project.project_country)
            if carried is not None:
                body = f"CONFIRMATION REQUESTED: {user.name} asked you to confirm {quote_text} for {project.title}, the amount you both agreed in the previous round. Confirm it so {user.name} can assign the project to you."
            else:
                body = f"CONFIRMATION REQUESTED: {user.name} accepted your quotation of {quote_text} for {project.title}. Confirm it so {user.name} can assign the project to you."
            award_message(self.database, project, award, user.id, contractor.id, body, "Confirm your quotation")
            commit_award_change(self.database)
            return {
                "status": "awaiting_builder_confirmation",
                "project_id": project.id,
                "builder_id": contractor.id,
                "award_id": award.id,
            }
        if award.request_id != request.id or award.builder_id != contractor.id:
            raise HTTPException(
                status_code=409, detail="This confirmation belongs to another quotation. Refresh and try again."
            )

        # Assigning a builder who has confirmed IS the assignment. Several builders
        # may hold an accepted request and a quotation at once; the owner picking
        # one settles it on the SAME project row, and the builders who were not
        # chosen keep their accepted request untouched but gain nothing on this
        # project. The award is already confirmed, so this makes the contract.
        project.contractor_id = contractor.id
        conversation = create_conversation_for_users(self.database, project.title, [user.id, contractor.id])
        create_conversation_message(
            self.database,
            conversation,
            user.id,
            assignment_message_payload(request, user, contractor, project, "accepted"),
            "ASSIGNMENT",
        )
        create_request_notification(
            self.database,
            contractor.id,
            "Project assigned",
            f"{user.name} assigned project {project.title} to you at your confirmed quotation.",
            category="NEGOTIATION",
        )
        # The contract now exists (confirmed AND assigned): re-split the escrow
        # over it, under the same rule the builder's confirmation used.
        self.repository.flush()
        contract = get_awarded_contract(self.database, project)
        escrow_resized = bool(contract) and resize_escrow_to_contract(
            self.database, project, contract["contract_amount"]
        )
        commit_award_change(self.database)
        return {
            "status": "assigned",
            "project_id": project.id,
            "contractor_id": contractor.id,
            "contract_amount": contract["contract_amount"] if contract else None,
            "escrow_resized": escrow_resized,
        }

    def assign_engineer_from_request(self, payload: RequestDecision, user: User):
        ensure_role(user, "OWNER")
        request = self.repository.get(payload.request_id)
        if not request or request.sender_id != user.id or request.request_type != OWNER_ENGINEER_REQUEST_TYPE:
            raise HTTPException(status_code=404, detail="Accepted site engineer request not found")
        if request.status != "accepted":
            raise HTTPException(
                status_code=400, detail="The site engineer must accept before the project can be assigned"
            )
        project = self.repository.get_project(request.project_id) if request.project_id else None
        if not project or project.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Project not found")
        engineer = self.repository.get_user(request.receiver_id)
        if not engineer or engineer.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Site engineer not found")

        # One project per engineer and one engineer per project, checked under
        # row locks so a concurrent assignment elsewhere -- by this owner,
        # another owner or a builder -- cannot slip in between check and write.
        # An engineer who accepted earlier may have been put on another project
        # since; the same availability rule as sending the request applies here.
        ensure_engineer_can_take_project(self.database, project, engineer.id)

        assignment = self.repository.find_project_engineer(project.id, engineer.id)
        # Already the ACTIVE Site Engineer here: nothing to assign, so no second
        # "New project assignment" notification. Read under the locks taken
        # above, so two identical requests at once cannot both pass.
        if assignment and assignment.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="This Site Engineer is already assigned to this project.")
        if not assignment:
            assignment = ProjectEngineer(project_id=project.id, engineer_id=engineer.id, status="ACTIVE")
            self.repository.add(assignment)
        else:
            assignment.status = "ACTIVE"

        create_request_notification(
            self.database,
            engineer.id,
            "New project assignment",
            f"{user.name} assigned you to project {project.title}.",
            category="PROJECT",
        )
        self.repository.commit()
        return {"status": "assigned", "project_id": project.id, "engineer_id": engineer.id}

    def confirm_project_assignment(self, payload: RequestDecision, user: User):
        ensure_role(user, "CONTRACTOR")
        # Locked so two confirmations of one award cannot both pass the check below.
        request = self.repository.lock_request(payload.request_id)
        # The builder on the quotation, whichever side opened it. Only
        # OWNER_TO_CONTRACTOR (builder = receiver) was recognised, so a builder whose
        # own CONTRACTOR_TO_OWNER quotation the owner awarded -- /assign accepts both
        # -- got "Assignment request not found" and could never confirm it.
        if (
            not request
            or request.request_type not in OWNER_BUILDER_REQUEST_TYPES
            or builder_id_on_request(request) != user.id
        ):
            raise HTTPException(status_code=404, detail="Assignment request not found")
        if request.status != "accepted":
            raise HTTPException(status_code=400, detail="Quotation must be accepted before assignment")
        project = self.repository.get_project(request.project_id) if request.project_id else None
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.contractor_id != user.id:
            # Confirming acknowledges an award the owner has already made; it does
            # not create one. This used to set `contractor_id` itself, so a builder
            # holding an accepted quotation could take the project without the owner
            # ever choosing them -- the same premature assignment as on the accept
            # path, reached from the other side. The owner's assignment writes
            # `contractor_id` and posts the ASSIGNMENT message this confirms.
            detail = (
                "This project is already assigned to another builder"
                if project.contractor_id
                else "The house owner has not assigned this project yet"
            )
            raise HTTPException(status_code=400, detail=detail)
        # Confirmed once: the award's ASSIGNMENT card records it. Confirming again
        # used to repeat the message and the owner's notification.
        # Compatibility wrapper: the same confirm_award() the assignment panel uses,
        # at the original quotation. Once negotiation has started the amount is no
        # longer implicit, so this older entry point refuses rather than guess.
        award = self.repository.find_active_award_for_request(project.id, request.id)
        if not award:
            raise HTTPException(status_code=404, detail="Assignment request not found")
        award, project = lock_award(self.database, award.id)
        if award.status == AWARD_CONFIRMED:
            raise HTTPException(status_code=409, detail="This assignment has already been confirmed.")
        if award.status == AWARD_NEGOTIATING or award.agreed_offer_id:
            raise HTTPException(
                status_code=409, detail="Negotiation is in progress. Confirm the contract from the assignment panel."
            )
        result = confirm_award(self.database, award, project, user, award_agreed_amount(self.database, award))
        commit_award_change(self.database)
        return {**result, "status": "assigned"}

    def answer_property_enquiry(self, payload: RequestDecision, user: User, accepted: bool):
        """A property enquiry answered through these endpoints, as when it was a request
        without a project: its seller only, once, with the generic notifications."""
        enquiry = property_links.lock_enquiry(self.database, payload.request_id)
        if not enquiry or enquiry.receiver_id != user.id:
            raise HTTPException(status_code=404, detail="Request not found")
        category = request_notification_category(enquiry.request_type)
        if not accepted:
            property_links.ensure_pending(enquiry)
            enquiry.status = "rejected"
            create_request_notification(
                self.database,
                enquiry.sender_id,
                "Request rejected",
                f"{user.name} rejected your {enquiry.request_type} request.",
                category=category,
            )
            self.repository.commit()
            return {"status": "rejected"}
        require_complete_profile(user)
        property_links.ensure_pending(enquiry)
        enquiry.status = "accepted"
        # The old request without a project opened this conversation.
        conversation = create_conversation_for_users(
            self.database, "Material request", [enquiry.sender_id, enquiry.receiver_id]
        )
        if enquiry.quotation_amount:
            quote_body = (
                f"QUOTATION: {user.name} accepted your request with a quotation of "
                f"₹{float(enquiry.quotation_amount):,.0f}."
            )
            create_conversation_message(self.database, conversation, user.id, quote_body, "QUOTATION")
            create_request_notification(
                self.database, enquiry.sender_id, "Quotation received", quote_body, category=category
            )
        else:
            create_conversation_message(
                self.database, conversation, user.id, f"REQUEST ACCEPTED: {user.name} accepted your request.", "REQUEST"
            )
            create_request_notification(
                self.database, enquiry.sender_id, "Request accepted", "Your request is accepted.", category=category
            )
        self.repository.commit()
        return {"status": "accepted"}

    def reject_project_request(self, payload: RequestDecision, user: User):
        request = self.repository.lock_request(payload.request_id)
        if request is None:
            return self.answer_property_enquiry(payload, user, accepted=False)
        if request.receiver_id != user.id:
            raise HTTPException(status_code=404, detail="Request not found")
        # Only pending -> rejected. An accepted request (a shortlisted quotation,
        # possibly already awarded) is not withdrawn through this endpoint.
        ensure_request_pending(request)
        request.status = "rejected"
        create_request_notification(
            self.database,
            request.sender_id,
            "Request rejected",
            f"{user.name} rejected your {request.request_type} request.",
            category=request_notification_category(request.request_type),
        )
        self.repository.commit()
        return {"status": "rejected"}

    def withdraw_project_request(self, payload: RequestDecision, user: User):
        request = self.repository.lock_request(payload.request_id)
        if not request or request.sender_id != user.id or request.request_type not in SEND_REQUEST_TYPES:
            raise HTTPException(status_code=404, detail="Request not found")
        # Only pending -> withdrawn; an answered or already withdrawn request stays as it is.
        ensure_request_pending(request)
        request.status = "withdrawn"
        project = self.repository.get_project(request.project_id) if request.project_id else None
        request_context = f" for {project.title}" if project else ""
        create_request_notification(
            self.database,
            request.receiver_id,
            "Request withdrawn",
            f"{user.name} withdrew their request{request_context}.",
            category=request_notification_category(request.request_type),
        )
        self.repository.commit()
        return {"status": "withdrawn"}
