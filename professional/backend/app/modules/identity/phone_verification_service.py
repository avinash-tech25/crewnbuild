"""The WhatsApp codes of an Indian mobile number: the sign-up check (SIGNUP) and sign-in
(LOGIN). Ported from the old phone_verification_service.py with the same rules and
limits:

* 6-digit code, 10 minutes (5 for a fixed test account), 5 wrong tries
* 60-second resend cooldown per number
* at most 10 requests per number per 15 minutes and 60 per address per hour, rolling,
  counted in otp_send_events so every API process shares them
* a correct sign-up code returns a one-time token (stored hashed) that sign-up must
  present with the same number within 15 minutes

Switched on by WHATSAPP_ENABLED and WHATSAPP_SIGNUP_OTP_ENABLED. The code is stored
hashed and never returned or logged, except the development-only preview to a request
from this machine.
"""

import hashlib
import ipaddress
import logging
import math
import re
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from hmac import compare_digest
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.password_hashing import hash_secret, verify_secret
from app.integrations.whatsapp.dovesoft_client import (
    DovesoftWhatsAppClient,
    SendOutcome,
    SendResult,
    WhatsAppNotReadyError,
    mask_phone,
)
from app.modules.identity.models import PhoneVerificationCode, User
from app.modules.identity.otp_test_accounts import (
    OTP_TEST_CODE_TTL_MINUTES,
    TEST_ACCOUNT_ROLE_MISMATCH,
    otp_test_account,
    otp_test_code,
)
from app.modules.identity.repository import PhoneCodeRepository, UserRepository
from app.modules.identity.session_service import utc_now

logger = logging.getLogger(__name__)

SIGNUP = "SIGNUP"
LOGIN = "LOGIN"
PURPOSES = (SIGNUP, LOGIN)

INDIA_DIAL_CODE = "+91"
INDIA_MOBILE_PATTERN = re.compile(r"[6-9]\d{9}")
INVALID_MOBILE = "Enter a valid 10 digit Indian mobile number."

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
VERIFIED_TTL_MINUTES = 15
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
PHONE_SEND_WINDOW = timedelta(minutes=15)
MAX_SENDS_PER_PHONE = 10
ADDRESS_SEND_WINDOW = timedelta(hours=1)
MAX_SENDS_PER_ADDRESS = 60
EVENT_RETENTION = timedelta(days=1)

NOT_VERIFIED = "Verify your mobile number on WhatsApp before creating the account."
UNAVAILABLE = "WhatsApp verification is not available right now. Try again later."
NOT_SENT = "We could not send the WhatsApp code. Try again in a moment."
UNCONFIRMED_SEND = "We could not confirm that the WhatsApp code was sent. Ask for a new code in a minute."
LOGIN_CODE_REFUSED = "That code is not right or has expired. Ask for a new one."
PHONE_IN_USE_MESSAGE = "This phone number is already in use."
NOT_REGISTERED_MESSAGE = "Mobile number is not registered. Please sign up first."

# Provider outcomes that prove no message went out, so the request is not counted.
NEVER_SENT_OUTCOMES = frozenset({SendOutcome.UNREACHABLE, SendOutcome.NOT_CONFIGURED})


def india_mobile(raw: str | None) -> str:
    """The 10 digit national number, or a 422. Only spaces and hyphens are removed:
    trimming anything else is how a different person's number gets verified."""
    value = re.sub(r"[\s-]", "", raw or "")
    if not INDIA_MOBILE_PATTERN.fullmatch(value):
        raise HTTPException(status_code=422, detail=INVALID_MOBILE)
    return value


def is_loopback(address: str | None) -> bool:
    try:
        return ipaddress.ip_address((address or "").strip()).is_loopback
    except ValueError:
        return False


def subject_hash(kind: str, value: str) -> str:
    return hashlib.sha256(f"{kind}:{value}".encode()).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(CODE_LENGTH))


def retry_seconds(remaining: float) -> int:
    return max(1, math.ceil(remaining))


def describe_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def too_many_requests(detail: str, seconds: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail, headers={"Retry-After": str(seconds)}
    )


