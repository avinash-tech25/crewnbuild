"""Request and response bodies of the identity endpoints. Field names are the old ones,
so the web app keeps working unchanged.

Request models still ignore unknown fields, as before: the web app sends a few fields
the server never read. They move to extra="forbid" (API-03) together with the web app
in R7.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

# Kuwait was once a second market. A request naming it is refused, not treated as India.
RETIRED_KUWAIT_VALUES = {"KUWAIT", "KU", "KW", "KWT", "KWD", "+965", "965"}
INDIA_ONLY_DETAIL = "Crew&Build is available in India only."


def reject_kuwait_value(value: str | None) -> str | None:
    if str(value or "").strip().upper() in RETIRED_KUWAIT_VALUES:
        raise ValueError(INDIA_ONLY_DETAIL)
    return value


class EmailCodeRequest(BaseModel):
    email: EmailStr


class EmailCodeVerify(BaseModel):
    email: EmailStr
    code: str


class PhoneCodeRequest(BaseModel):
    # The 10 digit Indian national number; +91 is fixed on the screen.
    phone: str


class PhoneCodeVerify(BaseModel):
    phone: str
    code: str


class PhoneLoginVerify(BaseModel):
    phone: str
    code: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetVerify(BaseModel):
    email: EmailStr
    code: str


class PasswordResetComplete(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    # An e-mail address or the account name, as before.
    email: str
    password: str


class SignupRequest(BaseModel):
    name: str
    # Optional only for the phone-first sign-up (a WhatsApp-verified number).
    email: EmailStr | None = None
    phone: str = ""
    password: str | None = None
    address: str = ""
    pincode: str = ""
    country_of_residence: str | None = None
    # OWNER, BUILDER (CONTRACTOR is still accepted), SUPPLIER or ENGINEER.
    role: str
    building_type: str | None = None
    construction_type: str | None = None
    budget: float | None = 0
    land_area: float | None = 0
    floors: int | None = 1
    floor_type: str | None = None
    project_title: str | None = None
    project_description: str | None = None
    site_status: str | None = None
    start_timeline: str | None = None
    design_status: str | None = None
    contact_preference: str | None = None
    company_name: str | None = None
    company_logo_url: str | None = None
    license_number: str | None = None
    experience_years: int | None = 0
    store_name: str | None = None
    categories: str | None = None
    qualification: str | None = None
    specialization: str | None = None
    about: str | None = None
    # Builders only: the paid offer chosen on the plans page; a choice, never an entitlement.
    plan_code: str | None = None
    duration_code: str | None = None
    # The token /auth/phone/verify-code returned for `phone`, where the WhatsApp check is on.
    phone_verification_token: str | None = None

    @field_validator("country_of_residence")
    @classmethod
    def india_only(cls, value: str | None) -> str | None:
        return reject_kuwait_value(value)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    email: str | None = None
    email_verified: bool = False
    phone: str
    role: str
    address: str
    pincode: str
    location: str | None = None
    country_of_residence: str | None = None
    rating: float
    profile_image_url: str | None = None
    created_at: str | None = None
    profile_complete: bool = False
    profile_completion: dict[str, Any] | None = None
    owner_profile: dict[str, Any] | None = None
    contractor_profile: dict[str, Any] | None = None
    supplier_profile: dict[str, Any] | None = None
    engineer_profile: dict[str, Any] | None = None
    # A builder's paid sign-up still to be paid ({plan_code, duration_code}), else null.
    subscription_checkout: dict[str, Any] | None = None


class AuthResponse(BaseModel):
    # The session itself travels in two HttpOnly cookies the page cannot read. The page
    # keeps this CSRF token in memory and sends it as X-CSRF-Token on every write.
    user: UserResponse
    csrf_token: str


class PartnerHandoffResponse(BaseModel):
    handoff_token: str
    expires_in_seconds: int


class SessionSummary(BaseModel):
    """One sign-in of the account (a session family), for the session list."""

    id: UUID
    user_agent: str | None
    ip_address: str | None
    last_used_at: datetime
    expires_at: datetime
    is_current: bool


class SessionList(BaseModel):
    items: list[SessionSummary]
