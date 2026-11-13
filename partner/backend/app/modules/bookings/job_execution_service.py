"""Job execution: the checklist, the technician's notes and the private job photos.

None of this is part of the job's status workflow. ARRIVED -> IN_PROGRESS ->
COMPLETED is moved by DispatchService.act_on_job alone, and nothing here reads
or changes `status`; it only decides, from the status, what may be written.

Who may do what (every refusal of somebody with no claim on the booking is a
404, exactly as an unknown id, so ids cannot be probed):

    requester who owns the booking
        CUSTOMER photos: add / remove their own until the technician arrives
        view steps and every photo of the booking (never the technician's notes)
    technician holding the booking (ACCEPTED ... COMPLETED)
        view CUSTOMER photos -- only now, the same point contact details appear
        BEFORE photos: add while ARRIVED or IN_PROGRESS
        AFTER photos: add while IN_PROGRESS
        remove their own BEFORE / AFTER photos until the job is COMPLETED
        tick steps and edit notes while IN_PROGRESS only
    anybody else, including a technician who was only offered the job
        nothing
"""

import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.database.types import naive_utc_now
from app.modules.bookings.job_media_storage import JobMediaStorage, process_image, read_upload
from app.modules.bookings.models import (
    MEDIA_AFTER,
    MEDIA_BEFORE,
    MEDIA_CUSTOMER,
    SERVICE_NOTES_MAX_LENGTH,
    STATUS_ACCEPTED,
    STATUS_ARRIVED,
    STATUS_COMPLETED,
    STATUS_EN_ROUTE,
    STATUS_EXPIRED,
    STATUS_IN_PROGRESS,
    STATUS_NO_TECHNICIAN_FOUND,
    STATUS_OFFERED,
    STATUS_SEARCHING,
    ServiceRequest,
    ServiceRequestMedia,
    ServiceRequestStep,
)
from app.modules.bookings.repository import JobExecutionRepository, ServiceRequestRepository
from app.modules.bookings.schemas import JobExecutionResponse, JobMediaOut, JobStepOut, RequesterJobExecutionResponse
from app.modules.catalog.models import Service
from app.modules.identity.models import Technician
from app.modules.requesters.repository import Requester

logger = logging.getLogger(__name__)

# A technician holds a booking from acceptance on -- the same statuses in which
# DispatchService shows them the customer's contact details.
TECHNICIAN_ACCESS_STATUSES = (STATUS_ACCEPTED, STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS, STATUS_COMPLETED)
# The requester may add or remove problem photos until the technician is there.
CUSTOMER_PHOTO_STATUSES = (
    STATUS_SEARCHING,
    STATUS_OFFERED,
    STATUS_ACCEPTED,
    STATUS_EN_ROUTE,
    STATUS_NO_TECHNICIAN_FOUND,
    STATUS_EXPIRED,
)
TECHNICIAN_UPLOAD_STATUSES = {
    MEDIA_BEFORE: (STATUS_ARRIVED, STATUS_IN_PROGRESS),
    MEDIA_AFTER: (STATUS_IN_PROGRESS,),
}
# Until the job is COMPLETED -- in practice while the technician is on site.
TECHNICIAN_DELETE_STATUSES = (STATUS_ARRIVED, STATUS_IN_PROGRESS)

JOB_NOT_FOUND = "Job not found"
BOOKING_NOT_FOUND = "Booking not found"
PHOTO_NOT_FOUND = "Photo not found"


def media_limits() -> dict[str, int]:
    return {
        MEDIA_CUSTOMER: settings.job_media_max_customer_photos,
        MEDIA_BEFORE: settings.job_media_max_before_photos,
        MEDIA_AFTER: settings.job_media_max_after_photos,
    }


def snapshot_steps(database: Session, booking: ServiceRequest, service: Service | None) -> int:
    """Copy the service's active checklist onto a NEW booking, in the booking's own
    transaction. A booking without a service, or a service without templates,
    simply gets no steps. Returns how many were copied."""
    repository = JobExecutionRepository(database)
    if service is None:
        return 0
    templates = repository.list_active_step_templates(service.id)
    for template in templates:
        repository.add(
            ServiceRequestStep(
                service_request_id=booking.id,
                position=template.position,
                title=template.title,
                template_id=template.id,
            )
        )
    return len(templates)


def _step_out(step: ServiceRequestStep) -> JobStepOut:
    return JobStepOut(
        id=step.id,
        position=step.position,
        title=step.title,
        completed=step.completed_at is not None,
        completed_at=step.completed_at,
    )


def _media_out(media: ServiceRequestMedia, can_delete: bool) -> JobMediaOut:
    # Field by field: storage_key is internal and has no place in the model.
    return JobMediaOut(
        id=media.id,
        kind=media.kind,
        content_type=media.content_type,
        byte_size=media.byte_size,
        created_at=media.created_at,
        can_delete=can_delete,
    )


