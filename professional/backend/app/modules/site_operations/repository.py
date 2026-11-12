"""Daily records and their rows (ported from the old daily_cost_repository.py)."""

import uuid
from datetime import date as date_value
from datetime import datetime, time

from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import Project, ProjectTimeline
from app.modules.site_operations.models import (
    CostExpense,
    CostLabourEntry,
    CostMachineryUsage,
    CostMaterialInventory,
    CostMaterialPurchase,
    CostMaterialUsage,
    CostPayment,
    CostSupplier,
    CostWorker,
    DailyCostRegister,
)


class DailyCostRepository(BaseRepository[DailyCostRegister]):
    def __init__(self, database: Session):
        super().__init__(database, DailyCostRegister)

    # ------------------------------------------------------------ daily registers
    def list_expired_registers(self, project_id: uuid.UUID, today: date_value) -> list[DailyCostRegister]:
        return (
            self.database.query(DailyCostRegister)
            .filter(
                DailyCostRegister.project_id == project_id,
                or_(DailyCostRegister.work_date < today, DailyCostRegister.status == "COMPLETED"),
                DailyCostRegister.status != "CLOSED",
            )
            .all()
        )

    def list_project_register_ids(self, project_id: uuid.UUID) -> list:
        return self.database.query(DailyCostRegister.id).filter(DailyCostRegister.project_id == project_id).all()

    def list_project_registers(self, project_id: uuid.UUID, work_date: str | None) -> list[DailyCostRegister]:
        register_query = self.database.query(DailyCostRegister).filter(DailyCostRegister.project_id == project_id)
        if work_date:
            register_query = register_query.filter(
                DailyCostRegister.work_date == datetime.fromisoformat(work_date).date()
            )
        return register_query.order_by(desc(DailyCostRegister.work_date), desc(DailyCostRegister.id)).all()

    def list_completed_quantities(self, project_id: uuid.UUID, reference: str) -> list:
        return (
            self.database.query(DailyCostRegister.completed_quantity)
            .filter(
                DailyCostRegister.project_id == project_id,
                DailyCostRegister.boq_reference == reference,
                DailyCostRegister.completed_quantity.isnot(None),
            )
            .all()
        )

    def find_user_register(
        self, project_id: uuid.UUID, user_id: uuid.UUID, work_date: date_value
    ) -> DailyCostRegister | None:
        return (
            self.database.query(DailyCostRegister)
            .filter(
                DailyCostRegister.project_id == project_id,
                DailyCostRegister.created_by_id == user_id,
                DailyCostRegister.work_date == work_date,
            )
            .first()
        )

    def count_work_days(self, project_id: uuid.UUID, user_id: uuid.UUID, selected_date: date_value) -> int:
        return (
            self.database.query(DailyCostRegister.work_date)
            .filter(
                DailyCostRegister.project_id == project_id,
                DailyCostRegister.created_by_id == user_id,
                DailyCostRegister.work_date <= selected_date,
            )
            .distinct()
            .count()
        )

    # ------------------------------------------------------ suppliers and workers
    def find_supplier(self, contractor_id: uuid.UUID, supplier_name: str) -> CostSupplier | None:
        return (
            self.database.query(CostSupplier)
            .filter(
                CostSupplier.contractor_id == contractor_id,
                CostSupplier.name == supplier_name,
            )
            .first()
        )

    def find_worker(self, contractor_id: uuid.UUID, worker_name: str) -> CostWorker | None:
        return (
            self.database.query(CostWorker)
            .filter(
                CostWorker.contractor_id == contractor_id,
                CostWorker.name == worker_name,
            )
            .first()
        )

    # ------------------------------------------------------------------ materials
    def find_inventory(self, project_id: uuid.UUID, material: str) -> CostMaterialInventory | None:
        return (
            self.database.query(CostMaterialInventory)
            .filter(
                CostMaterialInventory.project_id == project_id,
                CostMaterialInventory.material == material,
            )
            .first()
        )

    def list_project_inventory(self, project_id: uuid.UUID) -> list[CostMaterialInventory]:
        return (
            self.database.query(CostMaterialInventory)
            .filter(CostMaterialInventory.project_id == project_id)
            .order_by(CostMaterialInventory.material)
            .all()
        )

    def list_material_usages(self, register_ids: list[uuid.UUID]) -> list[CostMaterialUsage]:
        return self.database.query(CostMaterialUsage).filter(CostMaterialUsage.register_id.in_(register_ids)).all()

    def list_rated_material_usages(self, project_id: uuid.UUID) -> list[CostMaterialUsage]:
        return (
            self.database.query(CostMaterialUsage)
            .filter(CostMaterialUsage.project_id == project_id, CostMaterialUsage.rate > 0)
            .order_by(CostMaterialUsage.work_date, CostMaterialUsage.id)
            .all()
        )

    def find_register_material_usage(self, register_id: uuid.UUID, material_name: str) -> CostMaterialUsage | None:
        return (
            self.database.query(CostMaterialUsage)
            .filter(CostMaterialUsage.register_id == register_id, CostMaterialUsage.material == material_name)
            .first()
        )

    def list_users(self, user_ids: list) -> list[User]:
        return self.database.query(User).filter(User.id.in_(user_ids)).all()

    # ---------------------------------------------------------- register entries
    def list_labour_entries(self, register_ids: list[uuid.UUID]) -> list[CostLabourEntry]:
        return self.database.query(CostLabourEntry).filter(CostLabourEntry.register_id.in_(register_ids)).all()

    def list_material_purchases(self, register_ids: list[uuid.UUID]) -> list[CostMaterialPurchase]:
        return (
            self.database.query(CostMaterialPurchase).filter(CostMaterialPurchase.register_id.in_(register_ids)).all()
        )

    def list_expenses(self, register_ids: list[uuid.UUID]) -> list[CostExpense]:
        return self.database.query(CostExpense).filter(CostExpense.register_id.in_(register_ids)).all()

    def list_machinery_usages(self, register_ids: list[uuid.UUID]) -> list[CostMachineryUsage]:
        return self.database.query(CostMachineryUsage).filter(CostMachineryUsage.register_id.in_(register_ids)).all()

    def list_payments(self, register_ids: list[uuid.UUID]) -> list[CostPayment]:
        return self.database.query(CostPayment).filter(CostPayment.register_id.in_(register_ids)).all()

    def find_daily_total_expense(self, register_id: uuid.UUID) -> CostExpense | None:
        return (
            self.database.query(CostExpense)
            .filter(CostExpense.register_id == register_id, CostExpense.category == "DAILY_WORKFLOW_TOTAL")
            .first()
        )

    # ------------------------------------------------------- projects / timeline
    def get_project(self, project_id: uuid.UUID) -> Project | None:
        return self.database.get(Project, project_id)

    def find_day_timeline(
        self, project_id: uuid.UUID, user_id: uuid.UUID, selected_date: date_value
    ) -> ProjectTimeline | None:
        return (
            self.database.query(ProjectTimeline)
            .filter(
                ProjectTimeline.project_id == project_id,
                ProjectTimeline.created_by_id == user_id,
                ProjectTimeline.date >= datetime.combine(selected_date, time.min),
                ProjectTimeline.date <= datetime.combine(selected_date, time.max),
            )
            .order_by(ProjectTimeline.id)
            .first()
        )
