"""Request bodies of the weather endpoints (unchanged)."""

from typing import Literal

from pydantic import BaseModel, Field


class SiteLocationUpdate(BaseModel):
    """Where a site is: coordinates typed in (MANUAL) or a place chosen from the search (SEARCH)."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    location_name: str | None = Field(default=None, max_length=255)
    country_code: str | None = Field(default=None, max_length=2)
    timezone: str | None = Field(default=None, max_length=64)
    source: Literal["MANUAL", "SEARCH"] = "MANUAL"
