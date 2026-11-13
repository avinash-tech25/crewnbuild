"""Where the requester's registered address actually is, as a coordinate.

Professional stores an account's home as text and nothing else: the street address
they typed, the "Branch, District, State" resolved from their pincode, and the
pincode. There is no latitude or longitude column anywhere in Professional's users,
so for the booking map to open on the place the account registered, that text
has to be turned into a point.

It is turned into a point by the same geocoder the booking map's search box
already uses -- no second provider, no new key -- in two steps:

  1. the pincode is placed, giving an anchor for the postal area;
  2. the locality and the typed address are searched *within* that anchor.

Step 2 is what keeps two accounts under one pincode apart. 505405 alone holds
Badnapalli, Jillella, Nerella and Tadoor, kilometres apart, so a pincode centre
handed to all of them would send a House Owner's painter to a village they have
never been to and make the distance to a technician in the next village read as
zero. It is also why the search is confined rather than free: "Tadoor" typed on
its own lands in Siddipet, 45 km from the Tadoor in this pincode.

The pincode's own centre is used only when nothing more specific can be placed
-- rural OpenStreetMap coverage is patchy, and some of those village names are
simply not in it. It is marked as such, so the map opens wider rather than
claiming a precision the lookup did not have.

This is the *fallback* for the booking map, not its first choice. A genuinely
precise device fix still wins; `BookServicePage.jsx` holds the order.
"""

import logging

from app.modules.bookings.schemas import RegisteredLocation
from app.modules.locations.geocoding_service import GeocodingService, Place
from app.modules.locations.location_service import PincodeDirectory
from app.modules.requesters.repository import Requester

logger = logging.getLogger(__name__)

COUNTRY = "India"

# How close to open the map for each kind of answer. A street address is a
# building, a locality is a village, a pincode is a postal area -- and the last
# gets a wider view instead of a false show of precision. Never a country.
ZOOM_FOR_SOURCE = {"address": 16, "locality": 15, "pincode": 12}


def _clean(value: str | None) -> str:
    """Whitespace collapsed, so a pasted multi-line address is still one query."""
    return " ".join((value or "").split()).strip(" ,")


def _place_of(account: Requester) -> tuple[str, str, str]:
    """(address, locality, pincode) as the account recorded them.

    `location` is "Branch, District, State", written by Professional when the
    account picked its post office branch. Both parts are used: the branch names
    the village, the district and state disambiguate it.
    """
    return _clean(account.address), _clean(account.location), _clean(account.pincode)


class RegisteredLocationService:
    """Resolves an account's registered address to a point, best effort.

    Every failure answers None rather than raising: a booking map that could not
    place the profile asks the requester to search, which is a working screen.
    One that returns a 500 is not.
    """

    def __init__(self, geocoder: GeocodingService, directory: PincodeDirectory):
        self.geocoder = geocoder
        self.directory = directory

    # ------------------------------------------------------------- internals

    def _first(self, query: str, near: tuple[float, float] | None = None) -> Place | None:
        if len(query) < 3:
            return None
        try:
            found = self.geocoder.search(query, near=near)
        except Exception as error:  # the geocoder is an outside service
            logger.info("Registered location lookup failed for %r (%s)", query, type(error).__name__)
            return None
        return found[0] if found else None

    def _locality(self, account: Requester) -> str:
        """The village/branch name on its own, for a search already anchored to
        the pincode -- where the district and state add nothing but noise."""
        locality = _place_of(account)[1]
        return _clean(locality.split(",")[0]) if locality else ""

    def _district_and_state(self, account: Requester) -> str:
        """ "District, State" from the account, or from the postal directory when
        the account never recorded one. Every branch under a pincode shares
        these, so nothing about *which* village is being guessed here."""
        locality = _place_of(account)[1]
        parts = [_clean(part) for part in locality.split(",")[1:] if _clean(part)]
        if parts:
            return ", ".join(parts)
        pincode = _place_of(account)[2]
        if not pincode:
            return ""
        try:
            primary = self.directory.branches(pincode)[0]
        except Exception as error:  # the directory is an outside service too
            logger.info("Pincode directory gave no district for %s (%s)", pincode, type(error).__name__)
            return ""
        return ", ".join(part for part in [primary["district"], primary["state"]] if part)

    def _anchor(self, pincode: str, district_and_state: str) -> Place | None:
        """The postal area's own centre: the search's anchor, and the last resort."""
        if not pincode:
            return None
        return self._first(f"{pincode}, {COUNTRY}") or self._first(
            ", ".join(part for part in [pincode, district_and_state, COUNTRY] if part)
        )

    # ----------------------------------------------------------------- public

    def resolve(self, account: Requester) -> RegisteredLocation | None:
        address, _, pincode = _place_of(account)
        locality = self._locality(account)
        district_and_state = self._district_and_state(account)
        anchor = self._anchor(pincode, district_and_state)

        if anchor:
            near = (anchor.latitude, anchor.longitude)
            # Most specific first: the street the account typed, then the street
            # with its village, then the village. Each is confined to the pincode
            # area, so a street name common across India cannot pull the pin out
            # of the district.
            candidates: list[tuple[str, str]] = []
            if address:
                candidates.append(("address", ", ".join(part for part in [address, locality] if part)))
                candidates.append(("address", address))
            if locality:
                candidates.append(("locality", locality))
            for source, query in candidates:
                found = self._first(_clean(query), near=near)
                if found:
                    return self._as_location(found, source)
            return self._as_location(anchor, "pincode")

        # No pincode, or the geocoder could not place it. Ask unconfined, most
        # specific first -- there is no area left to confine the search to.
        for source, query in (
            ("address", ", ".join(part for part in [address, locality, district_and_state, pincode, COUNTRY] if part)),
            ("locality", ", ".join(part for part in [locality, district_and_state, COUNTRY] if part)),
        ):
            found = self._first(_clean(query))
            if found:
                return self._as_location(found, source)
        return None

    @staticmethod
    def _as_location(place: Place, source: str) -> RegisteredLocation:
        return RegisteredLocation(
            latitude=place.latitude,
            longitude=place.longitude,
            label=place.name,
            source=source,
            zoom=ZOOM_FOR_SOURCE[source],
        )
