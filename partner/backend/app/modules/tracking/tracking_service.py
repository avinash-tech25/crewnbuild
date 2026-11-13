"""Live tracking for a booking: where the technician is, the road route to the customer,
the remaining distance and the arrival estimate.

    technician's device (one GPS watcher, ~every LOCATION_UPDATE_INTERVAL_SECONDS)
            |
            v
    POST /technicians/me/location  (technician_location_service: validate, store)
            |
            |  the job is the one the database says they hold -- never a body field
            v
    on_technician_fix(): route progress, arrival check
            |
            v
    realtime hub, booking room  ->  the customer's map

There is one position per technician (`technician_locations`); this module
never stores one. A booking only adds a destination (booking_destinations).

Who may see what:
  * the customer who made the booking sees the position of the technician who
    holds it right now, while it is ACCEPTED, EN_ROUTE or ARRIVED. Not before (nobody
    has agreed to travel), not once work has started, and never the position of a
    technician who held it earlier -- the position is looked up by the booking's
    current technician_id, so there is no copy that could be out of date;
  * the technician sees their own navigation view for a job they hold.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from app.core import api_errors
from app.core.api_errors import api_error
from app.core.config import Settings
from app.core.logging import log_event
from app.database.types import naive_utc_now
from app.modules.bookings.booking_responses import REQUESTER_STATUS_LABELS, first_name
from app.modules.bookings.dispatch_service import EVENT_BOOKING_STATUS, EVENT_TRACKING_STOPPED
from app.modules.bookings.models import (
    STATUS_ACCEPTED,
    STATUS_ARRIVED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    ServiceRequest,
    ServiceRequestTracking,
)
from app.modules.bookings.repository import ServiceRequestRepository
from app.modules.identity.models import Technician
from app.modules.locations import geo
from app.modules.realtime.hub import TOPIC_BOOKING, RealtimeHub
from app.modules.requesters.repository import Requester
from app.modules.technicians.models import TechnicianLocation
from app.modules.technicians.repository import TechnicianLocationRepository
from app.modules.tracking.repository import TrackingRepository
from app.modules.tracking.routing_service import RouteResult, RoutingService
from app.modules.tracking.schemas import (
    DestinationPoint,
    DestinationRequest,
    LineStringGeometry,
    RouteOut,
    TechnicianPosition,
    TechnicianTrackingStatus,
    TrackedTechnician,
    TrackingSnapshot,
)

logger = logging.getLogger(__name__)

# The technician's position is shown to the customer between accepting and arriving.
SHARING_STATUSES = (STATUS_ACCEPTED, STATUS_EN_ROUTE, STATUS_ARRIVED)
# The customer's tracking page stays open through the work (without a position).
TRACKABLE_STATUSES = (*SHARING_STATUSES, STATUS_IN_PROGRESS)

# Past this the technician is not meaningfully on the planned route any more, so
# the distance is measured as the crow flies rather than along a road they left.
MAX_ON_ROUTE_DEVIATION_METERS = 500.0
# A city road is roughly this much longer than the straight line it follows.
STRAIGHT_LINE_ROAD_FACTOR = 1.3
# A technician nowhere near the planned route is replanned after this short guard.
JUMP_REROUTE_MIN_INTERVAL_SECONDS = 5.0

NOT_FOUND_MESSAGE = "Booking not found"
SHARING_CLOSED_MESSAGE = "Live location is not shared for this job any more."
NO_DESTINATION_MESSAGE = (
    "Waiting for the customer to confirm their exact location on the map. "
    "Your position is being shared; the route appears as soon as they do."
)
WAITING_FOR_TECHNICIAN_MESSAGE = "Waiting for the technician's location..."
SET_DESTINATION_MESSAGE = "Set your exact location on the map so the technician can be tracked to your door."
NOT_TRACKABLE_MESSAGE = "Live tracking opens once your technician accepts the booking."
TRACKING_FINISHED_MESSAGE = "This booking is finished, so live tracking is closed."
WORK_STARTED_MESSAGE = "Your technician is at the address and working."
NO_TECHNICIAN_POSITION_MESSAGE = "Waiting for your location..."

# Websocket message types. The customer's page switches on these names.
EVENT_SNAPSHOT = "tracking_snapshot"
EVENT_LOCATION = "technician_location"
EVENT_ROUTE = "route_updated"


@dataclass(frozen=True)
class Fix:
    """One position, at server time -- either just received or read from the table."""

    latitude: float
    longitude: float
    accuracy: float | None
    heading: float | None
    speed: float | None
    at: datetime

    @property
    def point(self) -> geo.Point:
        return self.latitude, self.longitude

    @classmethod
    def of(cls, location: TechnicianLocation) -> "Fix":
        return cls(
            location.latitude,
            location.longitude,
            location.accuracy,
            location.heading,
            location.speed,
            location.last_location_at,
        )

    def position(self) -> TechnicianPosition:
        return TechnicianPosition(
            latitude=self.latitude,
            longitude=self.longitude,
            accuracy=self.accuracy,
            heading=self.heading,
            speed=self.speed,
            updated_at=self.at,
        )


def route_out(route: RouteResult) -> RouteOut:
    return RouteOut(
        distance_meters=round(route.distance_meters, 1),
        duration_seconds=round(route.duration_seconds, 1),
        # Back into GeoJSON order for the wire: [longitude, latitude].
        geometry=LineStringGeometry(coordinates=[[lng, lat] for lat, lng in route.coordinates]),
        source=route.source,
    )


class TrackingService:
    def __init__(
        self,
        bookings: ServiceRequestRepository,
        tracking: TrackingRepository,
        locations: TechnicianLocationRepository,
        routing: RoutingService,
        realtime: RealtimeHub,
        settings: Settings,
    ) -> None:
        self.bookings = bookings
        self.tracking = tracking
        # Not used for queries: the tracking websocket route closes this session
        # once the socket is admitted (tracking_routes.tracking_stream).
        self.database = tracking.database
        self.locations = locations
        self.routing = routing
        self.realtime = realtime
        self.settings = settings

    # ----------------------------------------------------------- from a fix

    def on_technician_fix(self, booking: ServiceRequest, technician: Technician, fix: Fix) -> TechnicianTrackingStatus:
        """A position from the technician holding `booking`: progress, arrival, broadcast.

        Called after the position is committed. Routing (a network call) happens
        outside any transaction; the arrival check takes the booking's lock only
        when it actually has something to change.
        """
        tracking = self.tracking.get(booking.id)
        if booking.status not in SHARING_STATUSES:
            return self._navigation(
                booking, tracking, self._base_snapshot(booking, tracking, None), sharing_allowed=False
            )

        rerouted = self._needs_reroute(booking, tracking, fix.point)
        snapshot = self._build_snapshot(booking, tracking, fix, fetch_route=rerouted)
        if rerouted and snapshot.route is not None:
            self._publish(booking.id, {"type": EVENT_ROUTE, "route": snapshot.route.model_dump(mode="json")})

        if self._has_arrived(booking, snapshot, fix.accuracy) and self._mark_arrived(booking, technician, fix.at):
            snapshot = self._build_snapshot(booking, tracking, fix, fetch_route=False)

        self._publish(booking.id, self._location_message(snapshot))
        return self._navigation(booking, tracking, snapshot, sharing_allowed=True, updated_at=fix.at)

    def _mark_arrived(self, booking: ServiceRequest, technician: Technician, now: datetime) -> bool:
        """EN_ROUTE -> ARRIVED, decided by real distance, under the booking's lock."""
        locked = self.bookings.lock(booking.id)
        if locked is None or locked.status != STATUS_EN_ROUTE or locked.technician_id != technician.id:
            self.tracking.rollback()
            return False
        locked.transition(STATUS_ARRIVED)
        locked.arrived_at = now
        self.tracking.commit()
        log_event(
            logger,
            "job.transition",
            request=locked.reference,
            technician=technician.id,
            status=STATUS_ARRIVED,
            trigger="distance",
        )
        self._publish(
            booking.id,
            {
                "type": EVENT_BOOKING_STATUS,
                "status": STATUS_ARRIVED,
                "status_label": REQUESTER_STATUS_LABELS[STATUS_ARRIVED],
            },
        )
        return True

    # ------------------------------------------------------------ technician

    def technician_status(self, technician: Technician, booking_id: uuid.UUID) -> TechnicianTrackingStatus:
        """The technician's navigation view of a job they hold, from their current position.

        Loaded by technician, so a job that is not theirs -- including one they have
        only been offered -- is simply not found.
        """
        booking = self.bookings.get_held_by_technician(booking_id, technician.id)
        if booking is None:
            raise api_error(404, api_errors.JOB_NOT_FOUND, NOT_FOUND_MESSAGE)
        tracking = self.tracking.get(booking.id)
        allowed = booking.status in SHARING_STATUSES
        location = self.locations.get(technician.id)
        fix = Fix.of(location) if location is not None else None
        if fix is None or not allowed:
            snapshot = self._base_snapshot(booking, tracking, None)
            status = self._navigation(booking, tracking, snapshot, sharing_allowed=allowed)
            if allowed:
                status.message = (
                    NO_TECHNICIAN_POSITION_MESSAGE if tracking and tracking.has_destination else NO_DESTINATION_MESSAGE
                )
            return status
        snapshot = self._build_snapshot(
            booking, tracking, fix, fetch_route=self.routing.get_cached_route(booking.id) is None
        )
        return self._navigation(booking, tracking, snapshot, sharing_allowed=True, updated_at=fix.at)

    def _navigation(
        self,
        booking: ServiceRequest,
        tracking: ServiceRequestTracking | None,
        snapshot: TrackingSnapshot,
        *,
        sharing_allowed: bool,
        updated_at: datetime | None = None,
    ) -> TechnicianTrackingStatus:
        has_destination = bool(tracking and tracking.has_destination)
        message = snapshot.message
        if not has_destination:
            message = NO_DESTINATION_MESSAGE
        elif not sharing_allowed:
            message = SHARING_CLOSED_MESSAGE
        return TechnicianTrackingStatus(
            booking_id=booking.id,
            status=booking.status,
            sharing_allowed=sharing_allowed,
            has_destination=has_destination,
            destination=snapshot.destination,
            position=snapshot.position,
            route=snapshot.route,
            distance_remaining_meters=snapshot.distance_remaining_meters,
            eta_seconds=snapshot.eta_seconds,
            updated_at=updated_at,
            message=message,
        )

    # -------------------------------------------------------------- requester

    def load_for_requester(self, requester: Requester, booking_id: uuid.UUID) -> ServiceRequest:
        """The booking, but only if this account is the one that created it."""
        booking = self.bookings.get_for_requester(booking_id, requester.id)
        if booking is None:
            raise api_error(404, api_errors.BOOKING_NOT_FOUND, NOT_FOUND_MESSAGE)
        return booking

    def requester_snapshot(self, requester: Requester, booking_id: uuid.UUID) -> TrackingSnapshot:
        return self.snapshot_for_booking(self.load_for_requester(requester, booking_id))

    def set_destination(
        self, requester: Requester, booking_id: uuid.UUID, payload: DestinationRequest
    ) -> TrackingSnapshot:
        """Record where the technician is actually being asked to come. Only this
        tracking row changes; nothing about the booking or the account does."""
        booking = self.load_for_requester(requester, booking_id)
        if booking.status not in TRACKABLE_STATUSES:
            raise api_error(409, api_errors.TRACKING_CLOSED, NOT_TRACKABLE_MESSAGE)
        now = naive_utc_now()
        tracking = self.tracking.set_destination(
            booking.id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy=payload.accuracy,
            now=now,
        )
        self.tracking.commit()
        self.tracking.refresh(tracking)
        # The cached route was planned to the old pin; it is now wrong.
        self.routing.clear_booking_route(booking.id)
        snapshot = self.snapshot_for_booking(booking, fetch_route=True)
        if snapshot.route is not None:
            self._publish(booking.id, {"type": EVENT_ROUTE, "route": snapshot.route.model_dump(mode="json")})
        return snapshot

    # ----------------------------------------------------------- shared reads

    def snapshot_for_booking(self, booking: ServiceRequest, *, fetch_route: bool | None = None) -> TrackingSnapshot:
        """The snapshot for a booking the caller has already been authorised for."""
        tracking = self.tracking.get(booking.id)
        if booking.status not in TRACKABLE_STATUSES:
            self.routing.clear_booking_route(booking.id)
            snapshot = self._base_snapshot(
                booking, tracking, TRACKING_FINISHED_MESSAGE if booking.accepted_at else NOT_TRACKABLE_MESSAGE
            )
            snapshot.is_live = False
            return snapshot
        if booking.status not in SHARING_STATUSES:
            return self._base_snapshot(booking, tracking, WORK_STARTED_MESSAGE)
        if tracking is None or not tracking.has_destination:
            return self._base_snapshot(booking, tracking, SET_DESTINATION_MESSAGE)
        location = self.locations.get(booking.technician_id) if booking.technician_id else None
        if location is None:
            return self._base_snapshot(booking, tracking, WAITING_FOR_TECHNICIAN_MESSAGE)
        if fetch_route is None:
            fetch_route = self.routing.get_cached_route(booking.id) is None
        return self._build_snapshot(booking, tracking, Fix.of(location), fetch_route=fetch_route)

    # -------------------------------------------------------------- internals

    def _base_snapshot(
        self, booking: ServiceRequest, tracking: ServiceRequestTracking | None, message: str | None
    ) -> TrackingSnapshot:
        technician = None
        if booking.technician is not None and booking.status in TRACKABLE_STATUSES:
            technician = TrackedTechnician(
                name=first_name(booking.technician.name), technician_type=booking.technician_type
            )
        destination = None
        if tracking is not None and tracking.has_destination:
            destination = DestinationPoint(
                latitude=tracking.destination_latitude, longitude=tracking.destination_longitude
            )
        return TrackingSnapshot(
            booking_id=booking.id,
            status=booking.status,
            status_label=REQUESTER_STATUS_LABELS.get(booking.status, booking.status),
            is_live=booking.status in SHARING_STATUSES,
            technician=technician,
            destination=destination,
            stale_after_seconds=self.settings.location_stale_threshold_seconds,
            message=message,
        )

    def _build_snapshot(
        self, booking: ServiceRequest, tracking: ServiceRequestTracking | None, fix: Fix, fetch_route: bool
    ) -> TrackingSnapshot:
        snapshot = self._base_snapshot(booking, tracking, None)
        snapshot.position = fix.position()
        if tracking is None or not tracking.has_destination:
            snapshot.message = SET_DESTINATION_MESSAGE
            return snapshot

        destination = tracking.destination
        route = (
            self.routing.get_route_for_booking(booking.id, fix.point, destination, refresh=fetch_route)
            if fetch_route
            else self.routing.get_cached_route(booking.id)
        )
        if route is None:
            snapshot.distance_remaining_meters, snapshot.eta_seconds = self._straight_line_progress(
                fix.point, destination
            )
            snapshot.eta_basis = "straight_line"
            return snapshot
        snapshot.route = route_out(route)
        snapshot.message = route.warning
        snapshot.distance_remaining_meters, snapshot.eta_seconds, snapshot.eta_basis = self._progress(
            route, fix.point, destination
        )
        return snapshot

    def _has_arrived(self, booking: ServiceRequest, snapshot: TrackingSnapshot, accuracy: float | None) -> bool:
        """The journey is under way, the remaining distance is genuinely inside the
        arrival radius, and the fix is precise enough to believe."""
        if booking.status != STATUS_EN_ROUTE:
            return False
        remaining = snapshot.distance_remaining_meters
        if remaining is None or remaining > self.settings.arrival_threshold_meters:
            return False
        return accuracy is None or accuracy <= self.settings.arrival_max_accuracy_meters

    def _needs_reroute(
        self, booking: ServiceRequest, tracking: ServiceRequestTracking | None, current: geo.Point
    ) -> bool:
        """True only when there is no usable route -- never on every GPS fix."""
        if tracking is None or not tracking.has_destination:
            return False
        cached = self.routing.get_cached_route(booking.id)
        if cached is None:
            return True
        _, _, deviation = geo.project_on_path(cached.coordinates, current)
        if deviation > MAX_ON_ROUTE_DEVIATION_METERS and self.routing.can_refresh(
            booking.id, JUMP_REROUTE_MIN_INTERVAL_SECONDS
        ):
            log_event(logger, "tracking.reroute", request=booking.reference, deviation_m=deviation)
            return True
        if not self.routing.can_refresh(booking.id):
            return False
        if cached.source != "osrm":
            return True
        return deviation > self.settings.route_refresh_deviation_meters

    def _progress(self, route: RouteResult, current: geo.Point, destination: geo.Point) -> tuple[float, float, str]:
        if route.source == "fallback" or len(route.coordinates) < 2:
            return (*self._straight_line_progress(current, destination), "straight_line")
        _, _, deviation = geo.project_on_path(route.coordinates, current)
        if deviation > MAX_ON_ROUTE_DEVIATION_METERS:
            return (*self._straight_line_progress(current, destination), "straight_line")
        remaining = geo.remaining_distance_meters(route.coordinates, current)
        eta = (
            0.0 if route.distance_meters <= 0 else route.duration_seconds * min(1.0, remaining / route.distance_meters)
        )
        return round(remaining, 1), round(max(eta, 0.0), 1), "road_route"

    def _straight_line_progress(self, current: geo.Point, destination: geo.Point) -> tuple[float, float]:
        distance = geo.haversine_meters(current, destination) * STRAIGHT_LINE_ROAD_FACTOR
        speed_ms = max(self.settings.tracking_fallback_speed_kmph, 1.0) / 3.6
        return round(distance, 1), round(distance / speed_ms, 1)

    def _publish(self, booking_id: uuid.UUID, message: dict) -> None:
        self.realtime.publish(TOPIC_BOOKING, booking_id, {"booking_id": str(booking_id), **message})

    @staticmethod
    def _location_message(snapshot: TrackingSnapshot) -> dict:
        position = snapshot.position
        return {
            "type": EVENT_LOCATION,
            "status": snapshot.status,
            "status_label": snapshot.status_label,
            "latitude": position.latitude,
            "longitude": position.longitude,
            "accuracy": position.accuracy,
            "heading": position.heading,
            "speed": position.speed,
            "distance_remaining_meters": snapshot.distance_remaining_meters,
            "eta_seconds": snapshot.eta_seconds,
            "eta_basis": snapshot.eta_basis,
            "updated_at": position.updated_at.isoformat(),
        }


__all__ = [
    "EVENT_SNAPSHOT",
    "EVENT_TRACKING_STOPPED",
    "SHARING_STATUSES",
    "TRACKABLE_STATUSES",
    "Fix",
    "TrackingService",
]
