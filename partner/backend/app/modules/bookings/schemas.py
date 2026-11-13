"""Request and answer shapes of bookings, dispatch, job execution, ratings, start codes and work bills (the old app/schemas)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator, model_validator

from app.modules.bookings.models import (
    BILL_NOTES_MAX_LENGTH,
    ITEM_DESCRIPTION_MAX_LENGTH,
    ITEM_NAME_MAX_LENGTH,
    ITEM_UNIT_MAX_LENGTH,
)
from app.modules.tracking.schemas import TechnicianTrackingStatus

# Where in the property the work is needed. A fixed list, not free text, because a
# service charge will later depend on which area was chosen and a price cannot be
# derived from a typed sentence. The booking form offers exactly these
# (Partner/frontend/src/constants/serviceAreas.js); keep the two lists in step.
SERVICE_AREAS = (
    "Full Property",
    "Interior",
    "Exterior",
    "Living Room / Hall",
    "Bedroom",
    "Kitchen",
    "Bathroom / Toilet",
    "Dining Area",
    "Balcony",
    "Terrace / Roof",
    "Staircase",
    "Basement",
    "Parking / Garage",
    "Garden / Outdoor Area",
    "Office / Workspace",
    "Shop / Showroom",
    "Warehouse / Storage Area",
    "Common Area",
    "Other",
)


_SERVICE_AREA_BY_NAME = {area.casefold(): area for area in SERVICE_AREAS}


class RequesterSessionRequest(BaseModel):
    # The one-time Professional handoff token passed over by window.postMessage. Sent
    # in the request body, never in a URL, and exchanged once for a Partner session.
    handoff_token: str = Field(min_length=20, max_length=4096)


class RequesterProfile(BaseModel):
    id: UUID
    name: str
    role: str  # OWNER | SITE_ENGINEER
    role_label: str
    pincode: str
    area: str | None = None
    has_service_location: bool


class RegisteredLocation(BaseModel):
    """The requester's registered address, resolved to a point.

    The booking map's fallback when the device cannot say precisely where it is.
    `source` records how specific the answer is -- an exact address, the locality
    under the pincode, or the pincode's postal area -- and `zoom` follows from it,
    so the map never claims a precision the lookup did not have.
    """

    latitude: float
    longitude: float
    label: str
    source: str  # address | locality | pincode
    zoom: int


class RequesterSessionResponse(BaseModel):
    # The session itself is in HttpOnly cookies the page cannot read. The page keeps
    # this CSRF token in memory and sends it as X-CSRF-Token on every write.
    expires_in_seconds: int
    requester: RequesterProfile
    csrf_token: str


class BookingCreateRequest(BaseModel):
    technician_type: str = Field(max_length=20)
    # Which catalog service is being booked. Optional: a booking made before the
    # catalog existed, or by any caller that leaves it out, still works.
    #
    # There is deliberately NO price field here, and adding one would be a
    # mistake. The amount is read from `partner.services` at booking time, so a
    # requester cannot propose, influence or tamper with what a job costs --
    # there is nothing for them to send.
    service_id: UUID | None = None
    # Where the work is, as placed on the booking map. This is what the nearby
    # search measures from and where the technician is tracked to -- not the
    # requester's own device position, which is only the map's opening view.
    service_latitude: float | None = Field(default=None, ge=-90, le=90)
    service_longitude: float | None = Field(default=None, ge=-180, le=180)
    # Set only when the point came from the requester's device rather than from
    # their finger on the map, so a wildly imprecise fix can be refused.
    service_accuracy: float | None = Field(default=None, ge=0)
    # The service area chosen on the booking form. It keeps the booking's existing
    # `description` field rather than adding a column, so no migration was needed;
    # what changed is only that the value now has to be one of SERVICE_AREAS.
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("description")
    @classmethod
    def only_a_known_service_area(cls, value: str | None) -> str | None:
        area = (value or "").strip()
        if not area:
            # Still accepted: bookings made before the form asked for an area, and
            # any caller that leaves it out. Nothing in dispatch reads this field.
            return None
        known = _SERVICE_AREA_BY_NAME.get(area.casefold())
        if known is None:
            raise ValueError("Choose one of the listed service areas.")
        # Stored in the list's own spelling, so pricing can match on it exactly.
        return known


class AssignedTechnician(BaseModel):
    name: str
    technician_type: str
    experience_years: int
    area: str | None = None
    match_label: str | None = None
    # Only once the technician has accepted.
    phone: str | None = None
    # The technician's aggregate from real ratings (one decimal; None = no ratings
    # yet). Shown under the same rule as the rest of this card.
    average_rating: float | None = None
    rating_count: int = 0


class BookingResponse(BaseModel):
    id: UUID
    # SR-XXXXXXXX: the reference support and the logs use for this booking.
    reference: str
    status: str
    status_label: str
    technician_type: str
    service_address: str
    service_area: str | None = None
    pincode: str
    service_latitude: float | None = None
    service_longitude: float | None = None
    description: str | None = None
    # The booking's own snapshot, not a live catalog read: an older booking keeps
    # the amount it was made at however the catalog moves afterwards.
    service_id: UUID | None = None
    service_name: str | None = None
    service_kind: str | None = None
    quoted_amount: Decimal | None = None
    currency: str | None = None
    message: str | None = None
    technician: AssignedTechnician | None = None
    can_cancel: bool
    can_retry: bool
    # How many batches of offers have gone out in the current dispatch round.
    dispatch_attempts: int = 0
    # COMPLETED, with a technician, and not rated yet.
    can_rate: bool = False
    created_at: datetime
    updated_at: datetime
    assigned_at: datetime | None = None
    accepted_at: datetime | None = None
    en_route_at: datetime | None = None
    arrived_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None


class TechnicianJobResponse(BaseModel):
    id: UUID
    reference: str
    status: str
    technician_type: str
    requester_type: str
    requester_type_label: str
    service_area: str | None = None
    pincode: str
    service_address: str
    # Only ever populated for a job the technician already holds; a job REQUEST
    # is a JobOffer (app/schemas/dispatch.py), which has no location at all.
    service_latitude: float | None = None
    service_longitude: float | None = None
    description: str | None = None
    # The booking's snapshot of what was booked and its price, as on BookingResponse.
    service_name: str | None = None
    service_kind: str | None = None
    quoted_amount: Decimal | None = None
    currency: str | None = None
    requested_at: datetime
    offer_expires_at: datetime | None = None
    match_label: str | None = None
    # Only once this technician has accepted the job.
    requester_name: str | None = None
    requester_phone: str | None = None
    next_actions: list[str]
    accepted_at: datetime | None = None
    en_route_at: datetime | None = None
    arrived_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    # Set when the booking was cancelled (only requesters can cancel, while it is
    # ACCEPTED or EN_ROUTE once held). No reason or actor is recorded anywhere.
    cancelled_at: datetime | None = None


class TechnicianLocationRequest(BaseModel):
    """One fix from a working technician's device.

    There is no technician id here and no booking id: who is publishing comes from
    the access token, and which job (if any) the position belongs to is the one
    the database says they hold. A body cannot claim an identity or a job.
    """

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, description="Metres of uncertainty, as the device reports it.")
    heading: float | None = Field(default=None, ge=0, le=360)
    speed: float | None = Field(default=None, ge=0, le=150, description="Metres per second.")
    altitude: float | None = Field(default=None, ge=-500, le=9000)
    # When the device took the fix. Only used to drop fixes that arrive out of
    # order, and refused when it is far from server time; freshness is always
    # judged by the server's own clock.
    device_timestamp: datetime | None = None

    @model_validator(mode="after")
    def reject_null_island(self) -> "TechnicianLocationRequest":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("0, 0 is not a valid position.")
        return self


# What dispatch currently makes of a technician (TechnicianPresence.dispatch_status).
DISPATCH_STATUS_AVAILABLE = "AVAILABLE"  # will be offered nearby jobs


DISPATCH_STATUS_OFFERED = "OFFERED"  # answering an offer; no second one meanwhile


DISPATCH_STATUS_ON_JOB = "ON_JOB"  # holding a job


DISPATCH_STATUS_PAUSED = "PAUSED"  # on a break, by choice


DISPATCH_STATUS_OFFLINE = "OFFLINE"  # not working, by choice


DISPATCH_STATUS_LOCATION_STALE = "LOCATION_STALE"  # wants work, but no fresh position


DISPATCH_STATUS_NOT_ELIGIBLE = "NOT_ELIGIBLE"  # registration / identity incomplete


class TechnicianPresence(BaseModel):
    """What the technician's own app needs to know about being reachable for work."""

    work_status: str
    dispatch_status: str
    is_available: bool
    has_location: bool
    location_updated_at: datetime | None = None
    location_fresh: bool
    # True only when every condition of the dispatch search holds.
    ready_for_nearby_jobs: bool
    # Whether the app should be streaming its position now: available, or holding a job.
    tracking_required: bool
    # The cadence and the staleness rule the app must keep to, from server config.
    update_interval_seconds: float
    stale_after_seconds: int
    message: str | None = None


