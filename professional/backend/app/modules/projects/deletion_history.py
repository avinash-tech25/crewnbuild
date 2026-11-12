"""The project rows that keep an account from being deleted (ported from the old
self_deletion_service.shared_projects and the purge_repository history queries, the
projects part). Other modules' rows (daily registers, stock, labour and equipment,
material and store requests) are added by accounts/deletion_blockers.py.
"""

import uuid
from typing import Any

from sqlalchemy import Select, or_, select, union
from sqlalchemy.orm import Session

from app.modules.projects.models import (
    AwardOffer,
    Project,
    ProjectAward,
    ProjectEngineer,
    ProjectRequest,
    ProjectSupplier,
)


def shared_project_titles(database: Session, user_id: uuid.UUID) -> list[str]:
    """Projects this account owns that another account (a builder) is working on."""
    return list(
        database.scalars(
            select(Project.title).where(
                Project.owner_id == user_id, Project.contractor_id.isnot(None), Project.contractor_id != user_id
            )
        ).all()
    )


def builder_history_project_ids(user_id: uuid.UUID) -> list[Select[Any]]:
    """Projects holding this builder's history: the award itself, awards and offers,
    requests, and supplier assignments."""
    return [
        select(Project.id).where(Project.contractor_id == user_id),
        select(ProjectAward.project_id).where(ProjectAward.builder_id == user_id),
        select(ProjectAward.project_id)
        .join(AwardOffer, AwardOffer.award_id == ProjectAward.id)
        .where(AwardOffer.proposed_by_id == user_id),
        select(ProjectRequest.project_id).where(
            ProjectRequest.project_id.isnot(None),
            or_(ProjectRequest.sender_id == user_id, ProjectRequest.receiver_id == user_id),
        ),
        select(ProjectSupplier.project_id).where(ProjectSupplier.contractor_id == user_id),
    ]


def supplier_history_project_ids(user_id: uuid.UUID) -> list[Select[Any]]:
    """ACTIVE supplier assignments naming this supplier."""
    return [
        select(ProjectSupplier.project_id).where(
            ProjectSupplier.supplier_id == user_id, ProjectSupplier.status == "ACTIVE"
        )
    ]


def engineer_history_project_ids(user_id: uuid.UUID) -> list[Select[Any]]:
    """ACTIVE supplier assignments naming this engineer, and the live staffing link."""
    return [
        select(ProjectSupplier.project_id).where(
            ProjectSupplier.engineer_id == user_id, ProjectSupplier.status == "ACTIVE"
        ),
        select(ProjectEngineer.project_id).where(
            ProjectEngineer.engineer_id == user_id, ProjectEngineer.status == "ACTIVE"
        ),
    ]


def other_owners_project_titles(
    database: Session, user_id: uuid.UUID, sources: list[Select[Any]], extra_ids: list[uuid.UUID], limit: int = 5
) -> list[str]:
    """Titles of the projects named by `sources` (and `extra_ids`) that someone else owns,
    oldest first, at most `limit`."""
    ids = union(*sources).subquery() if sources else None
    conditions = []
    if ids is not None:
        conditions.append(Project.id.in_(select(ids.c[0])))
    if extra_ids:
        conditions.append(Project.id.in_(extra_ids))
    if not conditions:
        return []
    return list(
        database.scalars(
            select(Project.title)
            .where(or_(*conditions), Project.owner_id != user_id)
            .order_by(Project.created_at, Project.id)
            .limit(limit)
        ).all()
    )
