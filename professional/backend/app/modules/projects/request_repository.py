"""Project request rows (ported from the old project_request_repository.py)."""

from sqlalchemy import and_, desc, or_, text
from sqlalchemy.orm import Session, selectinload

from app.modules.identity.models import User
from app.modules.projects.access import engineers_working_on_a_project
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import (
    AWARD_ACTIVE_STATUSES,
    AWARD_DECLINED,
    Project,
    ProjectAward,
    ProjectEngineer,
    ProjectRequest,
)
from app.modules.projects.request_types import OWNER_BUILDER_REQUEST_TYPES


class ProjectRequestRepository(BaseRepository[ProjectRequest]):
    def __init__(self, database: Session):
        super().__init__(database, ProjectRequest)

    # ------------------------------------------------------------ other models
    def get_user(self, user_id):
        return self.database.get(User, user_id)

    def get_project(self, project_id):
        return self.database.get(Project, project_id)

    def lock_project(self, project_id):
        return self.database.query(Project).filter(Project.id == project_id).with_for_update().first()

    def list_self_construction_project_ids(self):
        return self.database.query(Project.id).filter(Project.construction_type == "SELF_CONSTRUCTION").all()

    # --------------------------------------------------------- project requests
    def lock_request(self, request_id):
        return self.database.query(ProjectRequest).filter(ProjectRequest.id == request_id).with_for_update().first()

    def find_existing_request(self, sender_id, receiver_id, project_id, request_type):
        return (
            self.database.query(ProjectRequest)
            .filter(
                ProjectRequest.sender_id == sender_id,
                ProjectRequest.receiver_id == receiver_id,
                ProjectRequest.project_id == project_id,
                ProjectRequest.request_type == request_type,
                ProjectRequest.status.in_(["pending", "accepted"]),
            )
            .first()
        )

    def lock_owner_builder_pair(self, namespace, pair_key):
        self.database.execute(
            text("SELECT pg_advisory_xact_lock(:namespace, hashtext(:pair_key))"),
            {
                "namespace": namespace,
                "pair_key": pair_key,
            },
        )

    def find_live_owner_builder_thread(self, project_id, user_id, receiver_id):
        return (
            self.database.query(ProjectRequest)
            .filter(
                ProjectRequest.request_type.in_(OWNER_BUILDER_REQUEST_TYPES),
                ProjectRequest.project_id == project_id,
                ProjectRequest.status.in_(["pending", "accepted"]),
                or_(
                    and_(ProjectRequest.sender_id == user_id, ProjectRequest.receiver_id == receiver_id),
                    and_(ProjectRequest.sender_id == receiver_id, ProjectRequest.receiver_id == user_id),
                ),
            )
            .first()
        )

    def find_owner_supplier_thread_id(self, owner_supplier_types, project_id, user_id, receiver_id):
        return (
            self.database.query(ProjectRequest.id)
            .filter(
                ProjectRequest.status.in_(["pending", "accepted"]),
                ProjectRequest.request_type.in_(owner_supplier_types),
                ProjectRequest.project_id == project_id,
                or_(
                    and_(ProjectRequest.sender_id == user_id, ProjectRequest.receiver_id == receiver_id),
                    and_(ProjectRequest.sender_id == receiver_id, ProjectRequest.receiver_id == user_id),
                ),
            )
            .first()
        )

    def find_accepted_supplier_contractor_id(self, supplier_contractor_types, user_id, receiver_id):
        return (
            self.database.query(ProjectRequest.id)
            .filter(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(supplier_contractor_types),
                or_(
                    and_(ProjectRequest.sender_id == user_id, ProjectRequest.receiver_id == receiver_id),
                    and_(ProjectRequest.sender_id == receiver_id, ProjectRequest.receiver_id == user_id),
                ),
            )
            .first()
        )

    def find_pending_supplier_contractor_id(self, supplier_contractor_types, user_id, receiver_id):
        return (
            self.database.query(ProjectRequest.id)
            .filter(
                ProjectRequest.status == "pending",
                ProjectRequest.request_type.in_(supplier_contractor_types),
                or_(
                    and_(ProjectRequest.sender_id == user_id, ProjectRequest.receiver_id == receiver_id),
                    and_(ProjectRequest.sender_id == receiver_id, ProjectRequest.receiver_id == user_id),
                ),
            )
            .first()
        )

    def list_requests(self, base_filter):
        return (
            self.database.query(ProjectRequest)
            .options(
                selectinload(ProjectRequest.sender).selectinload(User.owner_profile),
                selectinload(ProjectRequest.sender).selectinload(User.contractor_profile),
                selectinload(ProjectRequest.sender).selectinload(User.supplier_profile),
                selectinload(ProjectRequest.receiver).selectinload(User.owner_profile),
                selectinload(ProjectRequest.receiver).selectinload(User.contractor_profile),
                selectinload(ProjectRequest.receiver).selectinload(User.supplier_profile),
                selectinload(ProjectRequest.project),
            )
            .filter(base_filter)
            .order_by(desc(ProjectRequest.created_at))
            .all()
        )

    # --------------------------------------------------------- site engineers
    def find_active_project_engineer_id(self, project_id):
        return (
            self.database.query(ProjectEngineer.id)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_active_project_engineer(self, project_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_project_engineer(self, project_id, engineer_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
            )
            .first()
        )

    def engineers_working_on_a_project(self, engineer_ids, exclude_project_id=None) -> set:
        return engineers_working_on_a_project(self.database, engineer_ids, exclude_project_id=exclude_project_id)

    # ------------------------------------------------------------------ awards
    def find_declined_award_id(self, project_id, builder_id):
        return (
            self.database.query(ProjectAward.id)
            .filter(
                ProjectAward.project_id == project_id,
                ProjectAward.builder_id == builder_id,
                ProjectAward.status == AWARD_DECLINED,
            )
            .first()
        )

    def lock_active_award(self, project_id):
        return (
            self.database.query(ProjectAward)
            .filter(
                ProjectAward.project_id == project_id,
                ProjectAward.status.in_(AWARD_ACTIVE_STATUSES),
            )
            .populate_existing()
            .with_for_update()
            .first()
        )

    def find_active_award_for_request(self, project_id, request_id):
        return (
            self.database.query(ProjectAward)
            .filter(
                ProjectAward.project_id == project_id,
                ProjectAward.request_id == request_id,
                ProjectAward.status.in_(AWARD_ACTIVE_STATUSES),
            )
            .first()
        )
