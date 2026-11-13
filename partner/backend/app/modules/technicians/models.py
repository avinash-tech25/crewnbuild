"""Technician tables (technical-architecture.md section 11, domains Accounts and Technician).

    technician_profiles                  user_id -> technician_id
    technician_identity_verifications    was identity_verifications; FK technician_id CASCADE;
                                         the Aadhaar ciphertext and the face capture carry
                                         the version of the key that encrypted them
    technician_services                  composite PK (technician_id, catalog_service_id)
    technician_working_hours             composite PK (technician_id, weekday)

The location, payout-account and earnings tables come with the areas that use them.
The Python names stay the old ones (TechnicianProfile.user_id, IdentityVerification,
TechnicianService.service_id) so the ported services are unchanged; the tables and
columns follow section 9. Times are timestamptz, read as naive UTC.
"""

import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now
from app.modules.identity.models import Technician

TECHNICIAN_TYPES = ("PAINTER", "PLUMBER", "ELECTRICIAN", "CARPENTER")
TECHNICIAN_TYPE_CHECK = "technician_type IN ('PAINTER', 'PLUMBER', 'ELECTRICIAN', 'CARPENTER')"

# How far a technician is willing to travel, in km: the dispatch rings. NULL = no limit.
SERVICE_RADIUS_CHOICES_KM = (2, 5, 10, 15)
# What the technician has said about working right now (only they decide it):
#   OFFLINE    not working; never offered anything
#   AVAILABLE  working and wants jobs
#   PAUSED     working, but on a break: no new offers, jobs in hand continue
WORK_STATUS_OFFLINE = "OFFLINE"
WORK_STATUS_AVAILABLE = "AVAILABLE"
WORK_STATUS_PAUSED = "PAUSED"
WORK_STATUSES = (WORK_STATUS_OFFLINE, WORK_STATUS_AVAILABLE, WORK_STATUS_PAUSED)
WORK_STATUS_CHECK = "work_status IN (" + ", ".join(f"'{status}'" for status in WORK_STATUSES) + ")"
SERVICE_RADIUS_CHECK = (
    "service_radius_km IS NULL OR service_radius_km IN (" + ", ".join(str(km) for km in SERVICE_RADIUS_CHOICES_KM) + ")"
)

FACE_NOT_STARTED = "NOT_STARTED"
FACE_PENDING = "PENDING"
FACE_VERIFIED = "VERIFIED"
FACE_FAILED = "FAILED"

AADHAAR_NOT_SUBMITTED = "NOT_SUBMITTED"
AADHAAR_PENDING = "PENDING_VERIFICATION"
AADHAAR_VERIFIED = "VERIFIED"
AADHAAR_FAILED = "FAILED"

# ISO weekdays: 1 = Monday ... 7 = Sunday.
WEEKDAYS = (1, 2, 3, 4, 5, 6, 7)


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


def updated_at_column() -> Mapped[datetime]:
    return mapped_column(
        "updated_at",
        NaiveUtcTimestamp,
        nullable=False,
        default=naive_utc_now,
        onupdate=naive_utc_now,
        server_default=text("now()"),
    )


