"""What the projects module asks site operations (the old award_service and
project_repository reads of the daily records, same answers)."""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.site_operations.models import CostMaterialInventory, CostMaterialUsage, DailyCostRegister, LabourLog


def work_record_label(database: Session, project_id: uuid.UUID) -> str | None:
    """The first record of work done on site the project has, in the old order: daily
    site records, material usage, labour logs."""
    for model, label in (
        (DailyCostRegister, "daily site records"),
        (CostMaterialUsage, "material usage"),
        (LabourLog, "labour logs"),
    ):
        if database.scalars(select(model.id).where(model.project_id == project_id).limit(1)).first():
            return label
    return None


def has_cost_register(database: Session, project_id: uuid.UUID) -> bool:
    return (
        database.scalars(
            select(DailyCostRegister.id).where(DailyCostRegister.project_id == project_id).limit(1)
        ).first()
        is not None
    )


def daily_register_status(
    database: Session, project_id: uuid.UUID, engineer_id: uuid.UUID, work_date: date
) -> str | None:
    """The status of this engineer's daily record for that day, or None."""
    return database.scalars(
        select(DailyCostRegister.status).where(
            DailyCostRegister.project_id == project_id,
            DailyCostRegister.created_by_id == engineer_id,
            DailyCostRegister.work_date == work_date,
        )
    ).first()


def builder_history_project_ids(database: Session, builder_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding this builder's daily records or project stock."""
    registers = select(DailyCostRegister.project_id).where(DailyCostRegister.contractor_id == builder_id)
    stock = select(CostMaterialInventory.project_id).where(
        CostMaterialInventory.contractor_id == builder_id, CostMaterialInventory.project_id.isnot(None)
    )
    return list(set(database.scalars(registers).all()) | set(database.scalars(stock).all()))
