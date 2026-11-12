"""What the file route asks the projects module (ported from the old file_service /
file_repository project rules, same answers).

    a project's cover          shown wherever the owner's project is shown
    a site photo or video      the project's House Owner, awarded builder and actively
                               assigned Site Engineer (the builder's photos plan rule is
                               billing's and allows everything until it is ported)
    a team engineer's files    the builder whose team the engineer is ACTIVE on
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.projects.access import contractor_has_project_access, engineer_has_project_access
from app.modules.projects.daily_window import daily_record_is_open
from app.modules.projects.models import ContractorEngineer, Project, ProjectImage, ProjectTimeline
from app.modules.projects.pending_links import BUILDER_PHOTOS, pending_project_feature_allowed


def address(file_id: uuid.UUID) -> str:
    return f"/files/{file_id}"


def is_project_cover_image(database: Session, owner_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    return (
        database.scalars(
            select(Project.id).where(Project.owner_id == owner_id, Project.cover_image_url.contains(address(file_id)))
        ).first()
        is not None
    )


def site_media_project_id(database: Session, file_id: uuid.UUID) -> uuid.UUID | None:
    """The project a site photo or video belongs to (project_photos), or None."""
    return database.scalars(select(ProjectImage.project_id).where(ProjectImage.image_url == address(file_id))).first()


def project_media_visible(database: Session, user: User, file_id: uuid.UUID) -> bool:
    project_id = site_media_project_id(database, file_id)
    if project_id is None:
        return False
    project = database.get(Project, project_id)
    if not project:
        return False
    # The builder's photos tool: a builder without it, or the owner while the project's
    # builder's access is paused, is refused.
    if user.role in (ROLE_BUILDER, ROLE_OWNER) and not pending_project_feature_allowed(
        database, user, project, BUILDER_PHOTOS
    ):
        return False
    if user.role == ROLE_OWNER and project.owner_id == user.id:
        return True
    if user.role == ROLE_BUILDER and (
        project.contractor_id == user.id or contractor_has_project_access(database, project.id, user.id)
    ):
        return True
    return user.role == ROLE_ENGINEER and engineer_has_project_access(database, project.id, user.id)


def engineer_site_photo_paused(database: Session, user: User, file_id: uuid.UUID) -> bool:
    """A Site Engineer's site photo of a closed day while the project's builder's photo
    access is paused (never while billing is not ported)."""
    if user.role != ROLE_ENGINEER:
        return False
    found = database.execute(
        select(ProjectImage.project_id, ProjectTimeline.date)
        .outerjoin(ProjectTimeline, ProjectTimeline.id == ProjectImage.timeline_id)
        .where(ProjectImage.image_url == address(file_id))
    ).first()
    if found is None:
        return False
    project_id, work_date = found
    if pending_project_feature_allowed(database, user, database.get(Project, project_id), BUILDER_PHOTOS):
        return False
    return not (isinstance(work_date, datetime) and daily_record_is_open(work_date.date()))


def has_active_team_link(database: Session, builder_id: uuid.UUID, engineer_id: uuid.UUID) -> bool:
    return (
        database.scalars(
            select(ContractorEngineer.id).where(
                ContractorEngineer.contractor_id == builder_id,
                ContractorEngineer.engineer_id == engineer_id,
                ContractorEngineer.status == "ACTIVE",
            )
        ).first()
        is not None
    )
