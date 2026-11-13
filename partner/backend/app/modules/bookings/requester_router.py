"""Bookings for House Owners and Site Engineers (the old Partner
app/requester/routes/requester_routes.py, booking part; the session routes are
modules/requesters/router.py). Paths and answers unchanged, under /api/v1/requester.
Every route needs a live requester (booking) session, re-checked against Professional.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Response, UploadFile

from app.auth.dependencies import get_current_requester
from app.modules.bookings.dependencies import (
    get_dispatch_service,
    get_job_execution_service,
    get_rating_service,
    get_registered_location_service,
    get_start_otp_service,
    get_work_bill_service,
)
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.job_execution_service import JobExecutionService, content_headers
from app.modules.bookings.rating_service import RatingService
from app.modules.bookings.requester_location_service import RegisteredLocationService
from app.modules.bookings.schemas import (
    BookingCreateRequest,
    BookingResponse,
    JobMediaOut,
    RatingSubmitRequest,
    RatingView,
    RegisteredLocation,
    RequesterJobExecutionResponse,
    StartOtpView,
    WorkBillResponse,
)
from app.modules.bookings.start_otp_service import StartOtpService
from app.modules.bookings.work_bill_service import WorkBillService

router = APIRouter(prefix="/requester", tags=["Booking (House Owner / Site Engineer)"])


@router.get("/me/registered-location", response_model=RegisteredLocation | None)
def read_registered_location(
    requester=Depends(get_current_requester),
    locations: RegisteredLocationService = Depends(get_registered_location_service),
):
    """Where this account's registered address is, for the booking map to open on
    when the device cannot fix a precise position of its own.

    Answers null, not an error, when the address cannot be placed: the map then
    asks the requester to search, which is still a working booking screen.
    """
    return locations.resolve(requester[0])


@router.post("/bookings", response_model=BookingResponse, status_code=201)
def create_booking(
    payload: BookingCreateRequest,
    requester=Depends(get_current_requester),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """Create a service request and send its first batch of offers."""
    account, role = requester
    # The requester and role come from the verified session, never the body.
    return dispatch.create_booking(account, role, payload)


@router.get("/bookings", response_model=list[BookingResponse])
def list_bookings(requester=Depends(get_current_requester), dispatch: DispatchService = Depends(get_dispatch_service)):
    return dispatch.list_bookings(requester[0])


@router.get("/bookings/{request_id}", response_model=BookingResponse)
def read_booking(
    request_id: UUID,
    requester=Depends(get_current_requester),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    return dispatch.get_booking(requester[0], request_id)


@router.post("/bookings/{request_id}/cancel", response_model=BookingResponse)
def cancel_booking(
    request_id: UUID,
    requester=Depends(get_current_requester),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """Cancel; every outstanding offer is withdrawn in the same transaction."""
    return dispatch.cancel_booking(requester[0], request_id)


@router.post("/bookings/{request_id}/retry", response_model=BookingResponse)
def retry_booking(
    request_id: UUID,
    requester=Depends(get_current_requester),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """A new dispatch round for a booking that ended NO_TECHNICIAN_FOUND or EXPIRED."""
    return dispatch.retry_booking(requester[0], request_id)


# ------------------------------------------------------------------ job execution


@router.get("/bookings/{request_id}/execution", response_model=RequesterJobExecutionResponse)
def read_booking_execution(
    request_id: UUID,
    requester=Depends(get_current_requester),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    return execution.requester_view(requester[0], request_id)


@router.post("/bookings/{request_id}/media", response_model=JobMediaOut, status_code=201)
def upload_problem_photo(
    request_id: UUID,
    file: UploadFile = File(...),
    requester=Depends(get_current_requester),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    # Always a CUSTOMER photo, attributed to the verified booking owner: the
    # request carries no kind and no uploader.
    return execution.requester_upload(requester[0], request_id, file)


@router.delete("/bookings/{request_id}/media/{media_id}", status_code=204)
def delete_problem_photo(
    request_id: UUID,
    media_id: UUID,
    requester=Depends(get_current_requester),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    execution.requester_delete(requester[0], request_id, media_id)
    return Response(status_code=204)


@router.get("/bookings/{request_id}/media/{media_id}/content")
def read_booking_photo(
    request_id: UUID,
    media_id: UUID,
    requester=Depends(get_current_requester),
    execution: JobExecutionService = Depends(get_job_execution_service),
):
    content, content_type = execution.requester_content(requester[0], request_id, media_id)
    return Response(content=content, media_type=content_type, headers=content_headers(content_type))


# ------------------------------------------------------------- start work OTP
# Only the booking's own customer; anyone else gets 404. The code itself is in the
# body only when the booking is ARRIVED, and the answer is never cached.

NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


@router.get("/bookings/{request_id}/start-otp", response_model=StartOtpView)
def read_start_otp(
    request_id: UUID,
    response: Response,
    requester=Depends(get_current_requester),
    start_otps: StartOtpService = Depends(get_start_otp_service),
):
    response.headers.update(NO_STORE)
    return start_otps.requester_view(requester[0], request_id)


@router.post("/bookings/{request_id}/start-otp/regenerate", response_model=StartOtpView)
def regenerate_start_otp(
    request_id: UUID,
    response: Response,
    requester=Depends(get_current_requester),
    start_otps: StartOtpService = Depends(get_start_otp_service),
):
    response.headers.update(NO_STORE)
    return start_otps.regenerate(requester[0], request_id)


# ------------------------------------------------------------------- rating
# The booking's own customer only (anyone else: 404), once the job is COMPLETED,
# once. Whole stars and predefined tags; no text. The technician is taken from
# the booking, never from the request.


@router.get("/bookings/{request_id}/rating", response_model=RatingView)
def read_rating(
    request_id: UUID, requester=Depends(get_current_requester), ratings: RatingService = Depends(get_rating_service)
):
    return ratings.requester_view(requester[0], request_id)


@router.post("/bookings/{request_id}/rating", response_model=RatingView, status_code=201)
def submit_rating(
    request_id: UUID,
    payload: RatingSubmitRequest,
    requester=Depends(get_current_requester),
    ratings: RatingService = Depends(get_rating_service),
):
    return ratings.submit(requester[0], request_id, payload)


# ---------------------------------------------------------------------- work bill
# Read-only for the requester: there is deliberately no endpoint here that writes
# to a bill, and no approval -- the bill is informational.


@router.get("/bookings/{request_id}/bill", response_model=WorkBillResponse)
def read_booking_bill(
    request_id: UUID, requester=Depends(get_current_requester), bills: WorkBillService = Depends(get_work_bill_service)
):
    return bills.requester_view(requester[0], request_id)


@router.get("/bookings/{request_id}/bill/media/{media_id}/content")
def read_booking_bill_photo(
    request_id: UUID,
    media_id: UUID,
    requester=Depends(get_current_requester),
    bills: WorkBillService = Depends(get_work_bill_service),
):
    content, content_type = bills.requester_content(requester[0], request_id, media_id)
    return Response(content=content, media_type=content_type, headers=content_headers(content_type))
