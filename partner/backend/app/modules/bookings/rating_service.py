"""Customer -> technician ratings: submit once, after completion; aggregates live.

    booking COMPLETED (completion itself unchanged, and never waits for a rating)
      -> its own customer submits 1-5 whole stars and optional predefined tags
      -> one row per booking (UNIQUE + the booking's row lock), technician copied
         from the booking -- never from the request
      -> average and count are computed from the rows whenever they are shown

Not a review system: there is no text anywhere, and a technician only ever sees
their own average and count -- never a rating, a tag or who gave it.
"""

import uuid
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.bookings.models import STATUS_COMPLETED, ServiceRequest, ServiceRequestRating, ServiceRequestRatingTag
from app.modules.bookings.repository import RatingRepository, ServiceRequestRepository
from app.modules.bookings.schemas import RatingSubmitRequest, RatingView, TagOption
from app.modules.requesters.repository import Requester

STATE_NOT_YET = "NOT_YET"
STATE_CAN_RATE = "CAN_RATE"
STATE_RATED = "RATED"

POSITIVE, MIXED, NEGATIVE = "positive", "mixed", "negative"
MAX_TAGS = 8
ONE_DECIMAL = Decimal("0.1")

# The one vocabulary. Keys are stable; labels are what the customer reads.
TAGS: dict[str, list[tuple[str, str]]] = {
    POSITIVE: [
        ("professional", "Professional"),
        ("on_time", "Arrived on time"),
        ("quality_work", "Good quality work"),
        ("polite", "Polite & respectful"),
        ("clean_work", "Clean work"),
        ("clear_explanation", "Explained the work clearly"),
        ("good_communication", "Good communication"),
        ("quick_service", "Quick service"),
    ],
    MIXED: [
        ("work_done_ok", "Work was okay"),
        ("minor_delay", "Slight delay"),
        ("took_longer", "Took longer than expected"),
        ("could_be_tidier", "Could be cleaner"),
        ("explain_better", "Could explain better"),
        ("partly_resolved", "Issue partly resolved"),
    ],
    NEGATIVE: [
        ("unprofessional", "Unprofessional"),
        ("late_arrival", "Arrived late"),
        ("poor_quality", "Poor quality work"),
        ("rude_behaviour", "Rude behaviour"),
        ("untidy", "Left area untidy"),
        ("poor_communication", "Poor communication"),
        ("slow_service", "Work took too long"),
        ("issue_unresolved", "Issue not resolved"),
    ],
}
STAR_GROUPS = {1: NEGATIVE, 2: NEGATIVE, 3: MIXED, 4: POSITIVE, 5: POSITIVE}
LABELS = {key: label for group in TAGS.values() for key, label in group}

BOOKING_NOT_FOUND = "Booking not found"
NOT_COMPLETED = "You can rate the technician once the job is completed."
ALREADY_RATED = "You have already rated this job."


# ------------------------------------------------------------------ aggregates


def rounded_average(value) -> float | None:
    """Exact half-up to one decimal: 4.666.. -> 4.7, 4.65 -> 4.7 (not float round)."""
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP))


def rating_summaries(database: Session, technician_ids) -> dict[uuid.UUID, tuple[float | None, int]]:
    """{technician_id: (average, count)} for many technicians in ONE grouped query."""
    wanted = {technician_id for technician_id in technician_ids if technician_id}
    summaries = dict.fromkeys(wanted, (None, 0))
    if not wanted:
        return summaries
    rows = RatingRepository(database).list_summary_rows(wanted)
    for technician_id, average, count in rows:
        summaries[technician_id] = (rounded_average(average), int(count))
    return summaries


def rating_summary(database: Session, technician_id) -> tuple[float | None, int]:
    return rating_summaries(database, [technician_id]).get(technician_id, (None, 0))


def rated_booking_ids(database: Session, booking_ids) -> set[uuid.UUID]:
    """Which of these bookings already have a rating, in ONE query."""
    wanted = [booking_id for booking_id in booking_ids if booking_id]
    if not wanted:
        return set()
    return RatingRepository(database).list_rated_booking_ids(wanted)