class LocationUpdateResponse(TechnicianPresence):
    """The answer to one fix: the presence it results in, and the job it was for."""

    # False when the database row was not rewritten because the technician has
    # neither moved nor reached the heartbeat; the fix was still accepted.
    persisted: bool
    server_time: datetime
    # The navigation view of the job this position belongs to, if any.
    active_job: TechnicianTrackingStatus | None = None


class JobOffer(BaseModel):
    """A booking offered to a technician who has NOT accepted it yet.

    Everything identifying is deliberately absent. There is no requester name, no
    phone number, no email, no address, no PIN code and no coordinates -- only the
    trade, which part of a property the work is in, and roughly how far away it
    is. A technician decides whether to travel; they do not get to browse who is
    booking until they have committed to the job.
    """

    booking_id: UUID
    reference: str
    technician_type: str
    # The structured Service Area chosen on the booking form ("Bedroom",
    # "Kitchen"...). Named `work_area` here because a booking's `service_area`
    # column means something else entirely -- the post office branch of the
    # address -- and that one is a location, so it is not in this model.
    work_area: str | None = None
    distance_meters: float | None = None
    # What was booked and the price it was booked at: the booking's own snapshot,
    # the same values the requester already sees. Neither says who or where the
    # customer is. All four are None for a booking made before the catalog.
    service_name: str | None = None
    service_kind: str | None = None
    quoted_amount: Decimal | None = None
    currency: str | None = None
    # DISPLAY ONLY: what the technician would earn from `quoted_amount` at the
    # commission configured right now (earnings_service.split_amount). Nothing is
    # recorded from it; the real earning is made at completion, at the rate then.
    # None when there is no price, or the configured rate is not valid.
    estimated_net_amount: Decimal | None = None
    offered_at: datetime
    expires_at: datetime


