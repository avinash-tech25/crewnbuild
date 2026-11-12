"""A builder's award: the assignment decision, its negotiation and the contract
confirmation (ported from the old builder award_service.py, same rules and answers).

The chat lines of the negotiation are not written until the messaging module is ported
(pending_links); the notifications are.
"""

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_workflow_now
from app.database.types import naive_utc_now
from app.modules.identity.models import ROLE_BUILDER, ROLE_OWNER, User
from app.modules.projects.award_repository import AwardRepository
from app.modules.projects.models import (
    AWARD_AWAITING_BUILDER,
    AWARD_CANCELLED,
    AWARD_CONFIRMED,
    AWARD_DECLINED,
    AWARD_NEGOTIATING,
    OFFER_ACCEPTED,
    OFFER_OPEN,
    OFFER_REJECTED,
    OFFER_SUPERSEDED,
    OFFER_WITHDRAWN,
    AwardOffer,
    Project,
    ProjectAward,
    ProjectEngineer,
    ProjectImage,
    ProjectRequest,
)
from app.modules.projects.notices import create_request_notification
from app.modules.projects.pending_links import (
    pending_create_conversation_for_users,
    pending_create_conversation_message,
    pending_update_assignment_message_status,
    pending_work_record_label,
)
from app.modules.projects.request_types import (
    OWNER_BUILDER_REQUEST_TYPES,
    OWNER_ENGINEER_REQUEST_TYPE,
    builder_id_on_request,
)
from app.modules.projects.schemas import AwardAmount, AwardOfferCreate

# ---------------------------------------------------------------------------
# Builder award: assignment decision, negotiation and contract confirmation.
#
# An award (app.models.award) is created when the owner negotiates with a
# builder or sends their quotation for confirmation. The builder confirms the
# final amount, negotiates, or declines; the owner answers offers or cancels.
# Only after the builder's confirmation may the owner assign the project, and the
# contract exists once the award is both confirmed and assigned. Awards assigned
# before this order existed are still confirmed after assignment. Every write
# locks the project row, then the award row.
# ---------------------------------------------------------------------------


def award_agreed_amount(database: Session, award: ProjectAward, request: ProjectRequest | None = None) -> Decimal:
    """The amount both sides currently stand on: the agreed offer, else the original quotation."""
    if award.agreed_offer_id:
        return Decimal(str(AwardRepository(database).get_offer(award.agreed_offer_id).amount)).quantize(Decimal("0.01"))
    request = request or AwardRepository(database).get_request(award.request_id)
    return Decimal(str(request.quotation_amount or 0)).quantize(Decimal("0.01"))


def project_award_states(database: Session, projects: list[Project]) -> dict[uuid.UUID, dict]:
    """Each project's active award (see app.models.award), keyed by project id.

    A contract exists only for a CONFIRMED award whose builder is still the
    project's builder (`projects.contractor_id`) and whose request is that same
    builder's accepted quotation on this project -- never just any accepted
    request, because several builders can hold one on the same project. Its
    value is the award's agreed amount. Nothing is stored on the project:
    `projects.budget` stays the owner's original budget.
    """
    by_id = {project.id: project for project in projects}
    if not by_id:
        return {}
    awards = AwardRepository(database).list_active_awards(list(by_id))
    states: dict[uuid.UUID, dict] = {}
    for award in awards:
        project = by_id[award.project_id]
        # An unassigned award is a negotiation, not an assignment: no contract status.
        state = {
            "award_id": award.id,
            "contract_status": award.status if award_assigned(award, project) else "none",
            "contract_amount": None,
            "awarded_request_id": None,
            "awarded_amount": None,
        }
        request = AwardRepository(database).get_request(award.request_id)
        if (
            request is not None
            and request.project_id == project.id
            and request.status == "accepted"
            and request.request_type in OWNER_BUILDER_REQUEST_TYPES
            and builder_id_on_request(request) == award.builder_id == project.contractor_id
        ):
            # The awarded builder's applicable amount (agreed offer, else their
            # quotation) -- shown on cards until a contract is confirmed.
            state["awarded_amount"] = float(award_agreed_amount(database, award, request))
            if award.status == AWARD_CONFIRMED:
                state["contract_amount"] = state["awarded_amount"]
                state["awarded_request_id"] = request.id
        states[award.project_id] = state
    return states


def awarded_contracts(database: Session, projects: list[Project]) -> dict[uuid.UUID, dict]:
    """The finalized contract of each project, keyed by project id (confirmed awards only)."""
    return {
        project_id: state
        for project_id, state in project_award_states(database, projects).items()
        if state["contract_amount"] is not None
    }


def get_awarded_contract(database: Session, project: Project) -> dict | None:
    """The project's finalized contract (see project_award_states), or None."""
    return awarded_contracts(database, [project]).get(project.id)


def contract_fields(project: Project, state: dict | None) -> dict:
    """Contract fields added to a project payload; `budget` itself is untouched.

    `contract_amount` is null until the builder confirms the contract, so a
    client shows `contract_amount ?? budget` as the project's active amount.
    """
    return {
        "original_budget": float(project.budget or 0),
        "contract_amount": state["contract_amount"] if state else None,
        "awarded_request_id": state["awarded_request_id"] if state else None,
        "contract_status": state["contract_status"] if state else "none",
        # Cards show contract_amount ?? awarded_amount ?? budget.
        "awarded_amount": state.get("awarded_amount") if state else None,
    }


