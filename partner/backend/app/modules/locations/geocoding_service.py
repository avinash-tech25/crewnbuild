"""Turning a typed place into coordinates, for the booking map's search box.

Nominatim, OpenStreetMap's own geocoder -- the same project as the map tiles,
free and needing no key. Its usage policy asks for an identifying User-Agent and
no more than one request a second, which is why the browser never calls it
directly: every lookup goes through here, where the identification, the
throttle and a small cache live in one place. Point GEOCODER_BASE_URL at your
own Nominatim before any real traffic.

No paid provider and no Google Maps: the whole map stack stays OpenStreetMap.
"""

import logging
import re
import threading
import time

import httpx
from fastapi import HTTPException

from app.core.runtime import settings

logger = logging.getLogger(__name__)

# A place does not move; the same query need not be asked twice in an hour.
CACHE_SECONDS = 60 * 60
CACHE_MAX_ENTRIES = 500
# Nominatim's usage policy: at most one request a second, across the whole app.
MIN_REQUEST_INTERVAL_SECONDS = 1.0

# How far around an anchor point a confined search may look, in degrees:
# about 28 km, which comfortably covers an Indian pincode's area without
# reaching the next district.
NEAR_RADIUS_DEGREES = 0.25

# A six-digit run, on its own, is an Indian pincode rather than part of a name.
PINCODE_IN_QUERY = re.compile(r"\b(\d{6})\b")

# Nominatim answers only when every word it is given matches, so one word it has
# never heard of -- a flat number, an apartment not yet mapped -- empties the whole
# answer. When a typed search finds nothing, it is asked again this many times at
# most, each time without the most specific part. Each retry is one more request
# under the one-a-second rule, so the number stays small.
MAX_RELAXED_SEARCHES = 3

# "Flat 302", "Plot No. 12", "H.No 1-2-3/4", "#45", "Door No 7" at the start of an
# address: a unit number no geocoder can match, and never the place itself.
UNIT_PREFIX = re.compile(
    r"^\s*(?:(?:flat|plot|house|door|shop|office|unit|h|d)\s*\.?\s*(?:no\.?|number)?|no\.?|#)\s*[\w\-/]*\d[\w\-/]*\s*,?\s*",
    re.IGNORECASE,
)

# What a building's name ends in. A retry that would start with one of these --
# "Residency Kondapur" -- matches some *other* residency, which is worse than the
# plain area, so it is skipped.
BUILDING_WORDS = frozenset(
    [
        "residency",
        "residence",
        "residences",
        "apartment",
        "apartments",
        "apts",
        "apt",
        "tower",
        "towers",
        "heights",
        "enclave",
        "complex",
        "block",
        "wing",
        "floor",
        "villa",
        "villas",
        "homes",
        "nilayam",
        "nivas",
        "mansion",
        "building",
        "bldg",
    ]
)


def _relaxations(text: str) -> list[str]:
    """Broader versions of an address that found nothing, most specific first.

    Indian addresses run from the door outward -- unit, building, street, area,
    city -- so each attempt drops what comes first. Comma-separated parts are
    dropped a whole part at a time. Without commas there is no telling where the
    building's name ends, so after the unit number goes the last two words are
    tried, then the last one: the area or city the requester ended on.
    """
    candidates: list[str] = []
    stripped = UNIT_PREFIX.sub("", text).strip(" ,")
    if stripped != text:
        candidates.append(stripped)
    parts = [part.strip() for part in stripped.split(",") if part.strip()]
    if len(parts) > 1:
        candidates += [", ".join(parts[index:]) for index in range(1, len(parts))]
    else:
        words = stripped.split()
        candidates += [" ".join(words[-count:]) for count in (2, 1) if len(words) > count]

    unique: list[str] = []
    for candidate in candidates:
        # Too short to mean anything, or only a number left over from an address.
        if len(candidate) < 3 or candidate.replace(" ", "").isdigit():
            continue
        if candidate.split()[0].strip(",.").casefold() in BUILDING_WORDS:
            continue
        if candidate.casefold() not in {seen.casefold() for seen in unique} and candidate.casefold() != text.casefold():
            unique.append(candidate)
    return unique


