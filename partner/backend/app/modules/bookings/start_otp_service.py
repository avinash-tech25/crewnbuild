"""Start Work OTP: issue the customer's code, and check the technician's.

    booking ARRIVED (GPS arrival, unchanged)
      -> the booking's customer opens it: a 6-digit code is issued lazily, under
         the booking's row lock, and the same code is shown again while it lasts
      -> the technician enters it -> DispatchService.start_with_otp checks it here
         and moves the job to IN_PROGRESS in the same transaction

The code is made with `secrets`. It is kept twice, neither in plain text:
  * Fernet-encrypted with DATA_ENCRYPTION_KEY, so the customer can be shown it
    again -- erased as soon as the code stops being ACTIVE;
  * an HMAC-SHA256 verifier over "<booking id>:<code>" with a key derived from
    that same secret, compared in constant time -- so a code only ever verifies
    the booking it was issued for.

Nothing here logs a code, returns it to a technician, or puts it in a URL.
"""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException

from app.core.runtime import settings
from app.core.security import data_encryption
from app.database.types import naive_utc_now
from app.modules.bookings.models import (
    OTP_ACTIVE,
    OTP_CONSUMED,
    OTP_EXPIRED,
    OTP_LOCKED,
    OTP_SUPERSEDED,
    STATUS_ACCEPTED,
    STATUS_ARRIVED,
    STATUS_COMPLETED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_OFFERED,
    STATUS_SEARCHING,
    ServiceRequest,
    ServiceRequestStartOtp,
)
from app.modules.bookings.repository import ServiceRequestRepository, StartOtpRepository
from app.modules.bookings.schemas import (
    STATE_LIMITED,
    STATE_LOCKED,
    STATE_NOT_APPLICABLE,
    STATE_READY,
    STATE_STARTED,
    STATE_WAITING,
    StartOtpView,
)
from app.modules.requesters.repository import Requester

logger = logging.getLogger(__name__)

CODE_DIGITS = 6
CODE_PATTERN = re.compile(r"^[0-9]{6}$")
BOOKING_NOT_FOUND = "Booking not found"
UNAVAILABLE = "The Start Work code is not available right now. Please try again later."

WRONG_CODE = "Incorrect OTP. Please check the code with the customer."
LOCKED_CODE = "Too many incorrect codes. Ask the customer to get a new code."
NO_CURRENT_CODE = "There is no current Start Work code. Ask the customer to open their booking to see one."
EXPIRED_CODE = "This code has expired. Ask the customer to open their booking for a new one."
MALFORMED_CODE = "Enter the 6-digit code the customer gives you."

BEFORE_ARRIVAL = (STATUS_SEARCHING, STATUS_OFFERED, STATUS_ACCEPTED, STATUS_EN_ROUTE)
AFTER_START = (STATUS_IN_PROGRESS, STATUS_COMPLETED)


# ------------------------------------------------------------------ crypto


def _secret() -> str:
    key = settings.data_encryption_key.get_secret_value().strip()
    if not key:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    return key


def _verifier_key() -> bytes:
    # Derived, not the encryption key itself: the two uses never share key material.
    return hashlib.sha256(b"partner/start-work-otp/v1\x00" + _secret().encode()).digest()


def code_digest(booking_id, code: str) -> str:
    return hmac.new(_verifier_key(), f"{booking_id}:{code}".encode(), hashlib.sha256).hexdigest()


def new_code() -> str:
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def _close(otp: ServiceRequestStartOtp, status: str, now: datetime) -> None:
    """An ACTIVE code stops being usable: its readable copy goes with it."""
    otp.status = status
    otp.code_ciphertext = None
    otp.closed_at = now


# ----------------------------------------------------------------- service


