"""Identity tables (technical-architecture.md section 10, domain Identity; DDL in 12).

    users                         was users
    user_sessions                 was auth_sessions (+ csrf_secret_hash)
    user_oauth_identities         was oauth_identities
    email_verification_codes      was email_verifications (integer key -> UUID)
    phone_verification_codes      was phone_verifications (integer key -> UUID)
    otp_send_events               was phone_otp_send_events (integer key -> UUID)
    user_verification_reviews     was verification_records (integer key -> UUID); written by
                                  the admin verification screens

Column changes against the old users table (API field names stay the same; see
service.user_response):

    hashed_password        -> password_hash
    email_verified (bool)  -> email_verified_at (timestamptz; "email_verified" = is set)
    country_of_residence   -> country_code (same values as before: the country the account
                              holder gave, "India" when none; see country_key)
    + updated_at, deleted_at

`rating` and `profile_image_url` are kept as they are: the marketplace search reads the
first and the files module (which replaces the URL with profile_image_file_id) is not
ported yet.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, CreatedAtMixin, SoftDeleteMixin, TimestampMixin, UuidPrimaryKeyMixin

# ---- Role codes stored in users.role (section 7.1) ----
ROLE_OWNER = "OWNER"
ROLE_BUILDER = "BUILDER"
ROLE_ENGINEER = "ENGINEER"
ROLE_SUPPLIER = "SUPPLIER"
# Reserved, no screens; such an account may not sign in to this application.
ROLE_PROFESSIONAL = "PROFESSIONAL"
ROLE_GLOBAL_SUPER_ADMIN = "GLOBAL_SUPER_ADMIN"
ROLE_LOCATION_SUPER_ADMIN = "LOCATION_SUPER_ADMIN"
ROLE_MANAGER = "MANAGER"
ADMIN_ROLES = (ROLE_GLOBAL_SUPER_ADMIN, ROLE_LOCATION_SUPER_ADMIN, ROLE_MANAGER)
MARKETPLACE_ROLES = (ROLE_OWNER, ROLE_BUILDER, ROLE_SUPPLIER, ROLE_ENGINEER)
STORED_ROLES = (*MARKETPLACE_ROLES, ROLE_PROFESSIONAL, *ADMIN_ROLES)

# Roles computed for the session from ENGINEER plus the engineer category (7.1).
ROLE_SITE_ENGINEER = "SITE_ENGINEER"
ROLE_STORE_MANAGER = "STORE_MANAGER"

STATUS_ACTIVE = "ACTIVE"
STATUS_SUSPENDED = "SUSPENDED"
STATUS_DELETED = "DELETED"
ACCOUNT_STATUSES = (STATUS_ACTIVE, STATUS_SUSPENDED, STATUS_DELETED)

# What users.country_code holds when sign-up gives no country (the old default).
DEFAULT_COUNTRY = "India"

# user_sessions.revoke_reason
REVOKED_ROTATED = "rotated"
REVOKED_LOGOUT = "logout"
REVOKED_REUSE = "reuse"
REVOKED_PASSWORD_RESET = "password_reset"  # noqa: S105 a revoke reason, not a secret
REVOKED_EXPIRED = "expired"
REVOKED_BY_USER = "revoked_by_user"


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class User(UuidPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in_list("role", STORED_ROLES), name="role"),
        CheckConstraint(_in_list("status", ACCOUNT_STATUSES), name="status"),
    )

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    # NULL for a phone-first account until an address is added and verified.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "" for accounts that have no number yet (OAuth sign-up, administrators, whose
    # number lives on admin_profiles.phone).
    phone: Mapped[str] = mapped_column(String(20), nullable=False, server_default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_ACTIVE, server_default="ACTIVE")
    address: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    pincode: Mapped[str] = mapped_column(String(10), nullable=False, server_default="", index=True)
    # Area / district / state resolved from the pincode; the street address is `address`.
    location: Mapped[str | None] = mapped_column(String(180))
    # The account holder's country as given at sign-up, stored exactly as the old
    # country_of_residence column stored it (free text, "India" by default).
    country_code: Mapped[str | None] = mapped_column(String(60), default=DEFAULT_COUNTRY)
    rating: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    profile_image_url: Mapped[str | None] = mapped_column(String(500))

    owner_profile = relationship("OwnerProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    contractor_profile = relationship(
        "BuilderProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    supplier_profile = relationship(
        "SupplierProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    engineer_profile = relationship(
        "EngineerProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def is_active(self) -> bool:
        return (self.status or STATUS_ACTIVE).upper() == STATUS_ACTIVE


# One address per live account, compared without case.
Index(
    "uq_users__email",
    func.lower(User.email),
    unique=True,
    postgresql_where=text("email IS NOT NULL AND deleted_at IS NULL"),
)


def country_key(column: Any) -> Any:
    """The country a phone number is unique within: the first non-blank value, else
    India, compared in upper case. Identical to the old uq_users_country_phone key."""
    return func.upper(func.coalesce(func.nullif(func.btrim(column), ""), DEFAULT_COUNTRY))


# One number per country per live account. An empty number (no number yet) is left out,
# as the old uq_users_country_phone did.
Index(
    "uq_users__country_code_phone",
    country_key(User.country_code),
    User.phone,
    unique=True,
    postgresql_where=text("phone <> '' AND deleted_at IS NULL"),
)


class UserSession(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """One row per refresh token. Signing in starts a token family; every refresh retires
    the row it used (revoked_at, revoke_reason = 'rotated', replaced_by_session_id) and
    adds the next one in the same family. A retired refresh token presented again is
    reuse and ends the whole family.

    Only one-way verifiers are stored: SHA-256 of the refresh token and of the family's
    CSRF token. `expires_at` is the family's absolute end, copied onto every row it
    rotates into, so refreshing never extends a session.
    """

    __tablename__ = "user_sessions"
    __table_args__ = (
        UniqueConstraint("refresh_token_hash"),
        Index("ix_user_sessions__user_id_active", "user_id", postgresql_where=text("revoked_at IS NULL")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    replaced_by_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip_address: Mapped[str | None] = mapped_column(INET)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(20))


class UserOAuthIdentity(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """A Google or Microsoft account linked to one account. OAuth sign-in finds the
    account through this link (the provider's stable subject), never through a matching
    e-mail address."""

    __tablename__ = "user_oauth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject"),
        UniqueConstraint("provider", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    # Google `sub`; Microsoft "<tid>:<oid>".
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    # The provider-verified e-mail when linked (a record only, never a lookup key).
    email: Mapped[str | None] = mapped_column(String(255))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailVerificationCode(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """The pending or completed e-mail code of one address: sign-up, password reset, or a
    signed-in account adding its address (purpose PROFILE:<hash of the account id>). One
    row per address; a new code overwrites the previous one."""

    __tablename__ = "email_verification_codes"

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False, default="SIGNUP")
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PhoneVerificationCode(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """The pending or completed WhatsApp code of one Indian mobile number (purpose
    SIGNUP or LOGIN). One row per number; the code and the one-time token returned by a
    correct sign-up code are stored hashed only."""

    __tablename__ = "phone_verification_codes"

    # The 10 digit national number, the form users.phone stores.
    phone: Mapped[str] = mapped_column(String(15), nullable=False, unique=True)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False, default="SIGNUP")
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_token_hash: Mapped[str | None] = mapped_column(String(64))


OTP_SEND_KINDS = ("PHONE", "IP")


class OtpSendEvent(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """One WhatsApp code request, counted per number and per client address so the
    limits hold across every API process. Only a SHA-256 of the number or address is
    kept. Rows older than a day are removed as new ones are written."""

    __tablename__ = "otp_send_events"
    __table_args__ = (
        CheckConstraint(_in_list("kind", OTP_SEND_KINDS), name="kind"),
        Index("ix_otp_send_events__kind_subject_hash_occurred_at", "kind", "subject_hash", "occurred_at"),
    )

    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    subject_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class UserVerificationReview(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """One reviewer's decision about one account's documents (was verification_records).
    Superseded decisions are kept (is_current = false) for the history."""

    __tablename__ = "user_verification_reviews"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    verification_type: Mapped[str] = mapped_column(String(60), nullable=False, default="IDENTITY")
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    documents_reviewed: Mapped[str | None] = mapped_column(Text)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewer_email: Mapped[str | None] = mapped_column(String(255))
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    expires_on: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)


# User's profile relationships name the accounts tables; importing them here registers
# those mappers wherever User is used. (accounts.models does not import this module.)
import app.modules.accounts.models  # noqa: E402, F401
