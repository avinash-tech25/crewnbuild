"""Site operations endpoints under /api/v1 (ported from the old daily_cost_routes.py;
paths and answers unchanged, ids are UUIDs).

    /projects/{id}/daily-workflow           the Site Engineer's daily record (calendar)
    /cost-tool/...                          the cost tool: register, labour and attendance,
                                            materials, purchases, expenses, machinery,
                                            payments, and the summary
    /owners/projects/{id}/analysis          the House Owner's project analysis
    /materials/create, /labour/create       deprecated builder logs
"""

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import User
from app.modules.site_operations.repository import DailyCostRepository
from app.modules.site_operations.schemas import (
    CostExpenseCreate,
    CostLabourEntryCreate,
    CostMachineryUsageCreate,
    CostMaterialPurchaseCreate,
    CostMaterialUsageCreate,
    CostPaymentCreate,
    DailyCostRegisterCreate,
    LabourCreate,
    MaterialCreate,
)
from app.modules.site_operations.service import DailyCostService

router = APIRouter()


def get_daily_cost_service(database: Session = Depends(get_db)) -> DailyCostService:
    return DailyCostService(DailyCostRepository(database))


@router.get("/cost-tool/projects/{project_id}/summary", tags=["Contractors"])
def fetch_cost_tool_summary(
    project_id: uuid.UUID,
    work_date: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.fetch_cost_tool_summary(project_id=project_id, work_date=work_date, user=user)


@router.get("/owners/projects/{project_id}/analysis", tags=["Owners"])
def fetch_owner_project_analysis(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.fetch_owner_project_analysis(project_id=project_id, user=user)


@router.post("/cost-tool/registers", tags=["Contractors"])
def save_daily_cost_register(
    payload: DailyCostRegisterCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_daily_cost_register(payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/labour", tags=["Contractors"])
def save_cost_labour_entry(
    register_id: uuid.UUID,
    payload: CostLabourEntryCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_labour_entry(register_id=register_id, payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/material-usage", tags=["Contractors"])
def save_cost_material_usage(
    register_id: uuid.UUID,
    payload: CostMaterialUsageCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_material_usage(register_id=register_id, payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/material-purchases", tags=["Contractors"])
def save_cost_material_purchase(
    register_id: uuid.UUID,
    payload: CostMaterialPurchaseCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_material_purchase(register_id=register_id, payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/expenses", tags=["Contractors"])
def save_cost_expense(
    register_id: uuid.UUID,
    payload: CostExpenseCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_expense(register_id=register_id, payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/machinery", tags=["Contractors"])
def save_cost_machinery_usage(
    register_id: uuid.UUID,
    payload: CostMachineryUsageCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_machinery_usage(register_id=register_id, payload=payload, user=user)


@router.post("/cost-tool/registers/{register_id}/payments", tags=["Contractors"])
def save_cost_payment(
    register_id: uuid.UUID,
    payload: CostPaymentCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_cost_payment(register_id=register_id, payload=payload, user=user)


@router.post("/materials/create", tags=["Contractors"], deprecated=True)
def save_material_log(
    payload: MaterialCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_material_log(payload=payload, user=user)


@router.post("/labour/create", tags=["Contractors"], deprecated=True)
def save_labour_log(
    payload: LabourCreate,
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
):
    return service.save_labour_log(payload=payload, user=user)


@router.post("/projects/{project_id}/daily-workflow", tags=["Projects"])
def save_daily_workflow(
    project_id: uuid.UUID,
    work_date: str = Form(...),
    work_title: str = Form(...),
    activity_category: str = Form(default=""),
    boq_reference: str = Form(default=""),
    activity_unit: str = Form(default=""),
    planned_quantity: str = Form(default=""),
    completed_quantity: str = Form(default=""),
    detailed_remarks: str = Form(default=""),
    labour_worker_count: int = Form(default=0),
    labour_cost: float = Form(default=0),
    material_cost: float = Form(default=0),
    equipment_cost: float = Form(default=0),
    total_expenses: float = Form(default=0),
    material_used: str = Form(default=""),
    material_usage: str = Form(default="[]"),
    equipment_used: str = Form(default=""),
    inspection_remarks: str = Form(default=""),
    action: str = Form(default="IN_PROGRESS"),
    images: list[UploadFile] = File(default=[]),
    videos: list[UploadFile] = File(default=[]),
    user: User = Depends(current_user),
    service: DailyCostService = Depends(get_daily_cost_service),
    uploads: UploadService = Depends(get_upload_service),
):
    return service.save_daily_workflow(
        project_id=project_id,
        work_date=work_date,
        work_title=work_title,
        activity_category=activity_category,
        boq_reference=boq_reference,
        activity_unit=activity_unit,
        planned_quantity=planned_quantity,
        completed_quantity=completed_quantity,
        detailed_remarks=detailed_remarks,
        labour_worker_count=labour_worker_count,
        labour_cost=labour_cost,
        material_cost=material_cost,
        equipment_cost=equipment_cost,
        total_expenses=total_expenses,
        material_used=material_used,
        material_usage=material_usage,
        equipment_used=equipment_used,
        inspection_remarks=inspection_remarks,
        action=action,
        images=images,
        videos=videos,
        user=user,
        uploads=uploads,
    )
