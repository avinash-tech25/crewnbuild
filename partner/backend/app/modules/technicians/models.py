"""Technician tables (technical-architecture.md section 11, domains Accounts and Technician).

    technician_profiles                  user_id -> technician_id
    technician_identity_verifications    was identity_verifications; FK technician_id CASCADE;
                                         the Aadhaar ciphertext and the face capture carry
                                         the version of the key that encrypted them
    technician_services                  composite PK (technician_id, catalog_service_id)
    technician_working_hours             composite PK (technician_id, weekday)

    technician_locations                 PK technician_id (one row per technician)
    technician_payout_accounts           was technician_bank_accounts; the account number
                                         encrypted with its key version, last four shown
    technician_earnings                  service_request_id -> booking_id (SET NULL)

The Python names stay the old ones (TechnicianProfile.user_id, IdentityVerification,
TechnicianService.service_id) so the ported services are unchanged; the tables and
columns follow section 9. Times are timestamptz, read as naive UTC.
"""

import uuid
from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin, new_uuid7
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


class TechnicianLocation(Base):
    """Where a technician is right now. The ONE place a technician position lives.

    Everything that needs to know where a technician is reads this row: the
    dispatch search, the customer's live map, the technician's own navigation
    card and the arrival check. Before 0014 a journey kept a second copy on
    booking_destinations, written by a second endpoint from a second GPS
    watcher; that copy is gone.

    One row per technician, updated in place. No trail is kept: a history of
    everywhere a technician has been is a far more sensitive thing to hold than
    anything Partner needs, and nothing reads one. The row exists while the
    technician is working (available or on a job); signing out or going offline
    deletes it, and the sweeper deletes one nobody has refreshed for
    LOCATION_PURGE_AFTER_SECONDS.

    Two clocks, deliberately:
      last_location_at  SERVER time the row was last written. The only clock
                        freshness is ever judged by -- a device clock can be wrong
                        or set wrong on purpose.
      device_timestamp  when the device says it took the fix. Kept only to drop
                        fixes that arrive out of order, and bounded by
                        LOCATION_MAX_CLOCK_SKEW_SECONDS before it is believed.

    The row is not rewritten on every fix: a stationary technician's position is
    written at most every LOCATION_PERSIST_HEARTBEAT_SECONDS (always below the
    stale threshold), a moving one whenever they have moved
    LOCATION_PERSIST_MIN_MOVE_METERS. Every fix is still delivered to the
    customer live; only the database writes are thinned.
    """

    __tablename__ = "technician_locations"
    __table_args__ = (
        CheckConstraint("latitude BETWEEN -90 AND 90", name="latitude"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="longitude"),
        CheckConstraint("accuracy IS NULL OR accuracy >= 0", name="accuracy"),
        # The nearby search narrows to a bounding box before measuring distances.
        Index("ix_technician_locations__latitude_longitude", "latitude", "longitude"),
        # Freshness filter in the search, and the sweeper's purge.
        Index("ix_technician_locations__last_location_at", "last_location_at"),
    )

    technician_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("technicians.id", ondelete="CASCADE"), primary_key=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    speed: Mapped[float | None] = mapped_column(Float)
    altitude: Mapped[float | None] = mapped_column(Float)
    device_timestamp: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    last_location_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )

    technician = relationship("Technician")

    @property
    def point(self) -> tuple[float, float]:
        return self.latitude, self.longitude


# The only status for now, and a truthful one: the earning has been recorded. There
# is no payment collection and no payout yet, so nothing can make an earning
# "available" or "paid"; those states arrive with the processes that justify them.
EARNING_RECORDED = "RECORDED"


EARNING_STATUSES = (EARNING_RECORDED,)


