"""The one way a technician position enters the system, and what dispatch makes of it.

    device fix (~every LOCATION_UPDATE_INTERVAL_SECONDS while available or on a job)
        |
        |  identity from the access token; no technician id or job id in the body
        v
    validate:  coordinates and accuracy (no IP-derived guesses)
               device clock within LOCATION_MAX_CLOCK_SKEW_SECONDS of server time
               not older than the last fix (out of order)
               not an impossible jump (faster than LOCATION_MAX_SPEED_KMPH)
        |
        v
    technician_locations: rewritten only when moved or the heartbeat is due
        |
        +--> the job they hold (if any): route progress, arrival, live to the customer
        v
    presence: what dispatch currently makes of this technician

Location belongs to the working application, never to registration: nothing in
sign-up asks the device where it is.
"""

import logging
from datetime import UTC, datetime

from fastapi import HTTPException

from app.core import api_errors
from app.core.api_errors import api_error
from app.core.config import Settings
from app.core.logging import log_event
from app.database.types import naive_utc_now
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.schemas import (
    DISPATCH_STATUS_AVAILABLE,
    DISPATCH_STATUS_LOCATION_STALE,
    DISPATCH_STATUS_NOT_ELIGIBLE,
    DISPATCH_STATUS_OFFERED,
    DISPATCH_STATUS_OFFLINE,
    DISPATCH_STATUS_ON_JOB,
    DISPATCH_STATUS_PAUSED,
    LocationUpdateResponse,
    TechnicianLocationRequest,
    TechnicianPresence,
)
from app.modules.identity.models import Technician
from app.modules.locations.geo import haversine_meters
from app.modules.technicians.eligibility import job_eligibility
from app.modules.technicians.models import (
    WORK_STATUS_AVAILABLE,
    WORK_STATUS_OFFLINE,
    WORK_STATUS_PAUSED,
    TechnicianLocation,
)
from app.modules.technicians.repository import TechnicianLocationRepository, TechnicianRepository
from app.modules.tracking.location_accuracy import require_precise
from app.modules.tracking.tracking_service import Fix, TrackingService

logger = logging.getLogger(__name__)

LOCATION_REQUIRED_MESSAGE = "Location access is required to receive nearby jobs."
LOCATION_STALE_MESSAGE = "Your location is out of date. Keep the Partner app open to receive nearby jobs."
OFFLINE_MESSAGE = "You are offline, so no new jobs will be offered to you."
PAUSED_MESSAGE = "You are on a break. No new jobs will be offered until you resume."
JUMP_MESSAGE = "That position is too far from your last one to be real. Waiting for a steady GPS fix."
CLOCK_MESSAGE = "Your phone's clock is wrong. Set the date and time to automatic and try again."
OUT_OF_ORDER_MESSAGE = "An older position arrived after a newer one and was ignored."


def to_naive_utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    return moment


