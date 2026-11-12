"""Project endpoints under /api/v1 (ported from the old project_routes.py,
project_request_routes.py, award_routes.py, engineer_team_routes.py and
project_supplier_routes.py, in that order; paths and answers unchanged, ids are UUIDs).

Only a project's members (its House Owner, awarded builder and actively assigned Site
Engineer) read or change it; each service checks that, with the old 403/404 answers.
Discovery (/contractors/nearby, /suppliers/find-clients, /engineers/find ...) is the
marketplace module's.
"""

import uuid
from datetime import date as date_value
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import User
from app.modules.projects.award_repository import AwardRepository
from app.modules.projects.award_service import AwardService
from app.modules.projects.project_repository import ProjectRepository
from app.modules.projects.project_service import ProjectService
from app.modules.projects.request_repository import ProjectRequestRepository
from app.modules.projects.request_service import ProjectRequestService
from app.modules.projects.schemas import (
    AssignDecision,
    AwardAmount,
    AwardOfferCreate,
    EngineerAssignRequest,
    EngineerInviteCreate,
    EngineerJoinRequestCreate,
    EngineerJoinRequestDecision,
    EngineerJoinTeamRequest,
    EngineerSendRequest,
    ProjectCreate,
    ProjectProgressUpdate,
    ProjectRequestCreate,
    RequestDecision,
    SupplierAssignRequest,
)
from app.modules.projects.supplier_repository import ProjectSupplierRepository
from app.modules.projects.supplier_service import ProjectSupplierService
from app.modules.projects.team_repository import EngineerTeamRepository
from app.modules.projects.team_service import EngineerTeamService

router = APIRouter()


def get_project_service(database: Session = Depends(get_db)) -> ProjectService:
    return ProjectService(ProjectRepository(database))


def get_project_request_service(database: Session = Depends(get_db)) -> ProjectRequestService:
    return ProjectRequestService(ProjectRequestRepository(database))


def get_award_service(database: Session = Depends(get_db)) -> AwardService:
    return AwardService(AwardRepository(database))


def get_engineer_team_service(database: Session = Depends(get_db)) -> EngineerTeamService:
    return EngineerTeamService(EngineerTeamRepository(database))


def get_project_supplier_service(database: Session = Depends(get_db)) -> ProjectSupplierService:
    return ProjectSupplierService(ProjectSupplierRepository(database))


# ---- projects ----


@router.get("/owners/projects", tags=["Owners"])
def fetch_owner_projects(user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)):
    return service.fetch_owner_projects(user=user)


@router.post("/projects/create", tags=["Projects"])
def create_project_request(
    payload: ProjectCreate, user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)
):
    return service.create_project_request(payload=payload, user=user)


@router.post("/projects/create-with-image", tags=["Projects"])
def create_project_with_image(
    title: str = Form(...),
    description: str = Form(...),
    address: str = Form(...),
    pincode: str = Form(...),
    building_type: str = Form(...),
    construction_type: str = Form(...),
    budget: float = Form(default=0),
    land_area: float = Form(default=0),
    floors: int = Form(default=1),
    floor_type: str | None = Form(default=None),
    project_country: str = Form(default=""),
    project_state: str = Form(default=""),
    project_city: str = Form(default=""),
    estimated_cost: float | None = Form(default=None),
    estimated_duration_days: int | None = Form(default=None),
    material_estimate: float | None = Form(default=None),
    labour_estimate: float | None = Form(default=None),
    start_date: date_value | None = Form(default=None),
    end_date: date_value | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    service: ProjectService = Depends(get_project_service),
    uploads: UploadService = Depends(get_upload_service),
):
    return service.create_project_with_image(
        title=title,
        description=description,
        address=address,
        pincode=pincode,
        building_type=building_type,
        construction_type=construction_type,
        budget=budget,
        land_area=land_area,
        floors=floors,
        floor_type=floor_type,
        project_country=project_country,
        project_state=project_state,
        project_city=project_city,
        estimated_cost=estimated_cost,
        estimated_duration_days=estimated_duration_days,
        material_estimate=material_estimate,
        labour_estimate=labour_estimate,
        start_date=start_date,
        end_date=end_date,
        image=image,
        user=user,
        uploads=uploads,
    )