def cooldown_refusal(remaining: float) -> HTTPException:
    seconds = retry_seconds(remaining)
    return too_many_requests(f"Please wait {describe_wait(seconds)} before asking for a new code.", seconds)


def confirmed_not_sent(result: SendResult) -> bool:
    """True only when the provider's answer proves no message went out."""
    if result.outcome in NEVER_SENT_OUTCOMES:
        return True
    code = result.http_status
    return result.outcome is SendOutcome.REJECTED and isinstance(code, int) and 400 <= code <= 499


def provider_server_error(result: SendResult) -> bool:
    code = result.http_status
    return result.outcome is SendOutcome.REJECTED and isinstance(code, int) and 500 <= code <= 599


def window_wait(send_times: list[datetime], limit: int, window: timedelta, now: datetime) -> float | None:
    """Seconds until fewer than `limit` sends remain in the rolling window; None while under."""
    if len(send_times) < limit:
        return None
    leaves_at = send_times[len(send_times) - limit] + window
    return (leaves_at - now).total_seconds()


def phone_in_use(database: Session, phone: str, exclude_user_id: uuid.UUID | None = None) -> bool:
    """Whether another account already holds this number: marketplace accounts in
    users.phone, administrators in admin_profiles.phone."""
    if not phone:
        return False
    users = UserRepository(database)
    return users.phone_exists(phone, exclude_user_id) or users.admin_phone_exists(phone, exclude_user_id)


@dataclass(frozen=True)
class SendClaim:
    """Which send owns a number's row while its provider call runs."""

    record_id: uuid.UUID
    claimed_at: datetime
    previous_sent_at: datetime | None
    event_ids: tuple[uuid.UUID, ...] = ()

    def owns(self, record: PhoneVerificationCode | None) -> bool:
        return record is not None and record.id == self.record_id and record.last_sent_at == self.claimed_at


LoginCheck = Callable[[str], User]


