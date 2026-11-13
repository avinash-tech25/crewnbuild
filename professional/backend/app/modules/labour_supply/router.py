"""Labour supply endpoints under /api/v1 (ported from the old labor_supply_routes.py;
paths and answers unchanged, ids are UUIDs).

    /labor/trades, /labor/services...            a Labour Supplier's trades
    /labor/requests...                           requests addressed to the supplier
    /projects/{id}/labor-suppliers/..., /projects/{id}/labor-requests
                                                 the Site Engineer (and the builder's reads)
    /labor-requests/{id}...                      cancel, complete, change, attendance
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.identity.models import User
from app.modules.labour_supply.schemas import (
    LaborAccept,
    LaborDailyRecordPut,
    LaborDecisionNote,
    LaborRequestCreate,
    LaborRequestUpdate,
    LaborServiceCreate,
    LaborServiceUpdate,
)
from app.modules.labour_supply.service import LaborSupplyService

router = APIRouter(tags=["Labor"])


def get_labor_supply_service(database: Session = Depends(get_db)) -> LaborSupplyService:
    return LaborSupplyService(database)


# ---- Labour Supplier: trades ----


@router.get("/labor/trades")
def list_labor_trades(
    user: User = Depends(current_user), service: LaborSupplyService = Depends(get_labor_supply_service)
):
    return service.list_labor_trades(user=user)


@router.get("/labor/services")
def list_labor_services(
    user: User = Depends(current_user), service: LaborSupplyService = Depends(get_labor_supply_service)
):
    return service.list_labor_services(user=user)


@router.post("/labor/services")
def create_labor_service(
    payload: LaborServiceCreate,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.create_labor_service(payload=payload, user=user)


@router.patch("/labor/services/{service_id}")
def update_labor_service(
    service_id: uuid.UUID,
    payload: LaborServiceUpdate,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.update_labor_service(service_id=service_id, payload=payload, user=user)


@router.delete("/labor/services/{service_id}")
def delete_labor_service(
    service_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.delete_labor_service(service_id=service_id, user=user)


# ---- Labour Supplier: requests ----


@router.get("/labor/requests")
def list_supplier_labor_requests(
    status: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.list_supplier_labor_requests(status=status, user=user)


@router.post("/labor/requests/{request_id}/accept")
def accept_labor_request(
    request_id: uuid.UUID,
    payload: LaborAccept,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.accept_labor_request(request_id=request_id, payload=payload, user=user)


@router.post("/labor/requests/{request_id}/reject")
def reject_labor_request(
    request_id: uuid.UUID,
    payload: LaborDecisionNote | None = None,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.reject_labor_request(request_id=request_id, payload=payload, user=user)


@router.get("/labor/requests/{request_id}/daily-records")
def supplier_labor_daily_records(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.supplier_labor_daily_records(request_id=request_id, user=user)


# ---- Site Engineer ----


@router.get("/projects/{project_id}/labor-suppliers/{supplier_id}/services")
def project_labor_supplier_services(
    project_id: uuid.UUID,
    supplier_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    """The active trades of a Labour Supplier the builder assigned to this engineer."""
    return service.project_labor_supplier_services(project_id=project_id, supplier_id=supplier_id, user=user)


@router.post("/projects/{project_id}/labor-requests")
def create_labor_request(
    project_id: uuid.UUID,
    payload: LaborRequestCreate,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.create_labor_request(project_id=project_id, payload=payload, user=user)


@router.get("/projects/{project_id}/labor-requests")
def list_project_labor_requests(
    project_id: uuid.UUID,
    status: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    """The engineer sees their own requests on the project; the project's builder sees all."""
    return service.list_project_labor_requests(project_id=project_id, status=status, user=user)


@router.post("/labor-requests/{request_id}/cancel")
def cancel_labor_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.cancel_labor_request(request_id=request_id, user=user)


@router.post("/labor-requests/{request_id}/complete")
def complete_labor_request(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    """Ends the labour assignment and frees its workers back to the supplier's capacity."""
    return service.complete_labor_request(request_id=request_id, user=user)


@router.patch("/labor-requests/{request_id}")
def update_labor_request(
    request_id: uuid.UUID,
    payload: LaborRequestUpdate,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.update_labor_request(request_id=request_id, payload=payload, user=user)


# ---- attendance ----


@router.get("/labor-requests/{request_id}/daily-records")
def list_labor_daily_records(
    request_id: uuid.UUID,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    return service.list_labor_daily_records(request_id=request_id, user=user)


@router.put("/labor-requests/{request_id}/daily-records/{work_date}")
def put_labor_daily_record(
    request_id: uuid.UUID,
    work_date: date,
    payload: LaborDailyRecordPut,
    user: User = Depends(current_user),
    service: LaborSupplyService = Depends(get_labor_supply_service),
):
    """Create or replace the one record for this assignment and date."""
    return service.put_labor_daily_record(request_id=request_id, work_date=work_date, payload=payload, user=user)
