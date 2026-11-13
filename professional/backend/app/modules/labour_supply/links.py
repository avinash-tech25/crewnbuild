"""What other modules read from labour supply: a Labour Supplier's active trades
(projects, marketplace), the projects holding an account's labour history (account
deletion, the old purge_repository reads) and open labour orders (weather delivery
destinations; open = PENDING or ACCEPTED, as the old weather rule had it)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.labour_supply.models import STATUS_ACCEPTED, STATUS_PENDING, LaborDailyRecord, LaborRequest
from app.modules.labour_supply.repository import active_labor_trades_by_supplier

OPEN_STATUSES = (STATUS_PENDING, STATUS_ACCEPTED)

__all__ = [
    "active_labor_trades_by_supplier",
    "builder_history_project_ids",
    "engineer_history_project_ids",
    "open_order_project_ids",
    "open_order_supplier_ids",
    "supplier_history_project_ids",
]


def _project_ids(database: Session, statement: object) -> list[uuid.UUID]:
    return list(set(database.scalars(statement).all()))  # type: ignore[call-overload]


def builder_history_project_ids(database: Session, builder_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding labour requests made under this builder."""
    return _project_ids(database, select(LaborRequest.project_id).where(LaborRequest.contractor_id == builder_id))


def supplier_history_project_ids(database: Session, supplier_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding labour requests addressed to this supplier."""
    return _project_ids(database, select(LaborRequest.project_id).where(LaborRequest.supplier_id == supplier_id))


def engineer_history_project_ids(database: Session, engineer_id: uuid.UUID) -> list[uuid.UUID]:
    """Projects holding this engineer's labour requests or the attendance they recorded."""
    made = select(LaborRequest.project_id).where(LaborRequest.engineer_id == engineer_id)
    recorded = (
        select(LaborRequest.project_id)
        .join(LaborDailyRecord, LaborDailyRecord.labor_request_id == LaborRequest.id)
        .where(LaborDailyRecord.recorded_by_id == engineer_id)
    )
    return list(set(_project_ids(database, made)) | set(_project_ids(database, recorded)))


def open_order_project_ids(database: Session, supplier_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        database.scalars(
            select(LaborRequest.project_id)
            .where(LaborRequest.supplier_id == supplier_id, LaborRequest.status.in_(OPEN_STATUSES))
            .distinct()
        )
    )


def open_order_supplier_ids(database: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        database.scalars(
            select(LaborRequest.supplier_id)
            .where(LaborRequest.project_id == project_id, LaborRequest.status.in_(OPEN_STATUSES))
            .distinct()
        )
    )
