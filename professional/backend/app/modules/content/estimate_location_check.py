"""Server-side check of the public Get Estimate location (POST /estimates/public-calculate),
ported unchanged.

The PIN is looked up in India Post through the existing, unchanged
location_service functions, and must confirm BOTH the selected state and the
selected city before any estimate is produced. The page checks the same
thing (src/utils/estimateLocationMatch.js), with the same rules; this side
exists so a request that bypasses the page is refused too.

Rules:
  - every post office returned is inspected, never just the first;
  - the state must equal a branch's state ("&" read as "and");
  - the city must equal, after normalising, the district, postal division or
    block of a branch in that state (post-office names are not used);
  - the only spelling differences accepted are the approved official renames
    in CITY_ALIASES. Anything else is "unconfirmed" and refused.

Errors (detail = {"code", "message"}):
  400 invalid_pin, state_mismatch
  404 pin_not_found
  422 city_unconfirmed   (includes a PIN India Post has no district/state for)
  503 lookup_unavailable (India Post unreachable, timeout, bad response)
"""

import re

from fastapi import HTTPException

from app.integrations.india_post.pincode_directory import clean_india_pincode, fetch_india_pincode_branches

CITY_ALIASES = (
    ("bengaluru", "bangalore"),
    ("gurugram", "gurgaon"),
    ("prayagraj", "allahabad"),
    ("mysuru", "mysore"),
    ("mumbai", "bombay"),
    ("kolkata", "calcutta"),
)

HARMLESS_SUFFIXES = frozenset({"city", "gpo", "urban", "rural", "east", "west", "north", "south", "central"})

INDIA_PIN = re.compile(r"[1-9]\d{5}")

MESSAGES = {
    "invalid_pin": "Enter a valid 6-digit Indian PIN code.",
    "pin_not_found": "This PIN code was not found. Please check and try again.",
    "state_mismatch": "This PIN code does not belong to the selected state.",
    "city_unconfirmed": "We couldn't confirm the selected city for this PIN code. Please verify your location.",
    "lookup_unavailable": "We couldn't verify this PIN code right now. Please try again.",
}
STATUS = {
    "invalid_pin": 400,
    "state_mismatch": 400,
    "pin_not_found": 404,
    "city_unconfirmed": 422,
    "lookup_unavailable": 503,
}


def refuse(code: str) -> HTTPException:
    return HTTPException(status_code=STATUS[code], detail={"code": code, "message": MESSAGES[code]})


def _basic_name(value: str | None) -> str:
    text = (value or "").lower().replace("&", " and ")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = text.replace(".", "")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def normalize_state(value: str | None) -> str:
    return _basic_name(value)


def normalize_city(value: str | None) -> str:
    words = _basic_name(value).split()
    while len(words) > 1 and words[-1] in HARMLESS_SUFFIXES:
        words.pop()
    name = " ".join(words)
    for group in CITY_ALIASES:
        if name in group:
            return group[0]
    return name


def location_matches(branches: list[dict[str, str]], state: str, city: str) -> str:
    """'verified', 'state_mismatch' or 'city_unconfirmed' for these India Post branches."""
    wanted_state = normalize_state(state)
    in_state = [branch for branch in branches if normalize_state(branch.get("state")) == wanted_state]
    if not in_state:
        return "state_mismatch"
    wanted_city = normalize_city(city)
    places = {
        normalize_city(branch.get(field))
        for branch in in_state
        for field in ("district", "division", "block")
        if branch.get(field)
    }
    return "verified" if wanted_city in places else "city_unconfirmed"


async def verify_estimate_location(pincode: str, state: str, city: str) -> str:
    """The cleaned PIN once India Post confirms it is in this state and city;
    otherwise raises the matching HTTPException. Never passes on a failure."""
    try:
        cleaned = clean_india_pincode(pincode)  # the shared 6-digit check, unchanged
    except HTTPException:
        raise refuse("invalid_pin") from None
    # No Indian PIN starts with 0; the estimate calculation refuses those too.
    if not INDIA_PIN.fullmatch(cleaned):
        raise refuse("invalid_pin")
    try:
        branches = await fetch_india_pincode_branches(cleaned)
    except HTTPException as error:
        if error.status_code == 404:
            raise refuse("pin_not_found") from None
        if error.status_code == 422:
            raise refuse("city_unconfirmed") from None
        raise refuse("lookup_unavailable") from None
    except Exception:
        raise refuse("lookup_unavailable") from None
    outcome = location_matches(branches or [], state, city)
    if outcome != "verified":
        raise refuse(outcome)
    return cleaned
