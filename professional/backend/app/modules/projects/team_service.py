"""Builder teams of Site Engineers, invitations, specialists on a project, and a Site
Engineer's projects and opportunities (ported from the old engineer_team_service.py,
same rules and answers).
"""

import random
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.admin.scope import refuse_kuwait
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.projects.access import (
    ensure_contractor_project_access,
    ensure_engineer_can_take_project,
    ensure_role,
    project_progress_fields,
    require_complete_profile,
    working_project_ids_for_engineer,
)
from app.modules.projects.award_service import contract_fields, project_award_states, project_work_started_reason
from app.modules.projects.models import ContractorEngineer, EngineerInvitation, ProjectEngineer, ProjectRequest
from app.modules.projects.notices import create_request_notification
from app.modules.projects.people import can_view_private_contact, engineer_summary_payload
from app.modules.projects.request_types import SPECIALIST_REQUEST_TYPE
from app.modules.projects.schemas import (
    EngineerAssignRequest,
    EngineerInviteCreate,
    EngineerJoinRequestCreate,
    EngineerJoinRequestDecision,
    EngineerJoinTeamRequest,
    EngineerSendRequest,
)
from app.modules.projects.team_repository import EngineerTeamRepository


def legacy_role(user: User) -> str:
    """The role name request_sender_role stores (the builder as CONTRACTOR, as before)."""
    return "CONTRACTOR" if user.role == ROLE_BUILDER else user.role


SITE_ENGINEER_CATEGORY = "Site Engineer"


# The specialist Engineer Categories a project's Builder may bring onto a
# project. These are Engineer Categories that already exist on profiles from
# Step 1; nothing here creates a role, a dashboard or a signup flow.
SPECIALIST_CATEGORIES = [
    "Soil Engineer",
    "Survey Engineer",
    "Architecture",
    "Structural Engineer",
    "Civil Engineer",
    "Electrical Engineer",
    "Plumbing",
    "Mechanical Engineer",
    "HVAC",
    "Quantity Surveyor",
    "Safety",
    "Construction Safety",
    "Finishing / Painter",
]


def generate_engineer_invite_code(database: Session, contractor: User) -> str:
    company = contractor.contractor_profile.company_name if contractor.contractor_profile else contractor.name
    name_parts = [part for part in company.split() if part and part[0].isalnum()][:2]
    initials = "".join(part[0] for part in name_parts).upper() or contractor.name[:2].upper()
    pincode = (contractor.pincode or "")[-6:] or "000000"
    for _ in range(25):
        code = f"{initials}-{pincode}-{random.randint(1000, 9999)}"
        if not EngineerTeamRepository(database).find_invitation_id_by_code(code):
            return code
    return f"{initials}-{pincode}-{EngineerTeamRepository(database).count_invitations() + 1:04d}"


def engineer_invitation_payload(invitation: EngineerInvitation) -> dict:
    return {
        "id": invitation.id,
        "invite_code": invitation.invite_code,
        "invite_link": f"{get_settings().frontend_origin}/invite/{invitation.invite_code}",
        "phone": invitation.phone or "",
        "email": invitation.email or "",
        "status": invitation.status,
        "created_at": invitation.created_at.isoformat() if invitation.created_at else None,
    }


def normalized_invitation_contact(value: str | None) -> str:
    return (value or "").strip().lower()


def mark_matching_engineer_invitations_used(database: Session, contractor_id: uuid.UUID, engineer: User) -> None:
    engineer_email = normalized_invitation_contact(engineer.email)
    engineer_phone = normalized_invitation_contact(engineer.phone)
    pending = EngineerTeamRepository(database).list_pending_invitations_for_contractor(contractor_id)
    for invitation in pending:
        email_matches = engineer_email and normalized_invitation_contact(invitation.email) == engineer_email
        phone_matches = engineer_phone and normalized_invitation_contact(invitation.phone) == engineer_phone
        if email_matches or phone_matches:
            invitation.status = "USED"
            EngineerTeamRepository(database).add(invitation)