def technician_fk(*, primary_key: bool = False, unique: bool = False) -> Mapped[uuid.UUID]:
    return mapped_column(
        "technician_id",
        ForeignKey("technicians.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=primary_key,
        unique=unique,
        index=not primary_key and not unique,
    )


class TechnicianProfile(UuidPrimaryKeyMixin, Base):
    """What makes a Partner account a technician of one of the four trades."""

    __tablename__ = "technician_profiles"
    __table_args__ = (
        CheckConstraint(TECHNICIAN_TYPE_CHECK, name="technician_type"),
        CheckConstraint("experience_years BETWEEN 0 AND 60", name="experience_years"),
        CheckConstraint(SERVICE_RADIUS_CHECK, name="service_radius_km"),
        CheckConstraint(WORK_STATUS_CHECK, name="work_status"),
        # The dispatch search always filters on both together.
        Index("ix_technician_profiles__technician_type_work_status", "technician_type", "work_status"),
    )

    user_id: Mapped[uuid.UUID] = technician_fk(unique=True)
    # Chosen at the profile step; NULL only while sign-up is in progress.
    technician_type: Mapped[str | None] = mapped_column(String(20))
    experience_years: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    work_status: Mapped[str] = mapped_column(
        String(12), nullable=False, default=WORK_STATUS_OFFLINE, server_default=WORK_STATUS_OFFLINE
    )
    profile_image_url: Mapped[str | None] = mapped_column(String(500))
    # Work preferences; every default is "no restriction".
    service_radius_km: Mapped[int | None] = mapped_column(SmallInteger)
    offers_all_services: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    working_schedule_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    user = relationship("Technician", back_populates="technician_profile")

    @property
    def is_available(self) -> bool:
        """Whether the technician wants new jobs. Read-only: change `work_status`."""
        return self.work_status == WORK_STATUS_AVAILABLE


class IdentityVerification(UuidPrimaryKeyMixin, Base):
    """Face and Aadhaar status for a technician: statuses, not biometrics.

    face_*                the live capture awaiting review: an opaque random reference to
                          the ENCRYPTED capture file (face_capture_key_version names the
                          key), cleared and the file deleted when a reviewer decides or the
                          retention passes. No face template or embedding is stored.
    aadhaar_last4         for masked display only ("XXXX XXXX 1234").
    aadhaar_fingerprint   a keyed HMAC of the number, so one Aadhaar cannot be attached to
                          two accounts, without a searchable copy.
    aadhaar_ciphertext    the number encrypted (aadhaar_key_version names the key), for a
                          reviewer or provider later. Never returned by any API, never logged.
    VERIFIED / FAILED are set only by a real decision (app/scripts/identity_review.py).
    """

    __tablename__ = "technician_identity_verifications"
    __table_args__ = (
        CheckConstraint("face_status IN ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED')", name="face_status"),
        CheckConstraint(
            "aadhaar_status IN ('NOT_SUBMITTED', 'PENDING_VERIFICATION', 'VERIFIED', 'FAILED')",
            name="aadhaar_status",
        ),
        CheckConstraint("aadhaar_ciphertext IS NULL OR aadhaar_key_version IS NOT NULL", name="aadhaar_key_version"),
    )

    user_id: Mapped[uuid.UUID] = technician_fk(unique=True)

    face_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=FACE_NOT_STARTED, server_default=FACE_NOT_STARTED
    )
    face_consent_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    face_provider: Mapped[str | None] = mapped_column(String(40))
    face_provider_reference: Mapped[str | None] = mapped_column(String(120))
    face_capture_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    face_submitted_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    face_capture_expires_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    face_verified_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    aadhaar_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=AADHAAR_NOT_SUBMITTED, server_default=AADHAAR_NOT_SUBMITTED
    )
    aadhaar_consent_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    aadhaar_last4: Mapped[str | None] = mapped_column(String(4))
    aadhaar_fingerprint: Mapped[str | None] = mapped_column(String(64), unique=True)
    aadhaar_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    aadhaar_key_version: Mapped[int | None] = mapped_column(SmallInteger)
    aadhaar_submitted_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    aadhaar_verified_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    user = relationship("Technician", back_populates="identity")

    @property
    def face_submitted(self) -> bool:
        return self.face_status in (FACE_PENDING, FACE_VERIFIED)

    @property
    def aadhaar_submitted(self) -> bool:
        return self.aadhaar_status in (AADHAAR_PENDING, AADHAAR_VERIFIED)

    @property
    def aadhaar_masked(self) -> str | None:
        return f"XXXX XXXX {self.aadhaar_last4}" if self.aadhaar_last4 else None


class TechnicianService(Base):
    """One catalog service a technician has chosen to be offered (only read while
    offers_all_services is false). The service must belong to the technician's trade;
    the application checks it, and dispatch also matches the trade on every booking."""

    __tablename__ = "technician_services"
    __table_args__ = (Index("ix_technician_services__catalog_service_id", "catalog_service_id"),)

    technician_id: Mapped[uuid.UUID] = technician_fk(primary_key=True)
    # Services are retired (is_active = false), never deleted; RESTRICT keeps it that way.
    service_id: Mapped[uuid.UUID] = mapped_column(
        "catalog_service_id", ForeignKey("catalog_services.id", ondelete="RESTRICT"), primary_key=True
    )
    created_at: Mapped[datetime] = created_at_column()


class TechnicianWorkingHours(Base):
    """One working window on one weekday, in India time (no daylight saving, so nothing
    is ambiguous). A window never crosses midnight; end_time NULL means "until the end of
    the day". A day with no row is a day off."""

    __tablename__ = "technician_working_hours"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 1 AND 7", name="weekday"),
        CheckConstraint("end_time IS NULL OR start_time < end_time", name="window"),
    )

    technician_id: Mapped[uuid.UUID] = technician_fk(primary_key=True)
    weekday: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time | None] = mapped_column(Time)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


# The old app reached the profile and the identity record from the account.
Technician.technician_profile = relationship(  # type: ignore[attr-defined]
    TechnicianProfile, back_populates="user", uselist=False, cascade="all, delete-orphan"
)
Technician.identity = relationship(  # type: ignore[attr-defined]
    IdentityVerification, back_populates="user", uselist=False, cascade="all, delete-orphan"
)