def resize_escrow_to_contract(database: Session, project: Project, contract_amount: float) -> bool:
    """Re-split the project's escrow milestones over the finalized contract value.

    Only when every milestone is still the untouched standard set -- one per
    CONSTRUCTION_STAGES stage, all "pending". Anything released, paid or
    otherwise moved on is a financial record and is left exactly as it is.
    The last stage takes the rounding remainder so the total equals the
    contract to the paisa. The caller owns the transaction.
    """
    milestones = AwardRepository(database).list_escrow_milestones(project.id)
    shares = dict(CONSTRUCTION_STAGES)
    if not milestones or len(milestones) != len(shares) or {milestone.name for milestone in milestones} != set(shares):
        return False
    if any(milestone.status != "pending" for milestone in milestones):
        return False
    total = Decimal(str(contract_amount)).quantize(Decimal("0.01"))
    if total <= 0:
        return False
    stage_order = [name for name, _ in CONSTRUCTION_STAGES]
    by_stage = {milestone.name: milestone for milestone in milestones}
    allotted = Decimal("0")
    for name in stage_order[:-1]:
        amount = (total * Decimal(str(shares[name]))).quantize(Decimal("0.01"))
        by_stage[name].amount = amount
        allotted += amount
    by_stage[stage_order[-1]].amount = total - allotted
    return True


def money_label(amount, country: str | None = None) -> str:
    """An amount as the screens print it: Indian grouping in rupees."""
    value = Decimal(str(amount or 0)).quantize(Decimal("1"))
    digits = str(abs(value))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return f"₹{'-' if value < 0 else ''}{digits}"


def exact_amount(value) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except Exception:
        raise HTTPException(status_code=400, detail="Enter a valid amount")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    return amount


def project_work_record_reason(database: Session, project_id: uuid.UUID) -> str | None:
    """What already records construction work on the project, or None.

    Only records of work actually done on site count: daily site records,
    labour logs, material used on site, site activity updates and site photos.
    Preparation does not -- a material order or delivery, stock on hand, a CCTV
    device, or an assigned Site Engineer or supplier -- because none of those
    means building has begun, and counting them locked a builder's assignment on
    a project nobody had started. A supplier's delivery writes its own "Material
    Request" site update (completion status FULFILLED); that entry is a
    delivery, not work, so it is not counted either.

    An assignment that has work behind it is not released by a decline or a
    cancellation, and a project with work behind it counts as started.
    """
    label = pending_work_record_label(database, project_id)
    if label:
        return label
    if AwardRepository(database).find_project_record_id(ProjectImage, project_id):
        return "project photos"
    if AwardRepository(database).find_site_activity_id(project_id):
        return "site activity updates"
    return None


def project_work_started_reason(database: Session, project: Project) -> str | None:
    """Why construction has actually started, or None while it has not.

    Only records of work done on site count (project_work_record_reason). Not a
    progress percentage: `projects.completion_percentage` is a legacy manual
    figure the progress service no longer trusts or lets anyone set, and the
    percentage project_progress_map derives exists only where daily site records
    exist, which already count. The planned start date is a schedule, not
    evidence either -- an owner may still choose a builder after it has arrived
    (see planned_start_notice). Once work has started, the project's assignment
    is no longer open for decision.
    """
    work = project_work_record_reason(database, project.id)
    if work:
        return f"work is already recorded ({work})"
    return None


def project_started_reason(database: Session, project: Project) -> str | None:
    """Why the project counts as started for display, or None while it has not:
    its planned start date has arrived, or work has actually started. Never used
    to close an assignment decision -- that is project_work_started_reason."""
    if project.start_date and project.start_date <= local_workflow_now().date():
        return f"it started on {project.start_date.isoformat()}"
    return project_work_started_reason(database, project)


def planned_start_notice(project: Project, today=None) -> str | None:
    """'today' or 'passed' when the planned start date has arrived, else None.

    A warning for the owner choosing a builder, never a block. Calendar day in
    the configured workflow timezone, the same day every other rule here uses.
    """
    if not project.start_date:
        return None
    today = today or local_workflow_now().date()
    if project.start_date == today:
        return "today"
    if project.start_date < today:
        return "passed"
    return None


def assignment_locked_message(reason: str) -> str:
    """An unassigned negotiation on a project where work has started: the project
    can no longer be assigned through a quotation, so only ending it remains."""
    return f"This project can no longer be assigned through this quotation because {reason}. Cancel or withdraw from the negotiation; the recorded work is kept."


def release_blocked_message(reason: str, outcome: str) -> str:
    """Why an assigned, pending award cannot be released, and what still can happen."""
    return (
        f"This assignment cannot be {outcome} because {reason}. "
        "The recorded work is kept. The builder can confirm the contract at the agreed amount, "
        "or either side can keep negotiating the amount first."
    )


def ensure_assignment_open(database: Session, award: ProjectAward, project: Project) -> None:
    """Refuse negotiating an UNASSIGNED award once work has actually started.

    An assigned, pending award is never closed by work: its builder's work is
    on the project, so the contract can still be negotiated and confirmed --
    only releasing it is refused (see release_award). Closing every transition
    there left the award stuck on "awaiting builder" with no way out.
    """
    if award.status in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING) and not award_assigned(award, project):
        reason = project_work_started_reason(database, project)
        if reason:
            raise HTTPException(status_code=409, detail=assignment_locked_message(reason))


