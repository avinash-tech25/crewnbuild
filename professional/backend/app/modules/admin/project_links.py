"""What the admin console reads from projects and project requests (ported from the old
admin project_service.py, lead_service.py and the project parts of scope.py and the
overview, same rules and answers).

A project belongs to the country it is built in (India; a project without a country
counts as India). A request follows its project's country, else its sender's.
"""

import uuid
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Query, Session

from app.database.types import naive_utc_now
from app.modules.admin.admin_identity import account_locality
from app.modules.identity.models import User
from app.modules.projects.access import project_progress_fields
from app.modules.projects.models import Project, ProjectEngineer, ProjectRequest, ProjectTimeline
from app.modules.support.models import UserReport
from app.modules.support.report_service import describe as describe_report

INDIA = "India"
LOCALITY_INDIA = "IN"
PAIR_LABELS = {
    "OWNER_TO_CONTRACTOR": ("Owner → Builder", "Hiring"),
    "CONTRACTOR_TO_OWNER": ("Builder → Owner", "Hiring"),
    "OWNER_TO_SUPPLIER": ("Owner → Supplier", "Materials"),
    "SUPPLIER_TO_OWNER": ("Supplier → Owner", "Materials"),
    "CONTRACTOR_TO_SUPPLIER": ("Builder → Supplier", "Materials"),
    "SUPPLIER_TO_CONTRACTOR": ("Supplier → Builder", "Materials"),
    "OWNER_TO_PROFESSIONAL": ("Owner → Expert", "Expertise"),
    "PROFESSIONAL_TO_OWNER": ("Expert → Owner", "Expertise"),
    "CONTRACTOR_TO_PROFESSIONAL": ("Builder → Expert", "Expertise"),
    "PROFESSIONAL_TO_CONTRACTOR": ("Expert → Builder", "Expertise"),
}


def india_projects() -> Any:
    """project_country India, or NULL (rows written before the column existed)."""
    return or_(Project.project_country == INDIA, Project.project_country.is_(None))


def scope_projects(query: Query[Any], admin: Any) -> Query[Any]:
    """Restrict a Project query to the administrator's country."""
    if admin.is_global:
        return query
    if (admin.scope or "").strip().upper() != LOCALITY_INDIA:
        return query.filter(False)
    return query.filter(india_projects())


def project_locality(project: Project) -> str:
    return LOCALITY_INDIA


def assert_project_in_scope(project: Project, admin: Any) -> None:
    if admin.is_global:
        return
    if not admin.may_reach(project_locality(project)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This project belongs to another administrative scope"
        )


def _summary(project: Project) -> dict[str, Any]:
    return {"id": project.id, "title": project.title, "status": project.status}


def projects_owned_by(database: Session, user_id: uuid.UUID) -> list[dict[str, Any]]:
    return [_summary(project) for project in database.scalars(select(Project).where(Project.owner_id == user_id))]


def projects_built_by(database: Session, user_id: uuid.UUID) -> list[dict[str, Any]]:
    return [_summary(project) for project in database.scalars(select(Project).where(Project.contractor_id == user_id))]


def admin_projects(database: Session, admin: Any, *, limit: int, offset: int) -> dict[str, Any]:
    query = scope_projects(database.query(Project), admin)
    total = query.count()
    rows = query.order_by(Project.created_at.desc()).offset(offset).limit(limit).all()
    owner_ids = {project.owner_id for project in rows}
    owners = (
        {user.id: user for user in database.scalars(select(User).where(User.id.in_(owner_ids)))} if owner_ids else {}
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "scope": admin.scope,
        "projects": [
            {
                "id": project.id,
                "title": project.title,
                "status": project.status,
                **project_progress_fields(project),
                "project_country": project.project_country,
                "project_state": project.project_state,
                "project_city": project.project_city,
                "pincode": project.pincode,
                "owner_id": project.owner_id,
                "owner_name": owners[project.owner_id].name if project.owner_id in owners else None,
                "owner_country": owners[project.owner_id].country_code if project.owner_id in owners else None,
                "contractor_id": project.contractor_id,
                "budget": float(project.budget or 0),
                "created_at": project.created_at,
            }
            for project in rows
        ],
    }