@router.get("/projects/{project_id}", tags=["Projects"])
def fetch_project_details(
    project_id: uuid.UUID, user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)
):
    return service.fetch_project_details(project_id=project_id, user=user)


@router.delete("/projects/{project_id}", tags=["Projects"])
def delete_owner_project(
    project_id: uuid.UUID, user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)
):
    """Delete a House Owner's unassigned, unstarted project, with everything scoped to it."""
    return service.delete_owner_project(project_id=project_id, user=user)


@router.patch("/projects/{project_id}/progress", tags=["Projects"])
def update_project_progress(
    project_id: uuid.UUID,
    payload: ProjectProgressUpdate,
    user: User = Depends(current_user),
    service: ProjectService = Depends(get_project_service),
):
    return service.update_project_progress(project_id=project_id, payload=payload, user=user)


@router.patch("/projects/{project_id}/requirement", tags=["Projects"])
def update_project_requirement(
    project_id: uuid.UUID,
    payload: ProjectCreate,
    user: User = Depends(current_user),
    service: ProjectService = Depends(get_project_service),
):
    return service.update_project_requirement(project_id=project_id, payload=payload, user=user)


@router.get("/projects/{project_id}/photos", tags=["Projects"])
def fetch_project_photos(
    project_id: uuid.UUID, user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)
):
    return service.fetch_project_photos(project_id=project_id, user=user)


@router.delete("/project-photos/{photo_id}", tags=["Projects"])
def delete_project_photo(
    photo_id: uuid.UUID,
    user: User = Depends(current_user),
    service: ProjectService = Depends(get_project_service),
    uploads: UploadService = Depends(get_upload_service),
):
    return service.delete_project_photo(photo_id=photo_id, user=user, uploads=uploads)


@router.post("/timelines/create", tags=["Projects"])
def save_timeline_update(
    project_id: uuid.UUID,
    title: str = Form(...),
    description: str = Form(...),
    date: str = Form(...),
    completion_status: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    user: User = Depends(current_user),
    service: ProjectService = Depends(get_project_service),
    uploads: UploadService = Depends(get_upload_service),
):
    return service.save_timeline_update(
        project_id=project_id,
        title=title,
        description=description,
        date=date,
        completion_status=completion_status,
        images=images,
        user=user,
        uploads=uploads,
    )


@router.get("/timelines/project/{project_id}", tags=["Projects"])
def fetch_project_timeline_entries(
    project_id: uuid.UUID, user: User = Depends(current_user), service: ProjectService = Depends(get_project_service)
):
    return service.fetch_project_timeline_entries(project_id=project_id, user=user)


# ---- project requests ----


