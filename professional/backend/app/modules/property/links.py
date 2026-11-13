"""What other modules read from or do with property: listing media a viewer may open
(file access), accepted enquiries for the contact rule (people), and enquiries in the
shared /project-requests flows (incoming list, accept, reject), which answered them
when they were rows of the old requests table."""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.modules.files.file_ownership import file_ids_in
from app.modules.identity.models import User
from app.modules.property.models import PropertyEnquiry, PropertyListing
from app.modules.property.service import listing_visible_to, property_request_payload

__all__ = ["property_request_payload"]


def listing_shows_file_to(database: Session, seller_id: uuid.UUID, file_id: uuid.UUID, viewer: User) -> bool:
    """A photo or video of one of the seller's listings that the viewer may see."""
    listings = database.scalars(
        select(PropertyListing)
        .options(selectinload(PropertyListing.images))
        .where(PropertyListing.seller_id == seller_id)
    ).all()
    for listing in listings:
        shown = file_ids_in(listing.cover_image_url, listing.video_url, *(image.image_url for image in listing.images))
        if file_id in shown and listing_visible_to(listing, viewer):
            return True
    return False


def accepted_enquiry_between(database: Session, first_user_id: uuid.UUID, second_user_id: uuid.UUID) -> bool:
    """Whether an accepted enquiry links these two accounts, in either direction."""
    return (
        database.scalars(
            select(PropertyEnquiry.id)
            .where(
                PropertyEnquiry.status == "accepted",
                or_(
                    and_(PropertyEnquiry.sender_id == first_user_id, PropertyEnquiry.receiver_id == second_user_id),
                    and_(PropertyEnquiry.sender_id == second_user_id, PropertyEnquiry.receiver_id == first_user_id),
                ),
            )
            .limit(1)
        ).first()
        is not None
    )


def enquiries_of(database: Session, user_id: uuid.UUID) -> list[PropertyEnquiry]:
    """The enquiries this account sent or received, with both parties and the listing."""
    return list(
        database.scalars(
            select(PropertyEnquiry)
            .options(
                selectinload(PropertyEnquiry.sender).selectinload(User.owner_profile),
                selectinload(PropertyEnquiry.receiver).selectinload(User.owner_profile),
                selectinload(PropertyEnquiry.listing).selectinload(PropertyListing.images),
            )
            .where(or_(PropertyEnquiry.sender_id == user_id, PropertyEnquiry.receiver_id == user_id))
        ).all()
    )


def lock_enquiry(database: Session, enquiry_id: Any) -> PropertyEnquiry | None:
    """An enquiry, row-locked, for an answer through /project-requests; None when the id
    is not an enquiry's."""
    return database.scalars(select(PropertyEnquiry).where(PropertyEnquiry.id == enquiry_id).with_for_update()).first()


def ensure_pending(enquiry: PropertyEnquiry) -> None:
    """The same answer as a project request that was already answered."""
    if enquiry.status != "pending":
        raise HTTPException(status_code=409, detail=f"This request has already been {enquiry.status}.")
