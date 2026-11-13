"""What other modules read from equipment supply: the projects holding an account's
equipment history (account deletion, the old purge_repository reads), open equipment
orders (weather delivery destinations; open = PENDING or ACCEPTED, as the old weather
rule had it) and the pictures on a supplier's own listings (file access)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.equipment_supply.models import (
    STATUS_ACCEPTED,
    STATUS_PENDING,
    EquipmentItem,
    EquipmentRequest,
    EquipmentUsageLog,
)
from app.modules.files.file_ownership import file_ids_in

OPEN_STATUSES = (STATUS_PENDING, STATUS_ACCEPTED)


def _project_ids(database: Session, statement: object) -> set[uuid.UUID]:
    return set(database.scalars(statement).all())  # type: ignore[call-overload]


def builder_history_project_ids(database: Session, builder_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding equipment requests made under this builder."""
    return list(
        _project_ids(database, select(EquipmentRequest.project_id).where(EquipmentRequest.contractor_id == builder_id))
    )


def supplier_history_project_ids(database: Session, supplier_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding equipment requests addressed to this supplier."""
    return list(
        _project_ids(database, select(EquipmentRequest.project_id).where(EquipmentRequest.supplier_id == supplier_id))
    )


def engineer_history_project_ids(database: Session, engineer_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding this engineer's equipment requests or the usage they logged."""
    made = select(EquipmentRequest.project_id).where(EquipmentRequest.engineer_id == engineer_id)
    logged = (
        select(EquipmentRequest.project_id)
        .join(EquipmentUsageLog, EquipmentUsageLog.equipment_request_id == EquipmentRequest.id)
        .where(EquipmentUsageLog.recorded_by_id == engineer_id)
    )
    return list(_project_ids(database, made) | _project_ids(database, logged))


def open_order_project_ids(database: Session, supplier_id: uuid.UUID) -> set[uuid.UUID]:
    return _project_ids(
        database,
        select(EquipmentRequest.project_id)
        .where(EquipmentRequest.supplier_id == supplier_id, EquipmentRequest.status.in_(OPEN_STATUSES))
        .distinct(),
    )


def open_order_supplier_ids(database: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    return _project_ids(
        database,
        select(EquipmentRequest.supplier_id)
        .where(EquipmentRequest.project_id == project_id, EquipmentRequest.status.in_(OPEN_STATUSES))
        .distinct(),
    )


def is_equipment_listing_image(database: Session, supplier_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """A picture on one of the supplier's equipment listings."""
    urls = database.scalars(
        select(EquipmentItem.image_url).where(
            EquipmentItem.supplier_id == supplier_id, EquipmentItem.image_url.isnot(None)
        )
    ).all()
    return file_id in file_ids_in(*urls)