def lock_award(database: Session, award_id: uuid.UUID) -> tuple[ProjectAward, Project]:
    """The award and its project, both locked: project row first, then award."""
    award = AwardRepository(database).get(award_id)
    if not award:
        raise HTTPException(status_code=404, detail="Assignment not found")
    project = AwardRepository(database).lock_project(award.project_id)
    award = AwardRepository(database).lock_award(award_id)
    return award, project


def award_party(award: ProjectAward, project: Project, user: User) -> str:
    """'builder' or 'owner' on this award; anyone else is refused."""
    if user.id == award.builder_id and user.role == ROLE_BUILDER:
        return "builder"
    if user.id == project.owner_id and user.role == ROLE_OWNER:
        return "owner"
    raise HTTPException(
        status_code=403, detail="Only the project owner and the assigned builder can act on this assignment"
    )


def open_award_offer(database: Session, award_id: uuid.UUID, lock: bool = False) -> AwardOffer | None:
    return AwardRepository(database).find_open_offer(award_id, lock)


def award_message(
    database: Session,
    project: Project,
    award: ProjectAward,
    sender_id: uuid.UUID,
    recipient_id: uuid.UUID,
    body: str,
    title: str,
) -> None:
    """A line in the existing owner-builder conversation, and a notification."""
    conversation = pending_create_conversation_for_users(database, project.title, [project.owner_id, award.builder_id])
    pending_create_conversation_message(database, conversation, sender_id, body, "TEXT")
    create_request_notification(database, recipient_id, title, body, category="NEGOTIATION")


def award_payload(database: Session, award: ProjectAward, viewer: User) -> dict:
    """Everything the assignment panel shows, for the owner or the builder."""
    project = AwardRepository(database).get_project(award.project_id)
    request = AwardRepository(database).get_request(award.request_id)
    builder = AwardRepository(database).get_user(award.builder_id)
    owner = AwardRepository(database).get_user(project.owner_id)
    offers = AwardRepository(database).list_offers(award.id)
    names = {project.owner_id: owner.name if owner else "", award.builder_id: builder.name if builder else ""}
    open_offer = next((offer for offer in offers if offer.status == OFFER_OPEN), None)
    open_by = None
    if open_offer:
        open_by = "owner" if open_offer.proposed_by_id == project.owner_id else "builder"
    agreed = award_agreed_amount(database, award, request)
    assigned = award_assigned(award, project)
    if award.status == AWARD_AWAITING_BUILDER and not assigned:
        # Not assigned, nothing open: the builder confirms the final amount (the
        # agreed offer, else the quotation) before the owner may assign.
        phase = "quotation_agreed" if award.agreed_offer_id else "quotation_open"
        action_required_by = "builder"
    elif award.status == AWARD_CONFIRMED and not assigned:
        # The builder has confirmed; assigning is the owner's separate decision.
        phase = "builder_confirmed"
        action_required_by = "owner"
    elif award.status == AWARD_AWAITING_BUILDER:
        phase = "amount_agreed" if award.agreed_offer_id else "assignment_pending"
        action_required_by = "builder"
    elif award.status == AWARD_NEGOTIATING:
        phase = "negotiating"
        action_required_by = "owner" if open_by == "builder" else "builder"
    else:
        phase = {AWARD_CONFIRMED: "contract_confirmed", AWARD_DECLINED: "declined", AWARD_CANCELLED: "cancelled"}[
            award.status
        ]
        action_required_by = None
    actions: list[str] = []
    if viewer.id == award.builder_id:
        if award.status == AWARD_AWAITING_BUILDER and not assigned:
            # The builder confirms the final amount before any assignment; an
            # amount not yet agreed may still be countered instead.
            actions = ["confirm", "decline"] if award.agreed_offer_id else ["confirm", "counter", "decline"]
        elif award.status == AWARD_CONFIRMED and not assigned:
            # Confirmed, not assigned yet: the builder may still withdraw.
            actions = ["decline"]
        elif award.status == AWARD_AWAITING_BUILDER:
            actions = ["confirm", "counter", "decline"]
        elif award.status == AWARD_NEGOTIATING:
            actions = (["accept_offer", "reject_offer", "counter"] if open_by == "owner" else []) + ["decline"]
    elif viewer.id == project.owner_id:
        if award.status == AWARD_NEGOTIATING and open_by == "builder":
            actions = ["accept_offer", "reject_offer", "counter", "cancel"]
        elif award.status == AWARD_AWAITING_BUILDER and not assigned:
            # Waiting on the builder's confirmation: no assignment yet. The owner
            # may keep negotiating while nothing is agreed, or cancel.
            actions = (["counter"] if owner_may_open_offer(award) else []) + ["cancel"]
        elif award.status == AWARD_CONFIRMED and not assigned:
            # The builder confirmed: the owner assigns explicitly, or cancels.
            actions = ["assign", "cancel"]
        elif award.status == AWARD_CONFIRMED and assigned:
            # A confirmed contract: the owner may unassign it (Assign Builder
            # tab) while unassign_blocked allows; nothing else is open.
            actions = ["unassign"]
        elif owner_may_open_offer(award):
            actions = ["counter", "cancel"]
        elif award.status in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING):
            actions = ["cancel"]
    # Work started on a pending award. Assigned: the decisions stay open except
    # releasing it (the buttons stay, disabled, with the reason). Unassigned: it
    # can no longer become an assignment, so ending the negotiation is all that is
    # left -- the work itself is never touched.
    started = (
        project_work_started_reason(database, project)
        if award.status in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING)
        or (award.status == AWARD_CONFIRMED and not assigned)
        else None
    )
    locked = bool(started) and not assigned
    if locked:
        actions = [action for action in actions if action in ("decline", "cancel")]
        action_required_by = "owner" if viewer.id == project.owner_id else None
    release_blocked_reason = release_blocked_message(started, "declined or cancelled") if started and assigned else None
    contract = get_awarded_contract(database, project) if award.status == AWARD_CONFIRMED else None

    def offer_payload(offer: AwardOffer) -> dict:
        return {
            "id": offer.id,
            "proposed_by": "owner" if offer.proposed_by_id == project.owner_id else "builder",
            "proposer_name": names.get(offer.proposed_by_id, ""),
            "amount": float(offer.amount),
            "note": offer.note or "",
            "status": offer.status,
            "created_at": offer.created_at.isoformat() if offer.created_at else None,
            "responded_at": offer.responded_at.isoformat() if offer.responded_at else None,
        }

    # Earlier rounds on this same request with this same builder -- a
    # negotiation that was cancelled or declined before this award began --
    # so its offers stay visible after a new round starts. Read-only.
    earlier_rounds = [
        {
            "award_id": earlier.id,
            "status": earlier.status,
            "agreed_amount": float(award_agreed_amount(database, earlier)),
            "ended_at": earlier.responded_at.isoformat() if earlier.responded_at else None,
            "offers": [offer_payload(offer) for offer in AwardRepository(database).list_offers(earlier.id)],
        }
        for earlier in AwardRepository(database).list_ended_request_awards(award.request_id, award.builder_id, award.id)
    ]

    return {
        "id": award.id,
        "project_id": project.id,
        "project_title": project.title,
        "project_country": project.project_country,
        "owner_id": str(project.owner_id),
        "owner_name": names[project.owner_id],
        "builder_id": str(award.builder_id),
        "builder_name": names[award.builder_id],
        "request_id": award.request_id,
        "status": award.status,
        "phase": phase,
        # Negotiation and assignment are separate: true only once the owner has
        # assigned the project to this builder (projects.contractor_id).
        "assigned": assigned,
        "viewer": "builder" if viewer.id == award.builder_id else ("owner" if viewer.id == project.owner_id else None),
        "original_budget": float(project.budget or 0),
        "original_quotation": float(request.quotation_amount or 0) if request else None,
        "agreed_amount": float(agreed),
        "agreed_offer_id": award.agreed_offer_id,
        "contract_amount": contract["contract_amount"] if contract else None,
        "open_offer": offer_payload(open_offer) if open_offer else None,
        "offers": [offer_payload(offer) for offer in offers],
        "earlier_rounds": earlier_rounds,
        "action_required_by": action_required_by,
        "actions": actions,
        "release_blocked_reason": release_blocked_reason,
        # The owner's Unassign: 'work' / 'engineer' while it is refused.
        "unassign_blocked": owner_unassign_blocked(database, award, project) if viewer.id == project.owner_id else None,
        "locked": locked,
        "locked_reason": assignment_locked_message(started) if locked else None,
        # Planned start date arrived on a pending decision: a warning only.
        "planned_start_notice": planned_start_notice(project)
        if award.status in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING) and not started
        else None,
        "created_at": award.created_at.isoformat() if award.created_at else None,
        "responded_at": award.responded_at.isoformat() if award.responded_at else None,
        "confirmed_at": award.confirmed_at.isoformat() if award.confirmed_at else None,
    }


