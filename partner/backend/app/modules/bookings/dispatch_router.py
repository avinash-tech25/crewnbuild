"""Nearby dispatch: where a technician is, what they are offered, and their answer.

Every route decides who the caller is from their Partner session and then loads
the booking scoped to that identity in SQL. Nothing is read from the request: no
technician id, no requester id, no role.

What a technician can see before they accept is the whole point of this module.
A job REQUEST is a `JobOffer`, a model with nowhere to put a name, a phone
number, an address, a PIN code or a coordinate. Only once they have accepted does
the ordinary job view -- with the address and the contact rules the application
already had -- become reachable.

HTTP routes are plain `def`: they run in the threadpool, so their (synchronous)
database work never blocks the event loop that carries every websocket.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_active_technician, get_current_requester
from app.modules.bookings.dependencies import get_dispatch_service, get_technician_location_service
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.schemas import (
    JobOffer,
    LocationUpdateResponse,
    OfferOutcome,
    TechnicianLocationRequest,
    TechnicianPresence,
)
from app.modules.identity.models import Technician
from app.modules.locations.geocoding_service import GeocodingService, get_geocoding_service
from app.modules.technicians.technician_location_service import TechnicianLocationService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Nearby dispatch"])

# The technician's app offers this subprotocol with its access token as the second
# value, exactly as the requester's tracking socket does.


# ------------------------------------------------------- technician location


@router.post("/technicians/me/location", response_model=LocationUpdateResponse)
def publish_technician_location(
    payload: TechnicianLocationRequest,
    technician: Technician = Depends(get_active_technician),
    presence: TechnicianLocationService = Depends(get_technician_location_service),
):
    """The ONE location endpoint: where this technician is now.

    Sent about every LOCATION_UPDATE_INTERVAL_SECONDS while they are available or
    hold a job. Who is publishing comes from the access token, and which job the
    position belongs to from the database -- never from the body. The answer
    carries the presence it results in and, on a job, the navigation view.
    """
    return presence.publish(technician, payload)


@router.get("/technicians/me/presence", response_model=TechnicianPresence)
def read_technician_presence(
    technician: Technician = Depends(get_active_technician),
    presence: TechnicianLocationService = Depends(get_technician_location_service),
):
    return presence.presence(technician)


@router.delete("/technicians/me/location", response_model=TechnicianPresence)
def forget_technician_location(
    technician: Technician = Depends(get_active_technician),
    presence: TechnicianLocationService = Depends(get_technician_location_service),
):
    """Stop being reachable for nearby work (signing out, leaving the app). The
    stored position goes and any offer still being decided is withdrawn."""
    return presence.forget(technician)


# ----------------------------------------------------------- job requests


@router.get("/technicians/me/offers", response_model=list[JobOffer])
def list_offers(
    technician: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """Job requests waiting for this technician's answer.

    Nothing identifying: the trade, which part of a property the work is in, and
    roughly how far away it is.
    """
    return dispatch.list_offers(technician)


@router.post("/technicians/me/offers/{request_id}/accept", response_model=OfferOutcome)
def accept_offer(
    request_id: UUID,
    technician: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """Take the job. The first valid acceptance wins; every other answer is a 409
    with a code (REQUEST_ALREADY_ASSIGNED, REQUEST_CANCELLED, OFFER_EXPIRED...)."""
    return dispatch.answer_offer(technician, request_id, accept=True)


@router.post("/technicians/me/offers/{request_id}/decline", response_model=OfferOutcome)
def decline_offer(
    request_id: UUID,
    technician: Technician = Depends(get_active_technician),
    dispatch: DispatchService = Depends(get_dispatch_service),
):
    """Pass on the job. The booking keeps looking; it is not cancelled."""
    return dispatch.answer_offer(technician, request_id, accept=False)


# ------------------------------------------------ location search (requester)


@router.get("/locations/search")
def search_places(
    q: str = Query(min_length=3, max_length=200, description="What the requester typed."),
    _requester=Depends(get_current_requester),
    geocoder: GeocodingService = Depends(get_geocoding_service),
):
    """Places matching a search, for the booking map.

    Behind a booking session so Partner is not an open geocoding proxy.
    `matched` is set only when the full text found nothing and a broader part of
    it did -- the results are then for that area, not the exact address.
    """
    places, matched = geocoder.search_typed(q)
    return {"results": [place.as_dict() for place in places], "matched": matched}


@router.get("/locations/describe")
def describe_place(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    _requester=Depends(get_current_requester),
    geocoder: GeocodingService = Depends(get_geocoding_service),
):
    """What to call a point the requester dropped a pin on. Best effort."""
    return {"name": geocoder.describe(lat, lng)}


# ----------------------------------------------------------------- websocket
