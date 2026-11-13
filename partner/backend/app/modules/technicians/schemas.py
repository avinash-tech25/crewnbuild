"""Request and answer shapes of onboarding and work preferences (the old app/schemas)."""

from datetime import time
from uuid import UUID

from pydantic import BaseModel, Field


class WorkingDay(BaseModel):
    """One weekday, in India time. `end_time` null = until the end of the day."""

    weekday: int = Field(ge=1, le=7)  # 1 = Monday ... 7 = Sunday
    working: bool = False
    start_time: time | None = None
    end_time: time | None = None


class WorkPreferencesUpdate(BaseModel):
    """Everything at once: the screen saves the whole set, never a fragment."""

    # true = every active service of the trade (and any added later).
    offers_all_services: bool = True
    # Read only when offers_all_services is false; at least one is then required.
    service_ids: list[UUID] = Field(default_factory=list, max_length=100)
    # null = no personal limit; otherwise 2, 5, 10 or 15.
    service_radius_km: int | None = None
    working_schedule_enabled: bool = False
    # Up to one entry per weekday. Days not sent are days off.
    working_days: list[WorkingDay] = Field(default_factory=list, max_length=7)


class WorkPreferences(WorkPreferencesUpdate):
    technician_type: str | None = None
    # Always seven entries, Monday first, whether or not a schedule is enabled.
    working_days: list[WorkingDay]
    radius_choices_km: list[int]
    timezone: str = "Asia/Kolkata"


class AadhaarSubmitRequest(BaseModel):
    # Kept as a plain string so a malformed value is refused by the service with a
    # fixed message, never echoed back by a validation error.
    aadhaar_number: str = Field(default="", max_length=32)
    consent: bool = False


class ProfileCompleteRequest(BaseModel):
    name: str = Field(max_length=150)
    technician_type: str = Field(max_length=20)
    address: str = Field(max_length=500)
    pincode: str = Field(max_length=10)
    area: str = Field(max_length=120)
    experience_years: int = Field(default=0, ge=0, le=60)
    is_available: bool = True
    # The sign-in password, created with the account. A plain string, so a weak one is
    # refused by the service with a fixed message and never echoed by a validation error.
    password: str = Field(default="", max_length=256)
    # Services, radius and working hours, chosen on the same step. Optional: a
    # client that does not send them leaves the no-restriction defaults.
    work_preferences: WorkPreferencesUpdate | None = None
