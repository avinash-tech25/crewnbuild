"""Property endpoints under /api/v1 (ported from the old property_routes.py; paths and
answers unchanged, ids are UUIDs).

    /property-listings...                 a seller's listings, the buyer's browse and
                                          detail, the gallery and the status
    /property-listings/{id}/request(s)    a buyer's enquiry, and the seller's list of them

Enquiries are answered through the existing /project-requests accept and reject.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.identity.models import User
from app.modules.property.schemas import (
    PropertyListingCreate,
    PropertyListingImagesUpdate,
    PropertyListingStatusUpdate,
    PropertyListingUpdate,
    PropertyRequestCreate,
)
from app.modules.property.service import PropertyListingService

router = APIRouter(tags=["Properties"])


def get_property_listing_service(database: Session = Depends(get_db)) -> PropertyListingService:
    return PropertyListingService(database)


# ---- the seller ----


@router.post("/property-listings")
def create_property_listing(
    payload: PropertyListingCreate,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Create a listing. It starts as a DRAFT and is not yet on the market."""
    return service.create_property_listing(payload=payload, user=user)


@router.get("/property-listings/mine")
def fetch_my_property_listings(
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """The caller's own listings, every status included."""
    return service.fetch_my_property_listings(status_filter=status_filter, user=user)


# ---- the buyer ----


@router.get("/property-listings")
def browse_property_listings(
    search: str | None = Query(default=None),
    property_type: str | None = Query(default=None),
    listing_type: str | None = Query(default=None),
    pincode: str | None = Query(default=None),
    city: str | None = Query(default=None),
    min_price: float | None = Query(default=None, allow_inf_nan=False),
    max_price: float | None = Query(default=None, allow_inf_nan=False),
    bedrooms: int | None = Query(default=None, ge=-2_147_483_648, le=2_147_483_647),
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Published properties in the buyer's own locality, never the buyer's own."""
    return service.browse_property_listings(
        search=search,
        property_type=property_type,
        listing_type=listing_type,
        pincode=pincode,
        city=city,
        min_price=min_price,
        max_price=max_price,
        bedrooms=bedrooms,
        user=user,
    )


@router.get("/property-listings/{listing_id}")
def fetch_property_listing(
    listing_id: uuid.UUID,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """One listing: the seller in any status; anyone else only while it is on the
    market and in their locality (else 404)."""
    return service.fetch_property_listing(listing_id=listing_id, user=user)


# ---- the seller, on one listing (404 for anyone else) ----


@router.patch("/property-listings/{listing_id}")
def update_property_listing(
    listing_id: uuid.UUID,
    payload: PropertyListingUpdate,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Edit a listing; the status moves only through the status endpoint."""
    return service.update_property_listing(listing_id=listing_id, payload=payload, user=user)


@router.put("/property-listings/{listing_id}/images")
def update_property_listing_images(
    listing_id: uuid.UUID,
    payload: PropertyListingImagesUpdate,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Replace the gallery, in the order given."""
    return service.update_property_listing_images(listing_id=listing_id, payload=payload, user=user)


@router.patch("/property-listings/{listing_id}/status")
def update_property_listing_status(
    listing_id: uuid.UUID,
    payload: PropertyListingStatusUpdate,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Publish, withdraw, mark under offer or mark sold (the transition table decides)."""
    return service.update_property_listing_status(listing_id=listing_id, payload=payload, user=user)


@router.delete("/property-listings/{listing_id}")
def delete_property_listing(
    listing_id: uuid.UUID,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Delete a listing the caller owns (its photos and enquiries go with it)."""
    return service.delete_property_listing(listing_id=listing_id, user=user)


# ---- enquiries ----


@router.post("/property-listings/{listing_id}/request")
def send_property_request(
    listing_id: uuid.UUID,
    payload: PropertyRequestCreate | None = None,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """Send the seller an enquiry about one property (the seller is read off the listing)."""
    return service.send_property_request(listing_id=listing_id, payload=payload, user=user)


@router.get("/property-listings/{listing_id}/requests")
def fetch_property_listing_requests(
    listing_id: uuid.UUID,
    user: User = Depends(current_user),
    service: PropertyListingService = Depends(get_property_listing_service),
):
    """The enquiries on one of the caller's own listings (404 for anyone else's)."""
    return service.fetch_property_listing_requests(listing_id=listing_id, user=user)