def confirm_award(database: Session, award: ProjectAward, project: Project, user: User, amount) -> dict:
    """The builder's explicit confirmation of the final amount.

    On an unassigned award it is the prerequisite for the owner's Assign, which
    then makes the contract. On an award assigned before that order existed it
    makes the contract itself, as it always did. The caller holds the project
    and award locks and commits.
    """
    if user.id != award.builder_id or user.role != ROLE_BUILDER:
        raise HTTPException(status_code=403, detail="Only this quotation's builder can confirm it")
    if award.status == AWARD_CONFIRMED:
        raise HTTPException(status_code=409, detail="This contract has already been confirmed.")
    if award.status == AWARD_NEGOTIATING:
        raise HTTPException(status_code=409, detail="An offer is still open. Answer it before confirming the contract.")
    if award.status != AWARD_AWAITING_BUILDER:
        raise HTTPException(status_code=409, detail=f"This assignment was {award.status}.")
    # The builder confirms BEFORE the owner assigns (the project is then still
    # unassigned). An award assigned before this order existed is confirmed as
    # it always was; one whose project went to another builder is refused.
    if project.contractor_id is not None and project.contractor_id != award.builder_id:
        raise HTTPException(status_code=409, detail="This project is no longer assigned to you.")
    was_assigned = award_assigned(award, project)
    ensure_assignment_open(database, award, project)
    agreed = award_agreed_amount(database, award)
    if exact_amount(amount) != agreed:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"The agreed amount is now {money_label(agreed, project.project_country)}. Review it before confirming.",
                "agreed_amount": float(agreed),
            },
        )
    now = naive_utc_now()
    award.status = AWARD_CONFIRMED
    award.responded_at = now
    award.confirmed_at = now
    amount_text = money_label(agreed, project.project_country)
    if not was_assigned:
        # Confirmed, not assigned: no contract or escrow change yet. Those come
        # with the owner's explicit assignment (project_request_service).
        AwardRepository(database).flush()
        award_message(
            database,
            project,
            award,
            user.id,
            project.owner_id,
            f"BUILDER CONFIRMED: {user.name} confirmed the final quotation of {amount_text} for {project.title}. You can now assign the project to {user.name}.",
            "Builder confirmed quotation",
        )
        return {
            "status": AWARD_CONFIRMED,
            "award_id": award.id,
            "project_id": project.id,
            "assigned": False,
            "contract_amount": None,
            "escrow_resized": False,
            "escrow_note": None,
        }
    # The chat card shows the same state.
    pending_update_assignment_message_status(database, award.request_id, "accepted")
    AwardRepository(database).flush()
    contract = get_awarded_contract(database, project)
    escrow_resized = bool(contract) and resize_escrow_to_contract(database, project, contract["contract_amount"])
    conversation = pending_create_conversation_for_users(database, project.title, [project.owner_id, user.id])
    pending_create_conversation_message(
        database,
        conversation,
        user.id,
        f"PROJECT ASSIGNED: {user.name} accepted the assignment for {project.title}. Contract confirmed at {amount_text}.",
        "ASSIGNMENT",
    )
    create_request_notification(
        database,
        project.owner_id,
        "Project assignment accepted",
        f"{user.name} accepted the assignment for {project.title}. Contract confirmed at {amount_text}.",
        category="NEGOTIATION",
    )
    return {
        "status": AWARD_CONFIRMED,
        "award_id": award.id,
        "project_id": project.id,
        "assigned": True,
        "contract_amount": float(agreed),
        "escrow_resized": escrow_resized,
        "escrow_note": None
        if escrow_resized
        else "Escrow left unchanged: its milestones are not all pending standard stages.",
    }


