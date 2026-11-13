"""Equipment listings, requests and usage logs (ported from the old
equipment_supply_repository.py; same reads)."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database.base import new_uuid7
from app.modules.equipment_supply.models import (
    KIND_RENT,
    STATUS_ACCEPTED,
    EquipmentItem,
    EquipmentRequest,
    EquipmentUsageLog,
)
from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import Project, ProjectSupplier

ASSIGNMENT_ACTIVE = "ACTIVE"


class EquipmentSupplyRepository(BaseRepository[EquipmentRequest]):
    def __init__(self, database: Session) -> None:
        super().__init__(database, EquipmentRequest)

    # ---- lookups ----

    def get_user(self, user_id: uuid.UUID) -> User | None:
        return self.database.get(User, user_id)

    def get_project(self, project_id: uuid.UUID) -> Project | None:
        return self.database.get(Project, project_id)

    def get_item(self, item_id: uuid.UUID) -> EquipmentItem | None:
        return self.database.get(EquipmentItem, item_id)

    def get_request(self, request_id: uuid.UUID) -> EquipmentRequest | None:
        return self.database.get(EquipmentRequest, request_id)

    def get_assignment(self, assignment_id: uuid.UUID) -> ProjectSupplier | None:
        return self.database.get(ProjectSupplier, assignment_id)

    def get_usage_log(self, log_id: uuid.UUID) -> EquipmentUsageLog | None:
        return self.database.get(EquipmentUsageLog, log_id, populate_existing=True)

    # ---- row locks ----

    def lock_item(self, item_id: uuid.UUID) -> EquipmentItem | None:
        return (
            self.database.query(EquipmentItem)
            .filter(EquipmentItem.id == item_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def lock_request(self, request_id: uuid.UUID) -> EquipmentRequest | None:
        return (
            self.database.query(EquipmentRequest)
            .filter(EquipmentRequest.id == request_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    # ---- listings ----

    def list_supplier_items(self, supplier_id: uuid.UUID) -> list[EquipmentItem]:
        return (
            self.database.query(EquipmentItem)
            .filter(EquipmentItem.supplier_id == supplier_id)
            .order_by(EquipmentItem.is_active.desc(), EquipmentItem.category, EquipmentItem.name)
            .all()
        )

    def list_active_supplier_items(self, supplier_id: uuid.UUID) -> list[EquipmentItem]:
        return (
            self.database.query(EquipmentItem)
            .filter(EquipmentItem.supplier_id == supplier_id, EquipmentItem.is_active.is_(True))
            .order_by(EquipmentItem.category, EquipmentItem.name)
            .all()
        )

    def list_accepted_rentals(self, item_id: uuid.UUID) -> list[EquipmentRequest]:
        return (
            self.database.query(EquipmentRequest)
            .filter(
                EquipmentRequest.equipment_item_id == item_id,
                EquipmentRequest.request_kind == KIND_RENT,
                EquipmentRequest.status == STATUS_ACCEPTED,
            )
            .all()
        )

    # ---- requests ----

    def list_supplier_requests(self, supplier_id: uuid.UUID, status: str | None) -> list[EquipmentRequest]:
        query = self.database.query(EquipmentRequest).filter(EquipmentRequest.supplier_id == supplier_id)
        if status:
            query = query.filter(EquipmentRequest.status == status)
        return query.order_by(EquipmentRequest.created_at.desc(), EquipmentRequest.id.desc()).all()

    def list_project_requests(
        self, project_id: uuid.UUID, engineer_id: uuid.UUID | None, status: str | None
    ) -> list[EquipmentRequest]:
        """Every request on the project, or only one engineer's."""
        query = self.database.query(EquipmentRequest).filter(EquipmentRequest.project_id == project_id)
        if engineer_id is not None:
            query = query.filter(EquipmentRequest.engineer_id == engineer_id)
        if status:
            query = query.filter(EquipmentRequest.status == status)
        return query.order_by(EquipmentRequest.created_at.desc(), EquipmentRequest.id.desc()).all()

    # ---- assignments ----

    def find_active_assignment(
        self, project_id: uuid.UUID, supplier_id: uuid.UUID, engineer_id: uuid.UUID
    ) -> ProjectSupplier | None:
        return (
            self.database.query(ProjectSupplier)
            .filter(
                ProjectSupplier.project_id == project_id,
                ProjectSupplier.supplier_id == supplier_id,
                ProjectSupplier.engineer_id == engineer_id,
                ProjectSupplier.status == ASSIGNMENT_ACTIVE,
            )
            .first()
        )

    def find_any_active_assignment_id(self, project_id: uuid.UUID, supplier_id: uuid.UUID) -> Any:
        return (
            self.database.query(ProjectSupplier.id)
            .filter(
                ProjectSupplier.project_id == project_id,
                ProjectSupplier.supplier_id == supplier_id,
                ProjectSupplier.status == ASSIGNMENT_ACTIVE,
            )
            .first()
        )

    # ---- usage logs ----

    def list_usage_logs(self, request_id: uuid.UUID) -> list[EquipmentUsageLog]:
        return (
            self.database.query(EquipmentUsageLog)
            .filter(EquipmentUsageLog.equipment_request_id == request_id)
            .order_by(EquipmentUsageLog.usage_date.desc())
            .all()
        )

    def upsert_usage_log(
        self, request_id: uuid.UUID, usage_date: date, recorded_by_id: uuid.UUID, values: dict[str, Any], now: datetime
    ) -> uuid.UUID:
        """Create or replace the one usage row for this rental and date; returns its id."""
        table = EquipmentUsageLog.__table__
        statement = (
            pg_insert(table)
            .values(
                id=new_uuid7(),
                equipment_request_id=request_id,
                usage_on=usage_date,
                recorded_by_user_id=recorded_by_id,
                created_at=now,
                updated_at=now,
                **values,
            )
            .on_conflict_do_update(
                index_elements=["equipment_request_id", "usage_on"],
                set_={**values, "recorded_by_user_id": recorded_by_id, "updated_at": now},
            )
            .returning(table.c.id)
        )
        return self.database.execute(statement).scalar_one()
