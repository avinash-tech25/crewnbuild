"""Request and answer shapes of onboarding and work preferences (the old app/schemas)."""

from datetime import datetime, time
from decimal import Decimal
from typing import Literal
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


class ProfileUpdateRequest(BaseModel):
    """Every field optional: only what is sent changes.

    `technician_type` is deliberately absent: it decides which jobs are offered
    to the account, so it is chosen at registration and not switched later.
    """

    name: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    pincode: str | None = Field(default=None, max_length=10)
    area: str | None = Field(default=None, max_length=120)
    experience_years: int | None = Field(default=None, ge=0, le=60)


class AvailabilityUpdateRequest(BaseModel):
    """What the technician says about working now. Never ON_JOB or BUSY: those are
    facts about jobs and offers, derived on the server, not choices."""

    status: Literal["AVAILABLE", "PAUSED", "OFFLINE"]


class DashboardSummary(BaseModel):
    new_requests: int
    accepted_jobs: int
    active_jobs: int
    completed_jobs: int
    # Jobs this technician had accepted that were then cancelled.
    cancelled_jobs: int = 0
    is_available: bool
    work_status: str = "OFFLINE"
    technician_type: str | None = None
    can_receive_jobs: bool
    pending_requirements: list[str]
    # Work preferences, for the dashboard's quick overview. None = not set.
    service_radius_km: int | None = None
    working_schedule_enabled: bool = False
    # None when no schedule is enabled; otherwise whether now (India time) is inside today's hours.
    within_working_hours: bool | None = None
    # Computed from real ratings: one decimal (half-up), None with no ratings.
    average_rating: float | None = None
    rating_count: int = 0


class BankAccountResponse(BaseModel):
    account_holder_name: str
    bank_name: str
    # e.g. "••••••1234" -- the only form in which the number ever leaves the server.
    account_number_masked: str
    account_number_last4: str
    ifsc_code: str
    verification_status: str  # UNVERIFIED | PENDING | VERIFIED | REJECTED
    created_at: datetime
    updated_at: datetime


class BankAccountUpdateRequest(BaseModel):
    # Generous raw bounds; the real rules are applied after normalising. A 422 from
    # here never echoes the values (see validation_error_handler in main.py).
    account_holder_name: str = Field(max_length=200)
    bank_name: str = Field(max_length=200)
    account_number: str = Field(max_length=40)
    # Checked against account_number and then discarded -- never stored.
    confirm_account_number: str = Field(max_length=40)
    ifsc: str = Field(max_length=20)


class EarningOut(BaseModel):
    id: UUID
    service_request_id: UUID | None = None  # None if the booking was later deleted
    service_name: str | None = None
    service_kind: str | None = None
    earned_at: datetime
    gross_amount: Decimal  # the customer service price of the job
    commission_rate: Decimal  # percent, as it was when the job was completed
    commission_amount: Decimal
    net_amount: Decimal  # what the technician earned
    currency: str
    status: str


class EarningsSummary(BaseModel):
    currency: str
    # Net earnings in India time (Asia/Kolkata); the week starts on Monday.
    today_net: Decimal
    week_net: Decimal
    month_net: Decimal
    total_net: Decimal
    total_gross: Decimal
    total_commission: Decimal
    earnings_count: int
    timezone: str