def project_detail(database: Session, admin: Any, project_id: uuid.UUID) -> dict[str, Any] | None:
    """One project in full, or None when there is none (403 when out of scope)."""
    project = database.get(Project, project_id)
    if not project:
        return None
    assert_project_in_scope(project, admin)
    owner = database.get(User, project.owner_id)
    contractor = database.get(User, project.contractor_id) if project.contractor_id else None
    engineer_ids = list(
        database.scalars(
            select(ProjectEngineer.engineer_id).where(
                ProjectEngineer.project_id == project.id, ProjectEngineer.status == "ACTIVE"
            )
        )
    )
    engineers = list(database.scalars(select(User).where(User.id.in_(engineer_ids)))) if engineer_ids else []
    timeline = database.scalars(
        select(ProjectTimeline)
        .where(ProjectTimeline.project_id == project.id)
        .order_by(ProjectTimeline.date.desc())
        .limit(20)
    ).all()
    disputes = database.scalars(
        select(UserReport).where(UserReport.subject_type == "project", UserReport.subject_id == str(project.id))
    ).all()

    def person(user: User | None) -> dict[str, Any] | None:
        if user is None:
            return None
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "country": user.country_code,
            "status": user.status,
        }

    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "compliance_status": project.compliance_status,
        **project_progress_fields(project),
        "budget": float(project.budget or 0),
        "land_area": project.land_area,
        "floors": project.floors,
        "building_type": project.building_type,
        "construction_type": project.construction_type,
        "address": project.address,
        "pincode": project.pincode,
        "project_country": project.project_country,
        "project_state": project.project_state,
        "project_city": project.project_city,
        "created_at": project.created_at,
        "owner": person(owner),
        "contractor": person(contractor),
        "engineers": [person(engineer) for engineer in engineers],
        "timeline": [
            {
                "id": entry.id,
                "title": entry.title,
                "description": entry.description,
                "date": entry.date,
                "completion_status": entry.completion_status,
            }
            for entry in timeline
        ],
        "reports": [describe_report(database, dispute) for dispute in disputes],
    }


def marketplace_activity(
    database: Session, admin: Any, *, status: str | None, kind: str | None, limit: int, offset: int
) -> dict[str, Any]:
    """Requests visible to this administrator, with a summary over all of them."""
    statement = select(ProjectRequest)
    if status:
        statement = statement.where(ProjectRequest.status == status.strip().lower())
    if kind:
        statement = statement.where(ProjectRequest.request_type == kind.strip().upper())
    rows = database.scalars(statement.order_by(ProjectRequest.created_at.desc()).limit(600)).all()
    participant_ids = {row.sender_id for row in rows} | {row.receiver_id for row in rows}
    people = (
        {user.id: user for user in database.scalars(select(User).where(User.id.in_(participant_ids)))}
        if participant_ids
        else {}
    )
    project_ids = {row.project_id for row in rows if row.project_id}
    projects = (
        {project.id: project for project in database.scalars(select(Project).where(Project.id.in_(project_ids)))}
        if project_ids
        else {}
    )
    now = naive_utc_now()
    in_scope: list[dict[str, Any]] = []
    counts = {"pending": 0, "accepted": 0, "rejected": 0, "withdrawn": 0}
    for row in rows:
        project = projects.get(row.project_id) if row.project_id else None
        sender, receiver = people.get(row.sender_id), people.get(row.receiver_id)
        # A request follows its project's country, else its sender's.
        scope = project_locality(project) if project is not None else (account_locality(sender) if sender else "")
        if not admin.is_global and scope != admin.scope:
            continue
        direction, category = PAIR_LABELS.get(row.request_type, (row.request_type, "Other"))
        age_days = (now - row.created_at).days if row.created_at else None
        counts[row.status] = counts.get(row.status, 0) + 1
        in_scope.append(
            {
                "id": row.id,
                "direction": direction,
                "category": category,
                "request_type": row.request_type,
                "status": row.status,
                "scope": scope,
                "from_name": sender.name if sender else None,
                "from_role": sender.role if sender else None,
                "to_name": receiver.name if receiver else None,
                "to_role": receiver.role if receiver else None,
                "project_id": row.project_id,
                "project_title": project.title if project else None,
                "project_country": project.project_country if project else None,
                "quotation_amount": float(row.quotation_amount) if row.quotation_amount else None,
                "created_at": row.created_at,
                "age_days": age_days,
                "stalled": row.status == "pending" and (age_days or 0) >= 7,
            }
        )
    accepted = counts.get("accepted", 0)
    decided = accepted + counts.get("rejected", 0)
    return {
        "scope": admin.scope,
        "total": len(in_scope),
        "limit": limit,
        "offset": offset,
        "summary": {
            "pending": counts.get("pending", 0),
            "accepted": accepted,
            "rejected": counts.get("rejected", 0),
            "withdrawn": counts.get("withdrawn", 0),
            "stalled": sum(1 for row in in_scope if row["stalled"]),
            "acceptance_rate": round(accepted / decided * 100) if decided else None,
        },
        "requests": in_scope[offset : offset + limit],
    }


def stalled_request_count(database: Session, admin: Any, stalled_after_days: int) -> int:
    """Pending requests on in-scope projects nobody has answered for the threshold."""
    project_ids = [row[0] for row in scope_projects(database.query(Project.id), admin).all()]
    if not project_ids:
        return 0
    stale_before = naive_utc_now() - timedelta(days=stalled_after_days)
    return (
        database.scalar(
            select(func.count(ProjectRequest.id)).where(
                ProjectRequest.status == "pending",
                ProjectRequest.created_at < stale_before,
                ProjectRequest.project_id.in_(project_ids),
            )
        )
        or 0
    )


def project_count(database: Session, country: str) -> int:
    """Projects being built in this country."""
    condition = india_projects() if country == INDIA else Project.project_country == country
    return database.scalar(select(func.count(Project.id)).where(condition)) or 0
