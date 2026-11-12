"""Project rows the project screens read (ported from the old project_repository.py)."""

import uuid

from sqlalchemy import desc
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models import BuilderProfile as ContractorProfile
from app.modules.accounts.models import SupplierProfile
from app.modules.files.models import File
from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import (
    Project,
    ProjectAward,
    ProjectEngineer,
    ProjectImage,
    ProjectRequest,
    ProjectTimeline,
)
from app.modules.projects.pending_links import pending_has_cost_register


class ProjectRepository(BaseRepository[Project]):
    def __init__(self, database: Session):
        super().__init__(database, Project)

    # ------------------------------------------------------------ access checks
    def find_active_engineer_assignment_id(self, project_id: uuid.UUID, engineer_id: uuid.UUID):
        return (
            self.database.query(ProjectEngineer.id)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_awarded_project_id(self, project_id: uuid.UUID, contractor_id: uuid.UUID):
        return (
            self.database.query(Project.id)
            .filter(
                Project.id == project_id,
                Project.contractor_id == contractor_id,
            )
            .first()
        )

    # ----------------------------------------------------------------- projects
    def find_latest_owner_project(self, owner_id: uuid.UUID, pincode: str | None = None) -> Project | None:
        query = self.database.query(Project).filter(Project.owner_id == owner_id)
        if pincode:
            query = query.filter(Project.pincode == pincode)
        return query.order_by(desc(Project.created_at)).first()

    def find_owner_project_id(self, owner_id: uuid.UUID):
        return self.database.query(Project.id).filter(Project.owner_id == owner_id).first()

    def list_visible_projects(
        self, owner_only: bool, contractor_only: bool, user_id: uuid.UUID, pincode: str | None
    ) -> list[Project]:
        query = (
            self.database.query(Project)
            .options(selectinload(Project.escrow_milestones), selectinload(Project.contractor))
            .order_by(desc(Project.created_at))
        )
        if owner_only:
            query = query.filter(Project.owner_id == user_id)
        elif contractor_only:
            query = query.filter(
                Project.construction_type != "SELF_CONSTRUCTION",
                Project.contractor_id == user_id,
            )
        else:
            query = query.filter(Project.pincode == pincode)
        return query.all()

    def find_project_with_timelines(self, project_id: uuid.UUID) -> Project | None:
        return (
            self.database.query(Project)
            .options(
                selectinload(Project.timelines).selectinload(ProjectTimeline.images),
                selectinload(Project.escrow_milestones),
            )
            .filter(Project.id == project_id)
            .first()
        )

    # -------------------------------------------------------------------- users
    def list_nearby_suppliers(self, pincode: str) -> list[User]:
        return (
            self.database.query(User)
            .join(SupplierProfile, SupplierProfile.user_id == User.id)
            .filter(User.pincode == pincode)
            .all()
        )

    def list_nearby_contractors(self, pincode: str) -> list[User]:
        return (
            self.database.query(User)
            .join(ContractorProfile, ContractorProfile.user_id == User.id)
            .filter(User.pincode == pincode)
            .all()
        )

    def list_user_names(self, user_ids):
        return self.database.query(User.id, User.name).filter(User.id.in_(user_ids)).all()

    # ------------------------------------------------------- deletion blockers
    def find_active_project_engineer_id(self, project_id: uuid.UUID):
        return (
            self.database.query(ProjectEngineer.id)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_accepted_contractor_request_id(self, project_id: uuid.UUID):
        """An accepted builder request that still commits the project.

        Ending a negotiation or assignment (its project award cancelled or
        declined) never changes the request, which keeps "accepted". So a
        request whose latest award has ended no longer counts. One with no
        award yet, or with a live or confirmed one, still does.
        """
        request_ids = (
            self.database.query(ProjectRequest.id)
            .filter(
                ProjectRequest.project_id == project_id,
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(["OWNER_TO_CONTRACTOR", "CONTRACTOR_TO_OWNER"]),
            )
            .order_by(ProjectRequest.created_at, ProjectRequest.id)
            .all()
        )
        for (request_id,) in request_ids:
            latest_award = (
                self.database.query(ProjectAward.status)
                .filter(
                    ProjectAward.request_id == request_id,
                )
                .order_by(desc(ProjectAward.created_at), desc(ProjectAward.id))
                .first()
            )
            if latest_award is None or latest_award.status not in ("cancelled", "declined"):
                return request_id
        return None

    def find_cost_register_id(self, project_id: uuid.UUID):
        return pending_has_cost_register(self.database, project_id) or None

    # ------------------------------------------------------- photos / timeline
    def list_project_images(self, project_id: uuid.UUID) -> list[ProjectImage]:
        return (
            self.database.query(ProjectImage)
            .options(selectinload(ProjectImage.timeline))
            .filter(ProjectImage.project_id == project_id)
            .order_by(desc(ProjectImage.created_at), desc(ProjectImage.id))
            .all()
        )

    def get_image(self, photo_id: uuid.UUID) -> ProjectImage | None:
        return self.database.get(ProjectImage, photo_id)

    def get_timeline(self, timeline_id: uuid.UUID) -> ProjectTimeline | None:
        return self.database.get(ProjectTimeline, timeline_id)

    def get_uploaded_file(self, file_id: uuid.UUID) -> File | None:
        return self.database.get(File, file_id)

    def list_timeline_entries(self, project_id: uuid.UUID) -> list[ProjectTimeline]:
        return (
            self.database.query(ProjectTimeline)
            .options(selectinload(ProjectTimeline.images), selectinload(ProjectTimeline.created_by))
            .filter(ProjectTimeline.project_id == project_id)
            .order_by(desc(ProjectTimeline.date), desc(ProjectTimeline.id))
            .all()
        )
