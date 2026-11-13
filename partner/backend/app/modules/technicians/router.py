"""The technician dashboard (the old Partner app/technician/routes/technician_routes.py;
paths and answers unchanged, under /api/v1/technicians/me). The password change is in
modules/identity/router.py."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile

from app.auth.dependencies import get_active_technician, get_technician_session
from app.modules.bookings.dependencies import (
    get_bank_account_service,
    get_dispatch_service,
    get_earnings_service,
    get_job_execution_service,
    get_technician_service,
    get_upload_service,
    get_work_bill_service,
    get_work_preferences_service,
)
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.job_execution_service import JobExecutionService, content_headers
from app.modules.bookings.schemas import (
    BillItemCreateRequest,
    BillItemUpdateRequest,
    BillNotesUpdateRequest,
    JobCancelRequest,
    JobExecutionResponse,
    JobMediaOut,
    JobStepUpdateRequest,
    ServiceNotesUpdateRequest,
    StartWorkRequest,
    TechnicianJobResponse,
    WorkBillResponse,
)
from app.modules.bookings.work_bill_service import WorkBillService
from app.modules.catalog.schemas import ServiceOut
from app.modules.identity.models import Technician
from app.modules.identity.schemas import TechnicianResponse
from app.modules.technicians.bank_account_service import BankAccountService
from app.modules.technicians.earnings_service import EarningsService
from app.modules.technicians.schemas import (
    AvailabilityUpdateRequest,
    BankAccountResponse,
    BankAccountUpdateRequest,
    DashboardSummary,
    EarningOut,
    EarningsSummary,
    ProfileUpdateRequest,
    WorkPreferences,
    WorkPreferencesUpdate,
)
from app.modules.technicians.technician_service import TechnicianService
from app.modules.technicians.upload_service import UploadService
from app.modules.technicians.work_preferences_service import WorkPreferencesService

router = APIRouter(prefix="/technicians/me", tags=["Technician"])


@router.get("/dashboard", response_model=DashboardSummary)
def read_dashboard(
    user: Technician = Depends(get_active_technician), technicians: TechnicianService = Depends(get_technician_service)
):
    return technicians.dashboard(user)


@router.patch("", response_model=TechnicianResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: Technician = Depends(get_active_technician),
    technicians: TechnicianService = Depends(get_technician_service),
):
    return technicians.update_profile(user, payload)


@router.patch("/availability", response_model=TechnicianResponse)
def update_availability(
    payload: AvailabilityUpdateRequest,
    user: Technician = Depends(get_active_technician),
    technicians: TechnicianService = Depends(get_technician_service),
):
    """AVAILABLE, PAUSED or OFFLINE. Anything but AVAILABLE withdraws pending offers."""
    return technicians.set_availability(user, payload.status)


# ------------------------------------------------------------- work preferences


@router.get("/catalog", response_model=list[ServiceOut])
def read_own_trade_catalog(
    trade: str | None = Query(default=None, max_length=20),
    session: tuple[Technician, str] = Depends(get_technician_session),
    preferences: WorkPreferencesService = Depends(get_work_preferences_service),
):
    """The live services a technician may choose from: their own trade's.

    Open to the registration session too, because services are chosen on the last
    registration step -- before the trade is saved, so `trade` names the one being
    chosen. Once an account has a trade, no other trade's catalog is served here.
    The requester's catalog endpoints are unchanged.
    """
    return preferences.catalog_for(session[0], trade)


@router.get("/work-preferences", response_model=WorkPreferences)
def read_work_preferences(
    user: Technician = Depends(get_active_technician),
    preferences: WorkPreferencesService = Depends(get_work_preferences_service),
):
    return preferences.read(user)


@router.put("/work-preferences", response_model=WorkPreferences)
def update_work_preferences(
    payload: WorkPreferencesUpdate,
    user: Technician = Depends(get_active_technician),
    preferences: WorkPreferencesService = Depends(get_work_preferences_service),
):
    return preferences.update(user, payload)


@router.post("/profile-image", response_model=TechnicianResponse)
def upload_profile_image(
    file: UploadFile = File(...),
    user: Technician = Depends(get_active_technician),
    technicians: TechnicianService = Depends(get_technician_service),
    uploads: UploadService = Depends(get_upload_service),
):
    return technicians.set_profile_image(user, uploads.save_profile_image(file))


# ------------------------------------------------------------------- security


# ------------------------------------------------------------------- earnings
# Recorded when a priced job is completed. Read-only: there are no payouts yet.


@router.get("/earnings/summary", response_model=EarningsSummary)
def read_earnings_summary(
    user: Technician = Depends(get_active_technician),
    earnings: EarningsService = Depends(get_earnings_service),
):
    return earnings.summary(user)


@router.get("/earnings", response_model=list[EarningOut])
def list_earnings(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Technician = Depends(get_active_technician),
    earnings: EarningsService = Depends(get_earnings_service),
):
    """Newest first, at most 100 per page (the cap every Partner list uses)."""
    return earnings.history(user, limit, offset)


# --------------------------------------------------------- payout bank account
# Added after signup, from Profile / Settings. The full account number is
# accepted on PUT and never returned by either endpoint.


@router.get("/bank-account", response_model=BankAccountResponse | None)
def read_bank_account(
    user: Technician = Depends(get_active_technician),
    bank: BankAccountService = Depends(get_bank_account_service),
):
    """The technician's payout account, masked; null when none has been added."""
    return bank.read(user)


