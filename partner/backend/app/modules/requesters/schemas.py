"""Request and answer shapes of the requester session routes (the old app/schemas/booking.py)."""

from uuid import UUID

from pydantic import BaseModel, Field


class RequesterSessionRequest(BaseModel):
    # The one-time hand-off token Professional passes over by window.postMessage. Sent in
    # the request body, never in a URL, and exchanged once for a Partner session.
    handoff_token: str = Field(min_length=20, max_length=4096)


class RequesterProfile(BaseModel):
    id: UUID
    name: str
    role: str  # OWNER | SITE_ENGINEER
    role_label: str
    pincode: str
    area: str | None = None
    has_service_location: bool


class RequesterSessionResponse(BaseModel):
    # The session itself is in HttpOnly cookies the page cannot read. The page keeps this
    # CSRF token in memory and sends it as X-CSRF-Token on every write.
    expires_in_seconds: int
    requester: RequesterProfile
    csrf_token: str
