"""Live tracking shapes (the old app/schemas/tracking.py)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class DestinationRequest(BaseModel):
    """The requester's confirmed pin for their service address."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def reject_null_island(self) -> "DestinationRequest":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("0, 0 is not a valid location.")
        return self


class TechnicianPosition(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    heading: float | None = None
    speed: float | None = None
    # Server time of the fix. A reader compares it with `stale_after_seconds` and
    # shows "Location updating..." rather than an old position as if it were live.
    updated_at: datetime


class DestinationPoint(BaseModel):
    latitude: float
    longitude: float


class LineStringGeometry(BaseModel):
    """GeoJSON. Coordinates are [longitude, latitude] -- the OSRM/GeoJSON order,
    flipped back to [latitude, longitude] by the map component that draws it."""

    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class RouteOut(BaseModel):
    distance_meters: float
    duration_seconds: float
    geometry: LineStringGeometry
    source: Literal["osrm", "fallback"]


class TrackedTechnician(BaseModel):
    name: str
    technician_type: str


class TrackingSnapshot(BaseModel):
    """Everything the requester's map needs, in one answer.

    `is_live` says whether the technician is expected to be sharing right now; it
    is the server's decision, from the booking status, not something the page
    infers. `position` is absent whenever tracking is not open for this booking.
    """

    booking_id: UUID
    status: str
    status_label: str
    is_live: bool
    technician: TrackedTechnician | None = None
    destination: DestinationPoint | None = None
    position: TechnicianPosition | None = None
    route: RouteOut | None = None
    distance_remaining_meters: float | None = None
    eta_seconds: float | None = None
    # "road_route" when distance and ETA follow an OSRM road route; "straight_line"
    # when routing was unavailable and they are an approximation the page labels as such.
    eta_basis: str | None = None
    # A position older than this many seconds is not live any more.
    stale_after_seconds: int = 15
    message: str | None = None


class TechnicianTrackingStatus(BaseModel):
    """The technician's own navigation view of a job they hold.

    Only ever built for a booking the database says is theirs, so it may carry
    where they are going. A job REQUEST they have not accepted is a `JobOffer`
    (app/schemas/dispatch.py), which has no location in it at all.
    """

    booking_id: UUID
    status: str
    sharing_allowed: bool
    has_destination: bool
    # Where they are going, the road route to it, and where they are now -- the
    # three things a navigation screen is made of.
    destination: DestinationPoint | None = None
    position: TechnicianPosition | None = None
    route: RouteOut | None = None
    distance_remaining_meters: float | None = None
    eta_seconds: float | None = None
    updated_at: datetime | None = None
    message: str | None = None
