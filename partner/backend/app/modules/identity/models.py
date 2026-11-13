"""Partner identity tables (technical-architecture.md section 11, domain Accounts).

    technicians       was users: every Partner account is a technician; + deleted_at;
                      hashed_password -> password_hash; email is nullable (unique when set)
    sessions          was auth_sessions; principal_type stays technician / requester
    email_otp_codes   was email_otps

Keys are UUIDv7 and times timestamptz, read as naive UTC (NaiveUtcTimestamp) so the
ported rules keep their arithmetic. technician_profiles and
technician_identity_verifications come with part 2 (pending_links.py).

sessions.user_id has no foreign key: a session belongs either to a technician
(partner.technicians) or to a requester (a Professional account, read through
professional.v_partner_requesters), and `principal_type` says which. A session whose
account no longer exists simply fails to authenticate.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Index, Integer, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

ACCOUNT_STATUS_ONBOARDING = "ONBOARDING"
ACCOUNT_STATUS_ACTIVE = "ACTIVE"
ACCOUNT_STATUS_SUSPENDED = "SUSPENDED"

# Where an account is in sign-up. Derived, never stored.
STEP_EMAIL = "EMAIL"
STEP_FACE = "FACE"
STEP_AADHAAR = "AADHAAR"
STEP_PROFILE = "PROFILE"
STEP_COMPLETE = "COMPLETE"

PRINCIPAL_TECHNICIAN = "technician"
PRINCIPAL_REQUESTER = "requester"

REVOKED_ROTATED = "rotated"
REVOKED_LOGOUT = "logout"
REVOKED_REUSE = "reuse"
REVOKED_EXPIRED = "expired"
REVOKED_PASSWORD_CHANGE = "password_change"  # noqa: S105 a message or a name, not a secret

PURPOSE_SIGNUP = "SIGNUP"
PURPOSE_LOGIN = "LOGIN"
PURPOSE_PASSWORD_RESET = "PASSWORD_RESET"  # noqa: S105 a message or a name, not a secret


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


class Technician(UuidPrimaryKeyMixin, Base):
    """A Partner account. Registration proves the e-mail with a one-time code; sign-in is
    by e-mail and password. The row is created once the e-mail is verified (ONBOARDING)
    and becomes ACTIVE when the technician profile and the password are completed."""

    __tablename__ = "technicians"
    __table_args__ = (
        CheckConstraint("status IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED')", name="status"),
        Index(
            "uq_technicians__email", func.lower(text("email")), unique=True, postgresql_where=text("email IS NOT NULL")
        ),
    )

    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    # The sign-in password's hash (Argon2id; bcrypt for accounts from the old app until
    # their next sign-in). Never returned by any endpoint.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ACCOUNT_STATUS_ONBOARDING, server_default=ACCOUNT_STATUS_ONBOARDING
    )
    email_verified_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    # Filled in at the profile step (part 2).
    name: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    pincode: Mapped[str | None] = mapped_column(String(20), index=True)
    area: Mapped[str | None] = mapped_column(String(120))
    block: Mapped[str | None] = mapped_column(String(120))
    division: Mapped[str | None] = mapped_column(String(120))
    district: Mapped[str | None] = mapped_column(String(120), index=True)
    state: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, onupdate=naive_utc_now, server_default=text("now()")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    @property
    def is_active(self) -> bool:
        return self.status == ACCOUNT_STATUS_ACTIVE

    @property
    def is_suspended(self) -> bool:
        return self.status == ACCOUNT_STATUS_SUSPENDED

    @property
    def location_display(self) -> str:
        return ", ".join(part for part in [self.area, self.district, self.state] if part)

    @property
    def onboarding_step(self) -> str:
        from app.modules.identity.pending_links import identity_steps_submitted

        if not self.email_verified_at:
            return STEP_EMAIL
        face_submitted, aadhaar_submitted = identity_steps_submitted(self)
        if not face_submitted:
            return STEP_FACE
        if not aadhaar_submitted:
            return STEP_AADHAAR
        if not self.onboarding_completed_at:
            return STEP_PROFILE
        return STEP_COMPLETE


class Session(UuidPrimaryKeyMixin, Base):
    """One row per refresh token; a family is one sign-in. Refreshing retires the row it
    used (revoked_at, revoke_reason "rotated", replaced_by_session_id) and adds the next;
    a retired refresh token presented again revokes the whole family. Only SHA-256
    verifiers of the refresh tokens are stored. `handoff_jti` is the id of the hand-off a
    requester session was started with; unique, so a hand-off is exchanged once."""

    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("principal_type IN ('technician', 'requester')", name="principal_type"),
        UniqueConstraint("refresh_token_hash"),
        UniqueConstraint("handoff_jti"),
        Index(
            "ix_sessions__principal_type_user_id_live",
            "principal_type",
            "user_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    principal_type: Mapped[str] = mapped_column(String(12), nullable=False)
    # partner.technicians.id or a Professional account id: no foreign key (see above).
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    # Technician sessions only: "onboarding" or "partner". Kept for the whole family.
    scope: Mapped[str | None] = mapped_column(String(12))
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    token_family_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    created_at: Mapped[datetime] = created_at_column()
    expires_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False, default=naive_utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    revoke_reason: Mapped[str | None] = mapped_column(String(20))
    replaced_by_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    handoff_jti: Mapped[str | None] = mapped_column(String(64))


class EmailOtpCode(UuidPrimaryKeyMixin, Base):
    """One live e-mail code per address and purpose (sign-up, login, password reset). The
    code is stored as a hash only and never returned. The row is deleted when the code is
    used, so a code works once. A new request replaces the previous code; resends are
    limited by a cooldown and an hourly cap, wrong guesses by an attempt counter."""

    __tablename__ = "email_otp_codes"
    __table_args__ = (
        UniqueConstraint("email", "purpose"),
        CheckConstraint("purpose IN ('SIGNUP', 'LOGIN', 'PASSWORD_RESET')", name="purpose"),
    )

    email: Mapped[str] = mapped_column(String(255), nullable=False)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_sent_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    send_window_started_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False)
    sends_in_window: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = created_at_column()