UNAVAILABLE_MESSAGE = "Location search is unavailable right now. Move the pin on the map instead."


class Place:
    __slots__ = ("latitude", "longitude", "name")

    def __init__(self, name: str, latitude: float, longitude: float):
        self.name = name
        self.latitude = latitude
        self.longitude = longitude

    def as_dict(self) -> dict:
        return {"name": self.name, "latitude": self.latitude, "longitude": self.longitude}


class GeocodingService:
    """Created once per process, so the cache and the throttle are shared."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, list[Place]]] = {}
        self._lock = threading.Lock()
        self._last_request_at = 0.0

    # ------------------------------------------------------------- internals

    def _cached(self, key: str) -> list[Place] | None:
        with self._lock:
            entry = self._cache.get(key)
            if entry and time.monotonic() - entry[0] < CACHE_SECONDS:
                return entry[1]
        return None

    def _remember(self, key: str, places: list[Place]) -> None:
        with self._lock:
            if len(self._cache) >= CACHE_MAX_ENTRIES:
                self._cache.clear()
            self._cache[key] = (time.monotonic(), places)

    def _wait_turn(self) -> None:
        """Keeps the whole process under Nominatim's one-request-a-second rule."""
        with self._lock:
            wait = MIN_REQUEST_INTERVAL_SECONDS - (time.monotonic() - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def _get(self, path: str, params: dict) -> object:
        self._wait_turn()
        url = f"{settings.geocoder_base_url.rstrip('/')}/{path}"
        try:
            with httpx.Client(timeout=settings.geocoder_timeout_seconds) as client:
                response = client.get(
                    url,
                    params={"format": "jsonv2", **params},
                    # Nominatim refuses anonymous traffic; this identifies Partner.
                    headers={"User-Agent": settings.geocoder_user_agent, "Accept-Language": "en"},
                )
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as error:
            logger.warning("Geocoder unavailable (%s: %s)", type(error).__name__, error)
            raise HTTPException(status_code=503, detail=UNAVAILABLE_MESSAGE)

    # ----------------------------------------------------------------- public

    def search(
        self, query: str, near: tuple[float, float] | None = None, radius_degrees: float = NEAR_RADIUS_DEGREES
    ) -> list[Place]:
        """Places matching what the requester typed, best match first.

        `near` confines the answer to a box around a point. The booking map's
        search box never passes it -- a requester typing a city means that city,
        wherever it is. Resolving a *registered* address does, because a village
        name on its own is not unique in India: "Tadoor" alone is a place in
        Siddipet, 45 km from the Tadoor that shares the requester's pincode.
        Anchoring the search to their postal area is what tells the two apart.
        """
        cleaned = " ".join((query or "").split())
        if len(cleaned) < 3:
            return []
        key = f"search:{cleaned.casefold()}" + (f"@{near[0]:.3f},{near[1]:.3f}~{radius_degrees}" if near else "")
        cached = self._cached(key)
        if cached is not None:
            return cached

        params = {"q": cleaned, "limit": settings.geocoder_max_results, "addressdetails": 0}
        if settings.geocoder_country_codes.strip():
            params["countrycodes"] = settings.geocoder_country_codes.strip()
        if near:
            latitude, longitude = near
            # left,top,right,bottom -- Nominatim's own order.
            params["viewbox"] = (
                f"{longitude - radius_degrees},{latitude + radius_degrees},"
                f"{longitude + radius_degrees},{latitude - radius_degrees}"
            )
            params["bounded"] = 1
        payload = self._get("search", params)

        places = []
        seen_names: set[str] = set()
        for item in payload if isinstance(payload, list) else []:
            try:
                place = Place(str(item["display_name"]), float(item["lat"]), float(item["lon"]))
            except (KeyError, TypeError, ValueError):
                continue  # a result we cannot place is no result at all
            # One road mapped as several segments comes back once per segment, all
            # under the same name. The requester cannot tell them apart, and they
            # would crowd real alternatives out of the list; the first stays.
            if place.name.casefold() in seen_names:
                continue
            seen_names.add(place.name.casefold())
            places.append(place)
        self._remember(key, places)
        return places

    def search_typed(self, query: str) -> tuple[list[Place], str | None]:
        """What the booking map's search box asked for, and -- when the whole of
        it matched nothing -- the broader search that did answer.

        The second value is None when the places match everything typed. Otherwise
        it is the shorter text actually searched, so the box can say the list is
        for the area rather than the exact address; nothing is presented as more
        precise than it is, and the pin is still there to be moved.
        """
        cleaned = " ".join((query or "").split())
        places = self._search_as_typed(cleaned)
        if places:
            return places, None

        match = PINCODE_IN_QUERY.search(cleaned)
        rest = PINCODE_IN_QUERY.sub(" ", cleaned).strip(" ,") if match else cleaned
        rest = " ".join(rest.split())
        candidates = _relaxations(rest)[:MAX_RELAXED_SEARCHES]
        if not candidates:
            return [], None
        # Cached from the search above whenever a place name came with the pincode.
        anchor = self.search(f"{match.group(1)}, India") if match else []
        for candidate in candidates:
            if anchor:
                # Stay inside the pincode's area: the pincode is still what they meant.
                places = self.search(candidate, near=(anchor[0].latitude, anchor[0].longitude))
            else:
                places = self.search(candidate)
            if places:
                return places, f"{candidate}, {match.group(1)}" if anchor else candidate
        return [], None

    def _search_as_typed(self, cleaned: str) -> list[Place]:
        """The typed text as it stands.

        Free search, with one correction: when the requester typed a pincode
        *and* a place name, the pincode is treated as where to look rather than
        as another word to match. Without that, "Jillella 505405" answers with a
        Jillella in Andhra Pradesh, 400 km from the one in 505405 -- the name is
        common and the geocoder has no reason to prefer either. Anchoring to the
        pincode's own area settles it.

        A pincode typed on its own stays a plain search: there is no place name
        to anchor, and the postal area itself is the honest answer.
        """
        match = PINCODE_IN_QUERY.search(cleaned)
        rest = PINCODE_IN_QUERY.sub(" ", cleaned).strip(" ,") if match else ""
        if match and len(rest) >= 3:
            anchor = self.search(f"{match.group(1)}, India")
            if anchor:
                confined = self.search(rest, near=(anchor[0].latitude, anchor[0].longitude))
                if confined:
                    return confined
            # The pincode is unknown, or holds nothing by that name. Fall through
            # to the plain search rather than answering nothing at all.
        return self.search(cleaned)

    def describe(self, latitude: float, longitude: float) -> str | None:
        """What to call a point the requester dropped a pin on. Never required:
        a booking is made from the coordinates, not from this name."""
        key = f"reverse:{latitude:.5f},{longitude:.5f}"
        cached = self._cached(key)
        if cached is not None:
            return cached[0].name if cached else None
        try:
            payload = self._get("reverse", {"lat": latitude, "lon": longitude, "zoom": 18})
        except HTTPException:
            return None
        name = payload.get("display_name") if isinstance(payload, dict) else None
        places = [Place(str(name), latitude, longitude)] if name else []
        self._remember(key, places)
        return str(name) if name else None

    def area_name(self, latitude: float, longitude: float) -> str | None:
        """The town or city at a point ("Hyderabad, Telangana"), never the street:
        for naming a public visitor's weather. Best effort, cached and throttled
        like every other lookup."""
        key = f"area:{latitude:.2f},{longitude:.2f}"
        cached = self._cached(key)
        if cached is not None:
            return cached[0].name if cached else None
        try:
            payload = self._get(
                "reverse", {"lat": round(latitude, 2), "lon": round(longitude, 2), "zoom": 10, "addressdetails": 1}
            )
        except HTTPException:
            return None
        address = payload.get("address") if isinstance(payload, dict) else None
        address = address if isinstance(address, dict) else {}
        name = next(
            (
                address.get(part)
                for part in ("city", "town", "village", "county", "state_district", "state")
                if address.get(part)
            ),
            None,
        )
        if name and address.get("state") and address["state"] != name:
            name = f"{name}, {address['state']}"
        self._remember(key, [Place(name, latitude, longitude)] if name else [])
        return name


geocoding_service = GeocodingService()


def get_geocoding_service() -> GeocodingService:
    return geocoding_service
