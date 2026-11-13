"""Technician sign-up and sign-in (the old app/technician/services/auth_service.py, same
rules and answers). The profile step (complete_profile) comes with part 2.

Sign-in checks the password against Argon2id, or against a bcrypt hash from the old app;
a bcrypt (or outdated Argon2id) hash is replaced with a fresh Argon2id one right after a
successful sign-in.
"""

import hashlib
import re
import threading
import time
import uuid
from collections import deque

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
from app.modules.identity import pending_links
from app.modules.identity.models import ACCOUNT_STATUS_ONBOARDING, PURPOSE_SIGNUP, STEP_COMPLETE, Technician
from app.modules.identity.otp_service import OtpService, normalize_email
from app.modules.identity.repository import TechnicianRepository
from app.modules.identity.schemas import AuthResponse, CodeSentResponse, OnboardingState, TechnicianResponse

THROTTLED_MESSAGE = "Too many sign-in attempts. Please wait a few minutes and try again."
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# Contact number only (codes go to e-mail): exactly 10 ASCII digits, as the frontend asks.
MOBILE_PATTERN = re.compile(r"\d{10}", re.ASCII)
SUSPENDED_MESSAGE = "This account has been suspended. Contact CREWNBUILD support."
INVALID_CREDENTIALS_MESSAGE = "Invalid email or password."
ALREADY_REGISTERED = "This email is already registered. Log in instead."


class LoginThrottle:
    """Failed sign-in attempts, counted per e-mail address and per client address in a
    sliding window (LOGIN_FAILURE_WINDOW_SECONDS). Past either limit a sign-in is refused
    before its password is checked, with the same answer whether or not the e-mail has
    an account. A successful sign-in clears its e-mail's count. Kept in this process, as
    before (docs/porting-todo.md)."""

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _keys(email: str, client: str | None) -> tuple[str, str]:
        return "email:" + hashlib.sha256(email.encode("utf-8")).hexdigest(), "client:" + (client or "unknown")

    def _recent(self, key: str, now: float, window: int) -> deque[float]:
        attempts = self._failures.get(key)
        if attempts is None:
            return deque()
        while attempts and attempts[0] <= now - window:
            attempts.popleft()
        if not attempts:
            del self._failures[key]
        return attempts

    def blocked(self, settings: Settings, email: str, client: str | None) -> bool:
        email_key, client_key = self._keys(email, client)
        now = time.monotonic()
        window = settings.login_failure_window_seconds
        with self._lock:
            return (
                len(self._recent(email_key, now, window)) >= settings.login_max_failures_per_email
                or len(self._recent(client_key, now, window)) >= settings.login_max_failures_per_client
            )

    def failed(self, email: str, client: str | None) -> None:
        now = time.monotonic()
        with self._lock:
            for key in self._keys(email, client):
                self._failures.setdefault(key, deque()).append(now)

    def succeeded(self, email: str, client: str | None) -> None:
        email_key, _ = self._keys(email, client)
        with self._lock:
            self._failures.pop(email_key, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


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


def technician_response(technician: Technician, settings: Settings) -> TechnicianResponse:
    eligible, reasons = pending_links.job_eligibility(technician)
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
        **pending_links.profile_summary(technician),
        created_at=to_local_iso(technician.created_at, settings) or "",
        onboarding=OnboardingState(
            step=technician.onboarding_step,
            **pending_links.identity_summary(technician),
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
        pending_links.create_onboarding_rows(self.database, technician)
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
        if login_throttle.blocked(self.settings, email, client_address):
            raise HTTPException(status_code=429, detail=THROTTLED_MESSAGE)
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
            login_throttle.failed(email, client_address)
            raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MESSAGE)
        login_throttle.succeeded(email, client_address)
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