def release_award(database: Session, award: ProjectAward, project: Project, user: User, outcome: str) -> dict:
    """Builder declines, or owner cancels (unassigns), an award.

    The project is released (`contractor_id` cleared) so the owner can choose
    another quotation. Budget and quotations are not touched. The caller holds
    the locks and commits.

    The owner may unassign an assigned builder -- even after the contract was
    confirmed -- until work is recorded on site or the builder has put a Site
    Engineer on the project (see owner_unassign_blocked). The builder cannot
    walk away from a confirmed, assigned contract.
    """
    party = award_party(award, project, user)
    if (outcome == AWARD_DECLINED and party != "builder") or (outcome == AWARD_CANCELLED and party != "owner"):
        raise HTTPException(status_code=403, detail="This action is not available to you")
    # A builder's confirmation is not a contract until the owner assigns, so a
    # confirmed but unassigned award may still be withdrawn or cancelled.
    if award.status == AWARD_CONFIRMED and award_assigned(award, project) and outcome == AWARD_DECLINED:
        raise HTTPException(
            status_code=409, detail="The contract is already confirmed; this assignment can no longer be declined."
        )
    if award.status not in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING, AWARD_CONFIRMED):
        raise HTTPException(status_code=409, detail=f"This assignment was already {award.status}.")
    # Releasing an ASSIGNED award would leave its builder's recorded work on a
    # project with no builder, so it is refused once work exists; nothing is
    # deleted. An unassigned negotiation holds no work and may always be ended.
    if award_assigned(award, project):
        reason = project_work_started_reason(database, project)
        if reason:
            raise HTTPException(status_code=409, detail=release_blocked_message(reason, outcome))
        # The owner cannot unassign a builder whose Site Engineer is already
        # on the project; the builder's own decline keeps its existing rule.
        if outcome == AWARD_CANCELLED and builder_site_engineer_assignments(database, project):
            raise HTTPException(
                status_code=409,
                detail="The builder has assigned a Site Engineer to this project, so the builder cannot be unassigned.",
            )
    now = naive_utc_now()
    for offer in AwardRepository(database).list_open_offers(award.id):
        offer.status = OFFER_WITHDRAWN
        offer.responded_at = now
    was_assigned = award_assigned(award, project)
    # Confirmed by the builder but never assigned: released either way, with
    # its own wording below.
    was_confirmed_unassigned = award.status == AWARD_CONFIRMED and not was_assigned
    # Confirmed AND assigned: a contract the owner is now unassigning.
    was_contract = award.status == AWARD_CONFIRMED and was_assigned
    contract_text = money_label(award_agreed_amount(database, award), project.project_country) if was_contract else None
    confirmed_text = (
        money_label(award_agreed_amount(database, award), project.project_country) if was_confirmed_unassigned else None
    )
    # A builder withdrawing a confirmation the owner never assigned is stored as
    # "cancelled", not "declined": a declined award is what bars a builder from
    # this project for good (find_declined_award_id), and withdrawing before any
    # assignment is not that. The chat message records who withdrew.
    stored_status = AWARD_CANCELLED if was_confirmed_unassigned else outcome
    award.status = stored_status
    award.responded_at = now
    # The check constraint ties confirmed_at to status = confirmed.
    award.confirmed_at = None
    # Only this award's own builder is ever unassigned, and only on this project.
    if project.contractor_id == award.builder_id:
        project.contractor_id = None
        if was_assigned:
            release_builder_site_engineers(database, project, outcome)
    # The ASSIGNMENT card exists only for an assigned award. An unassigned one
    # has none, and the newest card for this request may belong to an earlier,
    # already-ended assignment that must keep its own status.
    if was_assigned:
        pending_update_assignment_message_status(database, award.request_id, outcome)
    # The contract's escrow split goes back to the owner's budget, under the
    # same rule that resized it: only an untouched, all-pending standard set.
    if was_contract:
        AwardRepository(database).flush()
        resize_escrow_to_contract(database, project, float(project.budget or 0))
    request = AwardRepository(database).get_request(award.request_id)
    quote_text = money_label(request.quotation_amount if request else 0, project.project_country)
    if was_contract:
        award_message(
            database,
            project,
            award,
            user.id,
            award.builder_id,
            f"PROJECT UNASSIGNED: {user.name} unassigned {project.title} from you. The contract at {contract_text} is cancelled.",
            "Project unassigned",
        )
    elif was_confirmed_unassigned:
        # The builder had confirmed; the project was never assigned.
        if outcome == AWARD_DECLINED:
            award_message(
                database,
                project,
                award,
                user.id,
                project.owner_id,
                f"CONFIRMATION WITHDRAWN: {user.name} withdrew their confirmed quotation of {confirmed_text} for {project.title}. The project was not assigned. You can choose another builder.",
                "Builder withdrew confirmation",
            )
        else:
            award_message(
                database,
                project,
                award,
                user.id,
                award.builder_id,
                f"CONFIRMATION CANCELLED: {user.name} cancelled your confirmed quotation of {confirmed_text} for {project.title}. The project was not assigned to you.",
                "Confirmed quotation cancelled",
            )
    elif not was_assigned:
        # Only a negotiation ended; nothing had been assigned.
        if outcome == AWARD_DECLINED:
            award_message(
                database,
                project,
                award,
                user.id,
                project.owner_id,
                f"NEGOTIATION DECLINED: {user.name} withdrew from the negotiation for {project.title} (quotation {quote_text}). You can choose another builder.",
                "Builder withdrew from negotiation",
            )
        else:
            award_message(
                database,
                project,
                award,
                user.id,
                award.builder_id,
                f"NEGOTIATION CANCELLED: {user.name} cancelled the negotiation for {project.title} (quotation {quote_text}).",
                "Negotiation cancelled",
            )
    elif outcome == AWARD_DECLINED:
        award_message(
            database,
            project,
            award,
            user.id,
            project.owner_id,
            f"ASSIGNMENT DECLINED: {user.name} declined the assignment for {project.title} (quotation {quote_text}). You can assign another builder.",
            "Builder declined assignment",
        )
    else:
        award_message(
            database,
            project,
            award,
            user.id,
            award.builder_id,
            f"ASSIGNMENT CANCELLED: {user.name} cancelled the assignment of {project.title} (quotation {quote_text}).",
            "Assignment cancelled",
        )
    return {"status": stored_status, "award_id": award.id, "project_id": project.id}


