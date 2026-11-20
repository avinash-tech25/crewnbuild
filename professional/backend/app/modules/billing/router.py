"""The builder's tools that once came with a paid plan, now open to every builder:

    GET  /builder/portfolio                       portfolio dashboard
    GET  /builder/portfolio/export.csv            consolidated CSV
    GET  /projects/{project_id}/summary.csv       one project's CSV summary
    GET  /cost-tool/registers/{id}/builder-adjustments    the record's audit trail (builder / engineer)
    POST /cost-tool/registers/{id}/builder-adjustments    a correction on a closed day (builder)

Subscriptions, coupons, booking payments and their Razorpay checkout were removed;
their tables stay in the schema (billing/models.py) until a migration drops them.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.billing.premium_service import PremiumService
from app.modules.billing.schemas import CostAdjustmentRequest
from app.modules.identity.models import User

router = APIRouter(tags=["Builder tools"])


def get_premium_service(database: Session = Depends(get_db)) -> PremiumService:
    return PremiumService(database)


@router.get("/builder/portfolio")
def read_builder_portfolio(
    user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> dict[str, Any]:
    return service.portfolio(user)


def _csv_response(filename: str, body: str) -> Response:
    return Response(
        content=body.encode("utf-8-sig"),  # BOM: Excel opens UTF-8 names correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/builder/portfolio/export.csv")
def export_builder_portfolio(
    user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> Response:
    return _csv_response(*service.portfolio_csv(user))


@router.get("/projects/{project_id}/summary.csv")
def export_project_summary(
    project_id: uuid.UUID, user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> Response:
    return _csv_response(*service.project_summary_csv(user, project_id))


@router.get("/cost-tool/registers/{register_id}/builder-adjustments")
def list_cost_adjustments(
    register_id: uuid.UUID, user: User = Depends(current_user), service: PremiumService = Depends(get_premium_service)
) -> dict[str, Any]:
    return service.list_adjustments(user, register_id)


@router.post("/cost-tool/registers/{register_id}/builder-adjustments")
def create_cost_adjustment(
    register_id: uuid.UUID,
    payload: CostAdjustmentRequest,
    user: User = Depends(current_user),
    service: PremiumService = Depends(get_premium_service),
) -> dict[str, Any]:
    return service.create_adjustment(user, register_id, payload.field_name, payload.adjusted_value, payload.reason)