class PhoneVerificationService:
    def __init__(self, database: Session, settings: Settings, whatsapp: DovesoftWhatsAppClient | None = None) -> None:
        self.database = database
        self.settings = settings
        self.repository = PhoneCodeRepository(database)
        self.whatsapp = whatsapp or DovesoftWhatsAppClient(settings)

    def required(self) -> bool:
        return bool(self.settings.whatsapp_enabled and self.settings.whatsapp_signup_otp_enabled)

    def dev_otp_preview(self) -> bool:
        return bool(self.settings.whatsapp_dev_otp_preview and self.settings.is_development())

    def check_test_account(self, phone: str, account: User) -> None:
        """A fixed test number signs in only an account holding its test role."""
        test_account = otp_test_account(phone, self.settings)
        if test_account and account.role != test_account.role:
            raise HTTPException(status_code=403, detail=TEST_ACCOUNT_ROLE_MISMATCH)

    def public_config(self) -> dict[str, Any]:
        return {"enabled": self.required(), "login": self.required(), "dial_code": INDIA_DIAL_CODE, "digits": 10}

    def send_code(
        self,
        raw_phone: str,
        client_address: str | None,
        purpose: str = SIGNUP,
        login_check: LoginCheck | None = None,
    ) -> dict[str, Any]:
        """Send a SIGNUP code (unregistered numbers only) or a LOGIN code (only to a number
        that belongs to exactly one account allowed to sign in; `login_check` decides and
        raises the refusal, after the limits and counted like a send)."""
        if purpose not in PURPOSES:
            raise ValueError(f"unknown phone code purpose {purpose!r}")
        if not self.required():
            raise HTTPException(status_code=404, detail="WhatsApp verification is not enabled.")
        phone = india_mobile(raw_phone)
        phone_key = subject_hash("PHONE", phone)
        address_key = subject_hash("IP", client_address or "unknown")
        now = utc_now()
        counted_events: tuple[uuid.UUID, ...] = ()
        if purpose == LOGIN:
            counted_events = self.screen_login(phone, phone_key, address_key, now, login_check)
        test_account = otp_test_account(phone, self.settings) if purpose == LOGIN else None
        code = otp_test_code(test_account, self.settings) if test_account else generate_code()
        code_hash = hash_secret(code)

        claim = self.claim_send(
            phone,
            phone_key,
            address_key,
            code_hash,
            now,
            purpose,
            counted=purpose == LOGIN,
            counted_events=counted_events,
        )

        if test_account:
            logger.info("WhatsApp login code for %s: fixed test account, not sent to WhatsApp", mask_phone(phone))
            self.store_code(phone, phone_key, code_hash, claim, purpose, OTP_TEST_CODE_TTL_MINUTES)
            return self.sent_reply(OTP_TEST_CODE_TTL_MINUTES)

        if self.dev_otp_preview():
            logger.info(
                "WhatsApp %s code for %s: development preview, not sent to WhatsApp", purpose.lower(), mask_phone(phone)
            )
            self.store_code(phone, phone_key, code_hash, claim, purpose)
            reply = self.sent_reply()
            reply["dev_preview"] = True
            if is_loopback(client_address):
                reply["dev_otp"] = code
            return reply

        logger.info("WhatsApp %s code requested for %s", purpose.lower(), mask_phone(phone))
        try:
            result = self.whatsapp.send(phone, self.settings.whatsapp_otp_template, [code])
        except WhatsAppNotReadyError:
            self.release_send(phone, phone_key, claim, address_key=address_key, release_events=True)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE) from None
        except Exception:
            self.release_send(phone, phone_key, claim)
            raise
        if result.uncertain or provider_server_error(result):
            # The code may be on its way: not stored, cooldown kept, still counted.
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNCONFIRMED_SEND)
        if not result.accepted:
            self.release_send(
                phone, phone_key, claim, address_key=address_key, release_events=confirmed_not_sent(result)
            )
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=NOT_SENT)
        self.store_code(phone, phone_key, code_hash, claim, purpose)
        return self.sent_reply()

    @staticmethod
    def sent_reply(ttl_minutes: int = CODE_TTL_MINUTES) -> dict[str, Any]:
        return {"sent": True, "expires_in_minutes": ttl_minutes, "resend_after_seconds": RESEND_COOLDOWN_SECONDS}

    def check_limits(
        self, record: PhoneVerificationCode | None, phone_key: str, address_key: str, now: datetime
    ) -> None:
        """The resend cooldown and the rolling caps; rolls back and raises 429."""
        if record:
            waited = (now - record.last_sent_at).total_seconds()
            if waited < RESEND_COOLDOWN_SECONDS:
                self.database.rollback()
                raise cooldown_refusal(RESEND_COOLDOWN_SECONDS - waited)
        phone_sends = self.repository.send_times_since("PHONE", phone_key, now - PHONE_SEND_WINDOW)
        address_sends = self.repository.send_times_since("IP", address_key, now - ADDRESS_SEND_WINDOW)
        waits = [
            wait
            for wait in (
                window_wait(phone_sends, MAX_SENDS_PER_PHONE, PHONE_SEND_WINDOW, now),
                window_wait(address_sends, MAX_SENDS_PER_ADDRESS, ADDRESS_SEND_WINDOW, now),
            )
            if wait is not None
        ]
        if waits:
            self.database.rollback()
            seconds = retry_seconds(max(waits))
            raise too_many_requests(f"Too many codes requested. Please try again in {describe_wait(seconds)}.", seconds)

    def record_request(self, phone_key: str, address_key: str, now: datetime) -> tuple[uuid.UUID, ...]:
        events = [
            self.repository.record_send("PHONE", phone_key, now),
            self.repository.record_send("IP", address_key, now),
        ]
        self.database.flush()
        return tuple(event.id for event in events)

    def screen_login(
        self, phone: str, phone_key: str, address_key: str, now: datetime, login_check: LoginCheck | None
    ) -> tuple[uuid.UUID, ...]:
        """Before a sign-in code exists: limits, then whether the number may sign in.
        Counted first, so asking whether numbers are registered is limited exactly as
        asking for codes is. Committed either way, which releases the locks."""
        self.repository.lock_subjects(phone_key, address_key)
        self.repository.purge_before(now - EVENT_RETENTION)
        self.check_limits(self.repository.find_by_phone(phone), phone_key, address_key, now)
        event_ids = self.record_request(phone_key, address_key, now)
        try:
            if login_check is not None:
                self.check_test_account(phone, login_check(phone))
            elif not phone_in_use(self.database, phone):
                raise HTTPException(status_code=404, detail=NOT_REGISTERED_MESSAGE)
        except HTTPException:
            self.database.commit()
            raise
        self.database.commit()
        return event_ids

    def claim_send(
        self,
        phone: str,
        phone_key: str,
        address_key: str,
        code_hash: str,
        now: datetime,
        purpose: str = SIGNUP,
        counted: bool = False,
        counted_events: tuple[uuid.UUID, ...] = (),
    ) -> SendClaim:
        """Check every limit and claim this send, as one transaction under the number's
        and the address's advisory locks. Committed before the provider is called, so no
        request waits on Dovesoft."""
        self.repository.lock_subjects(phone_key, address_key)
        self.repository.purge_before(now - EVENT_RETENTION)
        record = self.repository.find_by_phone(phone)
        if counted:
            waited = (now - record.last_sent_at).total_seconds() if record else None
            if waited is not None and waited < RESEND_COOLDOWN_SECONDS:
                self.database.rollback()
                raise cooldown_refusal(RESEND_COOLDOWN_SECONDS - waited)
            event_ids = counted_events
        else:
            self.check_limits(record, phone_key, address_key, now)
            event_ids = self.record_request(phone_key, address_key, now)

        if purpose == SIGNUP and phone_in_use(self.database, phone):
            self.database.commit()
            raise HTTPException(status_code=409, detail=PHONE_IN_USE_MESSAGE)

        previous_sent_at = record.last_sent_at if record else None
        if record:
            record.last_sent_at = now
        else:
            # A first send needs a row to claim the cooldown on; written already expired
            # so nothing verifies against it until store_code gives it a real expiry.
            record = PhoneVerificationCode(
                phone=phone,
                purpose=purpose,
                code_hash=code_hash,
                expires_at=now - timedelta(seconds=1),
                attempts=0,
                last_sent_at=now,
            )
            self.database.add(record)
            self.database.flush()
        claim = SendClaim(record_id=record.id, claimed_at=now, previous_sent_at=previous_sent_at, event_ids=event_ids)
        self.database.commit()
        return claim

    def release_send(
        self,
        phone: str,
        phone_key: str,
        claim: SendClaim,
        address_key: str | None = None,
        release_events: bool = False,
    ) -> None:
        """Give back the cooldown claimed for a send the provider did not accept (and,
        for a confirmed refusal, this request's own counted events). Never raises."""
        try:
            keys = (phone_key, address_key) if release_events and address_key else (phone_key,)
            self.repository.lock_subjects(*keys)
            record = self.repository.find_by_phone(phone)
            if record is not None and claim.owns(record):
                if claim.previous_sent_at is None:
                    self.database.delete(record)
                else:
                    record.last_sent_at = claim.previous_sent_at
            if release_events and claim.event_ids:
                self.repository.remove_send_events(claim.event_ids)
            self.database.commit()
        except SQLAlchemyError:
            self.database.rollback()
            logger.exception("Could not release the WhatsApp code claim for %s", mask_phone(phone))

    def store_code(
        self,
        phone: str,
        phone_key: str,
        code_hash: str,
        claim: SendClaim,
        purpose: str = SIGNUP,
        ttl_minutes: int = CODE_TTL_MINUTES,
    ) -> None:
        """Make the accepted code the number's one valid code, if this send still owns the row."""
        self.repository.lock_subjects(phone_key)
        record = self.repository.find_by_phone(phone)
        if record is None or not claim.owns(record):
            self.database.rollback()
            raise HTTPException(
                status_code=409, detail="A newer code was requested for this number. Use the most recent code."
            )
        record.purpose = purpose
        record.code_hash = code_hash
        record.expires_at = claim.claimed_at + timedelta(minutes=ttl_minutes)
        record.attempts = 0
        record.last_sent_at = claim.claimed_at
        record.verified_at = None
        record.verification_token_hash = None
        self.database.commit()

    def verify_code(self, raw_phone: str, raw_code: str) -> dict[str, Any]:
        """The sign-up check: a correct code returns a one-time token."""
        if not self.required():
            raise HTTPException(status_code=404, detail="WhatsApp verification is not enabled.")
        phone = india_mobile(raw_phone)
        code = "".join(character for character in (raw_code or "") if character.isdigit())
        record = self.repository.find_by_phone(phone)
        if not record or record.purpose != SIGNUP:
            raise HTTPException(status_code=404, detail="Ask for a WhatsApp code first.")
        now = utc_now()
        if record.verified_at:
            raise HTTPException(status_code=410, detail="That code has already been used. Ask for a new one.")
        if record.expires_at < now:
            raise HTTPException(status_code=410, detail="That code has expired. Ask for a new one.")
        if record.attempts >= MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many wrong attempts. Ask for a new code.")
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            self.database.commit()
            raise HTTPException(status_code=400, detail="That code is not right. Try again.")
        token = secrets.token_urlsafe(32)
        record.verified_at = now
        record.verification_token_hash = token_hash(token)
        self.database.commit()
        return {"verified": True, "verification_token": token, "valid_for_minutes": VERIFIED_TTL_MINUTES}

    def verify_login_code(self, raw_phone: str, raw_code: str) -> PhoneVerificationCode:
        """Check a LOGIN code; the caller signs in and commits. Every refusal but a
        malformed number is the same 400."""
        if not self.required():
            raise HTTPException(status_code=404, detail="WhatsApp sign-in is not enabled.")
        phone = india_mobile(raw_phone)
        code = "".join(character for character in (raw_code or "") if character.isdigit())
        record = self.repository.find_by_phone(phone)
        now = utc_now()
        if (
            record is None
            or record.purpose != LOGIN
            or record.verified_at
            or record.expires_at < now
            or record.attempts >= MAX_ATTEMPTS
        ):
            self.database.rollback()
            raise HTTPException(status_code=400, detail=LOGIN_CODE_REFUSED)
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            self.database.commit()
            raise HTTPException(status_code=400, detail=LOGIN_CODE_REFUSED)
        record.verified_at = now
        return record

    def require_verified(self, raw_phone: str, token: str | None) -> PhoneVerificationCode:
        """Sign-up's check: this exact number, this token, recently. The row stays locked
        until sign-up commits, so one token completes one sign-up."""
        phone = india_mobile(raw_phone)
        record = self.repository.find_by_phone(phone)
        presented = (token or "").strip()
        if (
            record is None
            or record.purpose != SIGNUP
            or not record.verified_at
            or not record.verification_token_hash
            or not presented
            or not compare_digest(token_hash(presented), record.verification_token_hash)
        ):
            raise HTTPException(status_code=422, detail=NOT_VERIFIED)
        if record.verified_at + timedelta(minutes=VERIFIED_TTL_MINUTES) < utc_now():
            raise HTTPException(status_code=422, detail="Your mobile verification expired. Verify the number again.")
        return record

    def consume(self, record: PhoneVerificationCode) -> None:
        """Removed in sign-up's own transaction."""
        self.database.delete(record)


def send_welcome_message(phone: str, name: str, settings: Settings) -> None:
    """Run after the sign-up response, outside its transaction. Never raises."""
    template = (settings.whatsapp_welcome_template or "").strip()
    if not (settings.whatsapp_enabled and settings.whatsapp_signup_otp_enabled and template and phone):
        return
    try:
        DovesoftWhatsAppClient(settings).send_template(phone, template, [(name or "").strip() or "there"])
    except WhatsAppNotReadyError:
        logger.warning(
            "WhatsApp welcome to %s was not sent: the Dovesoft request format is unconfirmed", mask_phone(phone)
        )
    except Exception:
        logger.exception("WhatsApp welcome to %s failed", mask_phone(phone))
