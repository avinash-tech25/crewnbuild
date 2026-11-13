"""Equipment supply endpoints under /api/v1 (ported from the old
equipment_supply_routes.py; paths and answers unchanged, ids are UUIDs).

    /equipment/items...                          an Equipment Supplier's listings
    /equipment/requests...                       requests addressed to the supplier
    /projects/{id}/equipment-suppliers/..., /projects/{id}/equipment-requests
                                                 the Site Engineer (and the builder's reads)
    /equipment-requests/{id}...                  cancel, usage logs
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.equipment_supply.schemas import (
    EquipmentDecisionNote,
    EquipmentItemCreate,
    EquipmentItemUpdate,
    EquipmentRequestCreate,
    EquipmentUsagePut,
)
from app.modules.equipment_supply.service import EquipmentSupplyService
from app.modules.identity.models import User

router = APIRouter(tags=["Equipment"])


def get_equipment_supply_service(database: Session = Depends(get_db)) -> EquipmentSupplyService:
    return EquipmentSupplyService(database)


# ---- Equipment Supplier: listings ----


@router.get("/equipment/items")
def list_equipment_items(
    user: User = Depends(current_user), service: EquipmentSupplyService = Depends(get_equipment_supply_service)
):
    return service.list_equipment_items(user=user)


@router.post("/equipment/items")
def create_equipment_item(
    payload: EquipmentItemCreate,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.create_equipment_item(payload=payload, user=user)


@router.patch("/equipment/items/{item_id}")
def update_equipment_item(
    item_id: uuid.UUID,
    payload: EquipmentItemUpdate,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.update_equipment_item(item_id=item_id, payload=payload, user=user)


@router.delete("/equipment/items/{item_id}")
def delete_equipment_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    """Soft delete: the listing is deactivated, never physically removed."""
    return service.delete_equipment_item(item_id=item_id, user=user)


# ---- Equipment Supplier: requests ----


@router.get("/equipment/requests")
def list_supplier_equipment_requests(
    status: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.list_supplier_equipment_requests(status=status, user=user)


@router.post("/equipment/requests/{request_id}/accept")
def accept_equipment_request(
    request_id: uuid.UUID,
    payload: EquipmentDecisionNote | None = None,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.accept_equipment_request(request_id=request_id, payload=payload, user=user)


@router.post("/equipment/requests/{request_id}/reject")
def reject_equipment_request(
    request_id: uuid.UUID,
    payload: EquipmentDecisionNote | None = None,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.reject_equipment_request(request_id=request_id, payload=payload, user=user)


@router.post("/equipment/requests/{request_id}/complete")
def complete_equipment_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    """RENT: returned. BUY: delivered."""
    return service.complete_equipment_request(request_id=request_id, user=user)


# ---- Site Engineer ----


@router.get("/projects/{project_id}/equipment-suppliers/{supplier_id}/items")
def project_equipment_supplier_items(
    project_id: uuid.UUID,
    supplier_id: uuid.UUID,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.project_equipment_supplier_items(
        project_id=project_id, supplier_id=supplier_id, start_date=start_date, end_date=end_date, user=user
    )


@router.post("/projects/{project_id}/equipment-requests")
def create_equipment_request(
    project_id: uuid.UUID,
    payload: EquipmentRequestCreate,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.create_equipment_request(project_id=project_id, payload=payload, user=user)


@router.get("/projects/{project_id}/equipment-requests")
def list_project_equipment_requests(
    project_id: uuid.UUID,
    status: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.list_project_equipment_requests(project_id=project_id, status=status, user=user)


@router.post("/equipment-requests/{request_id}/cancel")
def cancel_equipment_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.cancel_equipment_request(request_id=request_id, user=user)


# ---- usage logs ----


@router.get("/equipment-requests/{request_id}/usage")
def list_equipment_usage(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.list_equipment_usage(request_id=request_id, user=user)


@router.put("/equipment-requests/{request_id}/usage/{usage_date}")
def put_equipment_usage(
    request_id: uuid.UUID,
    usage_date: date,
    payload: EquipmentUsagePut,
    user: User = Depends(current_user),
    service: EquipmentSupplyService = Depends(get_equipment_supply_service),
):
    return service.put_equipment_usage(request_id=request_id, usage_date=usage_date, payload=payload, user=user)