class TechnicianLocationService:
    def __init__(
        self,
        locations: TechnicianLocationRepository,
        technicians: TechnicianRepository,
        tracking: TrackingService,
        dispatch: DispatchService,
        settings: Settings,
    ):
        self.locations = locations
        self.technicians = technicians
        self.tracking = tracking
        self.dispatch = dispatch
        self.settings = settings

    # --------------------------------------------------------------- presence

    def _presence(
        self, technician: Technician, location: TechnicianLocation | None, now: datetime, job=None
    ) -> TechnicianPresence:
        settings = self.settings
        profile = technician.technician_profile
        work_status = profile.work_status if profile else WORK_STATUS_OFFLINE
        fresh = self.locations.is_fresh(location, now, settings.location_stale_threshold_seconds)
        eligible, reasons = job_eligibility(technician)

        if not eligible:
            status, message = DISPATCH_STATUS_NOT_ELIGIBLE, reasons[0]
        elif job is not None:
            status, message = DISPATCH_STATUS_ON_JOB, None
        elif work_status == WORK_STATUS_PAUSED:
            status, message = DISPATCH_STATUS_PAUSED, PAUSED_MESSAGE
        elif work_status != WORK_STATUS_AVAILABLE:
            status, message = DISPATCH_STATUS_OFFLINE, OFFLINE_MESSAGE
        elif not fresh:
            status = DISPATCH_STATUS_LOCATION_STALE
            message = LOCATION_REQUIRED_MESSAGE if location is None else LOCATION_STALE_MESSAGE
        elif self.technicians.holds_live_offer(technician.id, now):
            status, message = DISPATCH_STATUS_OFFERED, None
        else:
            status, message = DISPATCH_STATUS_AVAILABLE, None

        return TechnicianPresence(
            work_status=work_status,
            dispatch_status=status,
            is_available=work_status == WORK_STATUS_AVAILABLE,
            has_location=location is not None,
            location_updated_at=location.last_location_at if location else None,
            location_fresh=fresh,
            ready_for_nearby_jobs=bool(eligible and job is None and work_status == WORK_STATUS_AVAILABLE and fresh),
            tracking_required=job is not None or work_status == WORK_STATUS_AVAILABLE,
            update_interval_seconds=settings.location_update_interval_seconds,
            stale_after_seconds=settings.location_stale_threshold_seconds,
            message=message,
        )

    def presence(self, technician: Technician) -> TechnicianPresence:
        now = naive_utc_now()
        location = self.locations.get(technician.id)
        if location is not None and not self.locations.is_fresh(
            location, now, self.settings.location_stale_threshold_seconds
        ):
            log_event(
                logger,
                "location.stale",
                technician=technician.id,
                age_s=(now - location.last_location_at).total_seconds(),
            )
        return self._presence(technician, location, now, self.technicians.active_job_of(technician.id))

    # -------------------------------------------------------------- one fix

    def _device_time(
        self, payload: TechnicianLocationRequest, technician: Technician, now: datetime
    ) -> datetime | None:
        device = to_naive_utc(payload.device_timestamp)
        if device is None:
            return None
        if abs((device - now).total_seconds()) > self.settings.location_max_clock_skew_seconds:
            self._reject(technician, "clock_skew", skew_s=(device - now).total_seconds())
            raise api_error(422, api_errors.LOCATION_CLOCK_SKEW, CLOCK_MESSAGE)
        return device

    def _check_jump(
        self, technician: Technician, current: TechnicianLocation, payload: TechnicianLocationRequest, now: datetime
    ) -> None:
        """Hyderabad to 300 km away in three seconds is not travel. Refused, not stored.

        Measured against the last stored fix while it is recent; both accuracies are
        allowed for, so a coarse first fix followed by a precise one is not a jump.
        """
        settings = self.settings
        if settings.location_max_speed_kmph <= 0:
            return
        elapsed = (now - current.last_location_at).total_seconds()
        if elapsed > settings.location_jump_check_window_seconds:
            return
        distance = haversine_meters(current.point, (payload.latitude, payload.longitude))
        allowance = (current.accuracy or 0.0) + (payload.accuracy or 0.0)
        implied_kmph = max(distance - allowance, 0.0) / max(elapsed, 1.0) * 3.6
        if implied_kmph > settings.location_max_speed_kmph:
            self._reject(technician, "jump", distance_m=distance, elapsed_s=elapsed, implied_kmph=implied_kmph)
            raise api_error(422, api_errors.LOCATION_JUMP_REJECTED, JUMP_MESSAGE)

    @staticmethod
    def _reject(technician: Technician, reason: str, **fields) -> None:
        log_event(
            logger, "location.update_rejected", logging.WARNING, technician=technician.id, reason=reason, **fields
        )

    def publish(self, technician: Technician, payload: TechnicianLocationRequest) -> LocationUpdateResponse:
        settings = self.settings
        # An IP-derived guess is not a position: storing one would offer this
        # technician work from the wrong end of the state.
        try:
            require_precise(payload.accuracy)
        except HTTPException:
            self._reject(technician, "imprecise", accuracy_m=payload.accuracy)
            raise
        now = naive_utc_now()
        device_time = self._device_time(payload, technician, now)
        current = self.locations.get(technician.id)

        if current is not None:
            if device_time and current.device_timestamp and device_time < current.device_timestamp:
                self._reject(technician, "out_of_order")
                raise api_error(409, api_errors.LOCATION_OUT_OF_ORDER, OUT_OF_ORDER_MESSAGE)
            self._check_jump(technician, current, payload, now)
            gap = (now - current.last_location_at).total_seconds()
            if gap > settings.location_stale_threshold_seconds:
                log_event(logger, "location.resumed", technician=technician.id, after_stale_s=gap)

        job = self.technicians.active_job_of(technician.id)
        profile = technician.technician_profile
        if job is None and (profile is None or profile.work_status == WORK_STATUS_OFFLINE):
            # Not working and holding nothing: a fix still in flight after going
            # offline (or signing out) must not bring the stored position back.
            return LocationUpdateResponse(
                **self._presence(technician, current, now, None).model_dump(),
                persisted=False,
                server_time=now,
                active_job=None,
            )

        # Thin the writes, never the deliveries: the customer still gets every fix.
        due = (
            current is None
            or haversine_meters(current.point, (payload.latitude, payload.longitude))
            >= settings.location_persist_min_move_meters
            or (now - current.last_location_at).total_seconds() >= settings.location_persist_heartbeat_seconds
        )
        if due:
            current = self.locations.write(
                current,
                technician.id,
                latitude=payload.latitude,
                longitude=payload.longitude,
                accuracy=payload.accuracy,
                heading=payload.heading,
                speed=payload.speed,
                altitude=payload.altitude,
                device_timestamp=device_time,
                now=now,
            )
        self.locations.commit()

        active = None
        if job is not None:
            fix = Fix(payload.latitude, payload.longitude, payload.accuracy, payload.heading, payload.speed, now)
            active = self.tracking.on_technician_fix(job, technician, fix)
            if active.status != job.status:
                job = self.technicians.active_job_of(technician.id)
        presence = self._presence(technician, current, now, job)
        return LocationUpdateResponse(**presence.model_dump(), persisted=due, server_time=now, active_job=active)

    # --------------------------------------------------------------- stopping

    def forget(self, technician: Technician) -> TechnicianPresence:
        """Signing out or leaving work: the position goes, and any offer they were
        still deciding on is withdrawn so no booking waits out its timeout on them."""
        self.locations.forget(technician.id)
        self.locations.commit()
        self.dispatch.withdraw_offers_of(technician)
        log_event(logger, "location.forgotten", technician=technician.id)
        now = naive_utc_now()
        return self._presence(technician, None, now, self.technicians.active_job_of(technician.id))