class OfferOutcome(BaseModel):
    """The answer to Accept or Decline. Losing, lateness and cancellation are 409s with a code."""

    booking_id: UUID
    reference: str
    # ACCEPTED -- this technician won it. DECLINED -- they passed.
    outcome: str
    message: str


class JobCancelRequest(BaseModel):
    """A technician handing back a job they accepted. The reason is a fixed choice,
    never free text, so nothing personal is written into the audit trail."""

    reason: str = Field(default="OTHER", pattern=r"^(VEHICLE_ISSUE|EMERGENCY|TOO_FAR|CUSTOMER_UNREACHABLE|OTHER)$")


class JobStepOut(BaseModel):
    id: UUID
    position: int
    title: str
    completed: bool
    completed_at: datetime | None = None


class JobMediaOut(BaseModel):
    id: UUID
    kind: str  # CUSTOMER | BEFORE | AFTER
    content_type: str
    byte_size: int
    created_at: datetime
    # Whether the caller may remove this photo right now.
    can_delete: bool


class RequesterJobExecutionResponse(BaseModel):
    """The job's progress as the requester sees it: checklist and photos.

    It has no field for the technician's service notes, so they cannot reach a
    requester through this model -- not even by accident later.
    """

    booking_id: UUID
    status: str
    steps: list[JobStepOut]
    steps_total: int
    steps_completed: int
    media: list[JobMediaOut]
    # What the caller may do right now; the server checks each again on the request.
    can_edit_steps: bool
    can_edit_notes: bool
    can_upload: list[str]
    media_limits: dict[str, int]


class JobExecutionResponse(RequesterJobExecutionResponse):
    """The technician's view: the requester's, plus their own service notes."""

    service_notes: str | None = None
    service_notes_updated_at: datetime | None = None


class JobStepUpdateRequest(BaseModel):
    completed: bool


class ServiceNotesUpdateRequest(BaseModel):
    # A generous bound on the raw body; the 2000-character rule is applied after trimming.
    notes: str | None = Field(default=None, max_length=10000)


