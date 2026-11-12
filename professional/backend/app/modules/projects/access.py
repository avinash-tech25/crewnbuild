"""Who may read or change a project (ported from the old access_control.py,
progress_service.py and engineer_availability.py, same rules and answers).

A project's members are its House Owner, its awarded builder (projects.builder_id, the
`contractor_id` attribute) and its actively assigned Site Engineer. An accepted request
is a shortlisted quotation, not an award, and opens nothing.

Roles: the stored builder role is BUILDER (the old CONTRACTOR); ensure_role still names
the old role in its refusal, as before.
"""

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.local_time import local_workflow_now
from app.modules.accounts.profile_completion import is_store_manager, profile_complete
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.projects.models import ContractorEngineer, Project, ProjectEngineer

# The old role names the refusal texts and the ensure_role calls use.
LEGACY_ROLE = {"CONTRACTOR": ROLE_BUILDER}
PROFILE_INCOMPLETE_MESSAGE = "Complete your profile before you continue."
ENGINEER_ALREADY_WORKING_DETAIL = "This Site Engineer is already working on a project."
PROJECT_ALREADY_HAS_ENGINEER_DETAIL = "This project already has an assigned site engineer"


def ensure_role(user: User, role: str) -> None:
    if user.role != LEGACY_ROLE.get(role, role):
        raise HTTPException(status_code=403, detail=f"{role} role required")


def require_complete_profile(user: User) -> None:
    """Request actions need a finished profile, the rule login and the meter use."""
    if not profile_complete(user):
        raise HTTPException(status_code=403, detail=PROFILE_INCOMPLETE_MESSAGE)


def get_project(database: Session, project_id: uuid.UUID) -> Project | None:
    return database.get(Project, project_id)


def engineer_has_project_access(database: Session, project_id: uuid.UUID, engineer_id: uuid.UUID) -> bool:
    return (
        database.scalars(
            select(ProjectEngineer.id).where(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
                ProjectEngineer.status == "ACTIVE",
            )
        ).first()
        is not None
    )


def store_manager_serves_project(database: Session, store_manager: User, project: Project) -> bool:
    """A Store Manager serves the projects of the builders whose team they are on."""
    if not is_store_manager(store_manager) or not project.contractor_id:
        return False
    return (
        database.scalars(
            select(ContractorEngineer.id).where(
                ContractorEngineer.contractor_id == project.contractor_id,
                ContractorEngineer.engineer_id == store_manager.id,
                ContractorEngineer.status == "ACTIVE",
            )
        ).first()
        is not None
    )


def contractor_has_project_access(database: Session, project_id: uuid.UUID, contractor_id: uuid.UUID) -> bool:
    """The builder the owner awarded the project to, and nobody else."""
    return (
        database.scalars(
            select(Project.id).where(Project.id == project_id, Project.contractor_id == contractor_id)
        ).first()
        is not None
    )


def ensure_contractor_project_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    ensure_role(user, "CONTRACTOR")
    project = get_project(database, project_id)
    if not project or (
        project.contractor_id != user.id and not contractor_has_project_access(database, project_id, user.id)
    ):
        raise HTTPException(status_code=403, detail="Only assigned builder can manage this project")
    return project


