"""The work bill: materials and additional labour on top of the service price.

Informational only. Nobody approves a bill, nothing is paid through it, and it
never moves the job's status. The technician's earning is computed from the
booking's quoted_amount alone (earnings_service) -- never from a bill.

Life of a bill
--------------
    no bill      until the technician's first entry (a line, a photo, a note);
                 a job with nothing billed never gets one
    DRAFT        editable by the technician holding the job, while IN_PROGRESS only
    FINALIZED    by Submit bill (the job stays IN_PROGRESS), or at the latest in
                 the transaction that completes the job; read-only from then on,
                 and submitting again changes nothing

Who may do what (a caller with no claim on the booking gets a 404, exactly as an
unknown id, so ids cannot be probed):

    technician holding the booking (ACCEPTED ... COMPLETED)
        view the bill; change a DRAFT bill while IN_PROGRESS; submit it
    requester who owns the booking
        view the bill, read-only -- there is no requester write endpoint at all
    anybody else
        nothing

Every write locks the booking row first -- the same lock the completion takes --
so a bill can never change while, or after, it is finalized.

Money is Decimal, rounded to the paisa half-up, as in earnings_service:

    line amount             = round(quantity * unit_price, 2)
    materials_total         = sum of MATERIAL amounts
    additional_labour_total = sum of LABOUR amounts
    bill_total              = coalesce(service_price, 0) + materials_total + additional_labour_total
"""

from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.database.types import naive_utc_now
from app.modules.bookings.job_execution_service import (
    BOOKING_NOT_FOUND,
    JOB_NOT_FOUND,
    PHOTO_NOT_FOUND,
    TECHNICIAN_ACCESS_STATUSES,
)
from app.modules.bookings.job_media_storage import JobMediaStorage, process_image, read_upload
from app.modules.bookings.models import (
    BILL_DRAFT,
    BILL_FINALIZED,
    BILL_NOTES_MAX_LENGTH,
    ITEM_DESCRIPTION_MAX_LENGTH,
    ITEM_LABOUR,
    ITEM_MATERIAL,
    LINE_AMOUNT_MAX,
    MEDIA_BILL,
    MEDIA_MATERIAL,
    STATUS_IN_PROGRESS,
    ServiceRequest,
    ServiceRequestBill,
    ServiceRequestBillItem,
    ServiceRequestMedia,
)
from app.modules.bookings.repository import ServiceRequestRepository, WorkBillRepository
from app.modules.bookings.schemas import BillItemFields, BillItemOut, JobMediaOut, WorkBillResponse
from app.modules.identity.models import Technician
from app.modules.requesters.repository import Requester
from app.modules.technicians.earnings_service import INDIA

PAISA = Decimal("0.01")
ZERO = Decimal("0.00")
CURRENCY_INR = "INR"

NOT_IN_PROGRESS = "The work bill can only be changed while the work is in progress."
ALREADY_FINALIZED = "This bill has been submitted and can no longer be changed."
ITEM_NOT_FOUND = "Bill line not found"


def bill_limits() -> dict[str, int]:
    return {
        "items": settings.work_bill_max_items,
        "material_photos": settings.work_bill_max_material_photos,
        "attachments": settings.work_bill_max_attachments,
    }


def line_amount(quantity: Decimal, unit_price: Decimal) -> Decimal:
    return (Decimal(quantity) * Decimal(unit_price)).quantize(PAISA, rounding=ROUND_HALF_UP)


def bill_totals(service_price: Decimal | None, items) -> tuple[Decimal, Decimal, Decimal]:
    """(materials_total, additional_labour_total, bill_total)."""
    materials = sum((Decimal(item.amount) for item in items if item.kind == ITEM_MATERIAL), ZERO)
    labour = sum((Decimal(item.amount) for item in items if item.kind == ITEM_LABOUR), ZERO)
    price = Decimal(service_price).quantize(PAISA) if service_price is not None else ZERO
    return materials.quantize(PAISA), labour.quantize(PAISA), (price + materials + labour).quantize(PAISA)


def _items(database: Session, bill: ServiceRequestBill) -> list[ServiceRequestBillItem]:
    repository = WorkBillRepository(database)
    return repository.list_items(bill.id)


def _bill_of(database: Session, booking: ServiceRequest) -> ServiceRequestBill | None:
    repository = WorkBillRepository(database)
    return repository.find_bill(booking.id)


def finalize_bill(database: Session, booking: ServiceRequest, bill: ServiceRequestBill, now: datetime) -> None:
    """Snapshot the totals and freeze the bill, in the CURRENT transaction. The
    caller holds the booking's row lock and commits."""
    materials, labour, total = bill_totals(booking.quoted_amount, _items(database, bill))
    bill.service_price = Decimal(booking.quoted_amount).quantize(PAISA) if booking.quoted_amount is not None else None
    bill.materials_total = materials
    bill.additional_labour_total = labour
    bill.bill_total = total
    bill.status = BILL_FINALIZED
    bill.finalized_at = now
    bill.updated_at = now