class RatingSubmitRequest(BaseModel):
    """What the customer sends. Strict: stars must be a JSON integer 1-5 (not "5",
    not 4.5, not missing), tags are strings, and any other field -- such as a
    technician_id -- is refused."""

    model_config = ConfigDict(extra="forbid")

    stars: StrictInt = Field(ge=1, le=5)
    tags: list[StrictStr] = Field(default_factory=list)


class TagOption(BaseModel):
    key: str
    label: str


class RatingView(BaseModel):
    """The customer's view of rating their own booking."""

    # NOT_YET (not completed) | CAN_RATE | RATED
    state: str
    technician_name: str | None = None
    # Only when RATED, and only this customer's own choice.
    stars: int | None = None
    tags: list[TagOption] = Field(default_factory=list)
    # The vocabulary, owned by the backend: group -> options, and stars -> group.
    tag_options: dict[str, list[TagOption]]
    star_groups: dict[str, str]


# What the customer's booking page should show about the code.
STATE_WAITING = "WAITING_FOR_ARRIVAL"  # technician not there yet: no code exists


STATE_READY = "READY"  # a usable code, shown to the customer


STATE_LOCKED = "LOCKED"  # too many wrong tries: get a new code


STATE_LIMITED = "RATE_LIMITED"  # too many codes this hour: wait, then get one


STATE_STARTED = "WORK_STARTED"  # the code did its job; nothing to show


STATE_NOT_APPLICABLE = "NOT_APPLICABLE"  # cancelled, no technician, ...


class StartOtpView(BaseModel):
    """The requester's view. `code` is present only in the READY state."""

    state: str
    code: str | None = None
    expires_at: datetime | None = None
    can_regenerate: bool = False
    # Seconds until a new code can be asked for (cooldown or hourly limit).
    retry_after_seconds: int | None = None
    message: str | None = None


class StartWorkRequest(BaseModel):
    # A plain string: a malformed value is refused with a fixed message and never
    # echoed back by a validation error.
    otp: str = Field(default="", max_length=32)


class BillItemOut(BaseModel):
    id: UUID
    kind: str  # MATERIAL | LABOUR
    name: str  # material name, or the kind of work
    description: str | None = None  # material notes, or the work description
    quantity: Decimal  # units, or hours
    unit: str
    unit_price: Decimal  # unit price, or rate
    amount: Decimal
    work_date: date | None = None  # labour only
    photos: list[JobMediaOut]  # material only
    created_at: datetime


class WorkBillResponse(BaseModel):
    booking_id: UUID
    booking_status: str
    # None: no bill has been started for this job (and none is invented).
    status: Literal["DRAFT", "FINALIZED"] | None = None
    currency: str
    # The booking's price. While DRAFT the totals are computed now; once
    # FINALIZED they are the snapshot taken at finalization.
    service_price: Decimal | None = None
    materials: list[BillItemOut]
    labour: list[BillItemOut]
    materials_total: Decimal
    additional_labour_total: Decimal
    bill_total: Decimal
    notes: str | None = None
    attachments: list[JobMediaOut]
    finalized_at: datetime | None = None
    updated_at: datetime | None = None
    # What the caller may do right now; the server checks each again on the request.
    can_edit: bool
    can_submit: bool
    limits: dict[str, int]


# Bounds keep every line under LINE_AMOUNT_MAX's NUMERIC(12,2) and quantities
# under NUMERIC(10,2); at most two decimals, as stored (never silently rounded).
Quantity = Field(gt=0, le=Decimal("9999.99"), max_digits=6, decimal_places=2)


Price = Field(ge=0, le=Decimal("999999.99"), max_digits=8, decimal_places=2)


class BillItemFields(BaseModel):
    name: str = Field(min_length=1, max_length=ITEM_NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=ITEM_DESCRIPTION_MAX_LENGTH * 2)
    quantity: Decimal = Quantity
    unit: str = Field(min_length=1, max_length=ITEM_UNIT_MAX_LENGTH)
    unit_price: Decimal = Price
    work_date: date | None = None


class BillItemCreateRequest(BillItemFields):
    kind: Literal["MATERIAL", "LABOUR"]


class BillItemUpdateRequest(BillItemFields):
    """A line keeps its kind; everything else may be changed while the bill is a draft."""


class BillNotesUpdateRequest(BaseModel):
    # A generous bound on the raw body; the 2000-character rule is applied after trimming.
    notes: str | None = Field(default=None, max_length=BILL_NOTES_MAX_LENGTH * 5)