class TechnicianEarning(Base):
    """What a technician earned for one completed, priced job.

    Created in the same transaction that marks the booking COMPLETED -- both
    happen or neither does -- and at most once per booking (UNIQUE
    service_request_id, behind the booking's row lock).

    Every figure is a snapshot taken at completion: the booking's quoted price
    (`gross_amount`), the commission rate configured at that moment, and the
    amounts derived from them. Changing the configured rate later only affects
    earnings created afterwards.

        commission_amount = round(gross_amount * commission_rate / 100, 2)  [half-up]
        net_amount        = gross_amount - commission_amount

    Both relationships are CHECKed by the database as well as computed here.

    Financial history is never cascade-deleted:
      * technician_id RESTRICT -- a technician with earnings cannot be deleted
        until somebody decides what happens to that history;
      * service_request_id SET NULL -- deleting a booking (which cascades from
        Professional account deletion) keeps the earning, which carries its own copy
        of the service name and kind for that reason.
    """

    __tablename__ = "technician_earnings"
    __table_args__ = (
        UniqueConstraint("booking_id"),
        CheckConstraint("gross_amount >= 0", name="gross"),
        CheckConstraint("commission_rate >= 0 AND commission_rate <= 100", name="rate"),
        CheckConstraint("commission_amount >= 0 AND commission_amount <= gross_amount", name="commission"),
        CheckConstraint("net_amount >= 0", name="net"),
        CheckConstraint("net_amount = gross_amount - commission_amount", name="net_is_gross_less_commission"),
        CheckConstraint(
            "commission_amount = round(gross_amount * commission_rate / 100, 2)",
            name="commission_matches_rate",
        ),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint(f"status IN ('{EARNING_RECORDED}')", name="status"),
        Index("ix_technician_earnings__technician_id_earned_at", "technician_id", "earned_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    technician_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("technicians.id", ondelete="RESTRICT"), nullable=False)
    service_request_id: Mapped[uuid.UUID | None] = mapped_column(
        "booking_id", ForeignKey("bookings.id", ondelete="SET NULL")
    )
    # A copy, so an earning still says what it was for if its booking is deleted.
    service_name: Mapped[str | None] = mapped_column(String(120))
    service_kind: Mapped[str | None] = mapped_column(String(12))
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Percent with two decimals: 0.00 to 100.00.
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), default=EARNING_RECORDED, server_default=EARNING_RECORDED, nullable=False
    )
    earned_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )


BANK_UNVERIFIED = "UNVERIFIED"


BANK_PENDING = "PENDING"


BANK_VERIFIED = "VERIFIED"


BANK_REJECTED = "REJECTED"


BANK_VERIFICATION_STATUSES = (BANK_UNVERIFIED, BANK_PENDING, BANK_VERIFIED, BANK_REJECTED)


BANK_STATUS_CHECK = "verification_status IN (" + ", ".join(f"'{status}'" for status in BANK_VERIFICATION_STATUSES) + ")"


# Indian Financial System Code: 4 letters (bank), a zero, 6 letters or digits (branch).
IFSC_PATTERN = "^[A-Z]{4}0[A-Z0-9]{6}$"


class TechnicianBankAccount(Base):
    """The one bank account a technician's payouts would go to.

    The account number is financial data and is stored the way the Aadhaar
    number is: Fernet-encrypted with DATA_ENCRYPTION_KEY (its key version stored beside
    it, DB-11), plus its last four
    digits for display. The full number is never returned by any endpoint, and
    the "confirm account number" field is never stored at all.

    `verification_status` starts UNVERIFIED: nothing here checks the account with
    a bank, so it is never marked VERIFIED by this application on its own. Any
    change to the details sends it back to UNVERIFIED.
    """

    __tablename__ = "technician_payout_accounts"
    __table_args__ = (
        # One payout account per technician, for now.
        UniqueConstraint("technician_id"),
        CheckConstraint(BANK_STATUS_CHECK, name="verification_status"),
        CheckConstraint(f"ifsc_code ~ '{IFSC_PATTERN}'", name="ifsc_code"),
        CheckConstraint("account_number_last4 ~ '^[0-9]{4}$'", name="last4"),
        CheckConstraint("btrim(account_holder_name) <> ''", name="holder"),
        CheckConstraint("btrim(bank_name) <> ''", name="bank_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    technician_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("technicians.id", ondelete="CASCADE"), nullable=False)
    account_holder_name: Mapped[str] = mapped_column(String(120), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_number_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    account_number_key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    account_number_last4: Mapped[str] = mapped_column(CHAR(4), nullable=False)
    ifsc_code: Mapped[str] = mapped_column(CHAR(11), nullable=False)
    verification_status: Mapped[str] = mapped_column(
        String(12), default=BANK_UNVERIFIED, server_default=BANK_UNVERIFIED, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )


# The old app reached the profile and the identity record from the account.
Technician.technician_profile = relationship(  # type: ignore[attr-defined]
    TechnicianProfile, back_populates="user", uselist=False, cascade="all, delete-orphan"
)
Technician.identity = relationship(  # type: ignore[attr-defined]
    IdentityVerification, back_populates="user", uselist=False, cascade="all, delete-orphan"
)
