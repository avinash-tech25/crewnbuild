"""Technician sign-up and sign-in (the old app/technician/services/auth_service.py, same
rules and answers). The profile step (complete_profile) comes with part 2.

Sign-in checks the password against Argon2id, or against a bcrypt hash from the old app;
a bcrypt (or outdated Argon2id) hash is replaced with a fresh Argon2id one right after a
successful sign-in.
"""

import re
import uuid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.local_time import to_local_iso
from app.core.security.password_hashing import (
    PASSWORD_MAX_BYTES,
    PASSWORD_RULE_MESSAGE,
    hash_secret,
    needs_rehash,
    password_is_strong,
    verify_against_unknown_account,
    verify_secret,
)
from app.database.types import naive_utc_now
from app.modules.identity.models import ACCOUNT_STATUS_ONBOARDING, PURPOSE_SIGNUP, STEP_COMPLETE, Technician
from app.modules.identity.otp_service import OtpService, normalize_email
from app.modules.identity.repository import TechnicianRepository
from app.modules.identity.schemas import AuthResponse, CodeSentResponse, OnboardingState, TechnicianResponse
from app.modules.rate_limits import service as limits

THROTTLED_MESSAGE = "Too many sign-in attempts. Please wait a few minutes and try again."
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# Contact number only (codes go to e-mail): exactly 10 ASCII digits, as the frontend asks.
MOBILE_PATTERN = re.compile(r"\d{10}", re.ASCII)
SUSPENDED_MESSAGE = "This account has been suspended. Contact CREWNBUILD support."
INVALID_CREDENTIALS_MESSAGE = "Invalid email or password."
ALREADY_REGISTERED = "This email is already registered. Log in instead."


class LoginThrottle:
    """Failed sign-in attempts (technical-architecture.md 6.4), counted in rate_limit_events
    so every API process shares them: LOGIN_MAX_FAILURES_PER_EMAIL (5) per e-mail address
    and LOGIN_MAX_FAILURES_PER_CLIENT (20) per client address over
    LOGIN_FAILURE_WINDOW_SECONDS (15 minutes). Past either limit a sign-in is refused with
    429 before its password is checked, the same whether or not the e-mail has an account;
    the refused attempt counts too, so the wait grows while attempts continue. A
    successful sign-in clears its e-mail's count. Only hashes of the keys are stored.

    Before R6 the counts lived in each process, at 10 and 50."""

    EMAIL_BUCKET = "login:account"
    CLIENT_BUCKET = "login:address"

    def ensure_allowed(self, database: Session, settings: Settings, email: str, client: str | None) -> None:
        window = settings.login_failure_window_seconds
        over_email = limits.blocked(database, self.EMAIL_BUCKET, email, settings.login_max_failures_per_email, window)
        over_client = limits.blocked(
            database, self.CLIENT_BUCKET, client or "unknown", settings.login_max_failures_per_client, window
        )
        if not (over_email or over_client):
            return
        self.failed(database, email, client)
        wait = max(
            limits.retry_after_seconds(database, self.EMAIL_BUCKET, email, window) if over_email else 0,
            limits.retry_after_seconds(database, self.CLIENT_BUCKET, client or "unknown", window) if over_client else 0,
        )
        raise HTTPException(status_code=429, detail=THROTTLED_MESSAGE, headers={"Retry-After": str(wait)})

    def failed(self, database: Session, email: str, client: str | None) -> None:
        limits.record(database, self.EMAIL_BUCKET, email)
        limits.record(database, self.CLIENT_BUCKET, client or "unknown")

    def succeeded(self, database: Session, email: str) -> None:
        limits.clear(database, self.EMAIL_BUCKET, email)


login_throttle = LoginThrottle()


def clean_email(value: str | None) -> str:
    email = normalize_email(value)
    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


def clean_phone(value: str | None) -> str:
    # Spaces are ignored; anything else that is not a digit is refused, never dropped.
    phone = "".join((value or "").split())
    if not MOBILE_PATTERN.fullmatch(phone):
        raise HTTPException(status_code=422, detail="Enter a valid 10 digit mobile number.")
    return phone


def clean_new_password(value: str | None) -> str:
    password = value or ""
    if not password_is_strong(password):
        raise HTTPException(status_code=422, detail=PASSWORD_RULE_MESSAGE)
    return password


def clean_name(value: str | None) -> str:
    name = " ".join((value or "").split())
    if len(name) < 2 or len(name) > 120:
        raise HTTPException(status_code=422, detail="Enter a name between 2 and 120 characters.")
    return name


def clean_address(value: str | None) -> str:
    address = (value or "").strip()
    if len(address) < 5 or len(address) > 500:
        raise HTTPException(status_code=422, detail="Enter a complete address (5 to 500 characters).")
    return address


def clean_technician_type(value: str | None) -> str:
    from app.modules.technicians.models import TECHNICIAN_TYPES

    technician_type = (value or "").strip().upper()
    if technician_type not in TECHNICIAN_TYPES:
        raise HTTPException(status_code=422, detail="Choose Painter, Plumber, Electrician or Carpenter.")
    return technician_type