def content_headers(content_type: str) -> dict[str, str]:
    extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(content_type, "bin")
    return {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="photo.{extension}"',
    }


class JobExecutionService:
    def __init__(
        self,
        repository: JobExecutionRepository,
        bookings: ServiceRequestRepository,
        storage: JobMediaStorage | None = None,
    ):
        self.repository = repository
        self.bookings = bookings
        self.storage = storage or JobMediaStorage()

    # ----------------------------------------------------------------- access

    def _technician_booking(self, technician: Technician, request_id, *, lock: bool = False) -> ServiceRequest:
        booking = self.bookings.lock(request_id) if lock else self.bookings.get(request_id)
        if not booking or booking.technician_id != technician.id or booking.status not in TECHNICIAN_ACCESS_STATUSES:
            raise HTTPException(status_code=404, detail=JOB_NOT_FOUND)
        return booking

    def _requester_booking(self, requester: Requester, request_id, *, lock: bool = False) -> ServiceRequest:
        booking = self.bookings.lock(request_id) if lock else self.bookings.get(request_id)
        if not booking or booking.requested_by_user_id != requester.id:
            raise HTTPException(status_code=404, detail=BOOKING_NOT_FOUND)
        return booking

    def _media_of(self, booking: ServiceRequest, media_id) -> ServiceRequestMedia:
        media = self.repository.find_job_media(booking.id, media_id)
        if media is None:
            raise HTTPException(status_code=404, detail=PHOTO_NOT_FOUND)
        return media

    # ------------------------------------------------------------------ views

    def _steps(self, booking: ServiceRequest) -> list[ServiceRequestStep]:
        return self.repository.list_steps(booking.id)

    def _media(self, booking: ServiceRequest) -> list[ServiceRequestMedia]:
        return self.repository.list_job_media(booking.id)

    def _view(
        self, booking: ServiceRequest, *, technician: Technician | None = None, requester: Requester | None = None
    ) -> JobExecutionResponse:
        steps = self._steps(booking)
        media = []
        for item in self._media(booking):
            if technician is not None:
                can_delete = (
                    item.uploaded_by_technician_id == technician.id and booking.status in TECHNICIAN_DELETE_STATUSES
                )
            else:
                can_delete = (
                    item.kind == MEDIA_CUSTOMER
                    and item.uploaded_by_requester_id == requester.id
                    and booking.status in CUSTOMER_PHOTO_STATUSES
                )
            media.append(_media_out(item, can_delete))
        if technician is not None:
            can_upload = [kind for kind, statuses in TECHNICIAN_UPLOAD_STATUSES.items() if booking.status in statuses]
            editable = booking.status == STATUS_IN_PROGRESS
        else:
            can_upload = [MEDIA_CUSTOMER] if booking.status in CUSTOMER_PHOTO_STATUSES else []
            editable = False
        return JobExecutionResponse(
            booking_id=booking.id,
            status=booking.status,
            steps=[_step_out(step) for step in steps],
            steps_total=len(steps),
            steps_completed=sum(1 for step in steps if step.completed_at is not None),
            service_notes=booking.service_notes,
            service_notes_updated_at=booking.service_notes_updated_at,
            media=media,
            can_edit_steps=editable,
            can_edit_notes=editable,
            can_upload=can_upload,
            media_limits=media_limits(),
        )

    def technician_view(self, technician: Technician, request_id) -> JobExecutionResponse:
        return self._view(self._technician_booking(technician, request_id), technician=technician)

    def requester_view(self, requester: Requester, request_id) -> RequesterJobExecutionResponse:
        # The technician's service notes stay with the technician: the requester's
        # model has no field for them.
        view = self._view(self._requester_booking(requester, request_id), requester=requester)
        return RequesterJobExecutionResponse(**view.model_dump(exclude={"service_notes", "service_notes_updated_at"}))

    # -------------------------------------------------------- checklist, notes

    def set_step(self, technician: Technician, request_id, step_id, completed: bool) -> JobExecutionResponse:
        booking = self._technician_booking(technician, request_id, lock=True)
        if booking.status != STATUS_IN_PROGRESS:
            raise HTTPException(status_code=409, detail="Job steps can only be updated while the work is in progress.")
        step = self.repository.find_step(booking.id, step_id)
        if step is None:
            raise HTTPException(status_code=404, detail="Step not found")
        if completed and step.completed_at is None:
            step.completed_at = naive_utc_now()
        elif not completed:
            step.completed_at = None
        self.repository.commit()
        return self._view(booking, technician=technician)

    def set_notes(self, technician: Technician, request_id, notes: str | None) -> JobExecutionResponse:
        booking = self._technician_booking(technician, request_id, lock=True)
        if booking.status != STATUS_IN_PROGRESS:
            raise HTTPException(
                status_code=409, detail="Service notes can only be edited while the work is in progress."
            )
        cleaned = (notes or "").strip() or None
        if cleaned is not None and len(cleaned) > SERVICE_NOTES_MAX_LENGTH:
            raise HTTPException(
                status_code=422, detail=f"Service notes can be at most {SERVICE_NOTES_MAX_LENGTH} characters."
            )
        booking.service_notes = cleaned
        booking.service_notes_updated_at = naive_utc_now()
        self.repository.commit()
        return self._view(booking, technician=technician)

    # ----------------------------------------------------------------- photos

    def _store_photo(self, request_id, kind: str, upload, authorize) -> JobMediaOut:
        """Shared upload path. `authorize(lock)` returns the booking, refusing the
        caller or the current status; it runs before the (slow) image work and
        again under the row lock, where the count is checked."""
        authorize(False)
        processed = process_image(read_upload(upload.file))

        # The locked read must see the booking as it is now, not as the first
        # check loaded it before the image work.
        self.repository.expire_all()
        booking, uploader = authorize(True)
        limit = media_limits()[kind]
        existing = self.repository.count_media_of_kind(booking.id, kind)
        if existing >= limit:
            raise HTTPException(status_code=409, detail=f"You can add at most {limit} photos here.")

        storage_key = self.storage.store(processed.content)
        try:
            media = ServiceRequestMedia(
                service_request_id=booking.id,
                kind=kind,
                storage_key=storage_key,
                content_type=processed.content_type,
                byte_size=len(processed.content),
                created_at=naive_utc_now(),
                **uploader,
            )
            self.repository.add(media)
            self.repository.commit()
        except Exception:
            self.repository.rollback()
            self.storage.delete(storage_key)
            raise
        return _media_out(media, can_delete=True)

    def technician_upload(self, technician: Technician, request_id, kind: str, upload) -> JobMediaOut:
        if kind not in TECHNICIAN_UPLOAD_STATUSES:
            raise HTTPException(status_code=422, detail="Choose BEFORE or AFTER.")

        def authorize(lock: bool):
            booking = self._technician_booking(technician, request_id, lock=lock)
            if booking.status not in TECHNICIAN_UPLOAD_STATUSES[kind]:
                when = "once you have arrived" if kind == MEDIA_BEFORE else "while the work is in progress"
                raise HTTPException(status_code=409, detail=f"{kind.title()} photos can only be added {when}.")
            return booking, {"uploaded_by_technician_id": technician.id}

        return self._store_photo(request_id, kind, upload, authorize)

    def requester_upload(self, requester: Requester, request_id, upload) -> JobMediaOut:
        def authorize(lock: bool):
            booking = self._requester_booking(requester, request_id, lock=lock)
            if booking.status not in CUSTOMER_PHOTO_STATUSES:
                raise HTTPException(status_code=409, detail="Photos can only be added before the technician arrives.")
            # The uploader is the verified booking owner -- never a value from the request.
            return booking, {"uploaded_by_requester_id": booking.requested_by_user_id}

        return self._store_photo(request_id, MEDIA_CUSTOMER, upload, authorize)

    def _remove(self, media: ServiceRequestMedia) -> None:
        storage_key = media.storage_key
        self.repository.remove(media)
        self.repository.commit()
        # After the commit: at worst a file outlives its row, which the orphan
        # script finds -- never a row pointing at a file already gone.
        self.storage.delete(storage_key)

    def technician_delete(self, technician: Technician, request_id, media_id) -> None:
        booking = self._technician_booking(technician, request_id, lock=True)
        media = self._media_of(booking, media_id)
        if media.uploaded_by_technician_id != technician.id:
            raise HTTPException(status_code=403, detail="You can only remove photos you added.")
        if booking.status not in TECHNICIAN_DELETE_STATUSES:
            raise HTTPException(status_code=409, detail="Photos can no longer be removed from this job.")
        self._remove(media)

    def requester_delete(self, requester: Requester, request_id, media_id) -> None:
        booking = self._requester_booking(requester, request_id, lock=True)
        media = self._media_of(booking, media_id)
        if media.kind != MEDIA_CUSTOMER or media.uploaded_by_requester_id != requester.id:
            raise HTTPException(status_code=403, detail="You can only remove photos you added.")
        if booking.status not in CUSTOMER_PHOTO_STATUSES:
            raise HTTPException(
                status_code=409, detail="Photos can no longer be removed once the technician has arrived."
            )
        self._remove(media)

    # ---------------------------------------------------------------- content

    def technician_content(self, technician: Technician, request_id, media_id) -> tuple[bytes, str]:
        booking = self._technician_booking(technician, request_id)
        media = self._media_of(booking, media_id)
        return self.storage.read(media.storage_key), media.content_type

    def requester_content(self, requester: Requester, request_id, media_id) -> tuple[bytes, str]:
        booking = self._requester_booking(requester, request_id)
        media = self._media_of(booking, media_id)
        return self.storage.read(media.storage_key), media.content_type