@router.post("/project-requests/send")
def send_project_request(
    payload: ProjectRequestCreate,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.send_project_request(payload=payload, user=user)


@router.get("/project-requests/incoming")
def fetch_incoming_requests(
    user: User = Depends(current_user), service: ProjectRequestService = Depends(get_project_request_service)
):
    return service.fetch_incoming_requests(user=user)


@router.post("/project-requests/accept")
def accept_project_request(
    payload: RequestDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.accept_project_request(payload=payload, user=user)


@router.post("/project-requests/assign")
def assign_project_to_contractor(
    payload: AssignDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.assign_project_to_contractor(payload=payload, user=user)


@router.post("/project-requests/assign-engineer")
def assign_engineer_from_request(
    payload: RequestDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    """The owner picks one accepted Site Engineer for a self-construction project."""
    return service.assign_engineer_from_request(payload=payload, user=user)


@router.post("/project-requests/confirm-assignment")
def confirm_project_assignment(
    payload: RequestDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.confirm_project_assignment(payload=payload, user=user)


@router.post("/project-requests/reject")
def reject_project_request(
    payload: RequestDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.reject_project_request(payload=payload, user=user)


@router.post("/project-requests/withdraw")
def withdraw_project_request(
    payload: RequestDecision,
    user: User = Depends(current_user),
    service: ProjectRequestService = Depends(get_project_request_service),
):
    return service.withdraw_project_request(payload=payload, user=user)


# ---- awards (the builder's assignment decision and its negotiation) ----


@router.get("/projects/{project_id}/award", tags=["Projects"])
def fetch_project_award(
    project_id: uuid.UUID,
    request_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    service: AwardService = Depends(get_award_service),
):
    return service.fetch_project_award(project_id=project_id, request_id=request_id, user=user)


@router.post("/awards/{award_id}/confirm", tags=["Projects"])
def confirm_project_award(
    award_id: uuid.UUID,
    payload: AwardAmount,
    user: User = Depends(current_user),
    service: AwardService = Depends(get_award_service),
):
    return service.confirm_project_award(award_id=award_id, payload=payload, user=user)


@router.post("/awards/{award_id}/decline", tags=["Projects"])
def decline_project_award(
    award_id: uuid.UUID, user: User = Depends(current_user), service: AwardService = Depends(get_award_service)
):
    return service.decline_project_award(award_id=award_id, user=user)


@router.post("/awards/{award_id}/cancel", tags=["Projects"])
def cancel_project_award(
    award_id: uuid.UUID, user: User = Depends(current_user), service: AwardService = Depends(get_award_service)
):
    return service.cancel_project_award(award_id=award_id, user=user)


@router.post("/awards/{award_id}/offers", tags=["Projects"])
def create_award_offer(
    award_id: uuid.UUID,
    payload: AwardOfferCreate,
    user: User = Depends(current_user),
    service: AwardService = Depends(get_award_service),
):
    return service.create_award_offer(award_id=award_id, payload=payload, user=user)


@router.post("/award-offers/{offer_id}/accept", tags=["Projects"])
def accept_award_offer(
    offer_id: uuid.UUID,
    payload: AwardAmount,
    user: User = Depends(current_user),
    service: AwardService = Depends(get_award_service),
):
    return service.accept_award_offer(offer_id=offer_id, payload=payload, user=user)


@router.post("/award-offers/{offer_id}/reject", tags=["Projects"])
def reject_award_offer(
    offer_id: uuid.UUID, user: User = Depends(current_user), service: AwardService = Depends(get_award_service)
):
    return service.reject_award_offer(offer_id=offer_id, user=user)


# ---- builder teams and Site Engineers ----


@router.get("/projects/{project_id}/specialist-team", tags=["Contractors"])
def fetch_project_specialist_team(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.fetch_project_specialist_team(project_id=project_id, user=user)


@router.get("/projects/{project_id}/specialist-candidates", tags=["Contractors"])
def fetch_project_specialist_candidates(
    project_id: uuid.UUID,
    category: str = Query(...),
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.fetch_project_specialist_candidates(project_id=project_id, category=category, user=user)


@router.post("/projects/{project_id}/specialist-request", tags=["Contractors"])
def send_project_specialist_request(
    project_id: uuid.UUID,
    payload: EngineerAssignRequest,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.send_project_specialist_request(project_id=project_id, payload=payload, user=user)


@router.post("/engineers/invite", tags=["Site Engineers"])
def create_engineer_invitation(
    payload: EngineerInviteCreate,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.create_engineer_invitation(payload=payload, user=user)


@router.post("/engineers/invite/revoke", tags=["Site Engineers"])
def revoke_engineer_invitation(
    payload: dict[str, Any] = Body(...),
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.revoke_engineer_invitation(payload=payload, user=user)


@router.post("/engineers/send-request", tags=["Site Engineers"])
def send_contractor_engineer_request(
    payload: EngineerSendRequest,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.send_contractor_engineer_request(payload=payload, user=user)


@router.get("/engineers/my-team", tags=["Site Engineers"])
def fetch_engineer_team(
    user: User = Depends(current_user), service: EngineerTeamService = Depends(get_engineer_team_service)
):
    return service.fetch_engineer_team(user=user)


@router.post("/engineers/join-team", tags=["Site Engineers"])
def join_engineer_team(
    payload: EngineerJoinTeamRequest,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.join_engineer_team(payload=payload, user=user)


@router.post("/engineers/request-join", tags=["Site Engineers"])
def request_engineer_join(
    payload: EngineerJoinRequestCreate,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.request_engineer_join(payload=payload, user=user)


@router.post("/engineers/join-request/respond", tags=["Site Engineers"])
def respond_engineer_join_request(
    payload: EngineerJoinRequestDecision,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.respond_engineer_join_request(payload=payload, user=user)


@router.get("/engineers/opportunities", tags=["Site Engineers"])
def fetch_engineer_opportunities(
    country: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.fetch_engineer_opportunities(country=country, user=user)


@router.post("/engineers/opportunities/{project_id}/apply", tags=["Site Engineers"])
def apply_engineer_opportunity(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.apply_engineer_opportunity(project_id=project_id, user=user)


@router.get("/engineers/my-projects", tags=["Site Engineers"])
def fetch_engineer_projects(
    user: User = Depends(current_user), service: EngineerTeamService = Depends(get_engineer_team_service)
):
    return service.fetch_engineer_projects(user=user)


@router.post("/projects/{project_id}/assign-engineer", tags=["Site Engineers"])
def assign_engineer_to_project(
    project_id: uuid.UUID,
    payload: EngineerAssignRequest,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.assign_engineer_to_project(project_id=project_id, payload=payload, user=user)


@router.post("/projects/{project_id}/unassign-engineer", tags=["Site Engineers"])
def unassign_engineer_from_project(
    project_id: uuid.UUID,
    payload: EngineerAssignRequest,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.unassign_engineer_from_project(project_id=project_id, payload=payload, user=user)


@router.get("/projects/{project_id}/engineer", tags=["Site Engineers"])
def fetch_project_engineer(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: EngineerTeamService = Depends(get_engineer_team_service),
):
    return service.fetch_project_engineer(project_id=project_id, user=user)


# ---- suppliers on projects ----


@router.get("/contractors/my-suppliers", tags=["Contractors"])
def fetch_contractor_accepted_suppliers(
    user: User = Depends(current_user), service: ProjectSupplierService = Depends(get_project_supplier_service)
):
    return service.fetch_contractor_accepted_suppliers(user=user)


@router.post("/projects/{project_id}/assign-supplier", tags=["Contractors"])
def assign_supplier_to_project(
    project_id: uuid.UUID,
    payload: SupplierAssignRequest,
    user: User = Depends(current_user),
    service: ProjectSupplierService = Depends(get_project_supplier_service),
):
    return service.assign_supplier_to_project(project_id=project_id, payload=payload, user=user)


@router.post("/projects/{project_id}/unassign-supplier", tags=["Contractors"])
def unassign_supplier_from_project(
    project_id: uuid.UUID,
    payload: SupplierAssignRequest,
    user: User = Depends(current_user),
    service: ProjectSupplierService = Depends(get_project_supplier_service),
):
    return service.unassign_supplier_from_project(project_id=project_id, payload=payload, user=user)


@router.get("/projects/{project_id}/suppliers", tags=["Contractors"])
def fetch_project_suppliers(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: ProjectSupplierService = Depends(get_project_supplier_service),
):
    return service.fetch_project_suppliers(project_id=project_id, user=user)


@router.get("/projects/{project_id}/team-suppliers", tags=["Site Engineers"])
def fetch_engineer_team_suppliers(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    service: ProjectSupplierService = Depends(get_project_supplier_service),
):
    return service.fetch_engineer_team_suppliers(project_id=project_id, user=user)


@router.get("/suppliers/my-projects", tags=["Suppliers"])
def fetch_supplier_my_projects(
    user: User = Depends(current_user), service: ProjectSupplierService = Depends(get_project_supplier_service)
):
    return service.fetch_supplier_my_projects(user=user)
