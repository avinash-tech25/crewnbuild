"""Property tables (technical-architecture.md section 10, domain Property): houses and
plots offered for sale, and buyers' enquiries.

    property_listings          UUID, + deleted_at; seller_id -> seller_user_id,
                               price -> price_amount
    property_listing_images    UUID
    property_enquiries         the property rows of the old requests table
                               (request_type PROPERTY_BUYER_TO_SELLER), split out;
                               sender_id -> buyer_user_id, receiver_id -> seller_user_id,
                               quotation_amount -> offer_amount

A listing is separate from a construction project: its own lifecycle (DRAFT -> LISTED
-> SOLD) and its own asking price. An enquiry keeps the old request lifecycle (pending,
accepted, rejected) and is answered through the same /project-requests accept and
reject endpoints as before; it answers the request attributes those flows read
(sender, receiver, request_type, quotation_amount, project_id None).

Every key is a UUID. The Python attribute names stay the old ones (seller_id, price,
sender_id, receiver_id, property_listing_id ...), so the ported service and the API
keys are unchanged. Times are timestamptz read as naive UTC.

Delete rules (9.3): a listing goes with nothing but its own delete (its photos and
enquiries go with it, CASCADE, as the old requests rows did); it keeps its seller
(RESTRICT; accounts are soft-deleted); its optional source project is SET NULL; an
enquiry keeps its buyer and seller (RESTRICT). deleted_at is in the table for the
data copy and later soft delete; the seller's delete still removes the row, as before.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp
from app.modules.labour_supply.models import account_fk, created_at_column

PROPERTY_STATUS_DRAFT = "DRAFT"
PROPERTY_STATUS_LISTED = "LISTED"
PROPERTY_STATUS_UNDER_OFFER = "UNDER_OFFER"
PROPERTY_STATUS_SOLD = "SOLD"
PROPERTY_STATUS_WITHDRAWN = "WITHDRAWN"
PROPERTY_STATUSES = (
    PROPERTY_STATUS_DRAFT,
    PROPERTY_STATUS_LISTED,
    PROPERTY_STATUS_UNDER_OFFER,
    PROPERTY_STATUS_SOLD,
    PROPERTY_STATUS_WITHDRAWN,
)
# What a buyer browsing the market can see.
PROPERTY_PUBLIC_STATUSES = (PROPERTY_STATUS_LISTED, PROPERTY_STATUS_UNDER_OFFER)
# Which status may follow which; any other move is refused.
PROPERTY_STATUS_TRANSITIONS = {
    PROPERTY_STATUS_DRAFT: (PROPERTY_STATUS_LISTED, PROPERTY_STATUS_WITHDRAWN),
    PROPERTY_STATUS_LISTED: (PROPERTY_STATUS_UNDER_OFFER, PROPERTY_STATUS_SOLD, PROPERTY_STATUS_WITHDRAWN),
    PROPERTY_STATUS_UNDER_OFFER: (PROPERTY_STATUS_LISTED, PROPERTY_STATUS_SOLD, PROPERTY_STATUS_WITHDRAWN),
    PROPERTY_STATUS_SOLD: (),
    PROPERTY_STATUS_WITHDRAWN: (PROPERTY_STATUS_LISTED,),
}

# The enquiry's request kind, as the old requests rows stored it.
PROPERTY_REQUEST_TYPE = "PROPERTY_BUYER_TO_SELLER"
ENQUIRY_STATUSES = ("pending", "accepted", "rejected")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class PropertyListing(UuidPrimaryKeyMixin, Base):
    __tablename__ = "property_listings"
    __table_args__ = (
        CheckConstraint(_in("status", PROPERTY_STATUSES), name="status"),
        CheckConstraint("price_amount >= 0", name="price"),
    )

    seller_id: Mapped[uuid.UUID] = account_fk("seller_user_id")
    # Optional origin; deleting a construction project never deletes a listing.
    source_project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    property_type: Mapped[str] = mapped_column(String(60), nullable=False)
    listing_type: Mapped[str] = mapped_column(String(30), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    country: Mapped[str | None] = mapped_column(String(60), default="India", index=True)
    state: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120))
    price: Mapped[Decimal] = mapped_column("price_amount", Numeric(14, 2), nullable=False, default=0)
    is_negotiable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    carpet_area: Mapped[float] = mapped_column(Float, default=0)
    built_up_area: Mapped[float] = mapped_column(Float, default=0)
    land_area: Mapped[float] = mapped_column(Float, default=0)
    bedrooms: Mapped[int] = mapped_column(Integer, default=0)
    bathrooms: Mapped[int] = mapped_column(Integer, default=0)
    floors: Mapped[int] = mapped_column(Integer, default=1)
    floor_type: Mapped[str | None] = mapped_column(String(40))
    furnishing: Mapped[str | None] = mapped_column(String(60))
    age_years: Mapped[int] = mapped_column(Integer, default=0)
    facing: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=PROPERTY_STATUS_DRAFT, index=True)
    cover_image_url: Mapped[str | None] = mapped_column(String(500))
    video_url: Mapped[str | None] = mapped_column(String(500))
    listed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    sold_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    deleted_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    seller = relationship("User", foreign_keys=[seller_id])
    images = relationship(
        "PropertyListingImage",
        back_populates="listing",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="(PropertyListingImage.sort_order, PropertyListingImage.id)",
    )


class PropertyListingImage(UuidPrimaryKeyMixin, Base):
    """A gallery photo on a listing: the address the upload service returned."""

    __tablename__ = "property_listing_images"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("property_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = created_at_column()

    listing = relationship("PropertyListing", back_populates="images")


class PropertyEnquiry(UuidPrimaryKeyMixin, Base):
    """A buyer's enquiry (with an optional offer) about one listing."""

    __tablename__ = "property_enquiries"
    __table_args__ = (
        CheckConstraint(_in("status", ENQUIRY_STATUSES), name="status"),
        CheckConstraint("offer_amount IS NULL OR offer_amount > 0", name="offer_amount"),
    )

    property_listing_id: Mapped[uuid.UUID] = mapped_column(
        "listing_id", ForeignKey("property_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID] = account_fk("buyer_user_id")
    receiver_id: Mapped[uuid.UUID] = account_fk("seller_user_id")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", index=True)
    quotation_amount: Mapped[Decimal | None] = mapped_column("offer_amount", Numeric(14, 2))
    quotation_created_at: Mapped[datetime | None] = mapped_column("offered_at", NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()

    sender = relationship("User", foreign_keys=[sender_id])
    receiver = relationship("User", foreign_keys=[receiver_id])
    listing = relationship("PropertyListing")

    # The request attributes the shared /project-requests flows read.
    request_type = PROPERTY_REQUEST_TYPE
    project_id = None
    project = None