def technician_response(technician: Technician, settings: Settings) -> TechnicianResponse:
    from app.modules.technicians.eligibility import job_eligibility
    from app.modules.technicians.models import AADHAAR_NOT_SUBMITTED, FACE_NOT_STARTED, WORK_STATUS_OFFLINE

    profile = technician.technician_profile  # type: ignore[attr-defined]
    identity = technician.identity  # type: ignore[attr-defined]
    eligible, reasons = job_eligibility(technician)
    return TechnicianResponse(
        id=technician.id,
        email=technician.email,
        phone=technician.phone,
        status=technician.status,
        name=technician.name,
        address=technician.address,
        pincode=technician.pincode,
        area=technician.area,
        block=technician.block,
        district=technician.district,
        state=technician.state,
        location=technician.location_display,
        technician_type=profile.technician_type if profile else None,
        experience_years=profile.experience_years if profile else 0,
        is_available=profile.is_available if profile else False,
        work_status=profile.work_status if profile else WORK_STATUS_OFFLINE,
        profile_image_url=profile.profile_image_url if profile else None,
        created_at=to_local_iso(technician.created_at, settings) or "",
        onboarding=OnboardingState(
            step=technician.onboarding_step,
            face_status=identity.face_status if identity else FACE_NOT_STARTED,
            aadhaar_status=identity.aadhaar_status if identity else AADHAAR_NOT_SUBMITTED,
            aadhaar_masked=identity.aadhaar_masked if identity else None,
            can_receive_jobs=eligible,
            pending_requirements=reasons,
        ),
    )


class AuthService:
    def __init__(self, database: Session, settings: Settings, otps: OtpService) -> None:
        self.database = database
        self.technicians = TechnicianRepository(database)
        self.settings = settings
        self.otps = otps

    def session_response(self, technician: Technician, scope: str, csrf_token: str) -> AuthResponse:
        """The body of a sign-in or refresh answer; the tokens travel only in cookies."""
        return AuthResponse(
            session_type=scope, user=technician_response(technician, self.settings), csrf_token=csrf_token
        )

    # ---- sign-up ----

    def send_signup_code(self, raw_email: str) -> CodeSentResponse:
        email = clean_email(raw_email)
        existing = self.technicians.get_by_email(email)
        if existing and existing.status != ACCOUNT_STATUS_ONBOARDING:
            raise HTTPException(status_code=409, detail=ALREADY_REGISTERED)
        result = self.otps.send(email, PURPOSE_SIGNUP)
        self.database.commit()
        return CodeSentResponse(**result)

    def verify_signup(self, raw_email: str, raw_phone: str, code: str) -> Technician:
        email = clean_email(raw_email)
        phone = clean_phone(raw_phone)
        existing = self.technicians.get_by_email(email)
        if existing and existing.status != ACCOUNT_STATUS_ONBOARDING:
            raise HTTPException(status_code=409, detail=ALREADY_REGISTERED)
        self.otps.consume(email, PURPOSE_SIGNUP, code)
        technician = existing or Technician(email=email, status=ACCOUNT_STATUS_ONBOARDING)
        technician.phone = phone
        technician.email_verified_at = naive_utc_now()
        if not existing:
            self.technicians.add(technician)
            self.database.flush()
        from app.modules.technicians.models import WORK_STATUS_OFFLINE, IdentityVerification, TechnicianProfile

        if technician.technician_profile is None:  # type: ignore[attr-defined]
            technician.technician_profile = TechnicianProfile(  # type: ignore[attr-defined]
                user_id=technician.id, work_status=WORK_STATUS_OFFLINE
            )
        if technician.identity is None:  # type: ignore[attr-defined]
            technician.identity = IdentityVerification(user_id=technician.id)  # type: ignore[attr-defined]
        try:
            self.database.commit()
        except IntegrityError:
            self.database.rollback()
            raise HTTPException(status_code=409, detail=ALREADY_REGISTERED) from None
        # The caller starts a registration session (scope onboarding): the onboarding
        # steps only, never the dashboard.
        self.database.refresh(technician)
        return technician

    # ---- sign-in (e-mail + password) ----

    def login(self, raw_email: str, password: str, client_address: str | None = None) -> Technician:
        """The only way to a dashboard session. Every refusal is the same 401, so the answer
        never tells whether the e-mail has an account or which part was wrong; too many
        recent failures are refused with 429 before the password is checked."""
        email = normalize_email(raw_email)
        login_throttle.ensure_allowed(self.database, self.settings, email, client_address)
        technician = self.technicians.get_by_email(email) if email else None
        stored_hash = technician.password_hash if technician and technician.password_hash else None
        if stored_hash is None:
            # Checked even without an account or password, so every refusal takes as long.
            verify_against_unknown_account(password or "")
            password_matches = False
        else:
            password_matches = verify_secret(password or "", stored_hash)
        within_limit = len((password or "").encode("utf-8")) <= PASSWORD_MAX_BYTES
        if not (
            technician is not None
            and stored_hash
            and password_matches
            and within_limit
            and technician.onboarding_step == STEP_COMPLETE
        ):
            self.database.rollback()
            login_throttle.failed(self.database, email, client_address)
            raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MESSAGE)
        login_throttle.succeeded(self.database, email)
        if technician.is_suspended:
            raise HTTPException(status_code=403, detail=SUSPENDED_MESSAGE)
        if needs_rehash(stored_hash):
            # A bcrypt hash from the old app (or old Argon2id parameters): replaced now.
            technician.password_hash = hash_secret(password)
            self.database.commit()
        return technician

    def require_session_technician(self, technician_id: uuid.UUID) -> Technician:
        """The account a technician session belongs to, if it may still hold one. Called
        before a refresh rotates the session (which keeps its scope)."""
        technician = self.technicians.get(technician_id)
        if not technician:
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
        if technician.is_suspended:
            raise HTTPException(status_code=403, detail=SUSPENDED_MESSAGE)
        return technician
