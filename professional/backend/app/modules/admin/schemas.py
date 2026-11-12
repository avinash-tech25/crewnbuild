"""Request bodies of the admin console (the old schemas/admin.py, same fields)."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class AdministratorCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str
    # Ignored for a location administrator, whose own scope is always used.
    scope: str | None = None
    permissions: list[str] | None = None


class AdministratorUpdate(BaseModel):
    # Each optional on its own: an omitted field is left unchanged, never cleared.
    scope: str | None = None
    permissions: list[str] | None = None
    reason: str | None = None


class StatusChange(BaseModel):
    reason: str | None = None


class VerificationDecision(BaseModel):
    status: str
    notes: str | None = None
    expires_on: str | None = None
    verification_type: str = "IDENTITY"


class ReportDecision(BaseModel):
    status: str
    note: str | None = None


class Announcement(BaseModel):
    audience: str
    title: str
    body: str


class AdvertCreate(BaseModel):
    title: str
    image_url: str
    link_url: str | None = None
    placements: list[str] | None = None
    # Ignored for a location administrator, whose own country is always used.
    scope: str | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    # What the advertiser agreed to pay, and on what basis: both or neither.
    price_amount: Decimal | None = None
    currency: str | None = None
    pricing_model: str | None = None
    # FULL, HALF or SMALL.
    display_width: str | None = None


class AdvertUpdate(BaseModel):
    title: str | None = None
    image_url: str | None = None
    link_url: str | None = None
    placements: list[str] | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    clear_dates: bool = False
    price_amount: Decimal | None = None
    pricing_model: str | None = None
    clear_price: bool = False
    display_width: str | None = None
    reason: str | None = None


class AdvertStatus(BaseModel):
    status: str
    reason: str | None = None


class StaffReply(BaseModel):
    body: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, max_length=20)
