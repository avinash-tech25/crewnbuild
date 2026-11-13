"""The six-digit e-mail codes: sign-up, Profile Settings (adding an address to a signed-in
account) and password reset. Ported from the old email_verification_service.py with the
same rules: codes stored hashed, 10-minute life, 5 wrong tries, 30-second resend
cooldown, a confirmed address usable for 15 minutes.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.password_hashing import hash_secret, password_is_strong, verify_secret
from app.integrations.email.email_sender import EmailSender
from app.modules.identity.models import EmailVerificationCode, User
from app.modules.identity.repository import EmailCodeRepository, SessionRepository, UserRepository
from app.modules.identity.session_service import revoke_user_sessions_after_password_reset, utc_now

logger = logging.getLogger(__name__)

SIGNUP = "SIGNUP"
PASSWORD_RESET = "PASSWORD_RESET"  # noqa: S105 a code purpose, not a secret
PROFILE_PREFIX = "PROFILE:"
EMAIL_IN_USE = "This email address is already associated with another account."
BAD_RESET_CODE = "That code is not right or has expired. Ask for a new one."
WEAK_PASSWORD = "Password must have 10+ characters with upper, lower, number, and symbol."  # noqa: S105 a message, not a secret

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
VERIFIED_TTL_MINUTES = 15
MAX_ATTEMPTS = 5
ATTEMPT_RESET_MINUTES = 15
RESEND_COOLDOWN_SECONDS = 30


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def generate_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(CODE_LENGTH))


def digits_of(raw_code: str | None) -> str:
    return "".join(character for character in (raw_code or "") if character.isdigit())


def profile_purpose(user_id: uuid.UUID) -> str:
    # 8 + 22 characters: the purpose column is varchar(30).
    return PROFILE_PREFIX + hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:22]


def cooldown_refusal(waited_seconds: float) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Please wait {int(RESEND_COOLDOWN_SECONDS - waited_seconds)} seconds before asking for a new code.",
    )


class EmailVerificationService:
    def __init__(self, database: Session, settings: Settings, email: EmailSender) -> None:
        self.database = database
        self.settings = settings
        self.repository = EmailCodeRepository(database)
        self.users = UserRepository(database)
        self.sessions = SessionRepository(database)
        self.email = email

    def get_record(self, email: str) -> EmailVerificationCode | None:
        return self.repository.find_by_email(email)

    def ensure_cooldown_passed(self, record: EmailVerificationCode | None) -> None:
        if record:
            waited = (utc_now() - record.last_sent_at).total_seconds()
            if waited < RESEND_COOLDOWN_SECONDS:
                raise cooldown_refusal(waited)

    # ---- sign-up ----

    def send_code(self, raw_email: str) -> dict[str, Any]:
        email = normalize_email(raw_email)
        if self.users.find_id_by_email(email):
            raise HTTPException(status_code=409, detail="Email already registered")
        self.ensure_cooldown_passed(self.get_record(email))

        code = generate_code()
        delivered = self.email.configured and self.send_code_email(email, code)
        if not delivered:
            # R6: refused in every environment. Before, away from production an undeliverable
            # code was written to the server's log; codes are never logged now (section 14.2).
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY
                if self.email.configured
                else status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="We could not send the verification email. Try again in a moment.",
            )
        self.store_code(email, code, SIGNUP)
        return {
            "sent": True,
            "delivered": delivered,
            "expires_in_minutes": CODE_TTL_MINUTES,
            "resend_after_seconds": RESEND_COOLDOWN_SECONDS,
        }

    def store_code(self, email: str, code: str, purpose: str) -> None:
        now = utc_now()
        record = self.get_record(email)
        # Wrong guesses carry over to a new code unless the previous one went out more
        # than ATTEMPT_RESET_MINUTES ago.
        carried = 0
        if record and record.last_sent_at and now - record.last_sent_at < timedelta(minutes=ATTEMPT_RESET_MINUTES):
            carried = record.attempts or 0
        values: dict[str, Any] = {
            "purpose": purpose,
            "code_hash": hash_secret(code),
            "expires_at": now + timedelta(minutes=CODE_TTL_MINUTES),
            "attempts": carried,
            "last_sent_at": now,
            "verified_at": None,
        }
        if record:
            for field, value in values.items():
                setattr(record, field, value)
        else:
            self.database.add(EmailVerificationCode(email=email, **values))
        self.database.commit()

    def verify_code(self, raw_email: str, raw_code: str) -> dict[str, Any]:
        email = normalize_email(raw_email)
        code = digits_of(raw_code)
        record = self.get_record(email)
        if not record or record.purpose != SIGNUP:
            raise HTTPException(status_code=404, detail="Ask for a verification code first.")
        now = utc_now()
        if record.verified_at:
            return {"verified": True}
        if record.expires_at < now:
            raise HTTPException(status_code=410, detail="That code has expired. Ask for a new one.")
        if record.attempts >= MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many wrong attempts. Ask for a new code.")
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            self.database.commit()
            raise HTTPException(status_code=400, detail="That code is not right. Try again.")
        record.verified_at = now
        self.database.commit()
        return {"verified": True, "valid_for_minutes": VERIFIED_TTL_MINUTES}

    def require_verified(self, raw_email: str) -> EmailVerificationCode:
        record = self.get_record(normalize_email(raw_email))
        if not record or record.purpose != SIGNUP or not record.verified_at:
            raise HTTPException(status_code=422, detail="Verify your email address before creating the account.")
        if record.verified_at + timedelta(minutes=VERIFIED_TTL_MINUTES) < utc_now():
            raise HTTPException(status_code=422, detail="Your email verification expired. Verify the address again.")
        return record

    def consume(self, raw_email: str) -> None:
        record = self.get_record(normalize_email(raw_email))
        if record:
            self.database.delete(record)

    # ---- Profile Settings ----

    def send_profile_code(self, user: User, raw_email: str) -> dict[str, Any]:
        email = normalize_email(raw_email)
        owner_id = self.users.find_id_by_email(email)
        if owner_id and owner_id != user.id:
            raise HTTPException(status_code=409, detail=EMAIL_IN_USE)
        if owner_id and user.email_verified:
            raise HTTPException(status_code=409, detail="This email address is already verified.")
        self.ensure_cooldown_passed(self.get_record(email))

        code = generate_code()
        if not (self.email.configured and self.send_profile_email(email, code)):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY
                if self.email.configured
                else status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="We could not send the verification email. Try again in a moment.",
            )
        self.store_code(email, code, profile_purpose(user.id))
        return {"sent": True, "expires_in_minutes": CODE_TTL_MINUTES, "resend_after_seconds": RESEND_COOLDOWN_SECONDS}

    def verify_profile_code(self, user: User, raw_email: str, raw_code: str) -> User:
        email = normalize_email(raw_email)
        code = digits_of(raw_code)
        record = self.get_record(email)
        if not record or record.purpose != profile_purpose(user.id):
            raise HTTPException(status_code=404, detail="Ask for a verification code first.")
        now = utc_now()
        if record.expires_at < now:
            raise HTTPException(status_code=410, detail="That code has expired. Ask for a new one.")
        if record.attempts >= MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many wrong attempts. Ask for a new code.")
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            self.database.commit()
            raise HTTPException(status_code=400, detail="That code is not right. Try again.")

        owner_id = self.users.find_id_by_email(email)
        if owner_id and owner_id != user.id:
            self.database.delete(record)
            self.database.commit()
            raise HTTPException(status_code=409, detail=EMAIL_IN_USE)

        user.email = email
        user.email_verified_at = now
        self.database.delete(record)
        try:
            self.database.commit()
        except IntegrityError:
            self.database.rollback()
            raise HTTPException(status_code=409, detail=EMAIL_IN_USE) from None
        return user

    # ---- password reset ----

    def send_reset_code(self, raw_email: str) -> dict[str, Any]:
        """The reply is the same whether or not the address has an account; only a real
        account is actually sent a code."""
        email = normalize_email(raw_email)
        quiet_reply = {
            "sent": True,
            "expires_in_minutes": CODE_TTL_MINUTES,
            "resend_after_seconds": RESEND_COOLDOWN_SECONDS,
        }
        if not self.users.find_id_by_email(email):
            return quiet_reply
        self.ensure_cooldown_passed(self.get_record(email))
        if not self.email.configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email delivery is not configured, so a reset code cannot be sent.",
            )
        code = generate_code()
        if not self.send_reset_email(email, code):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not send the reset email. Try again in a moment.",
            )
        self.store_code(email, code, PASSWORD_RESET)
        return quiet_reply

    def verify_reset_code(self, raw_email: str, raw_code: str) -> dict[str, Any]:
        email = normalize_email(raw_email)
        code = digits_of(raw_code)
        record = self.get_record(email)
        now = utc_now()
        if (
            record is None
            or record.purpose != PASSWORD_RESET
            or record.expires_at < now
            or record.attempts >= MAX_ATTEMPTS
        ):
            raise HTTPException(status_code=400, detail=BAD_RESET_CODE)
        if record.verified_at:
            return {"verified": True, "valid_for_minutes": VERIFIED_TTL_MINUTES}
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            self.database.commit()
            raise HTTPException(status_code=400, detail=BAD_RESET_CODE)
        record.verified_at = now
        self.database.commit()
        return {"verified": True, "valid_for_minutes": VERIFIED_TTL_MINUTES}

    def reset_password(self, raw_email: str, new_password: str) -> None:
        email = normalize_email(raw_email)
        record = self.get_record(email)
        if (
            record is None
            or record.purpose != PASSWORD_RESET
            or not record.verified_at
            or record.verified_at + timedelta(minutes=VERIFIED_TTL_MINUTES) < utc_now()
        ):
            raise HTTPException(
                status_code=422, detail="Verify the code from your email before setting a new password."
            )
        if not password_is_strong(new_password):
            raise HTTPException(status_code=422, detail=WEAK_PASSWORD)
        user = self.users.get_by_email(email)
        if not user:
            raise HTTPException(status_code=404, detail="Account not found.")
        user.password_hash = hash_secret(new_password)
        self.database.delete(record)
        # Whoever held a session before the reset must sign in again.
        revoke_user_sessions_after_password_reset(self.sessions, user.id)
        self.database.commit()

    # ---- messages ----

    def send_code_email(self, email: str, code: str) -> bool:
        return self.email.send_email(
            email,
            "Your CREWNBUILD verification code",
            f"Your CREWNBUILD verification code is {code}.\n\n"
            f"It expires in {CODE_TTL_MINUTES} minutes. If you did not ask to create an "
            "account, you can ignore this message.\n\nRegards,\nCREWNBUILD",
            code_email_html(
                "Verify your email",
                "Use this code to finish creating your <strong>CREWNBUILD</strong> account:",
                code,
                "If you did not ask to create an account, you can ignore this message.",
            ),
        )

    def send_profile_email(self, email: str, code: str) -> bool:
        return self.email.send_email(
            email,
            "Your CREWNBUILD email verification code",
            f"Your CREWNBUILD email verification code is {code}.\n\n"
            f"It expires in {CODE_TTL_MINUTES} minutes. If you did not ask to add this "
            "address to a CREWNBUILD account, you can ignore this message.\n\nRegards,\nCREWNBUILD",
            code_email_html(
                "Verify your email",
                "Use this code to verify the email address on your <strong>CREWNBUILD</strong> account:",
                code,
                "If you did not ask to add this address to a CREWNBUILD account, you can ignore this message.",
            ),
        )

    def send_reset_email(self, email: str, code: str) -> bool:
        return self.email.send_email(
            email,
            "Your CREWNBUILD password reset code",
            f"Use the code {code} to set a new CREWNBUILD password.\n\n"
            f"It expires in {CODE_TTL_MINUTES} minutes. If you did not ask to reset your "
            "password, you can ignore this message and your password stays unchanged.\n\nRegards,\nCREWNBUILD",
            code_email_html(
                "Reset your password",
                "Use this code to set a new <strong>CREWNBUILD</strong> password:",
                code,
                "If you did not ask to reset your password, you can ignore this message and your password "
                "stays unchanged.",
            ),
        )


def code_email_html(heading: str, intro: str, code: str, closing: str) -> str:
    return f"""
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#10231b">
          <h2 style="margin:0 0 12px;color:#0f3d2a">{heading}</h2>
          <p>{intro}</p>
          <p style="margin:20px 0;font-size:30px;font-weight:700;letter-spacing:8px;color:#0f3d2a">{escape(code)}</p>
          <p>It expires in {CODE_TTL_MINUTES} minutes. {closing}</p>
          <p style="margin-top:24px">Regards,<br><strong>CREWNBUILD</strong></p>
        </div>
        """
