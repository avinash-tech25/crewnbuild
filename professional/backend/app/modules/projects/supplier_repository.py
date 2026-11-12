"""Supplier assignment rows (ported from the old project_supplier_repository.py). A
supplier's published products come with the marketplace module (pending_links)."""

import uuid

from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session, selectinload

from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import ContractorEngineer, Project, ProjectEngineer, ProjectRequest, ProjectSupplier


class ProjectSupplierRepository(BaseRepository[ProjectSupplier]):
    def __init__(self, database: Session):
        super().__init__(database, ProjectSupplier)

    def get_user(self, user_id: uuid.UUID) -> User | None:
        return self.database.get(User, user_id)

    def get_project(self, project_id: uuid.UUID) -> Project | None:
        return self.database.get(Project, project_id)

    # ---------------------------------------------------------------- requests
    def list_accepted_contractor_supplier_requests(self, contractor_id: uuid.UUID) -> list[ProjectRequest]:
        return (
            self.database.query(ProjectRequest)
            .options(
                selectinload(ProjectRequest.sender).selectinload(User.supplier_profile),
                selectinload(ProjectRequest.receiver).selectinload(User.supplier_profile),
            )
            .filter(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(["SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER"]),
                or_(ProjectRequest.sender_id == contractor_id, ProjectRequest.receiver_id == contractor_id),
            )
            .order_by(desc(ProjectRequest.created_at))
            .all()
        )

    def find_accepted_supplier_relationship(
        self, supplier_id: uuid.UUID, contractor_id: uuid.UUID
    ) -> ProjectRequest | None:
        return (
            self.database.query(ProjectRequest)
            .filter(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(["SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER"]),
                or_(
                    and_(ProjectRequest.sender_id == supplier_id, ProjectRequest.receiver_id == contractor_id),
                    and_(ProjectRequest.sender_id == contractor_id, ProjectRequest.receiver_id == supplier_id),
                ),
            )
            .first()
        )

    def list_accepted_supplier_project_requests(self, supplier_id: uuid.UUID) -> list[ProjectRequest]:
        return (
            self.database.query(ProjectRequest)
            .options(
                selectinload(ProjectRequest.project),
                selectinload(ProjectRequest.sender),
                selectinload(ProjectRequest.receiver),
            )
            .filter(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(
                    ["OWNER_TO_SUPPLIER", "SUPPLIER_TO_OWNER", "CONTRACTOR_TO_SUPPLIER", "SUPPLIER_TO_CONTRACTOR"]
                ),
                ProjectRequest.project_id.isnot(None),
                or_(ProjectRequest.sender_id == supplier_id, ProjectRequest.receiver_id == supplier_id),
            )
            .all()
        )

    # ------------------------------------------------------------ engineers
    def find_active_team_engineer(self, contractor_id: uuid.UUID, engineer_id: uuid.UUID) -> ContractorEngineer | None:
        return (
            self.database.query(ContractorEngineer)
            .filter(
                ContractorEngineer.contractor_id == contractor_id,
                ContractorEngineer.engineer_id == engineer_id,
                ContractorEngineer.status == "ACTIVE",
            )
            .first()
        )

    def find_active_project_engineer(self, project_id: uuid.UUID, engineer_id: uuid.UUID) -> ProjectEngineer | None:
        return (
            self.database.query(ProjectEngineer)
            .filter(
                ProjectEngineer.project_id == project_id,
                ProjectEngineer.engineer_id == engineer_id,
                ProjectEngineer.status == "ACTIVE",
            )
            .first()
        )

    # ---------------------------------------------------------- assignments
    def list_active_contractor_assignments(
        self, supplier_id: uuid.UUID, contractor_id: uuid.UUID
    ) -> list[ProjectSupplier]:
        return (
            self.database.query(ProjectSupplier)
            .filter(
                ProjectSupplier.supplier_id == supplier_id,
                ProjectSupplier.contractor_id == contractor_id,
                ProjectSupplier.status == "ACTIVE",
            )
            .all()
        )

    def find_assignment(
        self, project_id: uuid.UUID, supplier_id: uuid.UUID, engineer_id: uuid.UUID
    ) -> ProjectSupplier | None:
        return (
            self.database.query(ProjectSupplier)
            .filter(
                ProjectSupplier.project_id == project_id,
                ProjectSupplier.supplier_id == supplier_id,
                ProjectSupplier.engineer_id == engineer_id,
            )
            .first()
        )

    def find_active_assignment(
        self, project_id: uuid.UUID, supplier_id: uuid.UUID, engineer_id: uuid.UUID
    ) -> ProjectSupplier | None:
        return (
            self.database.query(ProjectSupplier)
            .filter(
                ProjectSupplier.project_id == project_id,
                ProjectSupplier.supplier_id == supplier_id,
                ProjectSupplier.engineer_id == engineer_id,
                ProjectSupplier.status == "ACTIVE",
            )
            .first()
        )

    def list_active_project_assignments(
        self, project_id: uuid.UUID, engineer_only: bool, engineer_id: uuid.UUID
    ) -> list[ProjectSupplier]:
        query = self.database.query(ProjectSupplier).filter(
            ProjectSupplier.project_id == project_id,
            ProjectSupplier.status == "ACTIVE",
        )
        if engineer_only:
            query = query.filter(ProjectSupplier.engineer_id == engineer_id)
        return query.all()

    def list_active_supplier_assignments(self, supplier_id: uuid.UUID) -> list[ProjectSupplier]:
        return (
            self.database.query(ProjectSupplier)
            .options(selectinload(ProjectSupplier.project), selectinload(ProjectSupplier.contractor))
            .filter(ProjectSupplier.supplier_id == supplier_id, ProjectSupplier.status == "ACTIVE")
            .all()
        )