def builder_site_engineer_assignments(database: Session, project: Project) -> list[ProjectEngineer]:
    """The ACTIVE Site Engineer assignments on this project that the builder
    made. An engineer the House Owner hired directly (an accepted
    OWNER_TO_ENGINEER request on this project) is the owner's and not counted."""
    owner_hired_ids = {
        receiver_id
        for (receiver_id,) in database.query(ProjectRequest.receiver_id)
        .filter(
            ProjectRequest.project_id == project.id,
            ProjectRequest.request_type == OWNER_ENGINEER_REQUEST_TYPE,
            ProjectRequest.status == "accepted",
        )
        .all()
    }
    assignments = (
        database.query(ProjectEngineer)
        .filter(
            ProjectEngineer.project_id == project.id,
            ProjectEngineer.status == "ACTIVE",
        )
        .all()
    )
    return [assignment for assignment in assignments if assignment.engineer_id not in owner_hired_ids]


def owner_unassign_blocked(database: Session, award: ProjectAward, project: Project) -> str | None:
    """Why the owner cannot unassign this assigned builder right now: 'work'
    (work is recorded on site) or 'engineer' (the builder has assigned a Site
    Engineer). None when unassigning is allowed or the award is not assigned."""
    if not award_assigned(award, project) or award.status not in (
        AWARD_AWAITING_BUILDER,
        AWARD_NEGOTIATING,
        AWARD_CONFIRMED,
    ):
        return None
    if project_work_started_reason(database, project):
        return "work"
    if builder_site_engineer_assignments(database, project):
        return "engineer"
    return None


def release_builder_site_engineers(database: Session, project: Project, outcome: str) -> None:
    """End the Site Engineer assignments the released builder made on this project.

    Once `contractor_id` is cleared the builder no longer has the project, so an
    engineer they put on it would stay ACTIVE on a project nobody of theirs runs
    -- shown as busy everywhere and refused for any other project. Only reached
    when an assigned, not-yet-contracted award is released, and release_award has
    already refused that once work exists on site, so no recorded work is cut
    loose. An engineer the House Owner hired directly (an accepted
    OWNER_TO_ENGINEER request on this project) is the owner's, not the
    builder's, and stays assigned. Rows are marked REMOVED, never deleted.
    """
    ended = "declined" if outcome == AWARD_DECLINED else "cancelled"
    for assignment in builder_site_engineer_assignments(database, project):
        assignment.status = "REMOVED"
        create_request_notification(
            database,
            assignment.engineer_id,
            "Project assignment removed",
            f"You have been unassigned from project {project.title} because its builder assignment was {ended}.",
            category="PROJECT",
        )


