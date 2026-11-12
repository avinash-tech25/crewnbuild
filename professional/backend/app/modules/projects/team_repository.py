"""Team, invitation and assignment rows of the engineer-team screens (ported from the
old engineer_team_repository.py)."""

import uuid

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.modules.accounts.models import EngineerProfile
from app.modules.identity.models import ROLE_ENGINEER, User
from app.modules.messaging.models import Notification
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import ContractorEngineer, EngineerInvitation, Project, ProjectEngineer, ProjectRequest
from app.modules.projects.request_types import SPECIALIST_REQUEST_TYPE


def resolve_project_country(project: object) -> str:
    return "India"


class EngineerTeamRepository(BaseRepository[ContractorEngineer]):
    def __init__(self, database: Session):
        super().__init__(database, ContractorEngineer)

    # ------------------------------------------------------------ lookups
    def get_user(self, user_id):
        return self.database.get(User, user_id)

    def get_project(self, project_id):
        return self.database.get(Project, project_id)

    # -------------------------------------------------------- invitations
    def find_invitation_id_by_code(self, code: str):
        return self.database.query(EngineerInvitation.id).filter(EngineerInvitation.invite_code == code).first()

    def count_invitations(self) -> int:
        return self.database.query(EngineerInvitation).count()

    def find_invitation_by_code(self, code: str):
        return self.database.query(EngineerInvitation).filter(EngineerInvitation.invite_code == code).first()

    def list_pending_invitations_for_contractor(self, contractor_id):
        return (
            self.database.query(EngineerInvitation)
            .filter(
                EngineerInvitation.contractor_id == contractor_id,
                EngineerInvitation.status == "PENDING",
            )
            .all()
        )

    def list_pending_invitations_newest_first(self, contractor_id):
        return (
            self.database.query(EngineerInvitation)
            .filter(EngineerInvitation.contractor_id == contractor_id, EngineerInvitation.status == "PENDING")
            .order_by(desc(EngineerInvitation.created_at))
            .all()
        )

    def find_pending_invitation(self, invitation_id, contractor_id):
        return (
            self.database.query(EngineerInvitation)
            .filter(
                EngineerInvitation.id == invitation_id,
                EngineerInvitation.contractor_id == contractor_id,
                EngineerInvitation.status == "PENDING",
            )
            .first()
        )

    # ------------------------------------------------ builder/engineer team
    def find_relationship(self, contractor_id, engineer_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(
                ContractorEngineer.contractor_id == contractor_id,
                ContractorEngineer.engineer_id == engineer_id,
            )
            .first()
        )

    def find_active_relationship(self, contractor_id, engineer_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(
                ContractorEngineer.contractor_id == contractor_id,
                ContractorEngineer.engineer_id == engineer_id,
                ContractorEngineer.status == "ACTIVE",
            )
            .first()
        )

    def list_active_team_rows(self, contractor_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(ContractorEngineer.contractor_id == contractor_id, ContractorEngineer.status == "ACTIVE")
            .order_by(desc(ContractorEngineer.created_at))
            .all()
        )

    def list_incoming_join_requests(self, contractor_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(
                ContractorEngineer.contractor_id == contractor_id,
                ContractorEngineer.status == "PENDING",
                ContractorEngineer.request_sender_role == "ENGINEER",
            )
            .order_by(desc(ContractorEngineer.created_at))
            .all()
        )

    def list_outgoing_team_requests(self, contractor_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(
                ContractorEngineer.contractor_id == contractor_id,
                ContractorEngineer.status == "PENDING",
                ContractorEngineer.request_sender_role == "CONTRACTOR",
            )
            .order_by(desc(ContractorEngineer.created_at))
            .all()
        )

    def list_team_rows_for_engineer(self, engineer_id):
        return (
            self.database.query(ContractorEngineer)
            .filter(ContractorEngineer.engineer_id == engineer_id)
            .order_by(desc(ContractorEngineer.created_at))
            .all()
        )

    # ------------------------------------------------- project assignments
    def list_active_assignments_for_engineer(self, engineer_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(ProjectEngineer.engineer_id == engineer_id, ProjectEngineer.status == "ACTIVE")
            .all()
        )

    def list_active_assignment_project_ids_for_engineer(self, engineer_id):
        return (
            self.database.query(ProjectEngineer.project_id)
            .filter(ProjectEngineer.engineer_id == engineer_id, ProjectEngineer.status == "ACTIVE")
            .all()
        )

    def list_active_assignment_project_ids(self):
        return self.database.query(ProjectEngineer.project_id).filter(ProjectEngineer.status == "ACTIVE").all()

    def list_active_engineer_project_rows(self, engineer_id):
        return (
            self.database.query(ProjectEngineer, Project)
            .join(Project, Project.id == ProjectEngineer.project_id)
            .filter(ProjectEngineer.engineer_id == engineer_id, ProjectEngineer.status == "ACTIVE")
            .order_by(desc(ProjectEngineer.created_at))
            .all()
        )

    def find_project_assignment(self, project_id, engineer_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
            )
            .first()
        )

    def find_active_project_assignment(self, project_id, engineer_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_active_assignment_for_project(self, project_id):
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    # ------------------------------------------------------------ projects
    def list_active_projects_in_country(self, use_country):
        return (
            self.database.query(Project)
            .filter(Project.project_country == use_country, Project.status == "active")
            .order_by(desc(Project.created_at))
            .all()
        )

    def list_active_projects_in_pincode(self, pincode):
        return (
            self.database.query(Project)
            .filter(Project.pincode == pincode, Project.status == "active")
            .order_by(desc(Project.created_at))
            .all()
        )

    # ------------------------------------------------- specialist requests
    def list_specialist_requests(self, project_id: uuid.UUID) -> list:
        return (
            self.database.query(ProjectRequest)
            .filter(
                ProjectRequest.project_id == project_id,
                ProjectRequest.request_type == SPECIALIST_REQUEST_TYPE,
                ProjectRequest.status.in_(["pending", "accepted"]),
            )
            .order_by(desc(ProjectRequest.created_at))
            .all()
        )

    def list_specialist_candidates(self, requested_category: str, user_id, project):
        query = (
            self.database.query(User)
            .join(EngineerProfile, EngineerProfile.user_id == User.id)
            .filter(
                User.role == ROLE_ENGINEER, EngineerProfile.specialization == requested_category, User.id != user_id
            )
        )
        # The same locality rule the rest of the application discovers people by.
        project_country = resolve_project_country(project)
        if project_country and project_country != "India":
            query = query.filter(User.country_code == project_country)
        else:
            query = query.filter(User.pincode == (project.pincode or ""))
        return query.order_by(desc(User.rating), desc(User.created_at)).all()

    # ------------------------------------------------------- notifications
    def find_application_notification(self, receiver_id, project_title: str, user_name: str):
        return (
            self.database.query(Notification.id)
            .filter(
                Notification.user_id == receiver_id,
                Notification.title == "Site Engineer application",
                Notification.body.contains(project_title),
                Notification.body.contains(user_name),
            )
            .first()
        )