def finalize_bill_for_completion(
    database: Session, booking: ServiceRequest, now: datetime
) -> ServiceRequestBill | None:
    """Called by the completion transaction, under the booking's row lock.

    A DRAFT bill is finalized now, with the job, so a completed job never has a
    bill that could still change. A FINALIZED bill is left exactly as it is. A
    job without a bill completes without one -- none is invented. Never refuses:
    the bill does not stand in the way of completing a job.
    """
    bill = _bill_of(database, booking)
    if bill is not None and bill.status == BILL_DRAFT:
        finalize_bill(database, booking, bill, now)
    return bill


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


def _india_date(moment: datetime) -> date:
    return moment.replace(tzinfo=UTC).astimezone(INDIA).date()


class WorkBillService:
    def __init__(
        self, repository: WorkBillRepository, bookings: ServiceRequestRepository, storage: JobMediaStorage | None = None
    ):
        self.repository = repository
        # Still needed for this module's session-taking helpers (_bill_of, _items,
        # finalize_bill), whose signatures the completion path in dispatch_service uses.
        self.database = repository.database
        self.bookings = bookings
        self.storage = storage or JobMediaStorage()

    # ----------------------------------------------------------------- access

    def _technician_booking(self, technician: Technician, request_id, *, lock: bool = False) -> ServiceRequest:
        booking = self.bookings.lock(request_id) if lock else self.bookings.get(request_id)
        if not booking or booking.technician_id != technician.id or booking.status not in TECHNICIAN_ACCESS_STATUSES:
            raise HTTPException(status_code=404, detail=JOB_NOT_FOUND)
        return booking

    def _requester_booking(self, requester: Requester, request_id) -> ServiceRequest:
        booking = self.bookings.get(request_id)
        if not booking or booking.requested_by_user_id != requester.id:
            raise HTTPException(status_code=404, detail=BOOKING_NOT_FOUND)
        return booking

    def _editable(
        self, technician: Technician, request_id, *, create: bool, lock: bool = True
    ) -> tuple[ServiceRequest, ServiceRequestBill | None]:
        """The (locked) booking and its DRAFT bill -- created now if `create` and
        there is none -- or a refusal: 404 for somebody else's job, 409 when the
        job is not IN_PROGRESS or the bill is already FINALIZED."""
        booking = self._technician_booking(technician, request_id, lock=lock)
        if booking.status != STATUS_IN_PROGRESS:
            raise HTTPException(status_code=409, detail=NOT_IN_PROGRESS)
        bill = _bill_of(self.database, booking)
        if bill is not None and bill.status != BILL_DRAFT:
            raise HTTPException(status_code=409, detail=ALREADY_FINALIZED)
        if bill is None and create:
            bill = ServiceRequestBill(service_request_id=booking.id, status=BILL_DRAFT, currency=CURRENCY_INR)
            self.repository.add(bill)
            self.repository.flush()
        return booking, bill

    def _item_of(self, bill: ServiceRequestBill | None, item_id) -> ServiceRequestBillItem:
        item = None
        if bill is not None:
            item = self.repository.find_item(bill.id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
        return item

    def _bill_media_of(self, booking: ServiceRequest, media_id) -> ServiceRequestMedia:
        media = self.repository.find_bill_media(booking.id, media_id)
        if media is None:
            raise HTTPException(status_code=404, detail=PHOTO_NOT_FOUND)
        return media

    # ------------------------------------------------------------------- view

    def _view(self, booking: ServiceRequest, *, technician: Technician | None = None) -> WorkBillResponse:
        bill = _bill_of(self.database, booking)
        items = _items(self.database, bill) if bill is not None else []
        media = []
        if bill is not None:
            media = self.repository.list_bill_media(booking.id)
        editable = (
            technician is not None
            and booking.status == STATUS_IN_PROGRESS
            and (bill is None or bill.status == BILL_DRAFT)
        )

        def media_out(item: ServiceRequestMedia) -> JobMediaOut:
            return _media_out(item, can_delete=editable and item.uploaded_by_technician_id == technician.id)

        def item_out(item: ServiceRequestBillItem) -> BillItemOut:
            photos = [media_out(photo) for photo in media if photo.bill_item_id == item.id]
            return BillItemOut(
                id=item.id,
                kind=item.kind,
                name=item.name,
                description=item.description,
                quantity=item.quantity,
                unit=item.unit,
                unit_price=item.unit_price,
                amount=item.amount,
                work_date=item.work_date,
                photos=photos,
                created_at=item.created_at,
            )

        if bill is not None and bill.status == BILL_FINALIZED:
            service_price = bill.service_price
            materials, labour, total = bill.materials_total, bill.additional_labour_total, bill.bill_total
        else:
            service_price = booking.quoted_amount
            materials, labour, total = bill_totals(service_price, items)
        return WorkBillResponse(
            booking_id=booking.id,
            booking_status=booking.status,
            status=bill.status if bill is not None else None,
            currency=(bill.currency if bill is not None else booking.currency) or CURRENCY_INR,
            service_price=service_price,
            materials=[item_out(item) for item in items if item.kind == ITEM_MATERIAL],
            labour=[item_out(item) for item in items if item.kind == ITEM_LABOUR],
            materials_total=materials,
            additional_labour_total=labour,
            bill_total=total,
            notes=bill.notes if bill is not None else None,
            attachments=[media_out(item) for item in media if item.kind == MEDIA_BILL],
            finalized_at=bill.finalized_at if bill is not None else None,
            updated_at=bill.updated_at if bill is not None else None,
            can_edit=editable,
            can_submit=editable and bill is not None,
            limits=bill_limits(),
        )

    def technician_view(self, technician: Technician, request_id) -> WorkBillResponse:
        return self._view(self._technician_booking(technician, request_id), technician=technician)

    def requester_view(self, requester: Requester, request_id) -> WorkBillResponse:
        return self._view(self._requester_booking(requester, request_id))

    # ------------------------------------------------------------------ lines

    def _apply_fields(
        self, booking: ServiceRequest, item: ServiceRequestBillItem, kind: str, fields: BillItemFields
    ) -> None:
        name = fields.name.strip()
        unit = fields.unit.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Enter a name.")
        if not unit:
            raise HTTPException(status_code=422, detail="Enter a unit.")
        description = (fields.description or "").strip() or None
        if description is not None and len(description) > ITEM_DESCRIPTION_MAX_LENGTH:
            raise HTTPException(
                status_code=422, detail=f"The description can be at most {ITEM_DESCRIPTION_MAX_LENGTH} characters."
            )
        if kind == ITEM_MATERIAL and fields.work_date is not None:
            raise HTTPException(status_code=422, detail="A material line has no work date.")
        if fields.work_date is not None:
            today = _india_date(naive_utc_now())
            if fields.work_date > today or fields.work_date < _india_date(booking.created_at):
                raise HTTPException(status_code=422, detail="The work date must be between the booking date and today.")
        amount = line_amount(fields.quantity, fields.unit_price)
        if amount > LINE_AMOUNT_MAX:
            raise HTTPException(status_code=422, detail="One line can come to at most ₹10,00,000.")
        item.kind = kind
        item.name = name
        item.unit = unit
        item.description = description
        item.quantity = fields.quantity
        item.unit_price = fields.unit_price
        item.amount = amount
        item.work_date = fields.work_date

    def add_item(self, technician: Technician, request_id, kind: str, fields: BillItemFields) -> WorkBillResponse:
        booking, bill = self._editable(technician, request_id, create=True)
        count = self.repository.count_items(bill.id)
        if count >= settings.work_bill_max_items:
            raise HTTPException(
                status_code=409, detail=f"A bill can have at most {settings.work_bill_max_items} lines."
            )
        now = naive_utc_now()
        item = ServiceRequestBillItem(bill_id=bill.id, created_at=now, updated_at=now)
        self._apply_fields(booking, item, kind, fields)
        self.repository.add(item)
        bill.updated_at = now
        self.repository.commit()
        return self._view(booking, technician=technician)

    def update_item(self, technician: Technician, request_id, item_id, fields: BillItemFields) -> WorkBillResponse:
        booking, bill = self._editable(technician, request_id, create=False)
        item = self._item_of(bill, item_id)
        self._apply_fields(booking, item, item.kind, fields)
        now = naive_utc_now()
        item.updated_at = now
        bill.updated_at = now
        self.repository.commit()
        return self._view(booking, technician=technician)

    def delete_item(self, technician: Technician, request_id, item_id) -> WorkBillResponse:
        booking, bill = self._editable(technician, request_id, create=False)
        item = self._item_of(bill, item_id)
        photos = self.repository.list_item_photos(item.id)
        storage_keys = [photo.storage_key for photo in photos]
        for photo in photos:
            self.repository.remove(photo)
        # Photos first: the database would otherwise cascade them away under the ORM.
        self.repository.flush()
        self.repository.remove(item)
        bill.updated_at = naive_utc_now()
        self.repository.commit()
        # After the commit, as for every photo: at worst a file outlives its row.
        for storage_key in storage_keys:
            self.storage.delete(storage_key)
        return self._view(booking, technician=technician)

    # ------------------------------------------------------------------ notes

    def set_notes(self, technician: Technician, request_id, notes: str | None) -> WorkBillResponse:
        cleaned = (notes or "").strip() or None
        if cleaned is not None and len(cleaned) > BILL_NOTES_MAX_LENGTH:
            raise HTTPException(
                status_code=422, detail=f"Bill notes can be at most {BILL_NOTES_MAX_LENGTH} characters."
            )
        # Clearing notes on a job with no bill must not create an empty one.
        booking, bill = self._editable(technician, request_id, create=cleaned is not None)
        if bill is not None:
            bill.notes = cleaned
            bill.updated_at = naive_utc_now()
            self.repository.commit()
        return self._view(booking, technician=technician)

    # ----------------------------------------------------------------- submit

    def submit(self, technician: Technician, request_id) -> WorkBillResponse:
        """Finalize the bill. The job stays IN_PROGRESS; nothing else changes.
        Submitting a bill that is already FINALIZED returns it unchanged."""
        booking = self._technician_booking(technician, request_id, lock=True)
        bill = _bill_of(self.database, booking)
        if bill is not None and bill.status == BILL_FINALIZED:
            return self._view(booking, technician=technician)
        if booking.status != STATUS_IN_PROGRESS:
            raise HTTPException(status_code=409, detail=NOT_IN_PROGRESS)
        if bill is None:
            raise HTTPException(
                status_code=409,
                detail="There is no bill to submit yet: add a material, labour, attachment or note first.",
            )
        finalize_bill(self.database, booking, bill, naive_utc_now())
        self.repository.commit()
        return self._view(booking, technician=technician)

    # ----------------------------------------------------------------- photos

    def _store(self, technician: Technician, request_id, kind: str, upload, item_id=None) -> JobMediaOut:
        """Checked before the (slow) image work and again under the row lock,
        where the count is taken -- the job-photo upload path, for bill photos."""

        def authorize(lock: bool):
            # A photo for a line needs that line, so its bill exists already; an
            # attachment may be the bill's first entry and then creates it.
            booking, bill = self._editable(technician, request_id, create=lock and item_id is None, lock=lock)
            if item_id is not None:
                item = self._item_of(bill, item_id)
                if item.kind != ITEM_MATERIAL:
                    raise HTTPException(status_code=422, detail="Photos can be added to material lines only.")
            return booking, bill

        authorize(False)
        processed = process_image(read_upload(upload.file))

        # The locked read must see the booking and bill as they are now, not as
        # the first check loaded them before the image work.
        self.repository.expire_all()
        booking, bill = authorize(True)
        query = self.repository.query_media_count(booking.id)
        if item_id is not None:
            limit = settings.work_bill_max_material_photos
            existing = query.filter(ServiceRequestMedia.bill_item_id == item_id).scalar()
        else:
            limit = settings.work_bill_max_attachments
            existing = query.filter(ServiceRequestMedia.kind == MEDIA_BILL).scalar()
        if existing >= limit:
            raise HTTPException(status_code=409, detail=f"You can add at most {limit} photos here.")

        storage_key = self.storage.store(processed.content)
        try:
            now = naive_utc_now()
            media = ServiceRequestMedia(
                service_request_id=booking.id,
                kind=kind,
                bill_item_id=item_id,
                uploaded_by_technician_id=technician.id,
                storage_key=storage_key,
                content_type=processed.content_type,
                byte_size=len(processed.content),
                created_at=now,
            )
            self.repository.add(media)
            bill.updated_at = now
            self.repository.commit()
        except Exception:
            self.repository.rollback()
            self.storage.delete(storage_key)
            raise
        return _media_out(media, can_delete=True)

    def upload_material_photo(self, technician: Technician, request_id, item_id, upload) -> JobMediaOut:
        return self._store(technician, request_id, MEDIA_MATERIAL, upload, item_id=item_id)

    def upload_attachment(self, technician: Technician, request_id, upload) -> JobMediaOut:
        return self._store(technician, request_id, MEDIA_BILL, upload)

    def delete_media(self, technician: Technician, request_id, media_id) -> None:
        booking, bill = self._editable(technician, request_id, create=False)
        media = self._bill_media_of(booking, media_id)
        if media.uploaded_by_technician_id != technician.id:
            raise HTTPException(status_code=403, detail="You can only remove photos you added.")
        storage_key = media.storage_key
        self.repository.remove(media)
        if bill is not None:
            bill.updated_at = naive_utc_now()
        self.repository.commit()
        self.storage.delete(storage_key)

    # ---------------------------------------------------------------- content

    def technician_content(self, technician: Technician, request_id, media_id) -> tuple[bytes, str]:
        media = self._bill_media_of(self._technician_booking(technician, request_id), media_id)
        return self.storage.read(media.storage_key), media.content_type

    def requester_content(self, requester: Requester, request_id, media_id) -> tuple[bytes, str]:
        media = self._bill_media_of(self._requester_booking(requester, request_id), media_id)
        return self.storage.read(media.storage_key), media.content_type
