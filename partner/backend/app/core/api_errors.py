"""Controlled error answers for dispatch, offers and location.

Every refusal is `{"detail": {"code": "...", "message": "..."}}`: a stable code the
frontend can switch on, and a sentence safe to show as it is. A raw exception is
never sent to a client -- unexpected failures go through the handlers in
app/main.py, which answer with a generic message.
"""

from fastapi import HTTPException

# Booking / dispatch
BOOKING_NOT_FOUND = "BOOKING_NOT_FOUND"
DUPLICATE_OPEN_BOOKING = "DUPLICATE_OPEN_BOOKING"
INVALID_SERVICE = "INVALID_SERVICE"
INVALID_LOCATION = "INVALID_LOCATION"
INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"
NO_TECHNICIAN_AVAILABLE = "NO_TECHNICIAN_AVAILABLE"
REQUEST_CANCELLED = "REQUEST_CANCELLED"
REQUEST_ALREADY_ASSIGNED = "REQUEST_ALREADY_ASSIGNED"
# ---- Offers (technician) ----
OFFER_NOT_FOUND = "OFFER_NOT_FOUND"
OFFER_EXPIRED = "OFFER_EXPIRED"
OFFER_NO_LONGER_AVAILABLE = "OFFER_NO_LONGER_AVAILABLE"
NOT_ELIGIBLE = "NOT_ELIGIBLE"
TECHNICIAN_BUSY = "TECHNICIAN_BUSY"
JOB_NOT_FOUND = "JOB_NOT_FOUND"
# Location
LOCATION_IMPRECISE = "LOCATION_IMPRECISE"
LOCATION_STALE = "LOCATION_STALE"
LOCATION_JUMP_REJECTED = "LOCATION_JUMP_REJECTED"
LOCATION_CLOCK_SKEW = "LOCATION_CLOCK_SKEW"
LOCATION_OUT_OF_ORDER = "LOCATION_OUT_OF_ORDER"
LOCATION_PERMISSION_REQUIRED = "LOCATION_PERMISSION_REQUIRED"  # raised by the frontend, listed for completeness
TRACKING_CLOSED = "TRACKING_CLOSED"


def api_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})