def ensure_project_activity_read_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    project = get_project(database, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role == ROLE_OWNER and project.owner_id == user.id:
        return project
    if user.role == ROLE_ENGINEER and engineer_has_project_access(database, project_id, user.id):
        return project
    if user.role == ROLE_BUILDER and (
        project.contractor_id == user.id or contractor_has_project_access(database, project_id, user.id)
    ):
        return project
    raise HTTPException(status_code=403, detail="Project activity access denied")


def ensure_engineer_project_write_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    if user.role != ROLE_ENGINEER or not engineer_has_project_access(database, project_id, user.id):
        raise HTTPException(
            status_code=403, detail="Only an actively assigned Site Engineer can update project activity"
        )
    project = get_project(database, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def ensure_project_cost_read_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    """The project's cost records and financial summary: the awarded builder and the
    actively assigned Site Engineer only; the House Owner is refused on every project."""
    project = ensure_project_activity_read_access(database, project_id, user)
    if user.role == ROLE_OWNER:
        raise HTTPException(
            status_code=403,
            detail="Project cost records are available to the builder and the assigned Site Engineer only",
        )
    return project


def ensure_project_owner_analysis_access(database: Session, project_id: uuid.UUID, user: User) -> Project:
    """The House Owner's restricted Project Analysis: the owner of this project only."""
    ensure_role(user, "OWNER")
    project = get_project(database, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="You can only view the analysis of your own project")
    return project


def resolve_project_contractor(database: Session, project: Project, engineer_id: uuid.UUID) -> uuid.UUID | None:
    """The party an engineer's project records belong to: the awarded builder, or the
    owner of a self-construction project (which has no builder)."""
    if project.contractor_id:
        return project.contractor_id
    if project.construction_type == "SELF_CONSTRUCTION" and project.owner_id:
        return project.owner_id
    return None


def is_project_member(database: Session, project: Project, user: User) -> bool:
    """The House Owner, the awarded builder or an actively assigned engineer."""
    if user.id in (project.owner_id, project.contractor_id):
        return True
    return engineer_has_project_access(database, project.id, user.id)


# ---- progress (nothing stored) ----

COMPLETION_UNAVAILABLE = "unavailable"
SCHEDULE_DATES_MISSING = "dates_missing"
SCHEDULE_DATES_INVALID = "dates_invalid"
SCHEDULE_NOT_STARTED = "not_started"
SCHEDULE_IN_PROGRESS = "in_progress"
SCHEDULE_END_DATE_PASSED = "end_date_passed"


def round_percent(value: Decimal) -> float:
    clamped = min(Decimal(100), max(Decimal(0), value))
    return float(clamped.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def schedule_progress(start_date: date | None, end_date: date | None, today: date) -> dict[str, Any]:
    """Share of the planned duration elapsed, whole days, both ends inclusive."""
    empty = {"schedule_progress_percentage": None, "schedule_elapsed_days": None, "schedule_total_days": None}
    if start_date is None or end_date is None:
        return {"schedule_status": SCHEDULE_DATES_MISSING, **empty}
    if end_date < start_date:
        return {"schedule_status": SCHEDULE_DATES_INVALID, **empty}
    total_days = (end_date - start_date).days + 1
    if today < start_date:
        return {
            "schedule_status": SCHEDULE_NOT_STARTED,
            "schedule_progress_percentage": 0.0,
            "schedule_elapsed_days": 0,
            "schedule_total_days": total_days,
        }
    elapsed_days = min((today - start_date).days + 1, total_days)
    return {
        "schedule_status": SCHEDULE_END_DATE_PASSED if today > end_date else SCHEDULE_IN_PROGRESS,
        "schedule_progress_percentage": round_percent(Decimal(elapsed_days) * 100 / Decimal(total_days)),
        "schedule_elapsed_days": elapsed_days,
        "schedule_total_days": total_days,
    }


def project_progress_fields(project: Project, today: date | None = None) -> dict[str, Any]:
    """Construction completion is unavailable (no verified quantities yet); the schedule
    fields come from the project's own dates."""
    today = today or local_workflow_now().date()
    return {
        "completion_percentage": None,
        "completion_basis": COMPLETION_UNAVAILABLE,
        **schedule_progress(project.start_date, project.end_date, today),
    }


# ---- one Site Engineer per project, one project per Site Engineer ----


def _working_assignment_filters() -> tuple[Any, ...]:
    # An ACTIVE assignment on a project still running: not completed, not at 100%,
    # not past its end date.
    return (
        ProjectEngineer.status == "ACTIVE",
        func.lower(func.coalesce(Project.status, "")) != "completed",
        func.coalesce(Project.completion_percentage, 0) < 100,
        or_(Project.end_date.is_(None), Project.end_date >= date.today()),
    )


def engineers_working_on_a_project(
    database: Session, engineer_ids: Any, exclude_project_id: uuid.UUID | None = None
) -> set[uuid.UUID]:
    engineer_ids = [engineer_id for engineer_id in engineer_ids if engineer_id]
    if not engineer_ids:
        return set()
    statement = (
        select(ProjectEngineer.engineer_id)
        .join(Project, Project.id == ProjectEngineer.project_id)
        .where(ProjectEngineer.engineer_id.in_(engineer_ids), *_working_assignment_filters())
    )
    if exclude_project_id:
        statement = statement.where(ProjectEngineer.project_id != exclude_project_id)
    return set(database.scalars(statement.distinct()).all())


def working_project_ids_for_engineer(database: Session, engineer_id: uuid.UUID) -> list[uuid.UUID]:
    statement = (
        select(ProjectEngineer.project_id)
        .join(Project, Project.id == ProjectEngineer.project_id)
        .where(ProjectEngineer.engineer_id == engineer_id, *_working_assignment_filters())
        .distinct()
    )
    return list(database.scalars(statement).all())


def lock_assignment_targets(database: Session, project_id: uuid.UUID, engineer_id: uuid.UUID) -> None:
    """Row-lock the project, then the engineer, for the rest of the transaction."""
    database.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    database.execute(select(User.id).where(User.id == engineer_id).with_for_update())


def ensure_engineer_can_take_project(database: Session, project: Project, engineer_id: uuid.UUID) -> None:
    """409 for an assignment that would break one engineer per project / one project
    per engineer. Re-activating the engineer's own row here is allowed."""
    lock_assignment_targets(database, project.id, engineer_id)
    other_holder = database.scalars(
        select(ProjectEngineer.id).where(
            ProjectEngineer.project_id == project.id,
            ProjectEngineer.status == "ACTIVE",
            ProjectEngineer.engineer_id != engineer_id,
        )
    ).first()
    if other_holder:
        raise HTTPException(status_code=409, detail=PROJECT_ALREADY_HAS_ENGINEER_DETAIL)
    if engineers_working_on_a_project(database, [engineer_id], exclude_project_id=project.id):
        raise HTTPException(status_code=409, detail=ENGINEER_ALREADY_WORKING_DETAIL)