class StartOtpService:
    def __init__(self, repository: StartOtpRepository, bookings: ServiceRequestRepository):
        self.repository = repository
        self.bookings = bookings

    # ---------------------------------------------------------------- queries

    def active_for_update(self, booking_id) -> ServiceRequestStartOtp | None:
        return self.repository.lock_active(booking_id)

    def _latest(self, booking_id) -> ServiceRequestStartOtp | None:
        return self.repository.find_latest(booking_id)

    def _issued_since(self, booking_id, since: datetime) -> tuple[int, datetime | None]:
        count, oldest = self.repository.count_issued_since(booking_id, since)
        return count, oldest

    # --------------------------------------------------------------- lifecycle

    def expire_if_due(self, otp: ServiceRequestStartOtp | None, now: datetime) -> ServiceRequestStartOtp | None:
        """An ACTIVE code past its time becomes EXPIRED; returns it if still usable."""
        if otp is not None and otp.expires_at <= now:
            _close(otp, OTP_EXPIRED, now)
            self.repository.flush()
            return None
        return otp

    def _hourly_wait(self, booking_id, now: datetime) -> int:
        """Seconds until another code may be issued under the hourly cap (0 = now)."""
        window = timedelta(hours=1)
        count, oldest = self._issued_since(booking_id, now - window)
        if count < settings.start_otp_max_codes_per_hour or oldest is None:
            return 0
        return max(1, int((oldest + window - now).total_seconds()) + 1)

    def _issue(
        self, booking: ServiceRequest, requester: Requester, now: datetime
    ) -> tuple[ServiceRequestStartOtp, str]:
        code = new_code()
        _secret()  # 503 now when no key is configured
        ciphertext, key_version = data_encryption.encrypt(code.encode())
        otp = ServiceRequestStartOtp(
            service_request_id=booking.id,
            code_ciphertext=ciphertext.decode(),
            code_key_version=key_version,
            code_digest=code_digest(booking.id, code),
            status=OTP_ACTIVE,
            created_at=now,
            expires_at=now + timedelta(minutes=settings.start_otp_ttl_minutes),
            requested_by_user_id=requester.id,
        )
        self.repository.add(otp)
        self.repository.flush()
        logger.info("Start Work code issued for booking %s", booking.id)  # never the code itself
        return otp, code

    def _reveal(self, otp: ServiceRequestStartOtp) -> str:
        try:
            return data_encryption.decrypt(otp.code_ciphertext.encode(), otp.code_key_version or 1).decode()
        except (data_encryption.DecryptionError, AttributeError):
            # The key changed since it was issued: this code can never be shown again.
            raise HTTPException(status_code=409, detail="This code can no longer be shown. Get a new code.")

    def _ready(self, otp: ServiceRequestStartOtp, code: str | None = None) -> StartOtpView:
        return StartOtpView(
            state=STATE_READY,
            code=code or self._reveal(otp),
            expires_at=otp.expires_at,
            can_regenerate=True,
            message="Share this code with the technician only when you are ready for the work to begin.",
        )

    def _locked_booking(self, requester: Requester, booking_id) -> ServiceRequest:
        booking = self.bookings.lock(booking_id)
        # Not theirs answers exactly like an unknown id: ids cannot be probed.
        if booking is None or booking.requested_by_user_id != requester.id:
            raise HTTPException(status_code=404, detail=BOOKING_NOT_FOUND)
        return booking

    # ------------------------------------------------------------- requester

    def requester_view(self, requester: Requester, booking_id) -> StartOtpView:
        """The customer's code: issued lazily while ARRIVED, the same one while it lasts."""
        booking = self._locked_booking(requester, booking_id)
        now = naive_utc_now()
        if booking.status in BEFORE_ARRIVAL:
            self.repository.rollback()
            return StartOtpView(
                state=STATE_WAITING, message="Your Start Work code appears here once the technician has arrived."
            )
        if booking.status in AFTER_START:
            self.repository.rollback()
            return StartOtpView(state=STATE_STARTED, message="Work started.")
        if booking.status != STATUS_ARRIVED:
            self.repository.rollback()
            return StartOtpView(state=STATE_NOT_APPLICABLE)

        active = self.expire_if_due(self.active_for_update(booking.id), now)
        if active is not None:
            view = self._ready(active)
            self.repository.commit()
            return view
        latest = self._latest(booking.id)
        if latest is not None and latest.status == OTP_LOCKED:
            # A person decides to hand out a fresh code after five wrong guesses.
            view = StartOtpView(
                state=STATE_LOCKED, can_regenerate=True, message=LOCKED_CODE.replace("Ask the customer to get", "Get")
            )
            self.repository.commit()
            return view
        wait = self._hourly_wait(booking.id, now)
        if wait:
            self.repository.commit()
            return StartOtpView(
                state=STATE_LIMITED,
                retry_after_seconds=wait,
                message="Too many codes were requested. A new code will be available shortly.",
            )
        otp, code = self._issue(booking, requester, now)
        view = self._ready(otp, code)
        self.repository.commit()
        return view

    def regenerate(self, requester: Requester, booking_id) -> StartOtpView:
        """A new code on request; the old one stops working at once."""
        booking = self._locked_booking(requester, booking_id)
        if booking.status != STATUS_ARRIVED:
            self.repository.rollback()
            raise HTTPException(
                status_code=409, detail="A new code can be made only while the technician is at your address."
            )
        now = naive_utc_now()
        latest = self._latest(booking.id)
        if latest is not None:
            since = (now - latest.created_at).total_seconds()
            if since < settings.start_otp_regenerate_cooldown_seconds:
                self.repository.rollback()
                wait = int(settings.start_otp_regenerate_cooldown_seconds - since) + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {wait} seconds before getting a new code.",
                    headers={"Retry-After": str(wait)},
                )
        wait = self._hourly_wait(booking.id, now)
        if wait:
            self.repository.rollback()
            raise HTTPException(
                status_code=429,
                detail="Too many codes were requested. Please try again shortly.",
                headers={"Retry-After": str(wait)},
            )
        active = self.active_for_update(booking.id)
        if active is not None:
            _close(active, OTP_SUPERSEDED, now)
            self.repository.flush()
        otp, code = self._issue(booking, requester, now)
        view = self._ready(otp, code)
        self.repository.commit()
        return view

    # ------------------------------------------------------------ technician

    def check_for_start(self, booking: ServiceRequest, technician_id, submitted: str, now: datetime) -> None:
        """Consume the booking's current code, or raise -- the caller holds the
        booking's row lock and commits. A wrong code is committed as a failure
        HERE (the request is about to fail), so the count survives the error."""
        submitted = (submitted or "").strip()
        if not CODE_PATTERN.match(submitted):
            raise HTTPException(status_code=422, detail=MALFORMED_CODE)
        active = self.active_for_update(booking.id)
        if active is None:
            latest = self._latest(booking.id)
            raise HTTPException(
                status_code=409,
                detail=LOCKED_CODE if latest is not None and latest.status == OTP_LOCKED else NO_CURRENT_CODE,
            )
        if self.expire_if_due(active, now) is None:
            self.repository.commit()
            raise HTTPException(status_code=409, detail=EXPIRED_CODE)
        if not hmac.compare_digest(active.code_digest, code_digest(booking.id, submitted)):
            active.failed_attempts += 1
            active.last_failed_at = now
            left = settings.start_otp_max_attempts - active.failed_attempts
            if left <= 0:
                _close(active, OTP_LOCKED, now)
            self.repository.commit()
            logger.info("Start Work code rejected for booking %s (%s tries left)", booking.id, max(left, 0))
            if left <= 0:
                raise HTTPException(status_code=409, detail=LOCKED_CODE)
            raise HTTPException(status_code=400, detail=f"{WRONG_CODE} {left} {'try' if left == 1 else 'tries'} left.")
        _close(active, OTP_CONSUMED, now)
        active.consumed_at = now
        active.consumed_by_technician_id = technician_id
        self.repository.flush()
