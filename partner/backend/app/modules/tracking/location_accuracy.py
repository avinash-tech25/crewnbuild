"""What counts as a position, and what is only a guess.

`navigator.geolocation` does not fail when a device has no satellite or Wi-Fi
fix. It falls back to looking up the IP address and returns the middle of
whichever city the connection appears to come from, with an `accuracy` of tens
of kilometres. The shape is identical to a real fix; only the accuracy tells
them apart.

Accepting one of those is what put a booking whose PIN code is in Karimnagar at
a point in Hyderabad, and -- because the technician's browser resolved the same
IP to the same city centre -- left the technician sitting exactly on top of the
customer, 0 m away, "arriving in under a minute".

So every place a position enters the system refuses a fix less precise than
MAX_LOCATION_ACCURACY_METERS. Nothing is invented in its place: the caller is
told there is no usable position yet, and the screens say they are waiting for
one rather than drawing a city.
"""

from app.core.api_errors import LOCATION_IMPRECISE, api_error
from app.core.runtime import settings

IMPRECISE_MESSAGE = (
    "Your device could not fix a precise location -- the position it gave is accurate "
    "to about {kilometres} km, which is an estimate from your internet connection "
    "rather than where you are. Turn on precise location (GPS), or move near a window "
    "or outdoors, and try again."
)


def is_precise_enough(accuracy_meters: float | None) -> bool:
    """A fix with no stated accuracy is trusted; a device that reports one has to
    mean it. Only a stated, and bad, accuracy is refused."""
    if accuracy_meters is None:
        return True
    return accuracy_meters <= settings.max_location_accuracy_meters


def require_precise(accuracy_meters: float | None) -> None:
    if is_precise_enough(accuracy_meters):
        return
    raise api_error(
        422, LOCATION_IMPRECISE, IMPRECISE_MESSAGE.format(kilometres=round((accuracy_meters or 0) / 1000, 1))
    )