def engineer_category_of(engineer_user: User) -> str:
    profile = getattr(engineer_user, "engineer_profile", None)
    return (profile.specialization or "").strip() if profile else ""


def specialist_requests_for_project(database: Session, project_id: uuid.UUID) -> list:
    return EngineerTeamRepository(database).list_specialist_requests(project_id)


class EngineerTeamService:
    def __init__(self, repository: EngineerTeamRepository):
        self.repository = repository
        self.database = repository.database

    def fetch_project_specialist_team(self, project_id: uuid.UUID, user: User):
        ensure_contractor_project_access(self.database, project_id, user)

        holder_by_category: dict = {}
        for request in specialist_requests_for_project(self.database, project_id):
            specialist = self.repository.get_user(request.receiver_id)
            if not specialist:
                continue
            category = engineer_category_of(specialist)
            existing = holder_by_category.get(category)
            # An accepted row always wins over a pending one for the same category.
            if existing and existing["status"] == "accepted":
                continue
            holder_by_category[category] = {
                "status": request.status,
                "request_id": request.id,
                "engineer": engineer_summary_payload(
                    specialist,
                    specialist.engineer_profile,
                    can_view_private_contact(self.database, user, specialist),
                ),
                "requested_at": request.created_at.isoformat() if request.created_at else None,
            }

        return [
            {
                "category": category,
                "status": holder_by_category.get(category, {}).get("status", "none"),
                "request_id": holder_by_category.get(category, {}).get("request_id"),
                "engineer": holder_by_category.get(category, {}).get("engineer"),
                "requested_at": holder_by_category.get(category, {}).get("requested_at"),
            }
            for category in SPECIALIST_CATEGORIES
        ]

    def fetch_project_specialist_candidates(self, project_id: uuid.UUID, category: str, user: User):
        project = ensure_contractor_project_access(self.database, project_id, user)
        requested_category = (category or "").strip()
        if requested_category not in SPECIALIST_CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown Engineer Category.")

        # Each candidate carries their OWN standing. Someone who already has a
        # request is still listed, marked pending or accepted, rather than being
        # dropped from the list -- one person's request must never hide the others.
        open_requests = specialist_requests_for_project(self.database, project_id)
        status_by_engineer = {request.receiver_id: request.status for request in open_requests}
        category_is_filled = any(
            request.status == "accepted"
            and (holder := self.repository.get_user(request.receiver_id))
            and engineer_category_of(holder) == requested_category
            for request in open_requests
        )

        # The same locality rule the rest of the application discovers people by.
        engineers = self.repository.list_specialist_candidates(requested_category, user.id, project)
        candidates = []
        for engineer in engineers:
            status = status_by_engineer.get(engineer.id, "none")
            candidates.append(
                {
                    **engineer_summary_payload(
                        engineer, engineer.engineer_profile, can_view_private_contact(self.database, user, engineer)
                    ),
                    "request_status": status,
                    # False only because someone else already holds the category, which
                    # the interface explains rather than silently hiding the person.
                    "can_request": status == "none" and not category_is_filled,
                    "category_filled": category_is_filled,
                }
            )
        return candidates

    def send_project_specialist_request(self, project_id: uuid.UUID, payload: EngineerAssignRequest, user: User):
        project = ensure_contractor_project_access(self.database, project_id, user)
        require_complete_profile(user)

        specialist = self.repository.get_user(payload.engineer_id)
        if not specialist or specialist.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Engineer not found")
        if specialist.id == user.id:
            raise HTTPException(status_code=400, detail="You cannot send a request to yourself")

        # The category is read from the target's own profile, never from the caller,
        # so a hand-made request cannot place someone in a category they do not hold.
        category = engineer_category_of(specialist)
        if category not in SPECIALIST_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail="This Engineer's category cannot be assigned as a project specialist.",
            )

        for request in specialist_requests_for_project(self.database, project_id):
            if request.receiver_id == specialist.id:
                raise HTTPException(status_code=409, detail="This Engineer already has a request on this project.")
            # A category is filled only by an ACCEPTED request -- that is the active
            # assignment. A request still waiting for an answer reserves nothing, so
            # the Site Engineer may ask several people in the same category and take
            # whoever accepts first.
            if request.status != "accepted":
                continue
            holder = self.repository.get_user(request.receiver_id)
            if holder and engineer_category_of(holder) == category:
                raise HTTPException(status_code=409, detail=f"{category} is already filled on this project.")

        request = ProjectRequest(
            project_id=project.id,
            sender_id=user.id,
            receiver_id=specialist.id,
            request_type=SPECIALIST_REQUEST_TYPE,
            status="pending",
        )
        self.repository.add(request)
        create_request_notification(
            self.database,
            specialist.id,
            "New project request",
            f"{user.name} invited you to join {project.title} as {category}.",
            category="ENGINEER",
        )
        self.repository.commit()
        self.repository.refresh(request)
        return {"status": "sent", "request_id": request.id, "category": category}

    def create_engineer_invitation(self, payload: EngineerInviteCreate, user: User):
        ensure_role(user, "CONTRACTOR")
        if not (payload.phone or "").strip() and not (payload.email or "").strip():
            raise HTTPException(status_code=400, detail="Provide a phone number or email for the invitation.")
        code = generate_engineer_invite_code(self.database, user)
        invitation = EngineerInvitation(
            contractor_id=user.id,
            invite_code=code,
            phone=(payload.phone or "").strip() or None,
            email=(payload.email or "").strip() or None,
            status="PENDING",
        )
        self.repository.add(invitation)
        self.repository.commit()
        self.repository.refresh(invitation)
        return engineer_invitation_payload(invitation)

    def revoke_engineer_invitation(self, payload: dict, user: User):
        ensure_role(user, "CONTRACTOR")
        invitation_id = payload.get("invitation_id")
        if not invitation_id:
            raise HTTPException(status_code=400, detail="invitation_id is required.")
        try:
            invitation_key = uuid.UUID(str(invitation_id))
        except ValueError:
            # Crash fixed: an id that is not a UUID used to fail in the database (500).
            invitation_key = None
        invitation = self.repository.find_pending_invitation(invitation_key, user.id) if invitation_key else None
        if not invitation:
            raise HTTPException(status_code=404, detail="Invitation not found or already processed.")
        invitation.status = "REVOKED"
        self.repository.add(invitation)
        self.repository.commit()
        return {"ok": True, "message": "Invitation revoked."}

    def send_contractor_engineer_request(self, payload: EngineerSendRequest, user: User):
        ensure_role(user, "CONTRACTOR")
        require_complete_profile(user)
        engineer = self.repository.get_user(payload.engineer_id)
        if not engineer or engineer.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Site Engineer not found.")
        # The project_id is informational context for the request (used in notifications).
        # We only verify the project exists — the contractor does NOT need to be the
        # assigned contractor yet; project assignment happens after the engineer accepts.
        if payload.project_id:
            project = self.repository.get_project(payload.project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found.")
        # Check for existing relationship
        existing = self.repository.find_relationship(user.id, engineer.id)
        if existing:
            if existing.status == "ACTIVE":
                raise HTTPException(status_code=409, detail="Already connected. This engineer is already on your team.")
            if existing.status == "PENDING":
                raise HTTPException(
                    status_code=409, detail="Request already sent. Waiting for the engineer to respond."
                )
            # If REJECTED, allow re-request by resetting to PENDING
            existing.status = "PENDING"
            existing.request_sender_role = "CONTRACTOR"
            self.repository.add(existing)
        else:
            relationship = ContractorEngineer(
                contractor_id=user.id, engineer_id=engineer.id, status="PENDING", request_sender_role="CONTRACTOR"
            )
            self.repository.add(relationship)
        company_name = user.contractor_profile.company_name if user.contractor_profile else user.name
        create_request_notification(
            self.database,
            engineer.id,
            "New Site Engineer request",
            f"{company_name} ({user.pincode}) sent you a request to join their Site Engineer team.",
            category="ENGINEER",
        )
        self.repository.commit()
        return {"status": "sent", "message": "Request sent to the Site Engineer."}

    def fetch_engineer_team(self, user: User):
        if user.role == ROLE_BUILDER:
            active = []
            active_contacts = set()
            for row in self.repository.list_active_team_rows(user.id):
                engineer = self.repository.get_user(row.engineer_id)
                if not engineer:
                    continue
                active_contacts.update(
                    filter(
                        None,
                        [normalized_invitation_contact(engineer.email), normalized_invitation_contact(engineer.phone)],
                    )
                )
                assigned_rows = self.repository.list_active_assignments_for_engineer(engineer.id)
                # The same "working on a project" rule the House Owner screens
                # and the assignment check use, so an engineer is never shown
                # free here while being refused on assignment.
                working_projects = [
                    self.repository.get_project(project_id)
                    for project_id in working_project_ids_for_engineer(self.database, engineer.id)
                ]
                project_count = len(assigned_rows)
                assigned_projects = []
                for assigned in assigned_rows:
                    project = self.repository.get_project(assigned.project_id)
                    if project:
                        assigned_projects.append({"id": project.id, "title": project.title})
                active.append(
                    {
                        **engineer_summary_payload(
                            engineer, engineer.engineer_profile, True, project_count, assigned_projects
                        ),
                        "working_on_project": bool(working_projects),
                        # Working on a running project that is not one of this
                        # builder's: the builder can neither assign nor unassign.
                        "working_on_other_project": any(
                            project is not None and project.contractor_id != user.id for project in working_projects
                        ),
                    }
                )
            pending_requests = []
            for row in self.repository.list_incoming_join_requests(user.id):
                engineer = self.repository.get_user(row.engineer_id)
                if not engineer:
                    continue
                pending_requests.append(
                    {
                        **engineer_summary_payload(engineer, engineer.engineer_profile, True),
                        "relationship_id": row.id,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                )
            pending_invitations = self.repository.list_pending_invitations_newest_first(user.id)
            invitations = [
                engineer_invitation_payload(invitation)
                for invitation in pending_invitations
                if not (
                    {normalized_invitation_contact(invitation.email), normalized_invitation_contact(invitation.phone)}
                    - {""}
                )
                & active_contacts
            ]
            outgoing_requests = []
            for row in self.repository.list_outgoing_team_requests(user.id):
                engineer = self.repository.get_user(row.engineer_id)
                if not engineer:
                    continue
                outgoing_requests.append(
                    {
                        **engineer_summary_payload(engineer, engineer.engineer_profile, True),
                        "relationship_id": row.id,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                )
            return {
                "active": active,
                "pending_requests": pending_requests,
                "invitations": invitations,
                "outgoing_requests": outgoing_requests,
            }
        if user.role == ROLE_ENGINEER:
            teams = []
            incoming_requests = []
            for row in self.repository.list_team_rows_for_engineer(user.id):
                contractor = self.repository.get_user(row.contractor_id)
                if not contractor:
                    continue
                team_entry = {
                    "relationship_id": row.id,
                    "contractor_id": contractor.id,
                    "contractor_name": contractor.name,
                    "company_name": contractor.contractor_profile.company_name
                    if contractor.contractor_profile
                    else contractor.name,
                    "company_logo_url": contractor.contractor_profile.company_logo_url
                    if contractor.contractor_profile
                    else "",
                    "pincode": contractor.pincode,
                    "status": row.status,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                teams.append(team_entry)
                # Only contractor-initiated PENDING requests show as incoming requests
                # that the engineer can accept or reject. Engineer-initiated requests are
                # outgoing and should not appear here.
                if row.status == "PENDING" and row.request_sender_role == "CONTRACTOR":
                    incoming_requests.append(team_entry)
            return {"teams": teams, "incoming_requests": incoming_requests}
        raise HTTPException(status_code=403, detail="Engineer team is available only for builders and site engineers")

    def join_engineer_team(self, payload: EngineerJoinTeamRequest, user: User):
        ensure_role(user, "ENGINEER")
        code = (payload.invite_code or "").strip().upper()
        invitation = self.repository.find_invitation_by_code(code)
        if not invitation:
            raise HTTPException(status_code=404, detail="Invalid invitation code. Check the code and try again.")
        if invitation.status != "PENDING":
            raise HTTPException(status_code=400, detail="This invitation code has already been used.")
        contractor = self.repository.get_user(invitation.contractor_id)
        if not contractor or contractor.role != ROLE_BUILDER:
            raise HTTPException(status_code=404, detail="Inviting builder not found")
        relationship = self.repository.find_relationship(contractor.id, user.id)
        if relationship and relationship.status == "ACTIVE":
            mark_matching_engineer_invitations_used(self.database, contractor.id, user)
            invitation.status = "USED"
            self.repository.commit()
            company_name = (
                contractor.contractor_profile.company_name if contractor.contractor_profile else contractor.name
            )
            return {
                "status": "joined",
                "contractor_id": contractor.id,
                "contractor_name": contractor.name,
                "company_name": company_name,
            }
        if not relationship:
            relationship = ContractorEngineer(contractor_id=contractor.id, engineer_id=user.id, status="ACTIVE")
            self.repository.add(relationship)
        else:
            relationship.status = "ACTIVE"
        invitation.status = "USED"
        mark_matching_engineer_invitations_used(self.database, contractor.id, user)
        create_request_notification(
            self.database,
            contractor.id,
            "New Site Engineer joined your team",
            f"{user.name} joined your Site Engineer team using the invitation code {invitation.invite_code}.",
            category="ENGINEER",
        )
        self.repository.commit()
        company_name = contractor.contractor_profile.company_name if contractor.contractor_profile else contractor.name
        return {
            "status": "joined",
            "contractor_id": contractor.id,
            "contractor_name": contractor.name,
            "company_name": company_name,
        }

    def request_engineer_join(self, payload: EngineerJoinRequestCreate, user: User):
        ensure_role(user, "ENGINEER")
        require_complete_profile(user)
        contractor = self.repository.get_user(payload.contractor_id)
        if not contractor or contractor.role != ROLE_BUILDER:
            raise HTTPException(status_code=404, detail="Builder not found")
        relationship = self.repository.find_relationship(contractor.id, user.id)
        if relationship and relationship.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="You are already part of this builder's team.")
        if relationship and relationship.status == "PENDING":
            raise HTTPException(status_code=409, detail="You already sent a join request to this builder.")
        if relationship and relationship.status == "REJECTED":
            relationship.status = "PENDING"
            relationship.request_sender_role = "ENGINEER"
            self.repository.add(relationship)
        else:
            relationship = ContractorEngineer(
                contractor_id=contractor.id, engineer_id=user.id, status="PENDING", request_sender_role="ENGINEER"
            )
            self.repository.add(relationship)
        create_request_notification(
            self.database,
            contractor.id,
            "Site Engineer join request",
            f"{user.name} ({user.pincode}) wants to join your Site Engineer team.",
            category="ENGINEER",
        )
        self.repository.commit()
        return {"status": "requested", "relationship_id": relationship.id}

    def respond_engineer_join_request(self, payload: EngineerJoinRequestDecision, user: User):
        if user.role not in (ROLE_BUILDER, ROLE_ENGINEER):
            raise HTTPException(
                status_code=403, detail="Only builders and site engineers can respond to join requests."
            )
        relationship = self.repository.get(payload.relationship_id)
        if not relationship:
            raise HTTPException(status_code=404, detail="Join request not found")
        # Only the RECEIVER of a request may accept or reject it.
        # The sender_role tracks who initiated the request.
        sender = relationship.request_sender_role or ("ENGINEER" if user.role == ROLE_BUILDER else "CONTRACTOR")
        if user.role == ROLE_BUILDER and relationship.contractor_id != user.id:
            raise HTTPException(status_code=404, detail="Join request not found")
        if user.role == ROLE_ENGINEER and relationship.engineer_id != user.id:
            raise HTTPException(status_code=404, detail="Join request not found")
        if relationship.status == "ACTIVE":
            raise HTTPException(status_code=400, detail="This relationship is already active.")
        if relationship.status == "REJECTED":
            raise HTTPException(status_code=400, detail="This request has already been rejected.")
        # The sender cannot accept or reject their own request.
        if legacy_role(user) == sender:
            raise HTTPException(status_code=403, detail="Only the receiver of a request can accept or reject it.")
        action = (payload.action or "").upper()
        if action not in {"ACCEPT", "REJECT"}:
            raise HTTPException(status_code=400, detail="Action must be ACCEPT or REJECT")
        # Declining needs no profile; joining a team does.
        if action == "ACCEPT":
            require_complete_profile(user)
        relationship.status = "ACTIVE" if action == "ACCEPT" else "REJECTED"
        if action == "ACCEPT":
            # Notify the other party with correct direction context.
            if user.role == ROLE_BUILDER:
                # Builder accepted an engineer's request to join.
                company_name = user.contractor_profile.company_name if user.contractor_profile else user.name
                create_request_notification(
                    self.database,
                    relationship.engineer_id,
                    "Join request accepted",
                    f"{company_name} accepted your request to join their Site Engineer team.",
                    category="ENGINEER",
                )
            else:
                # Engineer accepted a builder's request to join their team.
                contractor = self.repository.get_user(relationship.contractor_id)
                company_name = (
                    contractor.contractor_profile.company_name
                    if contractor and contractor.contractor_profile
                    else (contractor.name if contractor else "Builder")
                )
                create_request_notification(
                    self.database,
                    relationship.contractor_id,
                    "Site Engineer request accepted",
                    f"{user.name} accepted your request to join the Site Engineer team at {company_name}.",
                    category="ENGINEER",
                )
        else:
            if user.role == ROLE_BUILDER:
                company_name = user.contractor_profile.company_name if user.contractor_profile else user.name
                create_request_notification(
                    self.database,
                    relationship.engineer_id,
                    "Join request declined",
                    f"{company_name} declined your request to join their Site Engineer team.",
                    category="ENGINEER",
                )
            else:
                contractor = self.repository.get_user(relationship.contractor_id)
                company_name = (
                    contractor.contractor_profile.company_name
                    if contractor and contractor.contractor_profile
                    else (contractor.name if contractor else "Builder")
                )
                create_request_notification(
                    self.database,
                    relationship.contractor_id,
                    "Site Engineer request declined",
                    f"{user.name} declined the request to join the Site Engineer team at {company_name}.",
                    category="ENGINEER",
                )
        self.repository.commit()
        return {"status": relationship.status}

    def fetch_engineer_opportunities(self, country: str | None, user: User):
        refuse_kuwait(country)
        ensure_role(user, "ENGINEER")
        assigned_project_ids = {
            item.project_id for item in self.repository.list_active_assignment_project_ids_for_engineer(user.id)
        }
        staffed_project_ids = {item.project_id for item in self.repository.list_active_assignment_project_ids()}
        # Scope by country when specified and not India; India keeps pincode locality.
        use_country = country and country.strip() if country else None
        country_is_india = (use_country or "India").upper() == "INDIA"
        if use_country and not country_is_india:
            projects = self.repository.list_active_projects_in_country(use_country)
        else:
            projects = self.repository.list_active_projects_in_pincode(user.pincode)
        opportunities = []
        for project in projects:
            if project.id in assigned_project_ids or project.id in staffed_project_ids or project.contractor_id is None:
                continue
            contractor = self.repository.get_user(project.contractor_id)
            if not contractor:
                continue
            opportunities.append(
                {
                    "project_id": project.id,
                    "title": project.title,
                    "description": project.description,
                    "address": project.address,
                    "pincode": project.pincode,
                    "building_type": project.building_type,
                    "construction_type": project.construction_type,
                    "budget": float(project.budget or 0),
                    "status": project.status,
                    **project_progress_fields(project),
                    "cover_image_url": project.cover_image_url,
                    "contractor_id": contractor.id,
                    "contractor_name": contractor.name,
                    "company_name": contractor.contractor_profile.company_name
                    if contractor.contractor_profile
                    else contractor.name,
                    "company_logo_url": contractor.contractor_profile.company_logo_url
                    if contractor.contractor_profile
                    else "",
                    "created_at": project.created_at.isoformat() if project.created_at else None,
                    "start_date": project.start_date.isoformat() if project.start_date else None,
                    "end_date": project.end_date.isoformat() if project.end_date else None,
                }
            )
        return opportunities

    def apply_engineer_opportunity(self, project_id: uuid.UUID, user: User):
        ensure_role(user, "ENGINEER")
        require_complete_profile(user)
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.pincode != user.pincode:
            raise HTTPException(status_code=400, detail="Project pincode does not match your profile")
        receiver_id = project.contractor_id or project.owner_id
        duplicate = self.repository.find_application_notification(receiver_id, project.title, user.name)
        if duplicate:
            raise HTTPException(status_code=409, detail="You already applied to this opportunity.")
        receiver = self.repository.get_user(receiver_id)
        company_name = (
            receiver.contractor_profile.company_name
            if receiver and receiver.contractor_profile
            else (receiver.name if receiver else "Project owner")
        )
        create_request_notification(
            self.database,
            receiver_id,
            "Site Engineer application",
            f"{user.name} ({user.pincode}) applied for the Site Engineer opportunity on {project.title}.",
            category="ENGINEER",
        )
        self.repository.commit()
        return {"status": "applied", "receiver_name": company_name}

    def fetch_engineer_projects(self, user: User):
        ensure_role(user, "ENGINEER")
        rows = self.repository.list_active_engineer_project_rows(user.id)
        award_states = project_award_states(self.database, [project for _, project in rows])
        payload = []
        for row, project in rows:
            contractor = self.repository.get_user(project.contractor_id) if project.contractor_id else None
            # A self-construction project has no builder — the owner hired this
            # engineer directly — so the party they answer to is the owner. Present
            # on every row; a builder-managed project is read from contractor_name
            # exactly as before and is unaffected.
            owner = self.repository.get_user(project.owner_id) if project.owner_id else None
            payload.append(
                {
                    "id": project.id,
                    "title": project.title,
                    "description": project.description,
                    "address": project.address,
                    "pincode": project.pincode,
                    "building_type": project.building_type,
                    "construction_type": project.construction_type,
                    "budget": float(project.budget or 0),
                    "status": project.status,
                    **project_progress_fields(project),
                    # Whether work has actually started on site (the app's one rule);
                    # the card shows a progress figure only then.
                    "work_started": project_work_started_reason(self.database, project) is not None,
                    "cover_image_url": project.cover_image_url,
                    "contractor_id": project.contractor_id,
                    "contractor_name": contractor.name if contractor else "",
                    "company_name": contractor.contractor_profile.company_name
                    if contractor and contractor.contractor_profile
                    else "",
                    "owner_name": owner.name if owner else "",
                    "assigned_at": row.created_at.isoformat() if row.created_at else None,
                    "created_at": project.created_at.isoformat() if project.created_at else None,
                    "start_date": project.start_date.isoformat() if project.start_date else None,
                    "end_date": project.end_date.isoformat() if project.end_date else None,
                    **contract_fields(project, award_states.get(project.id)),
                }
            )
        return payload

    def assign_engineer_to_project(self, project_id: uuid.UUID, payload: EngineerAssignRequest, user: User):
        project = ensure_contractor_project_access(self.database, project_id, user)
        engineer = self.repository.get_user(payload.engineer_id)
        if not engineer or engineer.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Site engineer not found")
        # The project Site Engineer slot is held by an Engineer whose category says
        # so. Checked here rather than only in the picker, so a hand-made request
        # cannot put a Plumbing or HVAC engineer in the Site Engineer slot.
        engineer_category = (
            (engineer.engineer_profile.specialization or "").strip() if engineer.engineer_profile else ""
        )
        if engineer_category != SITE_ENGINEER_CATEGORY:
            raise HTTPException(
                status_code=400,
                detail=f"Only an Engineer whose category is {SITE_ENGINEER_CATEGORY} can be assigned as the project Site Engineer.",
            )
        team_row = self.repository.find_active_relationship(user.id, engineer.id)
        if not team_row:
            raise HTTPException(status_code=400, detail="Only your active Site Engineers can be assigned to a project.")
        # No `contractor_id` is written here: ensure_contractor_project_access has
        # already required the project to be awarded to this builder. Assigning an
        # engineer used to award an unassigned project to whichever shortlisted
        # builder did it first.
        # One project per Site Engineer across the whole application -- this
        # builder's, another builder's or a House Owner's -- and one Site
        # Engineer per project. Checked under row locks, so two assignments
        # made at the same moment cannot both pass. Answers 409 when refused.
        ensure_engineer_can_take_project(self.database, project, engineer.id)
        assignment = self.repository.find_project_assignment(project.id, engineer.id)
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

    def unassign_engineer_from_project(self, project_id: uuid.UUID, payload: EngineerAssignRequest, user: User):
        if user.role == ROLE_OWNER:
            # A self-construction project has no builder: the owner hired its
            # Site Engineer, so the owner may also remove them. Only on their own
            # project, and never on a builder-managed one, where the builder
            # decides. Every other role keeps the builder check below.
            project = self.repository.get_project(project_id)
            if (
                not project
                or project.owner_id != user.id
                or project.construction_type != "SELF_CONSTRUCTION"
                or project.contractor_id
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Only the project owner can manage the Site Engineer on a self-construction project",
                )
        else:
            project = ensure_contractor_project_access(self.database, project_id, user)
        engineer = self.repository.get_user(payload.engineer_id)
        if not engineer or engineer.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Site engineer not found")
        assignment = self.repository.find_active_project_assignment(project.id, engineer.id)
        if not assignment:
            raise HTTPException(status_code=400, detail="This Site Engineer is not assigned to this project.")
        assignment.status = "REMOVED"
        create_request_notification(
            self.database,
            engineer.id,
            "Project assignment removed",
            f"You have been unassigned from project {project.title} by {user.name}.",
            category="PROJECT",
        )
        self.repository.commit()
        return {"status": "unassigned", "project_id": project.id, "engineer_id": engineer.id}

    def fetch_project_engineer(self, project_id: uuid.UUID, user: User):
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if user.role == ROLE_BUILDER:
            ensure_contractor_project_access(self.database, project_id, user)
        elif user.id != project.owner_id and user.id != project.contractor_id:
            raise HTTPException(status_code=403, detail="You do not have access to this project")
        assignment = self.repository.find_active_assignment_for_project(project.id)
        if not assignment:
            return {"engineer": None}
        engineer = self.repository.get_user(assignment.engineer_id)
        if not engineer:
            return {"engineer": None}
        return {"engineer": engineer_summary_payload(engineer, engineer.engineer_profile, True)}
