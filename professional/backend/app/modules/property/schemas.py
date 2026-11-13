"""Request bodies of property listings (the old schemas/property_listing.py; same
fields and rules, ids are UUIDs). `status`, `seller_id`, `listed_at` and `sold_at` are
not in them: the seller comes from the session and the status moves only through the
status endpoint."""

import uuid
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.modules.identity.schemas import INDIA_ONLY_DETAIL, RETIRED_KUWAIT_VALUES


def reject_kuwait_value(value: str | None) -> str | None:
    """A value naming Kuwait fails (422)."""
    if str(value or "").strip().upper() in RETIRED_KUWAIT_VALUES:
        raise ValueError(INDIA_ONLY_DETAIL)
    return value


# Crash fixed: an Infinity/NaN amount or an integer beyond the column used to reach the
# database and fail with a 500 (as did text longer than its column); they are a 422 now.
Amount = Annotated[float, Field(allow_inf_nan=False, le=999_999_999_999)]
Count = Annotated[int, Field(ge=-2_147_483_648, le=2_147_483_647)]


class PropertyListingCreate(BaseModel):
    title: Annotated[str, Field(max_length=180)]
    description: str
    property_type: Annotated[str, Field(max_length=60)]
    listing_type: Annotated[str, Field(max_length=30)]
    address: str
    pincode: Annotated[str, Field(max_length=20)]
    price: Amount = 0
    is_negotiable: bool = False
    country: Annotated[str, Field(max_length=60)] | None = None
    state: Annotated[str, Field(max_length=120)] | None = None
    city: Annotated[str, Field(max_length=120)] | None = None
    carpet_area: Amount = 0
    built_up_area: Amount = 0
    land_area: Amount = 0
    bedrooms: Count = 0
    bathrooms: Count = 0
    floors: Count = 1
    floor_type: Annotated[str, Field(max_length=40)] | None = None
    furnishing: Annotated[str, Field(max_length=60)] | None = None
    age_years: Count = 0
    facing: Annotated[str, Field(max_length=40)] | None = None
    cover_image_url: Annotated[str, Field(max_length=500)] | None = None
    video_url: Annotated[str, Field(max_length=500)] | None = None
    source_project_id: uuid.UUID | None = None
    # Gallery, in the order given: addresses /files/upload returned.
    image_urls: list[Annotated[str, Field(max_length=500)]] | None = None

    @field_validator("country")
    @classmethod
    def _india_only(cls, value: str | None) -> str | None:
        return reject_kuwait_value(value)


class PropertyListingUpdate(BaseModel):
    title: Annotated[str, Field(max_length=180)] | None = None
    description: str | None = None
    property_type: Annotated[str, Field(max_length=60)] | None = None
    listing_type: Annotated[str, Field(max_length=30)] | None = None
    address: str | None = None
    pincode: Annotated[str, Field(max_length=20)] | None = None
    price: Amount | None = None
    is_negotiable: bool | None = None
    country: Annotated[str, Field(max_length=60)] | None = None
    state: Annotated[str, Field(max_length=120)] | None = None
    city: Annotated[str, Field(max_length=120)] | None = None
    carpet_area: Amount | None = None
    built_up_area: Amount | None = None
    land_area: Amount | None = None
    bedrooms: Count | None = None
    bathrooms: Count | None = None
    floors: Count | None = None
    floor_type: Annotated[str, Field(max_length=40)] | None = None
    furnishing: Annotated[str, Field(max_length=60)] | None = None
    age_years: Count | None = None
    facing: Annotated[str, Field(max_length=40)] | None = None
    cover_image_url: Annotated[str, Field(max_length=500)] | None = None
    video_url: Annotated[str, Field(max_length=500)] | None = None
    source_project_id: uuid.UUID | None = None

    @field_validator("country")
    @classmethod
    def _india_only(cls, value: str | None) -> str | None:
        return reject_kuwait_value(value)


class PropertyListingStatusUpdate(BaseModel):
    """Publish, withdraw, mark under offer or mark sold."""

    status: str


class PropertyListingImagesUpdate(BaseModel):
    """Replace the gallery with this list, in this order."""

    image_urls: list[Annotated[str, Field(max_length=500)]]


class PropertyRequestCreate(BaseModel):
    """A buyer's enquiry: an optional offer and nothing else (the property comes from the
    path, the seller from the property)."""

    offer_amount: Amount | None = None
