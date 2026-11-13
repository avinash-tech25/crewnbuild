"""Property listings and buyers' enquiries (ported from the old
property_listing_service.py and property_repository.py; same rules and answers).

A listing is not a construction project; nothing here reads `projects` except to check
that an optional source project belongs to the seller. Only the seller reaches a
listing's edit, gallery, status, delete and enquiry list: anyone else gets 404
"Property listing not found", so listing ids cannot be probed. A buyer sees only
published listings in their own locality (pincode in India, else the country), never
their own, and never the seller's phone or e-mail until an enquiry or request between
them is accepted.

An enquiry is answered through the existing /project-requests accept and reject
endpoints (property links), as the old requests rows were.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.identity.models import ROLE_BUILDER, ROLE_OWNER, User
from app.modules.projects.access import require_complete_profile
from app.modules.projects.models import Project
from app.modules.projects.notices import create_request_notification
from app.modules.projects.pending_links import (
    pending_create_conversation_for_users,
    pending_create_conversation_message,
)
from app.modules.projects.people import can_view_private_contact
from app.modules.property.models import (
    PROPERTY_PUBLIC_STATUSES,
    PROPERTY_REQUEST_TYPE,
    PROPERTY_STATUS_DRAFT,
    PROPERTY_STATUS_LISTED,
    PROPERTY_STATUS_SOLD,
    PROPERTY_STATUS_TRANSITIONS,
    PROPERTY_STATUSES,
    PropertyEnquiry,
    PropertyListing,
    PropertyListingImage,
)
from app.modules.property.schemas import (
    PropertyListingCreate,
    PropertyListingImagesUpdate,
    PropertyListingStatusUpdate,
    PropertyListingUpdate,
    PropertyRequestCreate,
)

# The roles that may own a listing.
PROPERTY_SELLER_ROLES = (ROLE_OWNER, ROLE_BUILDER)
LISTING_NOT_FOUND = "Property listing not found"


def property_request_payload(listing: PropertyListing | None) -> dict[str, Any]:
    """Which property a request is about; the same keys, None, on every request that is
    not a property enquiry."""
    if not listing:
        return {"property_listing_id": None, "property_title": None, "property_image_url": None, "property_price": None}
    return {
        "property_listing_id": listing.id,
        "property_title": listing.title,
        "property_image_url": listing.cover_image_url or (listing.images[0].image_url if listing.images else None),
        "property_price": float(listing.price or 0),
    }


def ensure_property_seller(user: User) -> None:
    if user.role not in PROPERTY_SELLER_ROLES:
        raise HTTPException(status_code=403, detail="This account cannot list a property")


def owned_property_listing(database: Session, user: User, listing_id: uuid.UUID) -> PropertyListing:
    """A listing the caller owns, or 404 (never 403: ids cannot be probed)."""
    listing = database.get(PropertyListing, listing_id)
    if not listing or listing.seller_id != user.id:
        raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
    return listing


def property_listing_payload(
    listing: PropertyListing, seller: User | None = None, can_view_contact: bool = False, include_images: bool = True
) -> dict[str, Any]:
    """One listing as the API returns it; the seller's phone and e-mail only with
    `can_view_contact`."""
    payload: dict[str, Any] = {
        "id": listing.id,
        "seller_id": listing.seller_id,
        "source_project_id": listing.source_project_id,
        "title": listing.title,
        "description": listing.description,
        "property_type": listing.property_type,
        "listing_type": listing.listing_type,
        "address": listing.address,
        "pincode": listing.pincode,
        "country": listing.country,
        "state": listing.state,
        "city": listing.city,
        "price": float(listing.price or 0),
        "is_negotiable": listing.is_negotiable,
        "carpet_area": listing.carpet_area,
        "built_up_area": listing.built_up_area,
        "land_area": listing.land_area,
        "bedrooms": listing.bedrooms,
        "bathrooms": listing.bathrooms,
        "floors": listing.floors,
        "floor_type": listing.floor_type,
        "video_url": listing.video_url,
        "furnishing": listing.furnishing,
        "age_years": listing.age_years,
        "facing": listing.facing,
        "status": listing.status,
        "cover_image_url": listing.cover_image_url,
        "listed_at": local_iso(listing.listed_at),
        "sold_at": local_iso(listing.sold_at),
        "created_at": local_iso(listing.created_at),
    }
    if include_images:
        payload["images"] = [
            {"id": image.id, "image_url": image.image_url, "sort_order": image.sort_order}
            for image in sorted(listing.images, key=lambda item: (item.sort_order, item.created_at, item.id))
        ]
    if seller:
        payload["seller_name"] = seller.name
        payload["seller_role"] = seller.role
        payload["seller_rating"] = seller.rating
        payload["seller_profile_image_url"] = seller.profile_image_url
        # Absent, not blank, until the viewer may see them.
        if can_view_contact:
            payload["seller_phone"] = seller.phone
            payload["seller_email"] = seller.email
    payload["can_view_contact"] = can_view_contact
    return payload


def replace_property_listing_images(database: Session, listing: PropertyListing, image_urls: list[str]) -> None:
    """Set the gallery to exactly this list, in this order (only the address rows; the
    uploaded files are left alone)."""
    for image in list(listing.images):
        database.delete(image)
    database.flush()
    position = 0
    for image_url in image_urls:
        cleaned = (image_url or "").strip()
        if not cleaned:
            position += 1
            continue
        database.add(PropertyListingImage(listing_id=listing.id, image_url=cleaned, sort_order=position))
        position += 1
    database.flush()
    database.expire(listing, ["images"])


def verify_property_source_project(
    database: Session, user: User, source_project_id: uuid.UUID | None
) -> uuid.UUID | None:
    """A listing may only point at a project the seller owns or builds."""
    if not source_project_id:
        return None
    project = database.get(Project, source_project_id)
    if not project or user.id not in (project.owner_id, project.contractor_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return project.id


def property_visibility_scope(user: User) -> tuple[str, str]:
    """The locality a buyer may see property in, from their own account only."""
    return (user.pincode or "").strip(), (user.country_code or "India").strip()


def apply_property_visibility(statement: Any, user: User) -> Any:
    """Restrict a listing query to the buyer's locality; no pincode matches nothing."""
    viewer_pincode, viewer_country = property_visibility_scope(user)
    if viewer_country and viewer_country != "India":
        return statement.where(PropertyListing.country == viewer_country)
    return statement.where(PropertyListing.pincode == viewer_pincode)


