"""Account profile tables (technical-architecture.md section 10, domain Accounts).

Sign-up writes the role's profile, the session answer reads them, WhatsApp sign-in
finds administrators by admin_profiles.phone, the Book Technician and Store Manager
rules read the engineer category, and the accounts endpoints edit them.

    owner_profiles      integer key -> UUID; FK user_id CASCADE
    builder_profiles    integer key -> UUID; FK user_id CASCADE
    engineer_profiles   integer key -> UUID; FK user_id CASCADE; + category
    supplier_profiles   integer key -> UUID; FK user_id CASCADE
    admin_profiles      integer key -> UUID; FK user_id CASCADE, created_by_id SET NULL
    account_deletion_requests  integer key -> UUID; original_user_id without a foreign key

owner_profiles.budget is stored as budget_amount (money naming, section 9.1); the API
field stays `budget`.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import Base, TimestampMixin, UuidPrimaryKeyMixin

# ---- Engineer categories ----
SITE_ENGINEER_SPECIALIZATION = "Site Engineer"
STORE_MANAGER_SPECIALIZATION = "Store Manager"
# Every Engineer Category, in the order the forms list them. The onboarding save
# accepts only these.
ENGINEER_CATEGORIES = (
    SITE_ENGINEER_SPECIALIZATION,
    "Soil Engineer",
    "Survey Engineer",
    "Architecture",
    "Structural Engineer",
    "Civil Engineer",
    "Electrical Engineer",
    "Plumbing",
    "Mechanical Engineer",
    "HVAC",
    "Quantity Surveyor",
    "Safety",
    "Construction Safety",
    "Finishing / Painter",
    STORE_MANAGER_SPECIALIZATION,
)

# engineer_profiles.category: the two categories that change what an engineer may do.
CATEGORY_SITE_ENGINEER = "SITE_ENGINEER"
CATEGORY_STORE_MANAGER = "STORE_MANAGER"
ENGINEER_ACCESS_CATEGORIES = (CATEGORY_SITE_ENGINEER, CATEGORY_STORE_MANAGER)


def engineer_category_for(specialization: str | None) -> str | None:
    """The category column for a specialization, by the rules the old code applied to
    the specialization text itself:

    * Site Engineer: exactly "Site Engineer" after trimming (the Book Technician rule)
    * Store Manager: "Store Manager" ignoring case (the Store Manager dashboard rule)
    """
    value = (specialization or "").strip()
    if value == SITE_ENGINEER_SPECIALIZATION:
        return CATEGORY_SITE_ENGINEER
    if value.casefold() == STORE_MANAGER_SPECIALIZATION.casefold():
        return CATEGORY_STORE_MANAGER
    return None


# ---- Administrators ----
SCOPE_GLOBAL = "GLOBAL"
SCOPE_INDIA = "IN"
ADMIN_SCOPES = (SCOPE_GLOBAL, SCOPE_INDIA)


class OwnerProfile(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "owner_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    building_type: Mapped[str] = mapped_column(String(60), nullable=False, default="RESIDENTIAL")
    construction_type: Mapped[str] = mapped_column(String(60), nullable=False, default="CONTRACTOR")
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    land_area: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    floors: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    floor_type: Mapped[str | None] = mapped_column(String(40))
    project_title: Mapped[str | None] = mapped_column(String(180))
    project_description: Mapped[str | None] = mapped_column(Text)
    site_status: Mapped[str | None] = mapped_column(String(120))
    start_timeline: Mapped[str | None] = mapped_column(String(120))
    design_status: Mapped[str | None] = mapped_column(String(120))
    contact_preference: Mapped[str | None] = mapped_column(String(120))

    user = relationship("User", back_populates="owner_profile")


class BuilderProfile(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "builder_profiles"
    __table_args__ = (
        CheckConstraint(
            "(signup_plan_code IS NULL AND signup_duration_code IS NULL) OR "
            "(signup_plan_code IN ('PROFESSIONAL', 'BUSINESS') AND signup_duration_code IN ('MONTHLY', 'ANNUAL'))",
            name="signup_plan",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    company_name: Mapped[str] = mapped_column(String(160), nullable=False)
    license_number: Mapped[str | None] = mapped_column(String(100))
    experience_years: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_projects: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_project_details: Mapped[str | None] = mapped_column(Text)
    gallery: Mapped[str | None] = mapped_column(Text)
    company_logo_url: Mapped[str | None] = mapped_column(String(500))
    about: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(60))
    pan: Mapped[str | None] = mapped_column(String(60))
    website: Mapped[str | None] = mapped_column(String(255))
    business_type: Mapped[str | None] = mapped_column(String(120))
    registration_year: Mapped[int | None] = mapped_column(Integer)
    team_size: Mapped[str | None] = mapped_column(String(80))
    has_insurance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    service_locations: Mapped[str | None] = mapped_column(Text)
    services_offered: Mapped[str | None] = mapped_column(Text)
    equipment_owned: Mapped[str | None] = mapped_column(Text)
    documents: Mapped[str | None] = mapped_column(Text)
    # The paid plan chosen at sign-up; it grants nothing (billing/signup_checkout.py).
    signup_plan_code: Mapped[str | None] = mapped_column(String(20))
    signup_duration_code: Mapped[str | None] = mapped_column(String(20))

    user = relationship("User", back_populates="contractor_profile")


class SupplierProfile(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "supplier_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    store_name: Mapped[str] = mapped_column(String(160), nullable=False)
    categories: Mapped[str] = mapped_column(Text, nullable=False, default="")
    about: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(60))
    pan: Mapped[str | None] = mapped_column(String(60))
    website: Mapped[str | None] = mapped_column(String(255))
    business_type: Mapped[str | None] = mapped_column(String(120))
    # Material, Labour or Equipment; NULL until chosen.
    supplier_category: Mapped[str | None] = mapped_column(String(60))
    registration_year: Mapped[int | None] = mapped_column(Integer)
    delivery_locations: Mapped[str | None] = mapped_column(Text)
    documents: Mapped[str | None] = mapped_column(Text)
    gallery: Mapped[str | None] = mapped_column(Text)
    store_logo_url: Mapped[str | None] = mapped_column(String(500))

    user = relationship("User", back_populates="supplier_profile")


class EngineerProfile(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "engineer_profiles"
    __table_args__ = (
        CheckConstraint(
            "category IS NULL OR category IN ('SITE_ENGINEER', 'STORE_MANAGER')",
            name="category",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    qualification: Mapped[str | None] = mapped_column(String(160))
    # The Engineer Category the person chose, as shown on screen.
    specialization: Mapped[str | None] = mapped_column(String(160))
    # SITE_ENGINEER or STORE_MANAGER, derived from `specialization` whenever it is set
    # (engineer_category_for); NULL for every other category.
    category: Mapped[str | None] = mapped_column(String(20), index=True)
    experience_years: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    license_number: Mapped[str | None] = mapped_column(String(100))
    about: Mapped[str | None] = mapped_column(Text)
    profile_image_url: Mapped[str | None] = mapped_column(String(500))

    user = relationship("User", back_populates="engineer_profile")

    @validates("specialization")
    def _keep_category_in_step(self, _key: str, value: str | None) -> str | None:
        self.category = engineer_category_for(value)
        return value


class AdminProfile(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """Scope, permissions and WhatsApp sign-in number of one administrator."""

    __tablename__ = "admin_profiles"
    __table_args__ = (
        CheckConstraint("scope IN ('GLOBAL', 'IN')", name="scope"),
        Index("uq_admin_profiles__phone", "phone", unique=True, postgresql_where=text("phone <> ''")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # Comma-separated permission keys, e.g. "users.view,projects.view".
    permissions: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # The 10 digit Indian number for WhatsApp sign-in, "" when none is set.
    phone: Mapped[str] = mapped_column(String(30), nullable=False, default="", server_default="")

    user = relationship("User", foreign_keys=[user_id])


# ---- Account deletion ----
DELETION_STATUS_PENDING = "PENDING"
DELETION_STATUS_VERIFICATION = "VERIFICATION"
DELETION_STATUS_APPROVED = "APPROVED"
DELETION_STATUS_REJECTED = "REJECTED"
DELETION_STATUS_DELETED = "DELETED"
DELETION_SOURCE_PUBLIC = "PUBLIC"
DELETION_SOURCE_IN_APP = "IN_APP"


class AccountDeletionRequest(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """The record of an account deletion, written in the same transaction as the
    deletion. Rows of the earlier request-and-approval workflow (PENDING, VERIFICATION,
    APPROVED, REJECTED; sources PUBLIC and IN_APP) keep their values.

    original_user_id holds the account's id as a plain value, deliberately without a
    foreign key: it is the record of who the account was, whatever happens to the row
    in users."""

    __tablename__ = "account_deletion_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'VERIFICATION', 'APPROVED', 'REJECTED', 'DELETED')",
            name="status",
        ),
        CheckConstraint("source IN ('PUBLIC', 'IN_APP')", name="source"),
        # One open request per account.
        Index(
            "uq_account_deletion_requests__user_id_active",
            "user_id",
            unique=True,
            postgresql_where=text("status IN ('PENDING', 'VERIFICATION', 'APPROVED')"),
        ),
    )

    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    original_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    account_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason_code: Mapped[str | None] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(
        String(10), nullable=False, default=DELETION_SOURCE_PUBLIC, server_default=DELETION_SOURCE_PUBLIC
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    account_name: Mapped[str | None] = mapped_column(String(255))
    account_email: Mapped[str | None] = mapped_column(String(255))
    submitted_name: Mapped[str | None] = mapped_column(String(255))
    policy_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_email: Mapped[str] = mapped_column(String(255), nullable=False)
    submitted_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    submitted_role: Mapped[str] = mapped_column(String(30), nullable=False)
    account_role: Mapped[str] = mapped_column(String(30), nullable=False)
    email_matches_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=DELETION_STATUS_PENDING, index=True)
    # SHA-256 of the client address, for abuse limits; never the address itself.
    client_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    retained_records: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    deletion_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    last_failure: Mapped[str | None] = mapped_column(Text)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    company_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requester_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notification_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    notification_error: Mapped[str | None] = mapped_column(Text)
