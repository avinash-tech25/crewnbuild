"""Live tracking endpoints: the customer watches; the technician reads their navigation view.

There is no position endpoint here. A technician's position arrives only at
POST /technicians/me/location (dispatch_router), the one place it enters the
system, and reaches this booking's watchers from there.

Every route decides who the caller is from a Partner token and then loads the
booking *scoped to that identity* in SQL. Nothing is taken from the request: there
is no technician id, no requester id and no role in a body or a query string, so
changing a booking id in the address bar reaches a 404 rather than somebody
else's technician.

The live websocket is modules/realtime (cookie sign-in and an Origin check).
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_active_technician, get_current_requester
from app.modules.bookings.dependencies import get_tracking_service
from app.modules.identity.models import Technician
from app.modules.tracking.schemas import DestinationRequest, TechnicianTrackingStatus, TrackingSnapshot
from app.modules.tracking.tracking_service import TrackingService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tracking", tags=["Live tracking"])

# The requester's page offers this subprotocol with its session token as the
# second value: new WebSocket(url, [TRACKING_SUBPROTOCOL, token]).


# ------------------------------------------------------------------ technician


@router.get("/bookings/{booking_id}/sharing", response_model=TechnicianTrackingStatus)
def read_navigation(
    booking_id: UUID,
    technician: Technician = Depends(get_active_technician),
    tracking: TrackingService = Depends(get_tracking_service),
):
    """The technician's navigation view of a job they hold: destination, road route
    and remaining distance, measured from their current (canonical) position."""
    return tracking.technician_status(technician, booking_id)


# ------------------------------------------------------------------- requester


@router.get("/bookings/{booking_id}", response_model=TrackingSnapshot)
def read_tracking(
    booking_id: UUID,
    requester=Depends(get_current_requester),
    tracking: TrackingService = Depends(get_tracking_service),
):
    """The first paint of the customer's map, and the recovery after a refresh or a resync."""
    return tracking.requester_snapshot(requester[0], booking_id)


@router.put("/bookings/{booking_id}/destination", response_model=TrackingSnapshot)
def set_destination(
    booking_id: UUID,
    payload: DestinationRequest,
    requester=Depends(get_current_requester),
    tracking: TrackingService = Depends(get_tracking_service),
):
    """The customer confirms where the technician is being asked to come."""
    return tracking.set_destination(requester[0], booking_id, payload)


# ------------------------------------------------------------------- websocket