def award_assigned(award: ProjectAward, project: Project) -> bool:
    """Whether the owner has assigned the project to this award's builder.

    An award is the negotiation with one builder; the assignment is the owner's
    separate, explicit decision, recorded as `projects.contractor_id`. A
    negotiation -- even an agreed one -- leaves the project unassigned.
    """
    return project.contractor_id is not None and project.contractor_id == award.builder_id


def owner_may_open_offer(award: ProjectAward) -> bool:
    """The owner may put the first amount on the table while the assignment
    waits on the builder and nothing has been agreed yet. An amount already
    agreed is the builder's to confirm; the owner's way out is cancelling."""
    return award.status == AWARD_AWAITING_BUILDER and award.agreed_offer_id is None


def submit_award_offer(
    database: Session, award: ProjectAward, project: Project, user: User, amount, note: str | None
) -> dict:
    """A new amount on the table. Earlier offers are kept; only their status moves."""
    party = award_party(award, project, user)
    if award.status not in (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING):
        raise HTTPException(status_code=409, detail=f"This assignment is {award.status}; offers are closed.")
    ensure_assignment_open(database, award, project)
    amount = exact_amount(amount)
    note = (note or "").strip() or None
    if note and len(note) > 1000:
        raise HTTPException(status_code=400, detail="Keep the note under 1000 characters")
    current = open_award_offer(database, award.id, lock=True)
    if current and current.proposed_by_id == user.id:
        raise HTTPException(status_code=409, detail="Your previous offer is still waiting for a response.")
    if party == "builder" and award.agreed_offer_id and not award_assigned(award, project):
        raise HTTPException(
            status_code=409,
            detail="The quotation is agreed. Confirm it so the owner can assign the project, or withdraw.",
        )
    if party == "owner" and not current and not owner_may_open_offer(award):
        raise HTTPException(
            status_code=409,
            detail="The amount is already agreed. The builder confirms it, or you can cancel the assignment.",
        )
    if amount == award_agreed_amount(database, award):
        raise HTTPException(
            status_code=400, detail="That is already the agreed amount. Choose a different amount to negotiate."
        )
    now = naive_utc_now()
    if current:
        current.status = OFFER_SUPERSEDED
        current.responded_at = now
        # Written before the new open offer: one open offer per award.
        AwardRepository(database).flush()
    offer = AwardOffer(
        award_id=award.id, proposed_by_id=user.id, amount=amount, note=note, status=OFFER_OPEN, created_at=now
    )
    AwardRepository(database).add(offer)
    award.status = AWARD_NEGOTIATING
    award.responded_at = now
    AwardRepository(database).flush()
    amount_text = money_label(amount, project.project_country)
    recipient = project.owner_id if party == "builder" else award.builder_id
    award_message(
        database,
        project,
        award,
        user.id,
        recipient,
        f"COUNTER-OFFER: {user.name} proposed {amount_text} for {project.title}."
        + (f" Reason: {note}" if note else ""),
        "New counter-offer",
    )
    return {"status": AWARD_NEGOTIATING, "award_id": award.id, "offer_id": offer.id, "amount": float(amount)}


def answer_award_offer(database: Session, offer_id: uuid.UUID, user: User, decision: str, amount=None) -> dict:
    """The other side accepts or rejects an open offer. Accepting agrees the
    amount; it is still not a contract until the builder confirms it."""
    offer = AwardRepository(database).get_offer(offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    award, project = lock_award(database, offer.award_id)
    offer = AwardRepository(database).lock_offer(offer_id)
    award_party(award, project, user)
    if offer.proposed_by_id == user.id:
        raise HTTPException(status_code=403, detail="You cannot answer your own offer")
    if offer.status != OFFER_OPEN or award.status != AWARD_NEGOTIATING:
        raise HTTPException(status_code=409, detail="This offer is no longer open.")
    ensure_assignment_open(database, award, project)
    now = naive_utc_now()
    amount_text = money_label(offer.amount, project.project_country)
    if decision == "accept":
        if exact_amount(amount) != Decimal(str(offer.amount)).quantize(Decimal("0.01")):
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "This offer's amount has changed. Review it before accepting.",
                    "agreed_amount": float(offer.amount),
                },
            )
        offer.status = OFFER_ACCEPTED
        offer.responded_at = now
        award.agreed_offer_id = offer.id
        award.status = AWARD_AWAITING_BUILDER
        award.responded_at = now
        if not award_assigned(award, project):
            if user.id == project.owner_id:
                body = f"OFFER ACCEPTED: {user.name} accepted your offer of {amount_text} for {project.title}. Confirm this final quotation; {user.name} can assign the project only after you confirm."
            else:
                body = f"QUOTATION ACCEPTED: {user.name} accepted your offer of {amount_text} for {project.title}. Once {user.name} confirms the final quotation, you can assign the project."
        elif user.id == project.owner_id:
            body = f"OFFER ACCEPTED: {user.name} accepted your counter-offer of {amount_text} for {project.title}. Confirm the contract to finalize it."
        else:
            body = f"OFFER ACCEPTED: {user.name} accepted your offer of {amount_text} for {project.title}. The contract is final once {user.name} confirms it."
        award_message(database, project, award, user.id, offer.proposed_by_id, body, "Offer accepted")
    else:
        offer.status = OFFER_REJECTED
        offer.responded_at = now
        award.status = AWARD_AWAITING_BUILDER
        award.responded_at = now
        award_message(
            database,
            project,
            award,
            user.id,
            offer.proposed_by_id,
            f"OFFER REJECTED: {user.name} rejected the offer of {amount_text} for {project.title}. The agreed amount stays {money_label(award_agreed_amount(database, award), project.project_country)}.",
            "Offer rejected",
        )
    return {"status": award.status, "award_id": award.id, "offer_id": offer.id, "offer_status": offer.status}