def buyer_may_see_listing(listing: PropertyListing, user: User) -> bool:
    """The same rule as apply_property_visibility, for one loaded row."""
    viewer_pincode, viewer_country = property_visibility_scope(user)
    if viewer_country and viewer_country != "India":
        return (listing.country or "") == viewer_country
    return bool(viewer_pincode) and (listing.pincode or "") == viewer_pincode


def listing_visible_to(listing: PropertyListing, user: User) -> bool:
    """The detail endpoint's rule: the seller, or a buyer who may see a published one."""
    if listing.seller_id == user.id:
        return True
    return listing.status in PROPERTY_PUBLIC_STATUSES and buyer_may_see_listing(listing, user)


def open_enquiry(database: Session, listing_id: uuid.UUID, buyer_id: uuid.UUID) -> PropertyEnquiry | None:
    """A pending or accepted enquiry from this buyer on this listing (a rejected one does
    not block a new one)."""
    return database.scalars(
        select(PropertyEnquiry).where(
            PropertyEnquiry.property_listing_id == listing_id,
            PropertyEnquiry.sender_id == buyer_id,
            PropertyEnquiry.status.in_(["pending", "accepted"]),
        )
    ).first()


class PropertyListingService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def create_property_listing(self, payload: PropertyListingCreate, user: User) -> dict[str, Any]:
        ensure_property_seller(user)
        if not (payload.title or "").strip():
            raise HTTPException(status_code=400, detail="Property title is required")
        if payload.price is not None and payload.price < 0:
            raise HTTPException(status_code=400, detail="Price cannot be negative")
        listing = PropertyListing(
            seller_id=user.id,
            source_project_id=verify_property_source_project(self.database, user, payload.source_project_id),
            title=payload.title.strip(),
            description=payload.description,
            property_type=payload.property_type,
            listing_type=payload.listing_type,
            address=payload.address,
            pincode=payload.pincode,
            country=payload.country or user.country_code or "India",
            state=payload.state,
            city=payload.city,
            price=payload.price or 0,
            is_negotiable=payload.is_negotiable,
            carpet_area=payload.carpet_area or 0,
            built_up_area=payload.built_up_area or 0,
            land_area=payload.land_area or 0,
            bedrooms=payload.bedrooms or 0,
            bathrooms=payload.bathrooms or 0,
            floors=payload.floors or 1,
            floor_type=payload.floor_type,
            video_url=payload.video_url,
            furnishing=payload.furnishing,
            age_years=payload.age_years or 0,
            facing=payload.facing,
            cover_image_url=payload.cover_image_url,
            # Always DRAFT: publishing is its own step.
            status=PROPERTY_STATUS_DRAFT,
        )
        self.database.add(listing)
        self.database.flush()
        if payload.image_urls:
            replace_property_listing_images(self.database, listing, payload.image_urls)
        self.database.commit()
        self.database.refresh(listing)
        return property_listing_payload(listing, user, can_view_contact=True)

    def fetch_my_property_listings(self, status_filter: str | None, user: User) -> list[dict[str, Any]]:
        ensure_property_seller(user)
        statement = select(PropertyListing).where(PropertyListing.seller_id == user.id)
        if status_filter:
            statement = statement.where(PropertyListing.status == status_filter)
        listings = self.database.scalars(
            statement.options(selectinload(PropertyListing.images)).order_by(desc(PropertyListing.created_at))
        ).all()
        return [property_listing_payload(listing, user, can_view_contact=True) for listing in listings]

    def browse_property_listings(
        self,
        search: str | None,
        property_type: str | None,
        listing_type: str | None,
        pincode: str | None,
        city: str | None,
        min_price: float | None,
        max_price: float | None,
        bedrooms: int | None,
        user: User,
    ) -> dict[str, Any]:
        # Published, in the buyer's own locality, never the buyer's own: none of these
        # is a query parameter, so no request can widen past them.
        base = apply_property_visibility(
            select(PropertyListing, User)
            .join(User, PropertyListing.seller_id == User.id)
            .where(PropertyListing.status.in_(PROPERTY_PUBLIC_STATUSES), PropertyListing.seller_id != user.id),
            user,
        )
        # The Type and City choices are read before any filter narrows the rows.
        available = self.database.execute(
            base.with_only_columns(PropertyListing.property_type, PropertyListing.city)
        ).all()
        available_cities: dict[str, str] = {}
        for _type, listing_city in available:
            cleaned_city = (listing_city or "").strip()
            if cleaned_city:
                available_cities.setdefault(cleaned_city.lower(), cleaned_city)
        statement = base
        if search and search.strip():
            # Every word must match one of these fields; % and _ are taken literally.
            searchable_columns = (
                PropertyListing.title,
                PropertyListing.description,
                PropertyListing.address,
                PropertyListing.city,
                PropertyListing.state,
                PropertyListing.pincode,
                func.replace(PropertyListing.property_type, "_", " "),
            )
            for word in search.replace(",", " ").split()[:8]:
                escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                pattern = f"%{escaped}%"
                statement = statement.where(or_(*(column.ilike(pattern, escape="\\") for column in searchable_columns)))
        if property_type:
            statement = statement.where(PropertyListing.property_type == property_type)
        if listing_type:
            statement = statement.where(PropertyListing.listing_type == listing_type)
        if pincode:
            statement = statement.where(PropertyListing.pincode == pincode.strip())
        if city and city.strip():
            statement = statement.where(func.lower(func.trim(PropertyListing.city)) == city.strip().lower())
        if min_price is not None:
            statement = statement.where(PropertyListing.price >= min_price)
        if max_price is not None:
            statement = statement.where(PropertyListing.price <= max_price)
        if bedrooms is not None:
            # A plot has no BHK.
            statement = statement.where(PropertyListing.bedrooms >= bedrooms, PropertyListing.property_type != "PLOT")
        rows = self.database.execute(
            statement.options(selectinload(PropertyListing.images)).order_by(
                desc(PropertyListing.listed_at), desc(PropertyListing.created_at)
            )
        ).all()
        return {
            "listings": [property_listing_payload(listing, seller, can_view_contact=False) for listing, seller in rows],
            "property_types": sorted({value for value, _city in available if value}),
            "cities": sorted(available_cities.values(), key=str.lower),
        }

    def fetch_property_listing(self, listing_id: uuid.UUID, user: User) -> dict[str, Any]:
        listing = self.database.get(PropertyListing, listing_id)
        if not listing:
            raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
        is_seller = listing.seller_id == user.id
        if not is_seller and listing.status not in PROPERTY_PUBLIC_STATUSES:
            raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
        if not is_seller and not buyer_may_see_listing(listing, user):
            raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
        seller = self.database.get(User, listing.seller_id)
        can_view_contact = is_seller or (seller is not None and can_view_private_contact(self.database, user, seller))
        return property_listing_payload(listing, seller, can_view_contact=can_view_contact)

    def update_property_listing(
        self, listing_id: uuid.UUID, payload: PropertyListingUpdate, user: User
    ) -> dict[str, Any]:
        listing = owned_property_listing(self.database, user, listing_id)
        changes = payload.model_dump(exclude_unset=True)
        if "price" in changes and changes["price"] is not None and changes["price"] < 0:
            raise HTTPException(status_code=400, detail="Price cannot be negative")
        if "source_project_id" in changes:
            changes["source_project_id"] = verify_property_source_project(
                self.database, user, changes["source_project_id"]
            )
        for field, value in changes.items():
            setattr(listing, field, value)
        self.database.commit()
        self.database.refresh(listing)
        return property_listing_payload(listing, user, can_view_contact=True)

    def update_property_listing_images(
        self, listing_id: uuid.UUID, payload: PropertyListingImagesUpdate, user: User
    ) -> dict[str, Any]:
        listing = owned_property_listing(self.database, user, listing_id)
        replace_property_listing_images(self.database, listing, payload.image_urls)
        self.database.commit()
        self.database.refresh(listing)
        return property_listing_payload(listing, user, can_view_contact=True)

    def update_property_listing_status(
        self, listing_id: uuid.UUID, payload: PropertyListingStatusUpdate, user: User
    ) -> dict[str, Any]:
        listing = owned_property_listing(self.database, user, listing_id)
        requested = (payload.status or "").strip().upper()
        if requested not in PROPERTY_STATUSES:
            raise HTTPException(status_code=400, detail="Unknown property listing status")
        allowed = PROPERTY_STATUS_TRANSITIONS.get(listing.status, ())
        if requested not in allowed:
            raise HTTPException(
                status_code=409,
                detail=f"A {listing.status} listing cannot become {requested}. Allowed: {', '.join(allowed) or 'none'}",
            )
        listing.status = requested
        if requested == PROPERTY_STATUS_LISTED and not listing.listed_at:
            # Stamped on the first publication only.
            listing.listed_at = naive_utc_now()
        if requested == PROPERTY_STATUS_SOLD:
            listing.sold_at = naive_utc_now()
        self.database.commit()
        self.database.refresh(listing)
        return property_listing_payload(listing, user, can_view_contact=True)

    def delete_property_listing(self, listing_id: uuid.UUID, user: User) -> dict[str, Any]:
        listing = owned_property_listing(self.database, user, listing_id)
        # Its photos and enquiries go with it (CASCADE); the uploaded files stay.
        self.database.delete(listing)
        self.database.commit()
        return {"deleted": True}

    def send_property_request(
        self, listing_id: uuid.UUID, payload: PropertyRequestCreate | None, user: User
    ) -> dict[str, Any]:
        require_complete_profile(user)
        listing = self.database.get(PropertyListing, listing_id)
        # Only a property on the market, and only one the buyer may see.
        if not listing or listing.status not in PROPERTY_PUBLIC_STATUSES:
            raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
        if listing.seller_id != user.id and not buyer_may_see_listing(listing, user):
            raise HTTPException(status_code=404, detail=LISTING_NOT_FOUND)
        seller = self.database.get(User, listing.seller_id)
        if not seller:
            raise HTTPException(status_code=404, detail="Property seller not found")
        if seller.id == user.id:
            raise HTTPException(status_code=400, detail="You cannot send a request on your own property")
        if open_enquiry(self.database, listing.id, user.id):
            raise HTTPException(status_code=409, detail="Request already sent")
        offer_amount = payload.offer_amount if payload else None
        if offer_amount is not None and offer_amount <= 0:
            raise HTTPException(status_code=400, detail="Offer amount must be greater than zero")
        enquiry = PropertyEnquiry(
            # The buyer from the session and the seller from the listing, never the body.
            sender_id=user.id,
            receiver_id=seller.id,
            property_listing_id=listing.id,
            quotation_amount=offer_amount,
            quotation_created_at=naive_utc_now() if offer_amount else None,
        )
        self.database.add(enquiry)
        self.database.flush()
        conversation = pending_create_conversation_for_users(self.database, listing.title, [user.id, seller.id])
        pending_create_conversation_message(
            self.database, conversation, user.id, f"REQUEST: {user.name} is interested in {listing.title}.", "REQUEST"
        )
        create_request_notification(
            self.database,
            seller.id,
            "New request",
            f"{PROPERTY_REQUEST_TYPE}: {user.name} sent a request for {listing.title}.",
            category="PROPERTY",
        )
        self.database.commit()
        self.database.refresh(enquiry)
        return {
            "id": enquiry.id,
            "status": enquiry.status,
            "property_listing_id": enquiry.property_listing_id,
            "receiver_id": enquiry.receiver_id,
        }

    def fetch_property_listing_requests(self, listing_id: uuid.UUID, user: User) -> list[dict[str, Any]]:
        listing = owned_property_listing(self.database, user, listing_id)
        rows = self.database.execute(
            select(PropertyEnquiry, User)
            .join(User, PropertyEnquiry.sender_id == User.id)
            .where(PropertyEnquiry.property_listing_id == listing.id)
            .order_by(desc(PropertyEnquiry.created_at))
        ).all()
        return [
            {
                "id": enquiry.id,
                "status": enquiry.status,
                "buyer_id": buyer.id,
                "buyer_name": buyer.name,
                "offer_amount": float(enquiry.quotation_amount) if enquiry.quotation_amount else None,
                "created_at": local_iso(enquiry.created_at),
                "can_view_contact": can_view_private_contact(self.database, user, buyer),
            }
            for enquiry, buyer in rows
        ]
