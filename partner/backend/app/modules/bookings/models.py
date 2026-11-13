"""Booking tables (technical-architecture.md section 11, domains Bookings and Job execution).

    bookings                   was service_requests; requested_by_user_id -> professional.users
                               (RESTRICT, cross-schema: BOOKING_REQUESTER_FOREIGN_KEY);
                               service_id -> catalog_service_id
    booking_offers             was service_request_assignments
    booking_destinations       was service_request_tracking; PK booking_id
    booking_checklist_steps    was service_request_steps
    booking_media              was service_request_media
    booking_start_codes        was service_request_start_otps
    booking_work_bills         was service_request_bills
    booking_work_bill_items    was service_request_bill_items
    booking_ratings            was service_request_ratings
    booking_rating_tags        was service_request_rating_tags; composite PK (rating_id, tag)

Every column named service_request_id is booking_id. The Python names stay the old ones
(ServiceRequest, ServiceRequestAssignment, service_request_id, service_id) so the ported
services are unchanged. Times are timestamptz, read as naive UTC.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CHAR,
    DDL,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, object_session, relationship

from app.database.base import Base, new_uuid7
from app.database.types import NaiveUtcTimestamp, naive_utc_now
from app.modules.technicians.models import TECHNICIAN_TYPE_CHECK

# The booking's state machine. Every change of `status` goes through
# `transition()` below, which refuses anything not listed in ALLOWED_TRANSITIONS.
#
#   SEARCHING --> OFFERED --(first valid acceptance)--> ACCEPTED --> EN_ROUTE --> ARRIVED --> IN_PROGRESS --> COMPLETED
#      |             |  ^ next batch                       |             |
#      |             |  |                                  +--- technician cancels: back to SEARCHING, re-dispatched
#      |             +--+
#      +--> NO_TECHNICIAN_FOUND  (nobody eligible)         ACCEPTED is "assigned": one technician holds it.
#      +--> EXPIRED              (MAX_DISPATCH_ATTEMPTS batches, nobody accepted)
#      +--> CANCELLED            (the customer, until the technician has arrived)
#
# NO_TECHNICIAN_FOUND and EXPIRED can be retried by the customer (a new dispatch round).
STATUS_SEARCHING = "SEARCHING"


STATUS_OFFERED = "OFFERED"


STATUS_ACCEPTED = "ACCEPTED"


STATUS_EN_ROUTE = "EN_ROUTE"


STATUS_ARRIVED = "ARRIVED"


STATUS_IN_PROGRESS = "IN_PROGRESS"


STATUS_COMPLETED = "COMPLETED"


STATUS_CANCELLED = "CANCELLED"


STATUS_NO_TECHNICIAN_FOUND = "NO_TECHNICIAN_FOUND"


STATUS_EXPIRED = "EXPIRED"


SERVICE_REQUEST_STATUSES = (
    STATUS_SEARCHING,
    STATUS_OFFERED,
    STATUS_ACCEPTED,
    STATUS_EN_ROUTE,
    STATUS_ARRIVED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    STATUS_CANCELLED,
    STATUS_NO_TECHNICIAN_FOUND,
    STATUS_EXPIRED,
)


STATUS_CHECK = "status IN (" + ", ".join(f"'{status}'" for status in SERVICE_REQUEST_STATUSES) + ")"


ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    STATUS_SEARCHING: frozenset({STATUS_OFFERED, STATUS_NO_TECHNICIAN_FOUND, STATUS_EXPIRED, STATUS_CANCELLED}),
    # OFFERED -> OFFERED is the next batch going out after the previous one lapsed.
    STATUS_OFFERED: frozenset(
        {
            STATUS_OFFERED,
            STATUS_SEARCHING,
            STATUS_ACCEPTED,
            STATUS_NO_TECHNICIAN_FOUND,
            STATUS_EXPIRED,
            STATUS_CANCELLED,
        }
    ),
    STATUS_ACCEPTED: frozenset({STATUS_EN_ROUTE, STATUS_SEARCHING, STATUS_CANCELLED}),
    STATUS_EN_ROUTE: frozenset({STATUS_ARRIVED, STATUS_SEARCHING, STATUS_CANCELLED}),
    STATUS_ARRIVED: frozenset({STATUS_IN_PROGRESS}),
    STATUS_IN_PROGRESS: frozenset({STATUS_COMPLETED}),
    STATUS_NO_TECHNICIAN_FOUND: frozenset({STATUS_SEARCHING, STATUS_CANCELLED}),
    STATUS_EXPIRED: frozenset({STATUS_SEARCHING, STATUS_CANCELLED}),
    STATUS_COMPLETED: frozenset(),
    STATUS_CANCELLED: frozenset(),
}


class InvalidTransition(Exception):
    def __init__(self, from_status: str, to_status: str):
        super().__init__(f"{from_status} -> {to_status} is not an allowed booking transition")
        self.from_status = from_status
        self.to_status = to_status


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, frozenset())


# Dispatch is still looking: nobody holds the booking yet.
DISPATCHING_STATUSES = (STATUS_SEARCHING, STATUS_OFFERED)


# A technician on one of these is busy: no second job is offered meanwhile. A
# partial unique index enforces it in the database as well.
TECHNICIAN_BUSY_STATUSES = (STATUS_ACCEPTED, STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS)


# A booking still in play (one open booking per requester and trade).
OPEN_STATUSES = (*DISPATCHING_STATUSES, *TECHNICIAN_BUSY_STATUSES)


# Dispatch stopped without a technician; the requester may start a new round.
RETRYABLE_STATUSES = (STATUS_NO_TECHNICIAN_FOUND, STATUS_EXPIRED)


# Technician moves after accepting: (from, to, timestamp column).
TECHNICIAN_PROGRESS = {
    "en-route": (STATUS_ACCEPTED, STATUS_EN_ROUTE, "en_route_at"),
    "arrived": (STATUS_EN_ROUTE, STATUS_ARRIVED, "arrived_at"),
    "start": (STATUS_ARRIVED, STATUS_IN_PROGRESS, "started_at"),
    "complete": (STATUS_IN_PROGRESS, STATUS_COMPLETED, "completed_at"),
}


REQUESTER_CANCELLABLE = (*DISPATCHING_STATUSES, STATUS_ACCEPTED, STATUS_EN_ROUTE, *RETRYABLE_STATUSES)


# The technician holding the job may hand it back until they have arrived; the
# booking then goes back to dispatch rather than being left stuck.
TECHNICIAN_CANCELLABLE = (STATUS_ACCEPTED, STATUS_EN_ROUTE)


# Technician dashboard buckets (by booking status, for the technician holding it).
TECHNICIAN_BUCKETS = {
    "accepted": (STATUS_ACCEPTED,),
    "active": (STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS),
    "completed": (STATUS_COMPLETED,),
    # History: a job this technician accepted that was then cancelled (requesters
    # may cancel while ACCEPTED or EN_ROUTE). Only bookings with `accepted_at` count
    # -- a technician who was merely offered or assigned one never held it.
    "cancelled": (STATUS_CANCELLED,),
}


# What the technician wrote about the work. Enforced by a CHECK as well as the API.
SERVICE_NOTES_MAX_LENGTH = 2000


class ServiceRequest(Base):
    """A technician booking made by a Professional House Owner or Site Engineer.

    `requested_by_user_id` is the Professional account (professional.users, RESTRICT:
    Professional accounts are soft-deleted, so a booking never loses its requester).
    `technician_id` is the technician currently holding the job (NULL while searching or
    when nobody was found); the full offer history is in booking_offers.
    """

    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint(STATUS_CHECK, name="status"),
        CheckConstraint(TECHNICIAN_TYPE_CHECK, name="technician_type"),
        CheckConstraint("requested_by_role IN ('OWNER', 'SITE_ENGINEER')", name="requested_by_role"),
        CheckConstraint(
            "service_kind IS NULL OR service_kind IN ('SERVICE', 'CONSULTATION')",
            name="service_kind",
        ),
        CheckConstraint("quoted_amount IS NULL OR quoted_amount >= 0", name="quoted_amount"),
        CheckConstraint("currency IS NULL OR currency = 'INR'", name="currency"),
        CheckConstraint("service_latitude IS NULL OR service_latitude BETWEEN -90 AND 90", name="service_latitude"),
        CheckConstraint(
            "service_longitude IS NULL OR service_longitude BETWEEN -180 AND 180", name="service_longitude"
        ),
        CheckConstraint(
            f"service_notes IS NULL OR char_length(service_notes) <= {SERVICE_NOTES_MAX_LENGTH}",
            name="service_notes",
        ),
        Index("ix_bookings__technician_status", "technician_id", "status"),
        CheckConstraint("dispatch_round >= 1", name="dispatch_round"),
        CheckConstraint("dispatch_attempts >= 0", name="dispatch_attempts"),
        # One technician, one job at a time -- enforced by the database, not only by
        # the dispatch query, so no code path can ever give a technician two.
        Index(
            "uq_bookings__technician_active_job",
            "technician_id",
            unique=True,
            postgresql_where=text("status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True, nullable=False)
    requested_by_role: Mapped[str] = mapped_column(String(20), nullable=False)
    technician_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("technicians.id", ondelete="RESTRICT"), index=True
    )
    technician_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Snapshotted from the requester's Professional record at booking time.
    service_address: Mapped[str] = mapped_column(Text, nullable=False)
    service_area: Mapped[str | None] = mapped_column(String(120))
    pincode: Mapped[str] = mapped_column(String(20), nullable=False)
    # Where the technician must actually go: the point the requester placed on the
    # booking map. This -- not the pincode -- is what the nearby search measures
    # from and what the live map routes to. Nullable because bookings made before
    # the map existed have no coordinates.
    service_latitude: Mapped[float | None] = mapped_column(Float)
    service_longitude: Mapped[float | None] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text)
    # What was booked, and what it cost at the moment it was booked.
    #
    # All four are nullable: bookings made before the catalog existed have no
    # service, and they keep working exactly as they did.
    #
    # `quoted_amount` and `currency` are a SNAPSHOT, not a lookup. The catalog
    # price will change; what this booking was agreed at must not. Reading the
    # price through `service_id` instead would silently rewrite the past.
    # `service_kind` is snapshotted too so the dispatch and job payloads -- built
    # today without joins -- do not grow one.
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        "catalog_service_id", ForeignKey("catalog_services.id", ondelete="RESTRICT"), index=True
    )
    service_kind: Mapped[str | None] = mapped_column(String(12))
    quoted_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(
        String(24), default=STATUS_SEARCHING, server_default=STATUS_SEARCHING, index=True, nullable=False
    )
    # The technician's notes on the work, written while it is IN_PROGRESS and
    # read-only afterwards. NULL for every booking that never had any, including
    # all bookings made before notes existed.
    service_notes: Mapped[str | None] = mapped_column(Text)
    service_notes_updated_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    # Dispatch bookkeeping. A round is one search from SEARCHING until somebody
    # accepts or it stops; a new round starts when the requester retries or the
    # technician holding the job hands it back. `dispatch_attempts` counts the
    # batches sent in the current round, against MAX_DISPATCH_ATTEMPTS.
    dispatch_round: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1", nullable=False)
    dispatch_attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0", nullable=False)
    last_dispatched_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    # When the first offer of the current round went out.
    assigned_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    accepted_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    en_route_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    arrived_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    started_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    completed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    cancelled_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    technician = relationship("Technician", foreign_keys=[technician_id])
    # The catalog row this booking names. Read-only here: the amount the booking
    # is held to is `quoted_amount`, never this row's current price.
    service = relationship("Service", foreign_keys=[service_id])

    @property
    def requester(self) -> Any:
        """The booking's requester, read now from Professional's view (read-only)."""
        from app.core.runtime import settings
        from app.modules.requesters.repository import RequesterRepository

        session = object_session(self)
        if session is None:
            return None
        return RequesterRepository(session, settings.professional_schema).get(self.requested_by_user_id)

    assignments = relationship(
        "ServiceRequestAssignment",
        back_populates="service_request",
        cascade="all, delete-orphan",
        order_by="ServiceRequestAssignment.offered_at",
    )
    # The job's checklist, copied from the service's templates at booking time.
    # Empty for bookings without a catalog service, or whose service has none.
    steps = relationship(
        "ServiceRequestStep",
        back_populates="service_request",
        passive_deletes=True,
        order_by="ServiceRequestStep.position",
    )
    media = relationship(
        "ServiceRequestMedia",
        back_populates="service_request",
        passive_deletes=True,
        order_by="ServiceRequestMedia.created_at",
    )

    @property
    def reference(self) -> str:
        """The correlation id every log line about this booking carries: SR-XXXXXXXX.
        Derived from the id, so it needs no column and can never disagree with it."""
        return f"SR-{self.id.hex[:8].upper()}" if self.id else "SR-PENDING"

    @property
    def has_service_point(self) -> bool:
        return self.service_latitude is not None and self.service_longitude is not None

    def transition(self, to_status: str) -> None:
        """The only way `status` changes. Raises InvalidTransition otherwise."""
        if not can_transition(self.status, to_status):
            raise InvalidTransition(self.status, to_status)
        self.status = to_status


# What became of one offer.
OFFER_OFFERED = "OFFERED"  # waiting for the technician's answer


OFFER_ACCEPTED = "ACCEPTED"  # this technician won the booking


OFFER_REJECTED = "REJECTED"  # the technician declined


OFFER_EXPIRED = "EXPIRED"  # nobody answered within DISPATCH_OFFER_TIMEOUT_SECONDS


OFFER_CANCELLED = "CANCELLED"  # withdrawn for a reason other than losing: see status_reason


OFFER_LOST_RACE = "LOST_RACE"  # another technician in the same batch accepted first


OFFER_TECHNICIAN_CANCELLED = "TECHNICIAN_CANCELLED"  # accepted, then handed back by the technician


OFFER_STATUSES = (
    OFFER_OFFERED,
    OFFER_ACCEPTED,
    OFFER_REJECTED,
    OFFER_EXPIRED,
    OFFER_CANCELLED,
    OFFER_LOST_RACE,
    OFFER_TECHNICIAN_CANCELLED,
)


OFFER_STATUS_CHECK = "status IN (" + ", ".join(f"'{status}'" for status in OFFER_STATUSES) + ")"


# Answers that mean "not this booking": the technician is never offered it again.
FINAL_REFUSALS = (OFFER_REJECTED, OFFER_EXPIRED, OFFER_TECHNICIAN_CANCELLED)


# Why an offer was CANCELLED (status_reason). Never personal data.
REASON_CUSTOMER_CANCELLED = "CUSTOMER_CANCELLED"


REASON_NO_LONGER_ELIGIBLE = "NO_LONGER_ELIGIBLE"


REASON_TECHNICIAN_UNAVAILABLE = "TECHNICIAN_UNAVAILABLE"


class ServiceRequestAssignment(Base):
    """The dispatch record: every offer of a booking to a technician, and its outcome.

    The audit trail that answers "why was this technician selected?" -- `rank`,
    `score` and `score_breakdown` are exactly what the ranking engine computed when
    the offer went out, with the distance it measured -- and "why didn't another
    technician get it?" -- their own rows say REJECTED, EXPIRED, LOST_RACE or
    CANCELLED with a reason. Technicians who were ranked but never reached by a
    batch are in the structured `dispatch.ranked` log line for that batch.

    The integrity rules live here, in the database, not in the application:
      * a technician is offered a booking at most once per dispatch round (unique
        triple). Dispatch also never asks again anybody who declined, let an offer
        lapse or handed the job back (FINAL_REFUSALS) -- but somebody who merely
        lost a race, or whose offer was withdrawn, may be asked in a later round,
        which is exactly who should be asked when a holder hands the job back;
      * a booking has at most ONE accepted offer (partial unique index), so two
        simultaneous acceptances can never both succeed, whatever the code does.
    """

    __tablename__ = "booking_offers"
    __table_args__ = (
        UniqueConstraint(
            "booking_id",
            "technician_id",
            "dispatch_round",
        ),
        CheckConstraint(OFFER_STATUS_CHECK, name="status"),
        CheckConstraint("batch_number >= 1", name="batch_number"),
        CheckConstraint("dispatch_round >= 1", name="dispatch_round"),
        Index("ix_booking_offers__technician_status", "technician_id", "status"),
        # Acceptance, completion and fairness statistics for ranking.
        Index("ix_booking_offers__technician_offered_at", "technician_id", "offered_at"),
        # The sweeper's question: which outstanding offers have lapsed?
        Index(
            "ix_booking_offers__outstanding_expires_at",
            "expires_at",
            postgresql_where=text("status = 'OFFERED'"),
        ),
        Index(
            "uq_booking_offers__one_accepted",
            "booking_id",
            unique=True,
            postgresql_where=text("status = 'ACCEPTED'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), index=True, nullable=False
    )
    technician_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("technicians.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=OFFER_OFFERED, server_default=OFFER_OFFERED, nullable=False)
    status_reason: Mapped[str | None] = mapped_column(String(40))
    # Which round and which batch of it this offer went out in, and the place the
    # technician had in that batch's ranking (1 = best).
    dispatch_round: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1", nullable=False)
    batch_number: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1", nullable=False)
    rank: Mapped[int | None] = mapped_column(SmallInteger)
    score: Mapped[float | None] = mapped_column(Float)
    # Each normalised metric (0..1), its weight and the inputs it came from.
    score_breakdown: Mapped[dict | None] = mapped_column(JSONB)
    # Retained for offers made before 0014 (NEARBY / EXACT / SAME_BLOCK / ...).
    # The postal-area dispatch that wrote the other values no longer exists.
    match_type: Mapped[str | None] = mapped_column(String(16))
    # Straight-line metres between the technician and the job when it was offered.
    # It is the only thing about the job's whereabouts a technician sees before
    # accepting, and it is what the offer card shows as "approx 1.4 km away".
    distance_meters: Mapped[float | None] = mapped_column(Float)
    # Road travel time when an ETA provider was configured and answered; NULL means
    # ranking used straight-line distance, and nothing pretends otherwise.
    eta_seconds: Mapped[float | None] = mapped_column(Float)
    offered_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    responded_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    service_request = relationship("ServiceRequest", back_populates="assignments")
    technician = relationship("Technician")

    def close(self, status: str, now: datetime, reason: str | None = None) -> None:
        """End an outstanding offer. Only an OFFERED (or, for a hand-back, ACCEPTED) offer moves."""
        self.status = status
        self.status_reason = reason
        self.responded_at = now


class ServiceRequestTracking(Base):
    """Where the technician is being asked to go, for one booking.

    One row per booking. It holds the DESTINATION only -- the requester's
    confirmed pin, which the road route and the remaining distance are measured
    to. Where the technician is lives in exactly one place,
    `technician_locations`, and the live map reads the position of whichever
    technician `bookings.technician_id` currently names. A booking that
    moves to another technician therefore can never show the previous one's
    position: there is no per-booking copy of it to go stale.

    (Before 0014 this row also carried a copy of the technician's position,
    written by a second endpoint from a second GPS watcher. Those columns were
    removed when the two were consolidated.)
    """

    __tablename__ = "booking_destinations"
    __table_args__ = (
        CheckConstraint(
            "destination_latitude IS NULL OR destination_latitude BETWEEN -90 AND 90",
            name="destination_latitude",
        ),
        CheckConstraint(
            "destination_longitude IS NULL OR destination_longitude BETWEEN -180 AND 180",
            name="destination_longitude",
        ),
    )

    # The booking is the identity of the tracking row: one booking, one journey.
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", Uuid, ForeignKey("bookings.id", ondelete="CASCADE"), primary_key=True
    )

    destination_latitude: Mapped[float | None] = mapped_column(Float)
    destination_longitude: Mapped[float | None] = mapped_column(Float)
    destination_accuracy: Mapped[float | None] = mapped_column(Float)
    destination_set_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    service_request = relationship("ServiceRequest")

    @property
    def has_destination(self) -> bool:
        return self.destination_latitude is not None and self.destination_longitude is not None

    @property
    def destination(self) -> tuple[float, float] | None:
        return (self.destination_latitude, self.destination_longitude) if self.has_destination else None


class ServiceRequestStep(Base):
    """One checklist step of one booking, copied from the service's templates when
    the booking was made.

    The title is a SNAPSHOT, like the booking's price: a later edit to the
    catalog's checklist cannot rewrite a job that already happened. `template_id`
    only records where the step came from.

    A step is done when `completed_at` is set; there is no separate flag that
    could disagree with it. Ticking steps is a record of the work, not a status:
    the booking's ARRIVED -> IN_PROGRESS -> COMPLETED workflow never reads it.
    """

    __tablename__ = "booking_checklist_steps"
    __table_args__ = (UniqueConstraint("booking_id", "position"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("catalog_service_checklist_steps.id", ondelete="SET NULL"), index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    service_request = relationship("ServiceRequest", back_populates="steps")


MEDIA_CUSTOMER = "CUSTOMER"


MEDIA_BEFORE = "BEFORE"


MEDIA_AFTER = "AFTER"


# Work bill (0010): a photo of one material line, and an attachment to the bill.
MEDIA_MATERIAL = "MATERIAL"


MEDIA_BILL = "BILL"


MEDIA_KINDS = (MEDIA_CUSTOMER, MEDIA_BEFORE, MEDIA_AFTER, MEDIA_MATERIAL, MEDIA_BILL)


# The job-execution photos; the job-execution endpoints see these and no others.
JOB_MEDIA_KINDS = (MEDIA_CUSTOMER, MEDIA_BEFORE, MEDIA_AFTER)


BILL_MEDIA_KINDS = (MEDIA_MATERIAL, MEDIA_BILL)


MEDIA_KIND_CHECK = "kind IN (" + ", ".join(f"'{kind}'" for kind in MEDIA_KINDS) + ")"


MEDIA_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")


MEDIA_CONTENT_TYPE_CHECK = "content_type IN (" + ", ".join(f"'{value}'" for value in MEDIA_CONTENT_TYPES) + ")"


MAX_STORED_MEDIA_BYTES = 5 * 1024 * 1024


class ServiceRequestMedia(Base):
    """A private photo attached to a booking: the customer's problem photo, the
    technician's photo before or after the work, or -- on the work bill -- a
    photo of a material line (MATERIAL, with `bill_item_id`) or a bill
    attachment (BILL).

    Only metadata lives here. The image itself is re-encoded (which removes EXIF,
    GPS and every other metadata block), encrypted and written under
    JOB_MEDIA_DIRECTORY as `<storage_key>.bin`; it is served only through the
    authorised content endpoints, never from /uploads. `storage_key` is internal
    and never leaves the backend.

    Exactly one uploader is recorded, and it must match the kind: a CUSTOMER photo
    comes from the booking's requester, every other kind from the technician.
    `uploaded_by_requester_id` deliberately has NO foreign key: Partner keeps a
    single link into Professional's schema (service_requests.requested_by_user_id),
    and the value is only ever set from the verified booking owner. Deleting the
    Professional account still removes these rows through the booking's cascade.
    """

    __tablename__ = "booking_media"
    __table_args__ = (
        CheckConstraint(MEDIA_KIND_CHECK, name="kind"),
        CheckConstraint(MEDIA_CONTENT_TYPE_CHECK, name="content_type"),
        CheckConstraint(f"byte_size BETWEEN 1 AND {MAX_STORED_MEDIA_BYTES}", name="byte_size"),
        CheckConstraint(
            "(kind = 'CUSTOMER' AND uploaded_by_requester_id IS NOT NULL AND uploaded_by_technician_id IS NULL)"
            " OR (kind IN ('BEFORE', 'AFTER', 'MATERIAL', 'BILL') AND uploaded_by_technician_id IS NOT NULL AND uploaded_by_requester_id IS NULL)",
            name="uploader",
        ),
        CheckConstraint("(kind = 'MATERIAL') = (bill_item_id IS NOT NULL)", name="bill_item"),
        UniqueConstraint("storage_key"),
        Index("ix_booking_media__request_kind_created", "booking_id", "kind", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    uploaded_by_requester_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    uploaded_by_technician_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("technicians.id", ondelete="CASCADE"), index=True
    )
    # The material line a MATERIAL photo shows; NULL for every other kind.
    bill_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("booking_work_bill_items.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(CHAR(48), nullable=False)
    content_type: Mapped[str] = mapped_column(String(16), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )

    service_request = relationship("ServiceRequest", back_populates="media")


OTP_ACTIVE = "ACTIVE"


OTP_CONSUMED = "CONSUMED"


OTP_SUPERSEDED = "SUPERSEDED"


OTP_EXPIRED = "EXPIRED"


OTP_LOCKED = "LOCKED"


OTP_STATUSES = (OTP_ACTIVE, OTP_CONSUMED, OTP_SUPERSEDED, OTP_EXPIRED, OTP_LOCKED)


OTP_STATUS_CHECK = "status IN (" + ", ".join(f"'{status}'" for status in OTP_STATUSES) + ")"


class ServiceRequestStartOtp(Base):
    __tablename__ = "booking_start_codes"
    __table_args__ = (
        CheckConstraint(OTP_STATUS_CHECK, name="status"),
        # The readable copy exists only while the code can still be used.
        CheckConstraint("(status = 'ACTIVE') = (code_ciphertext IS NOT NULL)", name="ciphertext"),
        CheckConstraint("(status = 'CONSUMED') = (consumed_at IS NOT NULL)", name="consumed"),
        CheckConstraint("failed_attempts BETWEEN 0 AND 100", name="attempts"),
        CheckConstraint("expires_at > created_at", name="expiry"),
        CheckConstraint("code_digest ~ '^[0-9a-f]{64}$'", name="digest"),
        Index(
            "uq_booking_start_codes__one_active",
            "booking_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
        ),
        Index("ix_booking_start_codes__request_created", "booking_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    code_ciphertext: Mapped[str | None] = mapped_column(Text)
    # The version of DATA_ENCRYPTION_KEY that encrypted the code (DB-11).
    code_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    code_digest: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default=OTP_ACTIVE, server_default=OTP_ACTIVE, nullable=False)
    failed_attempts: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0", nullable=False)
    last_failed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    consumed_by_technician_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("technicians.id", ondelete="SET NULL")
    )
    # When it stopped being ACTIVE, whatever the reason.
    closed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    # The customer whose request created it (the booking's requester).
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)


BILL_DRAFT = "DRAFT"


BILL_FINALIZED = "FINALIZED"


BILL_STATUSES = (BILL_DRAFT, BILL_FINALIZED)


ITEM_MATERIAL = "MATERIAL"


ITEM_LABOUR = "LABOUR"


ITEM_KINDS = (ITEM_MATERIAL, ITEM_LABOUR)


# Enforced by CHECKs as well as the API.
BILL_NOTES_MAX_LENGTH = 2000


ITEM_NAME_MAX_LENGTH = 120


ITEM_DESCRIPTION_MAX_LENGTH = 500


ITEM_UNIT_MAX_LENGTH = 16


# One line may come to at most ten lakh rupees; with the line limit this keeps
# every total well inside NUMERIC(12,2).
LINE_AMOUNT_MAX = Decimal("1000000")


class ServiceRequestBill(Base):
    """The work bill of one booking: materials and additional labour on top of the
    service price. Informational -- nobody approves it and nothing is paid here.

    Created on the technician's first bill entry, never for a job with nothing
    billed (no backfill, no empty bills). DRAFT while the technician edits it,
    which is possible only while the job is IN_PROGRESS. FINALIZED when the
    technician submits it, or -- if they never did -- inside the transaction that
    completes the job. Once FINALIZED nothing on it changes.

    The totals are snapshots written at finalization and NULL before it:

        service_price           = the booking's quoted_amount (NULL for a pre-catalog booking)
        materials_total         = sum of MATERIAL line amounts
        additional_labour_total = sum of LABOUR line amounts
        bill_total              = coalesce(service_price, 0) + materials_total + additional_labour_total

    The booking's quoted_amount itself is never changed, and the technician's
    earning is computed from it alone -- never from bill_total.
    """

    __tablename__ = "booking_work_bills"
    __table_args__ = (
        UniqueConstraint("booking_id"),
        CheckConstraint("status IN ('DRAFT', 'FINALIZED')", name="status"),
        CheckConstraint(f"notes IS NULL OR char_length(notes) <= {BILL_NOTES_MAX_LENGTH}", name="notes"),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint(
            "(service_price IS NULL OR service_price >= 0) AND (materials_total IS NULL OR materials_total >= 0)"
            " AND (additional_labour_total IS NULL OR additional_labour_total >= 0)",
            name="amounts",
        ),
        CheckConstraint(
            "(status = 'DRAFT' AND finalized_at IS NULL AND service_price IS NULL AND materials_total IS NULL"
            " AND additional_labour_total IS NULL AND bill_total IS NULL)"
            " OR (status = 'FINALIZED' AND finalized_at IS NOT NULL AND materials_total IS NOT NULL"
            " AND additional_labour_total IS NOT NULL AND bill_total IS NOT NULL"
            " AND bill_total = coalesce(service_price, 0) + materials_total + additional_labour_total)",
            name="totals",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(12), default=BILL_DRAFT, server_default=BILL_DRAFT, nullable=False)
    # Bill notes -- separate from the job's service notes.
    notes: Mapped[str | None] = mapped_column(Text)
    service_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    materials_total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    additional_labour_total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    bill_total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(CHAR(3), default="INR", server_default="INR", nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    items = relationship(
        "ServiceRequestBillItem",
        back_populates="bill",
        passive_deletes=True,
        order_by="[ServiceRequestBillItem.created_at, ServiceRequestBillItem.id]",
    )


class ServiceRequestBillItem(Base):
    """One line of a work bill: a MATERIAL used, or ADDITIONAL LABOUR beyond the
    service price. `name` is the material or the kind of work; `quantity` is
    units or hours; `work_date` is for labour only.

        amount = round(quantity * unit_price, 2)   [half-up; CHECKed]
    """

    __tablename__ = "booking_work_bill_items"
    __table_args__ = (
        CheckConstraint("kind IN ('MATERIAL', 'LABOUR')", name="kind"),
        CheckConstraint("btrim(name) <> ''", name="name"),
        CheckConstraint("btrim(unit) <> ''", name="unit"),
        CheckConstraint(
            f"description IS NULL OR char_length(description) <= {ITEM_DESCRIPTION_MAX_LENGTH}",
            name="description",
        ),
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("unit_price >= 0", name="unit_price"),
        CheckConstraint(
            f"amount = round(quantity * unit_price, 2) AND amount <= {int(LINE_AMOUNT_MAX)}",
            name="amount",
        ),
        CheckConstraint("kind = 'LABOUR' OR work_date IS NULL", name="work_date"),
        Index("ix_booking_work_bill_items__bill_created", "bill_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_work_bills.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(ITEM_NAME_MAX_LENGTH), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(ITEM_UNIT_MAX_LENGTH), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    work_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )

    bill = relationship("ServiceRequestBill", back_populates="items")


class ServiceRequestRating(Base):
    __tablename__ = "booking_ratings"
    __table_args__ = (
        UniqueConstraint("booking_id"),
        CheckConstraint("stars BETWEEN 1 AND 5", name="stars"),
        Index("ix_booking_ratings__technician_id", "technician_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    # One rating per booking; deleted with its booking, like every per-booking row.
    service_request_id: Mapped[uuid.UUID] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    # RESTRICT, as earnings: a technician with rating history is not silently deleted.
    technician_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("technicians.id", ondelete="RESTRICT"), nullable=False)
    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )

    tags = relationship("ServiceRequestRatingTag", cascade="all, delete-orphan", order_by="ServiceRequestRatingTag.tag")


class ServiceRequestRatingTag(Base):
    """One predefined feedback tag on a rating. The vocabulary lives in code
    (services/rating_service.py); the database only refuses malformed keys."""

    __tablename__ = "booking_rating_tags"
    __table_args__ = (CheckConstraint("tag ~ '^[a-z_]{2,40}$'", name="tag"),)

    rating_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_ratings.id", ondelete="CASCADE"), primary_key=True)
    tag: Mapped[str] = mapped_column(String(40), primary_key=True)


# bookings.requested_by_user_id -> professional.users.id ON DELETE RESTRICT (section 9.3,
# a reference across schemas). Professional grants REFERENCES on users.id to the Partner
# role in its baseline; the key is created with the table when that is already so, and
# otherwise by the Partner baseline after Professional's (docs/porting-todo.md).
BOOKING_REQUESTER_FOREIGN_KEY = DDL(
    "ALTER TABLE partner.bookings ADD CONSTRAINT fk_bookings__requested_by_user_id__users "
    "FOREIGN KEY (requested_by_user_id) REFERENCES professional.users (id) ON DELETE RESTRICT"
)


def professional_users_referenceable(ddl: object, target: object, bind: Any, **_: object) -> bool:
    found = bind.execute(
        text(
            "SELECT 1 FROM information_schema.table_privileges WHERE table_schema = 'professional' "
            "AND table_name = 'users' AND privilege_type = 'REFERENCES' AND grantee = current_user"
        )
    ).first()
    return found is not None


event.listen(
    ServiceRequest.__table__,
    "after_create",
    BOOKING_REQUESTER_FOREIGN_KEY.execute_if(callable_=professional_users_referenceable),  # type: ignore[arg-type]
)

# The view Professional reads bookings through is created and dropped with these tables.
from app.modules.bookings import professional_view  # noqa: E402, F401