# ------------------------------------------------------------------ the customer


def _options() -> tuple[dict[str, list[TagOption]], dict[str, str]]:
    return (
        {group: [TagOption(key=key, label=label) for key, label in entries] for group, entries in TAGS.items()},
        {str(stars): group for stars, group in STAR_GROUPS.items()},
    )


def _first_name(value: str | None) -> str | None:
    return (value or "").strip().split(" ")[0] or None


def validated_tags(stars: int, tags: list[str]) -> list[str]:
    """The tags as submitted, if every one is known, unique and fits the stars."""
    if len(tags) > MAX_TAGS:
        raise HTTPException(status_code=422, detail=f"Choose at most {MAX_TAGS} feedback tags.")
    if len(set(tags)) != len(tags):
        raise HTTPException(status_code=422, detail="Each feedback tag can be chosen once.")
    unknown = [tag for tag in tags if tag not in LABELS]
    if unknown:
        raise HTTPException(status_code=422, detail="Choose feedback tags from the list shown.")
    allowed = {key for key, _label in TAGS[STAR_GROUPS[stars]]}
    if any(tag not in allowed for tag in tags):
        raise HTTPException(status_code=422, detail="Those feedback tags do not match the stars chosen.")
    return tags


class RatingService:
    def __init__(self, repository: RatingRepository, bookings: ServiceRequestRepository):
        self.repository = repository
        self.bookings = bookings

    def _view(self, booking: ServiceRequest, rating: ServiceRequestRating | None) -> RatingView:
        tag_options, star_groups = _options()
        technician = booking.technician
        name = _first_name(technician.name) if technician is not None else None
        if rating is not None:
            return RatingView(
                state=STATE_RATED,
                technician_name=name,
                stars=rating.stars,
                tags=[TagOption(key=tag.tag, label=LABELS.get(tag.tag, tag.tag)) for tag in rating.tags],
                tag_options=tag_options,
                star_groups=star_groups,
            )
        ready = booking.status == STATUS_COMPLETED and booking.technician_id is not None
        return RatingView(
            state=STATE_CAN_RATE if ready else STATE_NOT_YET,
            technician_name=name if ready else None,
            tag_options=tag_options,
            star_groups=star_groups,
        )

    def _rating_of(self, booking_id) -> ServiceRequestRating | None:
        return self.repository.find_for_booking(booking_id)

    def requester_view(self, requester: Requester, booking_id) -> RatingView:
        booking = self.bookings.get_for_requester(booking_id, requester.id)
        if booking is None:
            raise HTTPException(status_code=404, detail=BOOKING_NOT_FOUND)
        return self._view(booking, self._rating_of(booking.id))

    def submit(self, requester: Requester, booking_id, payload: RatingSubmitRequest) -> RatingView:
        """Once per completed booking, by its own customer. The booking's row lock
        queues a double submission; UNIQUE(service_request_id) is the backstop."""
        booking = self.bookings.lock(booking_id)
        if booking is None or booking.requested_by_user_id != requester.id:
            raise HTTPException(status_code=404, detail=BOOKING_NOT_FOUND)
        if booking.status != STATUS_COMPLETED or booking.technician_id is None:
            raise HTTPException(status_code=409, detail=NOT_COMPLETED)
        if self._rating_of(booking.id) is not None:
            raise HTTPException(status_code=409, detail=ALREADY_RATED)
        tags = validated_tags(payload.stars, payload.tags)
        rating = ServiceRequestRating(
            service_request_id=booking.id,
            technician_id=booking.technician_id,  # from the booking, never the request
            stars=payload.stars,
            tags=[ServiceRequestRatingTag(tag=tag) for tag in tags],
        )
        self.repository.add(rating)
        try:
            self.repository.commit()
        except IntegrityError:
            self.repository.rollback()
            raise HTTPException(status_code=409, detail=ALREADY_RATED)
        return self.requester_view(requester, booking_id)