@router.put("/bank-account", response_model=BankAccountResponse)
def save_bank_account(
    payload: BankAccountUpdateRequest,
    user: Technician = Depends(get_active_technician),
    bank: BankAccountService = Depends(get_bank_account_service),
):
    return bank.save(user, payload)


@router.get("/jobs", response_model=list[TechnicianJobResponse])
def list_jobs(
    # "new" is not a bucket any more: an unanswered job REQUEST is not a job this
    # technician holds, and it must not carry a job's details. Those live at
    # GET /technicians/me/offers, which returns a model with no address in it.
    bucket: Literal["accepted", "active", "completed", "cancelled"] = Query(default="accepted"),
    user: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    return dispatch.list_jobs(user, bucket)


# ------------------------------------------------------------------ job execution
# Declared before POST /jobs/{request_id}/{action}: that route would otherwise
# claim /jobs/{id}/media as an unknown action.


@router.get("/jobs/{request_id}/execution", response_model=JobExecutionResponse)
def read_job_execution(
    request_id: UUID,
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    return execution.technician_view(user, request_id)


@router.patch("/jobs/{request_id}/steps/{step_id}", response_model=JobExecutionResponse)
def update_job_step(
    request_id: UUID,
    step_id: UUID,
    payload: JobStepUpdateRequest,
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    return execution.set_step(user, request_id, step_id, payload.completed)


@router.put("/jobs/{request_id}/notes", response_model=JobExecutionResponse)
def update_service_notes(
    request_id: UUID,
    payload: ServiceNotesUpdateRequest,
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    return execution.set_notes(user, request_id, payload.notes)


@router.post("/jobs/{request_id}/media", response_model=JobMediaOut, status_code=201)
def upload_job_photo(
    request_id: UUID,
    kind: Literal["BEFORE", "AFTER"] = Form(...),
    file: UploadFile = File(...),
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    return execution.technician_upload(user, request_id, kind, file)


@router.delete("/jobs/{request_id}/media/{media_id}", status_code=204)
def delete_job_photo(
    request_id: UUID,
    media_id: UUID,
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    execution.technician_delete(user, request_id, media_id)
    return Response(status_code=204)


@router.get("/jobs/{request_id}/media/{media_id}/content")
def read_job_photo(
    request_id: UUID,
    media_id: UUID,
    user: Technician = Depends(get_active_technician),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    content, content_type = execution.technician_content(user, request_id, media_id)
    return Response(content=content, media_type=content_type, headers=content_headers(content_type))


# ---------------------------------------------------------------------- work bill
# Materials and additional labour on top of the service price. Informational:
# none of these moves the job's status or touches the technician's earning.


@router.get("/jobs/{request_id}/bill", response_model=WorkBillResponse)
def read_work_bill(
    request_id: UUID,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.technician_view(user, request_id)


@router.post("/jobs/{request_id}/bill/items", response_model=WorkBillResponse, status_code=201)
def add_bill_item(
    request_id: UUID,
    payload: BillItemCreateRequest,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.add_item(user, request_id, payload.kind, payload)


@router.put("/jobs/{request_id}/bill/items/{item_id}", response_model=WorkBillResponse)
def update_bill_item(
    request_id: UUID,
    item_id: UUID,
    payload: BillItemUpdateRequest,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.update_item(user, request_id, item_id, payload)


@router.delete("/jobs/{request_id}/bill/items/{item_id}", response_model=WorkBillResponse)
def delete_bill_item(
    request_id: UUID,
    item_id: UUID,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.delete_item(user, request_id, item_id)


@router.put("/jobs/{request_id}/bill/notes", response_model=WorkBillResponse)
def update_bill_notes(
    request_id: UUID,
    payload: BillNotesUpdateRequest,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.set_notes(user, request_id, payload.notes)


@router.post("/jobs/{request_id}/bill/submit", response_model=WorkBillResponse)
def submit_work_bill(
    request_id: UUID,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    # Finalizes the bill only: the job stays IN_PROGRESS until it is completed.
    return bills.submit(user, request_id)


@router.post("/jobs/{request_id}/bill/items/{item_id}/photos", response_model=JobMediaOut, status_code=201)
def upload_material_photo(
    request_id: UUID,
    item_id: UUID,
    file: UploadFile = File(...),
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.upload_material_photo(user, request_id, item_id, file)


@router.post("/jobs/{request_id}/bill/attachments", response_model=JobMediaOut, status_code=201)
def upload_bill_attachment(
    request_id: UUID,
    file: UploadFile = File(...),
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    return bills.upload_attachment(user, request_id, file)


@router.delete("/jobs/{request_id}/bill/media/{media_id}", status_code=204)
def delete_bill_photo(
    request_id: UUID,
    media_id: UUID,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    bills.delete_media(user, request_id, media_id)
    return Response(status_code=204)


@router.get("/jobs/{request_id}/bill/media/{media_id}/content")
def read_bill_photo(
    request_id: UUID,
    media_id: UUID,
    user: Technician = Depends(get_active_technician),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    content, content_type = bills.technician_content(user, request_id, media_id)
    return Response(content=content, media_type=content_type, headers=content_headers(content_type))


@router.post("/jobs/{request_id}/start", response_model=TechnicianJobResponse)
def start_work(
    request_id: UUID,
    payload: StartWorkRequest,
    user: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """ARRIVED -> IN_PROGRESS with the customer's Start Work code in the body.

    Declared before the generic action route, which no longer accepts "start":
    the body (and so the code) is required, and an old-style POST without one is
    refused (422) without starting anything. The response never contains a code.
    """
    return dispatch.start_with_otp(user, request_id, payload.otp)


@router.post("/jobs/{request_id}/cancel", status_code=204)
def hand_back_job(
    request_id: UUID,
    payload: JobCancelRequest | None = None,
    user: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """The technician holding a job hands it back (ACCEPTED or EN_ROUTE only).

    The booking returns to dispatch at once -- a new round, the next best
    technicians -- and is never offered to this technician again. The reason is a
    fixed choice; it is recorded on their offer and counts against their ranking.
    """
    dispatch.technician_cancel_job(user, request_id, (payload or JobCancelRequest()).reason)
    return Response(status_code=204)


@router.post("/jobs/{request_id}/{action}", response_model=TechnicianJobResponse)
def act_on_job(
    request_id: UUID,
    # Accepting and declining answer an OFFER, not a job already held: they live
    # at /technicians/me/offers/{id}/accept and /decline. Starting work needs the
    # customer's code and has its own route above.
    action: Literal["en-route", "arrived", "complete"],
    user: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    return dispatch.act_on_job(user, request_id, action)
