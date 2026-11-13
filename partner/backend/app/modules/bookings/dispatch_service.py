"""Bookings, dispatch and the job workflow -- ranked candidates, controlled batches, one winner.

    customer books (a point on the map, a trade, optionally a catalog service)
          |
    SEARCHING --- eligibility + nearby search (rings 5 -> 10 -> 15 km) ---+
          |       ranking engine (dispatch_ranking.py)                    |
          |       top DISPATCH_BATCH_SIZE offered at once                 v
          |                                                   OFFERED (batch n of the round)
          |   nobody eligible                                   |   each offer lives
          v                                                     |   DISPATCH_OFFER_TIMEOUT_SECONDS
    NO_TECHNICIAN_FOUND <--- nobody left ---- all rejected / lapsed: next batch
    EXPIRED <--------------- MAX_DISPATCH_ATTEMPTS batches, no acceptance
          |  (the customer may retry: a new round)              |
                                                       first valid acceptance
                                                                v
                       ACCEPTED -> EN_ROUTE -> ARRIVED -> IN_PROGRESS -> COMPLETED
                          |           |
                          +-----------+-- technician hands it back: SEARCHING, new round,
                                          never offered to them again

First valid acceptance wins, and that is settled by PostgreSQL, not by this code
alone: every change to a booking happens under a row lock on it, so concurrent
acceptances queue up and only the first finds it still OFFERED; and two partial
unique indexes make a second accepted offer for the booking, or a second active
job for the technician, impossible to commit at all.

Nothing here talks to a websocket directly. Messages are collected in an
`Outbox` while the transaction runs and published only after it has committed --
a technician is never alerted to an offer that another connection cannot see yet,
or that was rolled back.

Expiry is driven by the sweeper (dispatch_worker.py) every few seconds, so a
booking never waits for somebody to read it before it moves on. An acceptance
that arrives after the deadline also lapses the offer on the spot.

Every log line carries the booking's SR-XXXXXXXX reference and no personal data.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.core import api_errors
from app.core.api_errors import api_error
from app.core.config import Settings
from app.core.india_time import india_day_start_utc
from app.core.logging import log_event
from app.database.types import naive_utc_now
from app.modules.bookings.booking_responses import (
    REQUESTER_STATUS_LABELS,
    booking_response,
    job_offer,
    job_response,
    offer_of,
)
from app.modules.bookings.dispatch_ranking import CandidateMetrics, RankedCandidate, RankingConfig, rank_candidates
from app.modules.bookings.eta_provider import EtaProvider, NoEtaProvider
from app.modules.bookings.job_execution_service import snapshot_steps
from app.modules.bookings.models import (
    FINAL_REFUSALS,
    OFFER_ACCEPTED,
    OFFER_CANCELLED,
    OFFER_EXPIRED,
    OFFER_LOST_RACE,
    OFFER_OFFERED,
    OFFER_REJECTED,
    OFFER_TECHNICIAN_CANCELLED,
    REASON_CUSTOMER_CANCELLED,
    REASON_NO_LONGER_ELIGIBLE,
    REASON_TECHNICIAN_UNAVAILABLE,
    REQUESTER_CANCELLABLE,
    RETRYABLE_STATUSES,
    STATUS_ACCEPTED,
    STATUS_ARRIVED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_EN_ROUTE,
    STATUS_EXPIRED,
    STATUS_IN_PROGRESS,
    STATUS_NO_TECHNICIAN_FOUND,
    STATUS_OFFERED,
    STATUS_SEARCHING,
    TECHNICIAN_BUCKETS,
    TECHNICIAN_CANCELLABLE,
    TECHNICIAN_PROGRESS,
    ServiceRequest,
    ServiceRequestAssignment,
    ServiceRequestTracking,
)
from app.modules.bookings.rating_service import rated_booking_ids, rating_summaries
from app.modules.bookings.repository import ServiceRequestRepository, StartOtpRepository
from app.modules.bookings.schemas import (
    BookingCreateRequest,
    BookingResponse,
    JobOffer,
    OfferOutcome,
    TechnicianJobResponse,
)
from app.modules.bookings.start_otp_service import StartOtpService
from app.modules.bookings.work_bill_service import finalize_bill_for_completion
from app.modules.catalog.service import CatalogService
from app.modules.identity.auth_service import clean_technician_type
from app.modules.identity.models import Technician
from app.modules.locations.geo import haversine_meters
from app.modules.locations.location_service import clean_india_pincode
from app.modules.realtime.hub import TOPIC_BOOKING, TOPIC_TECHNICIAN, RealtimeHub
from app.modules.requesters.repository import Requester
from app.modules.technicians.earnings_service import record_earning_for_completion
from app.modules.technicians.eligibility import acceptance_refusal
from app.modules.technicians.repository import TechnicianLocationRepository, TechnicianRepository
from app.modules.tracking.repository import TrackingRepository

logger = logging.getLogger(__name__)


MISSING_LOCATION_MESSAGE = "Add your address and PIN code to your CREWNBUILD profile, then try again."
MISSING_SERVICE_POINT_MESSAGE = "Choose the service location on the map before booking."
START_ACTION = "start"
START_NEEDS_OTP_MESSAGE = "Enter the customer's Start Work code to start work."

# Websocket messages to a technician (topic TECHNICIAN, room = their id).
EVENT_OFFER = "booking_offer"
EVENT_OFFER_EXPIRED = "booking_offer_expired"
EVENT_TAKEN = "booking_taken"  # the card goes: somebody else won, or the request was withdrawn
EVENT_JOB_CANCELLED = "job_cancelled"  # a job they HELD was cancelled by the customer
# ...and to the customer watching a booking (topic BOOKING, room = booking id).
EVENT_BOOKING_STATUS = "booking_status"
EVENT_TRACKING_STOPPED = "tracking_stopped"


def outstanding_offers(booking: ServiceRequest) -> list[ServiceRequestAssignment]:
    return [offer for offer in booking.assignments if offer.status == OFFER_OFFERED]


def not_to_ask(booking: ServiceRequest) -> set:
    """Everyone already asked in this round, and everyone who ever said no."""
    return {
        offer.technician_id
        for offer in booking.assignments
        if offer.dispatch_round == booking.dispatch_round or offer.status in FINAL_REFUSALS
    }


@dataclass
class Outbox:
    """Realtime messages produced by a transaction, published only after it commits."""

    items: list[tuple[str, str, dict]] = field(default_factory=list)

    def technician(self, technician_id, message: dict) -> None:
        self.items.append((TOPIC_TECHNICIAN, str(technician_id), message))

    def booking(self, booking: ServiceRequest, message: dict) -> None:
        self.items.append((TOPIC_BOOKING, str(booking.id), {"booking_id": str(booking.id), **message}))

    def booking_status(self, booking: ServiceRequest) -> None:
        self.booking(
            booking,
            {
                "type": EVENT_BOOKING_STATUS,
                "status": booking.status,
                "status_label": REQUESTER_STATUS_LABELS.get(booking.status, booking.status),
            },
        )


# ------------------------------------------------------------------ responses

# ------------------------------------------------------------------ dispatch


class DispatchService:
    def __init__(
        self,
        bookings: ServiceRequestRepository,
        technicians: TechnicianRepository,
        locations: TechnicianLocationRepository,
        tracking: TrackingRepository,
        realtime: RealtimeHub,
        settings: Settings,
        eta: EtaProvider | None = None,
    ):
        self.bookings = bookings
        self.database = bookings.database  # for other domains' helpers that take a session
        self.technicians = technicians
        self.locations = locations
        self.realtime = realtime
        self.settings = settings
        self.eta = eta or NoEtaProvider()
        self.tracking = tracking

    # ------------------------------------------------------------- plumbing

    def _commit(self, outbox: Outbox | None = None) -> None:
        self.bookings.commit()
        if outbox is not None:
            self.publish(outbox)

    def publish(self, outbox: Outbox) -> None:
        for topic, room, message in outbox.items:
            self.realtime.publish(topic, room, message)
        outbox.items.clear()

    # ------------------------------------------------------------- candidates

    def _ranked_candidates(
        self, booking: ServiceRequest, tried: set, now: datetime
    ) -> tuple[list[RankedCandidate], float]:
        """Search the rings until a batch's worth is found, then rank the pool."""
        settings = self.settings
        pool, radius = [], settings.search_radii_meters[0]
        for radius in settings.search_radii_meters:
            pool = self.technicians.eligible_near(
                booking.technician_type,
                latitude=booking.service_latitude,
                longitude=booking.service_longitude,
                radius_meters=radius,
                exclude_ids=tried,
                now=now,
                stale_threshold_seconds=settings.location_stale_threshold_seconds,
                limit=settings.dispatch_candidate_pool_size,
                service_id=booking.service_id,
            )
            if len(pool) >= settings.dispatch_batch_size:
                break
        log_event(
            logger,
            "dispatch.candidates",
            request=booking.reference,
            round=booking.dispatch_round,
            batch=booking.dispatch_attempts + 1,
            radius_m=radius,
            count=len(pool),
            excluded=len(tried),
        )
        if not pool:
            return [], radius

        ids = [found.technician.id for found in pool]
        etas = self.eta.estimate(
            [(found.latitude, found.longitude) for found in pool], (booking.service_latitude, booking.service_longitude)
        )
        stats = self.technicians.dispatch_stats(
            ids,
            since=now - timedelta(days=settings.dispatch_stats_lookback_days),
            day_start=india_day_start_utc(now),
        )
        ratings = rating_summaries(self.database, ids)
        metrics = []
        for index, found in enumerate(pool):
            technician_stats = stats[found.technician.id]
            average, count = ratings.get(found.technician.id, (None, 0))
            metrics.append(
                CandidateMetrics(
                    technician_id=found.technician.id,
                    distance_meters=found.distance_meters,
                    eta_seconds=etas[index] if etas else None,
                    rating_average=average,
                    rating_count=count,
                    offers_answered=technician_stats.offers_answered,
                    offers_accepted=technician_stats.offers_accepted,
                    jobs_completed=technician_stats.jobs_completed,
                    jobs_handed_back=technician_stats.jobs_handed_back,
                    experience_years=found.technician.technician_profile.experience_years,
                    jobs_today=technician_stats.jobs_today,
                    location_age_seconds=max((now - found.last_location_at).total_seconds(), 0.0),
                    location_accuracy_meters=found.accuracy,
                )
            )
        ranked = rank_candidates(metrics, radius_meters=radius, config=RankingConfig.from_settings(settings))
        log_event(
            logger,
            "dispatch.ranked",
            request=booking.reference,
            eta_provider=self.eta.name if etas else "none",
            ranking=",".join(f"{entry.rank}:{entry.technician_id}:{entry.score:.4f}" for entry in ranked),
        )
        return ranked, radius

    # -------------------------------------------------------------- offering

    def _dispatch(self, booking: ServiceRequest, now: datetime, outbox: Outbox) -> None:
        """Send the next batch of the current round, or close the round.

        Caller holds the booking's row lock and commits afterwards.
        """
        settings = self.settings
        if booking.dispatch_attempts >= settings.max_dispatch_attempts:
            self._close_round(booking, STATUS_EXPIRED, outbox)
            return
        if not booking.has_service_point:
            # Only a booking made before the map existed can lack one, and there is
            # nothing to measure distance from. It is not sent by postal area any more.
            self._close_round(booking, STATUS_NO_TECHNICIAN_FOUND, outbox)
            return

        ranked, _radius = self._ranked_candidates(booking, not_to_ask(booking), now)
        batch_number = booking.dispatch_attempts + 1
        expires_at = now + timedelta(seconds=settings.dispatch_offer_timeout_seconds)
        offered: list[ServiceRequestAssignment] = []
        for candidate in ranked:
            if len(offered) >= settings.dispatch_batch_size:
                break
            # Serialise with any other booking offering the same technician right now.
            if not self.technicians.lock_technician(candidate.technician_id):
                continue
            if not self.technicians.is_free(candidate.technician_id, now):
                continue
            offer = ServiceRequestAssignment(
                technician_id=candidate.technician_id,
                status=OFFER_OFFERED,
                dispatch_round=booking.dispatch_round,
                batch_number=batch_number,
                rank=candidate.rank,
                score=candidate.score,
                score_breakdown=candidate.breakdown,
                distance_meters=candidate.distance_meters,
                eta_seconds=candidate.eta_seconds,
                offered_at=now,
                expires_at=expires_at,
            )
            booking.assignments.append(offer)
            offered.append(offer)

        if not offered:
            self._close_round(booking, STATUS_NO_TECHNICIAN_FOUND, outbox)
            return

        booking.technician_id = None
        booking.dispatch_attempts = batch_number
        booking.last_dispatched_at = now
        if batch_number == 1:
            booking.assigned_at = now
        booking.transition(STATUS_OFFERED)
        self.bookings.flush()
        for offer in offered:
            outbox.technician(
                offer.technician_id, {"type": EVENT_OFFER, **job_offer(booking, offer).model_dump(mode="json")}
            )
            log_event(
                logger,
                "dispatch.offer_created",
                request=booking.reference,
                technician=offer.technician_id,
                round=offer.dispatch_round,
                batch=offer.batch_number,
                rank=offer.rank,
                score=offer.score,
                distance_m=offer.distance_meters,
                expires_in_s=settings.dispatch_offer_timeout_seconds,
            )
        outbox.booking_status(booking)

    def _close_round(self, booking: ServiceRequest, status: str, outbox: Outbox) -> None:
        booking.technician_id = None
        booking.transition(status)
        self.bookings.flush()
        log_event(
            logger,
            "dispatch.no_technician" if status == STATUS_NO_TECHNICIAN_FOUND else "dispatch.expired",
            logging.WARNING,
            request=booking.reference,
            round=booking.dispatch_round,
            batches=booking.dispatch_attempts,
        )
        outbox.booking_status(booking)

    def _next_batch_if_unanswered(self, booking: ServiceRequest, now: datetime, outbox: Outbox) -> None:
        """Once nobody in the batch is still deciding, the next batch goes."""
        if booking.status == STATUS_OFFERED and not outstanding_offers(booking):
            self._dispatch(booking, now, outbox)

    def expire_lapsed(self, booking: ServiceRequest, now: datetime, outbox: Outbox) -> int:
        """Lapse offers nobody answered in time; move on when the whole batch has."""
        lapsed = [offer for offer in outstanding_offers(booking) if offer.expires_at <= now]
        for offer in lapsed:
            offer.close(OFFER_EXPIRED, now)
            outbox.technician(offer.technician_id, {"type": EVENT_OFFER_EXPIRED, "booking_id": str(booking.id)})
            log_event(
                logger,
                "dispatch.offer_expired",
                request=booking.reference,
                technician=offer.technician_id,
                batch=offer.batch_number,
            )
        if lapsed:
            self.bookings.flush()
            self._next_batch_if_unanswered(booking, now, outbox)
        return len(lapsed)

    # ------------------------------------------------------------- requester

    def create_booking(self, requester: Requester, role: str, payload: BookingCreateRequest) -> BookingResponse:
        technician_type = clean_technician_type(payload.technician_type)
        if not (requester.address or "").strip() or not (requester.pincode or "").strip():
            raise api_error(422, api_errors.INVALID_LOCATION, MISSING_LOCATION_MESSAGE)
        try:
            pincode = clean_india_pincode(requester.pincode)
        except HTTPException:
            raise api_error(
                422, api_errors.INVALID_LOCATION, "Booking needs a 6 digit Indian PIN code on your CREWNBUILD profile."
            )
        if payload.service_latitude is None or payload.service_longitude is None:
            raise api_error(422, api_errors.INVALID_LOCATION, MISSING_SERVICE_POINT_MESSAGE)
        # No accuracy check on the customer's pin: it is on a map in front of them,
        # and a wrong pin is something they can see and drag. The technician's
        # position is different -- nobody is looking at it -- and is still refused
        # when it is only an IP-derived guess.

        # The price comes from the catalog, never from the request: the payload has
        # no amount field. A retired service or one of another trade is refused.
        service = None
        if payload.service_id is not None:
            service = CatalogService(self.database).for_booking(payload.service_id, technician_type)

        existing = self.bookings.open_booking_for(requester.id, technician_type)
        if existing:
            raise api_error(
                409,
                api_errors.DUPLICATE_OPEN_BOOKING,
                "You already have an open booking for this service.",
                booking_id=str(existing.id),
            )

        now = naive_utc_now()
        booking = ServiceRequest(
            requested_by_user_id=requester.id,
            requested_by_role=role,
            technician_type=technician_type,
            service_address=requester.address.strip(),
            service_area=requester.area,
            pincode=pincode,
            service_latitude=payload.service_latitude,
            service_longitude=payload.service_longitude,
            description=(payload.description or "").strip() or None,
            service_id=service.id if service else None,
            service_kind=service.service_kind if service else None,
            quoted_amount=service.price if service else None,
            currency=service.currency if service else None,
            status=STATUS_SEARCHING,
            dispatch_round=1,
            dispatch_attempts=0,
            created_at=now,
        )
        self.bookings.add(booking)
        self.bookings.flush()
        snapshot_steps(self.database, booking, service)
        self.bookings.add(
            ServiceRequestTracking(
                service_request_id=booking.id,
                destination_latitude=payload.service_latitude,
                destination_longitude=payload.service_longitude,
                destination_set_at=now,
            )
        )
        log_event(
            logger,
            "dispatch.request_created",
            request=booking.reference,
            trade=technician_type,
            service=booking.service_id,
            role=role,
        )
        outbox = Outbox()
        self._dispatch(booking, now, outbox)
        self._commit(outbox)
        return self._response(self.bookings.load(booking.id))

    def _responses(self, bookings: list[ServiceRequest]) -> list[BookingResponse]:
        ratings = rating_summaries(self.database, [booking.technician_id for booking in bookings])
        rated = rated_booking_ids(
            self.database, [booking.id for booking in bookings if booking.status == STATUS_COMPLETED]
        )
        return [booking_response(booking, ratings, rated) for booking in bookings]

    def _response(self, booking: ServiceRequest) -> BookingResponse:
        return self._responses([booking])[0]

    def list_bookings(self, requester: Requester) -> list[BookingResponse]:
        return self._responses(self.bookings.list_for_requester(requester.id))

    def get_booking(self, requester: Requester, request_id) -> BookingResponse:
        booking = self.bookings.get_for_requester(request_id, requester.id)
        if not booking:
            raise api_error(404, api_errors.BOOKING_NOT_FOUND, "Booking not found")
        return self._response(booking)

    def _locked_for_requester(self, requester: Requester, request_id) -> ServiceRequest:
        booking = self.bookings.lock(request_id)
        if not booking or booking.requested_by_user_id != requester.id:
            raise api_error(404, api_errors.BOOKING_NOT_FOUND, "Booking not found")
        return booking

    def cancel_booking(self, requester: Requester, request_id) -> BookingResponse:
        """The customer cancels. Every outstanding offer is withdrawn in the same
        transaction, so no technician can accept it afterwards."""
        booking = self._locked_for_requester(requester, request_id)
        if booking.status not in REQUESTER_CANCELLABLE:
            raise api_error(409, api_errors.INVALID_STATE_TRANSITION, "This booking can no longer be cancelled.")
        now = naive_utc_now()
        outbox = Outbox()
        holder = booking.technician_id if booking.status in (STATUS_ACCEPTED, STATUS_EN_ROUTE) else None
        for offer in outstanding_offers(booking):
            offer.close(OFFER_CANCELLED, now, REASON_CUSTOMER_CANCELLED)
            outbox.technician(
                offer.technician_id,
                {
                    "type": EVENT_TAKEN,
                    "booking_id": str(booking.id),
                    "reason": REASON_CUSTOMER_CANCELLED,
                },
            )
        booking.transition(STATUS_CANCELLED)
        booking.cancelled_at = now
        if holder is not None:
            outbox.technician(holder, {"type": EVENT_JOB_CANCELLED, "booking_id": str(booking.id)})
        outbox.booking(booking, {"type": EVENT_TRACKING_STOPPED, "status": STATUS_CANCELLED})
        outbox.booking_status(booking)
        log_event(
            logger,
            "dispatch.cancelled",
            request=booking.reference,
            by="customer",
            withdrawn_offers=len([item for item in outbox.items if item[2].get("type") == EVENT_TAKEN]),
            had_technician=holder is not None,
        )
        self._commit(outbox)
        self.bookings.expire_all()
        return self._response(self.bookings.load(request_id))

    def retry_booking(self, requester: Requester, request_id) -> BookingResponse:
        """A new dispatch round for a booking that found nobody."""
        booking = self._locked_for_requester(requester, request_id)
        if booking.status not in RETRYABLE_STATUSES:
            raise api_error(
                409,
                api_errors.INVALID_STATE_TRANSITION,
                "Only a booking with no technician found can be searched again.",
            )
        if not booking.has_service_point:
            raise api_error(
                409,
                api_errors.INVALID_LOCATION,
                "This booking has no point on the map. Please make a new booking and place the location on the map.",
            )
        now = naive_utc_now()
        booking.dispatch_round += 1
        booking.dispatch_attempts = 0
        booking.transition(STATUS_SEARCHING)
        log_event(logger, "dispatch.started", request=booking.reference, round=booking.dispatch_round, trigger="retry")
        outbox = Outbox()
        self._dispatch(booking, now, outbox)
        self._commit(outbox)
        self.bookings.expire_all()
        return self._response(self.bookings.load(request_id))

    # ------------------------------------------------------------ technician

    def list_offers(self, technician: Technician) -> list[JobOffer]:
        """Job requests waiting for this technician's answer. Nothing identifying."""
        return [
            job_offer(booking, offer)
            for booking, offer in self.bookings.open_offers_for_technician(technician.id, naive_utc_now())
        ]

    def list_jobs(self, technician: Technician, bucket: str) -> list[TechnicianJobResponse]:
        statuses = TECHNICIAN_BUCKETS.get(bucket)
        if not statuses:
            raise api_error(422, "INVALID_BUCKET", "Choose accepted, active, completed or cancelled.")
        return [job_response(item) for item in self.bookings.list_held_by_technician(technician.id, statuses)]

    def job_counts(self, technician: Technician) -> dict[str, int]:
        held = self.bookings.count_held_by_technician(technician.id)
        total = lambda bucket: sum(held.get(status, 0) for status in TECHNICIAN_BUCKETS[bucket])
        return {
            "new_requests": len(self.bookings.open_offers_for_technician(technician.id, naive_utc_now())),
            "accepted_jobs": total("accepted"),
            "active_jobs": total("active"),
            "completed_jobs": total("completed"),
            "cancelled_jobs": total("cancelled"),
        }

    @staticmethod
    def _closed_offer_error(offer: ServiceRequestAssignment):
        """Why an offer that is no longer open cannot be answered."""
        if offer.status == OFFER_LOST_RACE:
            return api_error(
                409, api_errors.REQUEST_ALREADY_ASSIGNED, "This job has already been accepted by another technician."
            )
        if offer.status == OFFER_ACCEPTED:
            return api_error(409, api_errors.REQUEST_ALREADY_ASSIGNED, "You have already accepted this job.")
        if offer.status == OFFER_CANCELLED and offer.status_reason == REASON_CUSTOMER_CANCELLED:
            return api_error(409, api_errors.REQUEST_CANCELLED, "The customer cancelled this request.")
        if offer.status == OFFER_EXPIRED:
            return api_error(409, api_errors.OFFER_EXPIRED, "This job request expired before you answered.")
        return api_error(409, api_errors.OFFER_NO_LONGER_AVAILABLE, "This job request is no longer available.")

    def answer_offer(self, technician: Technician, request_id, accept: bool) -> OfferOutcome:
        """Accept or decline a job request. First valid acceptance wins.

        `lock` takes a row lock on the booking, so simultaneous answers queue up
        behind one another. The first acceptance closes every other offer of the
        batch as LOST_RACE in the same transaction, so each later one wakes to find
        its own offer closed and is told so. The partial unique indexes would
        refuse a second winner even if this code were wrong.
        """
        now = naive_utc_now()
        booking = self.bookings.lock(request_id)
        offer = offer_of(booking, technician.id) if booking is not None else None
        if offer is None:
            # Never offered: answered exactly as an unknown id, so nobody can probe
            # which booking ids exist.
            raise api_error(404, api_errors.OFFER_NOT_FOUND, "Job not found")
        if offer.status != OFFER_OFFERED:
            raise self._closed_offer_error(offer)

        outbox = Outbox()
        if offer.expires_at <= now:
            # Too slow. Lapse it and move the booking on in the same breath.
            self.expire_lapsed(booking, now, outbox)
            self._commit(outbox)
            raise api_error(409, api_errors.OFFER_EXPIRED, "This job request expired before you answered.")

        if not accept:
            offer.close(OFFER_REJECTED, now)
            self.bookings.flush()
            log_event(
                logger,
                "dispatch.offer_rejected",
                request=booking.reference,
                technician=technician.id,
                batch=offer.batch_number,
            )
            self._next_batch_if_unanswered(booking, now, outbox)
            self._commit(outbox)
            return OfferOutcome(
                booking_id=request_id, reference=booking.reference, outcome="DECLINED", message="Job request declined."
            )

        # Still allowed to take it? The offer was made up to a timeout ago; the
        # technician may since have gone unavailable, been suspended or dropped the
        # service. Judged on freshly read rows, under the booking lock.
        refusal = self._acceptance_refusal(technician, booking)
        if refusal:
            offer.close(OFFER_CANCELLED, now, REASON_NO_LONGER_ELIGIBLE)
            self.bookings.flush()
            log_event(
                logger,
                "dispatch.assignment_failed",
                logging.WARNING,
                request=booking.reference,
                technician=technician.id,
                reason=REASON_NO_LONGER_ELIGIBLE,
            )
            self._next_batch_if_unanswered(booking, now, outbox)
            self._commit(outbox)
            raise api_error(409, api_errors.NOT_ELIGIBLE, refusal)

        offer.close(OFFER_ACCEPTED, now)
        booking.technician_id = technician.id
        booking.transition(STATUS_ACCEPTED)
        booking.accepted_at = now
        losers = []
        for other in outstanding_offers(booking):
            other.close(OFFER_LOST_RACE, now)
            losers.append(other.technician_id)
            outbox.technician(
                other.technician_id,
                {
                    "type": EVENT_TAKEN,
                    "booking_id": str(booking.id),
                    "reason": OFFER_LOST_RACE,
                },
            )
        try:
            self.bookings.flush()
        except IntegrityError:
            # The database refused a second winner or a second active job. Nothing
            # was assigned; say so plainly.
            self.bookings.rollback()
            log_event(
                logger,
                "dispatch.assignment_failed",
                logging.WARNING,
                request=f"SR-{request_id.hex[:8].upper()}",
                technician=technician.id,
                reason="CONSTRAINT",
            )
            raise api_error(
                409, api_errors.REQUEST_ALREADY_ASSIGNED, "This job has already been accepted by another technician."
            )
        outbox.booking_status(booking)
        reference = booking.reference
        self._commit(outbox)
        log_event(
            logger,
            "dispatch.assignment_succeeded",
            request=reference,
            technician=technician.id,
            batch=offer.batch_number,
            rank=offer.rank,
            score=offer.score,
            lost_race=len(losers),
        )
        for loser in losers:
            log_event(logger, "dispatch.race_lost", request=reference, technician=loser)
        return OfferOutcome(
            booking_id=request_id,
            reference=reference,
            outcome="ACCEPTED",
            message="Job accepted. The customer can see you now.",
        )

    def _acceptance_refusal(self, technician: Technician, booking: ServiceRequest) -> str | None:
        """Re-read what can change a technician's eligibility, then judge it."""
        self.technicians.profile_for_acceptance(technician.id)
        self.bookings.refresh(technician)
        if technician.identity is not None:
            self.bookings.refresh(technician.identity)
        has_service = booking.service_id is not None and self.technicians.has_selected_service(
            technician.id, booking.service_id
        )
        return acceptance_refusal(technician, booking, has_selected_service=has_service)

    def technician_cancel_job(self, technician: Technician, request_id, reason: str) -> TechnicianJobResponse | None:
        """The technician holding a job hands it back before arriving.

        The booking is not left stuck: it goes back to SEARCHING as a new dispatch
        round and the next batch is offered at once. This technician is never
        offered it again (their offer row is TECHNICIAN_CANCELLED, and an offer
        pair is unique), and the hand-back counts against their ranking.
        """
        now = naive_utc_now()
        booking = self.bookings.lock(request_id)
        if not booking or booking.technician_id != technician.id:
            raise api_error(404, api_errors.JOB_NOT_FOUND, "Job not found")
        if booking.status not in TECHNICIAN_CANCELLABLE:
            raise api_error(
                409, api_errors.INVALID_STATE_TRANSITION, "Once you have arrived the job can no longer be handed back."
            )
        held = next(
            (
                offer
                for offer in booking.assignments
                if offer.technician_id == technician.id and offer.status == OFFER_ACCEPTED
            ),
            None,
        )
        if held is not None:
            held.close(OFFER_TECHNICIAN_CANCELLED, now, reason)
        outbox = Outbox()
        booking.technician_id = None
        booking.accepted_at = None
        booking.en_route_at = None
        booking.dispatch_round += 1
        booking.dispatch_attempts = 0
        booking.transition(STATUS_SEARCHING)
        # Released here, before the next batch, so the active-job index is satisfied.
        self.bookings.flush()
        outbox.booking(booking, {"type": EVENT_TRACKING_STOPPED, "status": STATUS_SEARCHING})
        log_event(
            logger,
            "dispatch.technician_cancelled",
            logging.WARNING,
            request=booking.reference,
            technician=technician.id,
            reason=reason,
            round=booking.dispatch_round,
        )
        log_event(
            logger,
            "dispatch.started",
            request=booking.reference,
            round=booking.dispatch_round,
            trigger="technician_cancelled",
        )
        self._dispatch(booking, now, outbox)
        self._commit(outbox)
        return None

    def withdraw_offers_of(self, technician: Technician, reason: str = REASON_TECHNICIAN_UNAVAILABLE) -> int:
        """Close a technician's unanswered offers (they went offline, paused or signed
        out), so no booking waits out a timeout on somebody who is not there."""
        withdrawn = 0
        for request_id in self.bookings.outstanding_offer_request_ids(technician.id):
            now = naive_utc_now()
            booking = self.bookings.lock(request_id)
            offer = (
                next(
                    (
                        entry
                        for entry in booking.assignments
                        if entry.technician_id == technician.id and entry.status == OFFER_OFFERED
                    ),
                    None,
                )
                if booking
                else None
            )
            if offer is None:
                self.bookings.commit()
                continue
            outbox = Outbox()
            offer.close(OFFER_CANCELLED, now, reason)
            self.bookings.flush()
            withdrawn += 1
            log_event(
                logger, "dispatch.offer_withdrawn", request=booking.reference, technician=technician.id, reason=reason
            )
            self._next_batch_if_unanswered(booking, now, outbox)
            self._commit(outbox)
        return withdrawn

    # --------------------------------------------------------------- sweeper

    def sweep(self, now: datetime | None = None, limit: int = 200) -> dict[str, int]:
        """One pass of the background sweeper. Each booking is its own transaction,
        taken with SKIP LOCKED, so it never waits on (or doubles up with) a request
        or another process handling the same booking."""
        now = now or naive_utc_now()
        counts = {"expired_offers": 0, "redispatched": 0, "purged_locations": 0}
        for request_id in self.bookings.with_lapsed_offers(now, limit):
            try:
                booking = self.bookings.lock(request_id, skip_locked=True)
                if booking is None:
                    self.bookings.rollback()
                    continue
                outbox = Outbox()
                counts["expired_offers"] += self.expire_lapsed(booking, now, outbox)
                self._commit(outbox)
            except Exception:
                self.bookings.rollback()
                logger.exception("dispatch.sweep_failed request_id=%s", request_id)

        cutoff = now - timedelta(seconds=self.settings.dispatch_stuck_search_seconds)
        for request_id in self.bookings.stuck_searching(cutoff, limit):
            try:
                booking = self.bookings.lock(request_id, skip_locked=True)
                if booking is None or booking.status != STATUS_SEARCHING:
                    self.bookings.rollback()
                    continue
                log_event(
                    logger,
                    "dispatch.started",
                    request=booking.reference,
                    round=booking.dispatch_round,
                    trigger="sweeper",
                )
                outbox = Outbox()
                self._dispatch(booking, now, outbox)
                self._commit(outbox)
                counts["redispatched"] += 1
            except Exception:
                self.bookings.rollback()
                logger.exception("dispatch.sweep_failed request_id=%s", request_id)

        try:
            purged = self.locations.purge_older_than(
                now - timedelta(seconds=self.settings.location_purge_after_seconds)
            )
            self.bookings.commit()
            counts["purged_locations"] = purged
            if purged:
                log_event(logger, "location.purged_stale", count=purged)
        except Exception:
            self.bookings.rollback()
            logger.exception("location.purge_failed")
        return counts

    # ---------------------------------------------------------- held jobs

    def _refuse_arrival_from_afar(self, booking: ServiceRequest) -> None:
        """Arrival is normally automatic, on the real remaining distance. This guards
        the manual route: a technician half a kilometre away is not 'arrived'."""
        tracking = self.tracking.get(booking.id)
        destination = tracking.destination if tracking is not None else None
        if destination is None and booking.has_service_point:
            destination = (booking.service_latitude, booking.service_longitude)
        location = self.locations.get(booking.technician_id)
        if destination is None or location is None:
            return
        metres = haversine_meters(location.point, destination)
        if metres <= self.settings.arrival_manual_threshold_meters:
            return
        raise api_error(
            409,
            api_errors.INVALID_STATE_TRANSITION,
            f"You are still about {metres / 1000:.2f} km from the address. "
            "The job is marked as arrived on its own once you get there.",
        )

    def _held_for_transition(self, technician: Technician, request_id, action: str) -> tuple[ServiceRequest, tuple]:
        booking = self.bookings.lock(request_id)
        if not booking or booking.technician_id != technician.id:
            raise api_error(404, api_errors.JOB_NOT_FOUND, "Job not found")
        transition = TECHNICIAN_PROGRESS.get(action)
        if not transition:
            raise api_error(404, api_errors.JOB_NOT_FOUND, "Unknown action")
        if booking.status != transition[0]:
            raise api_error(
                409,
                api_errors.INVALID_STATE_TRANSITION,
                f"This job is {booking.status.replace('_', ' ').lower()}; that step is not possible now.",
            )
        return booking, transition

    def act_on_job(self, technician: Technician, request_id, action: str) -> TechnicianJobResponse:
        """Move a job this technician holds to its next state. Starting work needs the
        customer's code and goes through `start_with_otp` alone."""
        if action == START_ACTION:
            raise api_error(409, api_errors.INVALID_STATE_TRANSITION, START_NEEDS_OTP_MESSAGE)
        booking, (_from_status, to_status, timestamp_column) = self._held_for_transition(technician, request_id, action)
        if to_status == STATUS_ARRIVED:
            self._refuse_arrival_from_afar(booking)
        return self._apply_transition(booking, technician, to_status, timestamp_column, naive_utc_now())

    def start_with_otp(self, technician: Technician, request_id, otp: str) -> TechnicianJobResponse:
        """ARRIVED -> IN_PROGRESS, only with the customer's current Start Work code,
        checked and consumed under the booking's row lock."""
        booking, (_from_status, to_status, timestamp_column) = self._held_for_transition(
            technician, request_id, START_ACTION
        )
        now = naive_utc_now()
        StartOtpService(StartOtpRepository(self.database), ServiceRequestRepository(self.database)).check_for_start(
            booking, technician.id, otp, now
        )
        return self._apply_transition(booking, technician, to_status, timestamp_column, now)

    def _apply_transition(
        self, booking: ServiceRequest, technician: Technician, to_status: str, timestamp_column: str, now: datetime
    ) -> TechnicianJobResponse:
        """The one place a held job's status and timestamp change; commits."""
        request_id = booking.id
        if to_status == STATUS_COMPLETED:
            # Earning and bill join THIS transaction, under the booking's lock.
            record_earning_for_completion(self.database, booking, earned_at=now)
            finalize_bill_for_completion(self.database, booking, now)
        booking.transition(to_status)
        setattr(booking, timestamp_column, now)
        outbox = Outbox()
        outbox.booking_status(booking)
        if to_status in (STATUS_IN_PROGRESS, STATUS_COMPLETED):
            outbox.booking(booking, {"type": EVENT_TRACKING_STOPPED, "status": to_status})
        log_event(logger, "job.transition", request=booking.reference, technician=technician.id, status=to_status)
        self._commit(outbox)
        self.bookings.expire_all()
        return job_response(self.bookings.get_held_by_technician(request_id, technician.id))
