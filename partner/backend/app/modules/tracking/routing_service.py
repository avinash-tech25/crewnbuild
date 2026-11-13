"""Road routing through OSRM (Open Source Routing Machine), with a per-booking cache.

Partner's frontend never calls OSRM: it receives already-normalised data from
here, so the map has one source of truth and no API key is ever exposed.

OSRM answers in GeoJSON, whose coordinate order is `[longitude, latitude]`.
Everything this module returns is `(latitude, longitude)`, so nothing downstream
can get the two the wrong way round.

The cache is what keeps a three-second GPS stream from becoming a three-second
OSRM stream: a booking's route is planned once and then reused, and the remaining
distance is measured along that cached geometry (`geo.remaining_distance_meters`).
A new route is fetched only when the technician has genuinely left the planned
one, and never more often than ROUTE_REFRESH_MIN_INTERVAL_SECONDS.
"""

import logging
import time
import uuid
from dataclasses import dataclass
from typing import Literal

import httpx

from app.core.config import Settings
from app.modules.locations import geo

logger = logging.getLogger(__name__)

RouteSource = Literal["osrm", "fallback"]

FALLBACK_WARNING = "Road routing is unavailable right now, so the distance and arrival time are approximate."


@dataclass(frozen=True)
class RouteResult:
    distance_meters: float
    duration_seconds: float
    coordinates: list[geo.Point]
    source: RouteSource
    warning: str | None = None


@dataclass
class _CachedRoute:
    route: RouteResult
    destination: geo.Point
    fetched_at: float


class RoutingService:
    """Created once per process, so the route cache outlives a single request.

    The cache is per process. With several workers each may plan a booking's route
    once; the refresh limits below still apply in each, which is what keeps OSRM
    traffic bounded.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._routes: dict[uuid.UUID, _CachedRoute] = {}

    # ------------------------------------------------------------------ OSRM

    def get_route(self, origin: geo.Point, destination: geo.Point) -> RouteResult:
        """A driving route from OSRM, degrading to a straight line when it is unreachable.

        A failed route is never an error the requester sees: the map still shows
        both markers and an approximate distance, marked as approximate.
        """
        base = self._settings.osrm_base_url.rstrip("/")
        coordinates = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
        url = f"{base}/route/v1/driving/{coordinates}"

        try:
            # Synchronous on purpose: callers run in the request threadpool, never on
            # the event loop, so a slow OSRM answer holds one worker, not the server.
            with httpx.Client(timeout=self._settings.osrm_timeout_seconds) as client:
                response = client.get(url, params={"overview": "full", "geometries": "geojson"})
                response.raise_for_status()
                payload = response.json()

            if payload.get("code") != "Ok" or not payload.get("routes"):
                raise ValueError(f"OSRM returned code {payload.get('code')}")

            route = payload["routes"][0]
            # GeoJSON is [longitude, latitude]; flipped to (latitude, longitude) here, once.
            path = [(float(lat), float(lng)) for lng, lat in route["geometry"]["coordinates"]]
            if len(path) < 2:
                raise ValueError("OSRM returned a degenerate geometry")

            return RouteResult(
                distance_meters=float(route["distance"]),
                duration_seconds=float(route["duration"]),
                coordinates=path,
                source="osrm",
            )
        except Exception as error:  # httpx, JSON and shape failures all mean "no road route"
            logger.warning(
                "OSRM routing failed (%s: %s) - using a straight-line estimate instead",
                type(error).__name__,
                error,
            )
            return self._straight_line(origin, destination)

    def _straight_line(self, origin: geo.Point, destination: geo.Point) -> RouteResult:
        distance = geo.haversine_meters(origin, destination)
        speed_ms = max(self._settings.tracking_fallback_speed_kmph, 1.0) / 3.6
        return RouteResult(
            distance_meters=distance,
            duration_seconds=distance / speed_ms,
            coordinates=[origin, destination],
            source="fallback",
            warning=FALLBACK_WARNING,
        )

    # ------------------------------------------------------------ per booking

    def get_route_for_booking(
        self, booking_id: uuid.UUID, origin: geo.Point, destination: geo.Point, refresh: bool = False
    ) -> RouteResult:
        cached = self._routes.get(booking_id)
        now = time.monotonic()

        if cached is not None and not refresh and cached.destination == destination:
            stale_fallback = (
                cached.route.source == "fallback"
                and now - cached.fetched_at >= self._settings.route_refresh_min_interval_seconds
            )
            if not stale_fallback:
                return cached.route

        route = self.get_route(origin, destination)

        # OSRM can take seconds to answer. A slow request that started before the
        # route was cleared (the destination moved, the journey restarted) must not
        # overwrite a newer one when it finally returns. The caller still gets its
        # own result either way.
        latest = self._routes.get(booking_id)
        if latest is None or latest.fetched_at <= now:
            self._routes[booking_id] = _CachedRoute(route=route, destination=destination, fetched_at=now)
        return route

    def get_cached_route(self, booking_id: uuid.UUID) -> RouteResult | None:
        cached = self._routes.get(booking_id)
        return cached.route if cached else None

    def can_refresh(self, booking_id: uuid.UUID, min_interval_seconds: float | None = None) -> bool:
        """Rate limit for the reroutes a wandering technician would otherwise trigger."""
        cached = self._routes.get(booking_id)
        if cached is None:
            return True
        if min_interval_seconds is None:
            min_interval_seconds = self._settings.route_refresh_min_interval_seconds
        return time.monotonic() - cached.fetched_at >= min_interval_seconds

    def clear_booking_route(self, booking_id: uuid.UUID) -> None:
        self._routes.pop(booking_id, None)
