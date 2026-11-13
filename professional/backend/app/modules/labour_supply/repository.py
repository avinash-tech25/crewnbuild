"""Labour services, requests and attendance (ported from the old
labor_supply_repository.py; same reads)."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database.base import new_uuid7
from app.modules.identity.models import User
from app.modules.labour_supply.models import STATUS_ACCEPTED, STATUS_PENDING, LaborDailyRecord, LaborRequest
from app.modules.labour_supply.models import LaborService as LaborServiceRow
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import Project, ProjectSupplier

ASSIGNMENT_ACTIVE = "ACTIVE"


def active_labor_trades_by_supplier(database: Session, supplier_ids: Any) -> dict[uuid.UUID, list[str]]:
    """The trades each supplier actually offers (active labour_services), in one query."""
    ids = list({supplier_id for supplier_id in supplier_ids if supplier_id is not None})
    if not ids:
        return {}
    rows = (
        database.query(LaborServiceRow.supplier_id, LaborServiceRow.trade)
        .filter(LaborServiceRow.supplier_id.in_(ids), LaborServiceRow.is_active.is_(True))
        .order_by(LaborServiceRow.trade)
        .all()
    )
    trades: dict[uuid.UUID, list[str]] = {}
    for supplier_id, trade in rows:
        trades.setdefault(supplier_id, []).append(trade)
    return trades


class LaborSupplyRepository(BaseRepository[LaborRequest]):
    def __init__(self, database: Session) -> None:
        super().__init__(database, LaborRequest)

    def get_user(self, user_id: uuid.UUID) -> User | None:
        return self.database.get(User, user_id)

    def get_project(self, project_id: uuid.UUID) -> Project | None:
        return self.database.get(Project, project_id)

    def get_assignment(self, assignment_id: uuid.UUID) -> ProjectSupplier | None:
        return self.database.get(ProjectSupplier, assignment_id)

    # ---- services ----

    def allocated_workers(self, supplier_id: uuid.UUID, trade: str) -> int:
        """Workers deployed on ACCEPTED requests for this supplier and trade."""
        return int(
            self.database.query(func.coalesce(func.sum(LaborRequest.workers_allocated), 0))
            .filter(
                LaborRequest.supplier_id == supplier_id,
                LaborRequest.trade == trade,
                LaborRequest.status == STATUS_ACCEPTED,
            )
            .scalar()
        )

    def lock_service(self, supplier_id: uuid.UUID, trade: str) -> LaborServiceRow | None:
        return (
            self.database.query(LaborServiceRow)
            .filter(LaborServiceRow.supplier_id == supplier_id, LaborServiceRow.trade == trade)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def lock_service_by_id(self, service_id: uuid.UUID) -> LaborServiceRow | None:
        return (
            self.database.query(LaborServiceRow)
            .filter(LaborServiceRow.id == service_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def list_supplier_services(self, supplier_id: uuid.UUID) -> list[LaborServiceRow]:
        return (
            self.database.query(LaborServiceRow)
            .filter(LaborServiceRow.supplier_id == supplier_id)
            .order_by(LaborServiceRow.trade)
            .all()
        )

    def list_active_supplier_services(self, supplier_id: uuid.UUID) -> list[LaborServiceRow]:
        return (
            self.database.query(LaborServiceRow)
            .filter(LaborServiceRow.supplier_id == supplier_id, LaborServiceRow.is_active.is_(True))
            .order_by(LaborServiceRow.trade)
            .all()
        )

    def find_service_id(self, supplier_id: uuid.UUID, trade: str) -> Any:
        return (
            self.database.query(LaborServiceRow.id)
            .filter(LaborServiceRow.supplier_id == supplier_id, LaborServiceRow.trade == trade)
            .first()
        )

    def find_open_request_id_for_trade(self, supplier_id: uuid.UUID, trade: str) -> Any:
        return (
            self.database.query(LaborRequest.id)
            .filter(
                LaborRequest.supplier_id == supplier_id,
                LaborRequest.trade == trade,
                LaborRequest.status.in_([STATUS_PENDING, STATUS_ACCEPTED]),
            )
            .first()
        )

    # ---- requests ----

    def find_duplicate_pending_request_id(
        self,
        project_id: uuid.UUID,
        engineer_id: uuid.UUID,
        supplier_id: uuid.UUID,
        trade: str,
        start_date: date,
        end_date: date | None,
        exclude_id: uuid.UUID | None = None,
    ) -> Any:
        """A PENDING request identical in project, engineer, supplier, trade and dates."""
        query = self.database.query(LaborRequest.id).filter(
            LaborRequest.project_id == project_id,
            LaborRequest.engineer_id == engineer_id,
            LaborRequest.supplier_id == supplier_id,
            LaborRequest.trade == trade,
            LaborRequest.start_date == start_date,
            LaborRequest.end_date.is_(None) if end_date is None else LaborRequest.end_date == end_date,
            LaborRequest.status == STATUS_PENDING,
        )
        if exclude_id is not None:
            query = query.filter(LaborRequest.id != exclude_id)
        return query.first()

    def lock_request(self, request_id: uuid.UUID) -> LaborRequest | None:
        return (
            self.database.query(LaborRequest)
            .filter(LaborRequest.id == request_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def list_supplier_requests(self, supplier_id: uuid.UUID, status: str | None) -> list[LaborRequest]:
        query = self.database.query(LaborRequest).filter(LaborRequest.supplier_id == supplier_id)
        if status:
            query = query.filter(LaborRequest.status == status)
        return query.order_by(LaborRequest.created_at.desc(), LaborRequest.id.desc()).all()

    def list_project_requests(
        self, project_id: uuid.UUID, engineer_id: uuid.UUID | None, status: str | None
    ) -> list[LaborRequest]:
        query = self.database.query(LaborRequest).filter(LaborRequest.project_id == project_id)
        if engineer_id is not None:
            query = query.filter(LaborRequest.engineer_id == engineer_id)
        if status:
            query = query.filter(LaborRequest.status == status)
        return query.order_by(LaborRequest.created_at.desc(), LaborRequest.id.desc()).all()

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

    # ---- attendance ----

    def list_daily_records(self, request_id: uuid.UUID) -> list[LaborDailyRecord]:
        return (
            self.database.query(LaborDailyRecord)
            .filter(LaborDailyRecord.labor_request_id == request_id)
            .order_by(LaborDailyRecord.work_date.desc())
            .all()
        )

    def upsert_daily_record(
        self, request_id: uuid.UUID, work_date: date, recorded_by_id: uuid.UUID, values: dict[str, Any], now: datetime
    ) -> uuid.UUID:
        """Create or replace the one record for this request and date."""
        table = LaborDailyRecord.__table__
        statement = (
            pg_insert(table)
            .values(
                id=new_uuid7(),
                labour_request_id=request_id,
                work_on=work_date,
                recorded_by_user_id=recorded_by_id,
                created_at=now,
                updated_at=now,
                **values,
            )
            .on_conflict_do_update(
                index_elements=["labour_request_id", "work_on"],
                set_={**values, "recorded_by_user_id": recorded_by_id, "updated_at": now},
            )
            .returning(table.c.id)
        )
        return self.database.execute(statement).scalar_one()

    def get_daily_record_fresh(self, record_id: uuid.UUID) -> LaborDailyRecord | None:
        return self.database.get(LaborDailyRecord, record_id, populate_existing=True)