def carry_last_agreed_amount(database: Session, award: ProjectAward) -> Decimal | None:
    """Start a new round at the amount the last round agreed.

    When an earlier round on the same request with the same builder ended
    (cancelled or withdrawn) after both sides had agreed an amount, the new
    round begins from that amount rather than the original quotation. The
    agreed offer must belong to its own award (composite FK), so the amount is
    recorded on this award as an ACCEPTED offer by whoever proposed it then,
    noted as carried over; the original exchange stays on the earlier award.
    Returns the carried amount, or None when there is nothing to carry. The
    award must already be flushed; the caller holds the locks and commits.
    """
    earlier = AwardRepository(database).find_last_agreed_ended_award(award.request_id, award.builder_id, award.id)
    if not earlier:
        return None
    agreed = AwardRepository(database).get_offer(earlier.agreed_offer_id)
    if not agreed:
        return None
    now = naive_utc_now()
    carried = AwardOffer(
        award_id=award.id,
        proposed_by_id=agreed.proposed_by_id,
        amount=agreed.amount,
        note="Agreed amount carried over from the previous round.",
        status=OFFER_ACCEPTED,
        created_at=now,
        responded_at=now,
    )
    AwardRepository(database).add(carried)
    AwardRepository(database).flush()
    award.agreed_offer_id = carried.id
    AwardRepository(database).flush()
    return Decimal(str(agreed.amount)).quantize(Decimal("0.01"))


def commit_award_change(database: Session) -> None:
    try:
        AwardRepository(database).commit()
    except IntegrityError:
        AwardRepository(database).rollback()
        raise HTTPException(status_code=409, detail="This assignment changed at the same time. Refresh and try again.")


class AwardService:
    def __init__(self, repository: AwardRepository):
        self.repository = repository
        # The module-level award helpers (shared with other domains) take a session.
        self.database = repository.database

    def fetch_project_award(self, project_id: uuid.UUID, request_id: uuid.UUID | None, user: User):
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        query = self.repository.query_project_awards(project_id)
        is_owner = user.role == ROLE_OWNER and project.owner_id == user.id
        if not is_owner:
            if user.role != ROLE_BUILDER:
                raise HTTPException(status_code=403, detail="Assignment access denied")
            # A builder sees only their own award on the project.
            query = query.filter(ProjectAward.builder_id == user.id)
        if request_id is not None:
            query = query.filter(ProjectAward.request_id == request_id)
        award = self.repository.find_active_or_latest_award(query)
        if not award and not is_owner:
            raise HTTPException(status_code=404, detail="Assignment not found")
        declined_request_ids = []
        if is_owner:
            declined_request_ids = [row[0] for row in self.repository.list_declined_award_request_ids(project_id)]
        return {
            "award": award_payload(self.database, award, user) if award else None,
            "declined_request_ids": declined_request_ids,
        }

    def confirm_project_award(self, award_id: uuid.UUID, payload: AwardAmount, user: User):
        award, project = lock_award(self.database, award_id)
        result = confirm_award(self.database, award, project, user, payload.amount)
        commit_award_change(self.database)
        return result

    def decline_project_award(self, award_id: uuid.UUID, user: User):
        award, project = lock_award(self.database, award_id)
        result = release_award(self.database, award, project, user, AWARD_DECLINED)
        commit_award_change(self.database)
        return result

    def cancel_project_award(self, award_id: uuid.UUID, user: User):
        award, project = lock_award(self.database, award_id)
        result = release_award(self.database, award, project, user, AWARD_CANCELLED)
        commit_award_change(self.database)
        return result

    def create_award_offer(self, award_id: uuid.UUID, payload: AwardOfferCreate, user: User):
        award, project = lock_award(self.database, award_id)
        result = submit_award_offer(self.database, award, project, user, payload.amount, payload.note)
        commit_award_change(self.database)
        return result

    def accept_award_offer(self, offer_id: uuid.UUID, payload: AwardAmount, user: User):
        result = answer_award_offer(self.database, offer_id, user, "accept", payload.amount)
        commit_award_change(self.database)
        return result

    def reject_award_offer(self, offer_id: uuid.UUID, user: User):
        result = answer_award_offer(self.database, offer_id, user, "reject")
        commit_award_change(self.database)
        return result


# The standard construction stages a project is opened with, in build order.
# These names and shares are the ones this application has always used to create
# a project's escrow milestones; they were three inline literals until now. Named
# here so the milestone writer below and the estimate response both read one
# definition and cannot drift apart. Values are unchanged.
CONSTRUCTION_STAGES: tuple[tuple[str, float], ...] = (
    ("Foundation", 0.25),
    ("Structure", 0.45),
    ("Finishing", 0.30),
)
