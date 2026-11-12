"""Request and response bodies of the accounts endpoints. Field names are the old ones.

Request models still ignore unknown fields, as before; extra="forbid" comes with the
web app in R7.
"""

from pydantic import BaseModel, Field, field_validator

from app.modules.identity.schemas import UserResponse, reject_kuwait_value


class CompleteProfileRequest(BaseModel):
    name: str | None = None
    phone: str
    # Where the WhatsApp check is on, a changed Indian number needs the token
    # /auth/phone/verify-code returned for it.
    phone_verification_token: str | None = None
    address: str
    pincode: str
    location: str | None = None
    country_of_residence: str | None = None
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
    profile_image_url: str | None = None
    about: str | None = None
    gstin: str | None = None
    pan: str | None = None
    website: str | None = None
    business_type: str | None = None
    supplier_category: str | None = None
    registration_year: int | None = None
    team_size: str | None = None
    insurance_available: bool | None = False
    service_locations: str | None = None
    services_offered: str | None = None
    equipment_owned: str | None = None
    documents: str | None = None
    gallery: str | None = None
    completed_project_details: str | None = None
    store_name: str | None = None
    store_logo_url: str | None = None
    categories: str | None = None
    qualification: str | None = None
    specialization: str | None = None

    @field_validator("country_of_residence")
    @classmethod
    def india_only(cls, value: str | None) -> str | None:
        return reject_kuwait_value(value)


class SupplierCategoryUpdate(BaseModel):
    """The category a new supplier chose. The account comes from the session."""

    supplier_category: str


class SupplierCategorySaved(BaseModel):
    supplier_category: str
    user: UserResponse


class EngineerCategoryUpdate(BaseModel):
    """The category a new engineer chose. The account comes from the session."""

    specialization: str


class EngineerCategorySaved(BaseModel):
    specialization: str
    user: UserResponse


class PhoneChangeRequest(BaseModel):
    # The new 10 digit Indian number and the token its WhatsApp check returned.
    phone: str
    phone_verification_token: str


class ProfileImageUpdate(BaseModel):
    profile_image_url: str


class BusinessLogoUpdate(BaseModel):
    logo_url: str


class LocationUpdate(BaseModel):
    """The account's pincode and the post office branch chosen for it."""

    pincode: str
    branch_name: str


class AccountDeletionCreate(BaseModel):
    """The Delete Account form. The account is always the session's own; these details
    only confirm the user knows which account they are deleting."""

    full_name: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    phone: str = Field(min_length=1, max_length=30)
    reason_code: str = Field(min_length=1, max_length=40)
    reason_details: str | None = Field(default=None, max_length=1000)
    confirm_deletion: bool
    confirmation_text: str | None = Field(default=None, max_length=50)
