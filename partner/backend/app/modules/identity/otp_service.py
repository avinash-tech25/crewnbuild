"""E-mail one-time codes for technician sign-up and password reset (the old
app/technician/services/otp_service.py, same rules):

* six digits from `secrets`, stored only as a hash, never returned;
* tied to one address and one purpose (a sign-up code cannot reset a password);
* expire after OTP_TTL_MINUTES; OTP_MAX_ATTEMPTS wrong guesses lock the code;
* resend: a cooldown between sends and a cap per rolling hour;
* used once: the row is deleted the moment a code is accepted.

When e-mail cannot be sent, outside production the code is written to the server log
(as before); production answers 503.
"""

import ipaddress
import logging
import secrets
from collections.abc import Callable
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.password_hashing import hash_secret, verify_secret
from app.database.types import naive_utc_now
from app.integrations.email.email_sender import EmailSender
from app.modules.identity.models import PURPOSE_PASSWORD_RESET, PURPOSE_SIGNUP, EmailOtpCode
from app.modules.identity.repository import OtpRepository

logger = logging.getLogger(__name__)

CODE_LENGTH = 6
WRONG_CODE_MESSAGE = "That code is not right or has expired. Ask for a new one."


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def generate_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(CODE_LENGTH))


class OtpService:
    def __init__(self, database: Session, settings: Settings, email: EmailSender) -> None:
        self.database = database
        self.repository = OtpRepository(database)
        self.settings = settings
        self.email = email

    def dev_preview_allowed(self, client_address: str | None) -> bool:
        """EMAIL_DEV_OTP_PREVIEW: development, the setting on, a request from this machine."""
        try:
            loopback = ipaddress.ip_address((client_address or "").strip()).is_loopback
        except ValueError:
            loopback = False
        return bool(self.settings.email_dev_otp_preview and self.settings.is_development() and loopback)

    def send(
        self, email: str, purpose: str, defer: Callable[..., Any] | None = None, client_address: str | None = None
    ) -> dict[str, Any]:
        """Generate, store and e-mail a new code. Returns what the client may know.
        `defer`, when given, runs the delivery after the reply (BackgroundTasks), so the
        reply's timing says nothing about the address."""
        settings = self.settings
        now = naive_utc_now()
        record = self.repository.find(email, purpose, for_update=True)
        if record:
            waited = (now - record.last_sent_at).total_seconds()
            if waited < settings.otp_resend_cooldown_seconds:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Please wait {int(settings.otp_resend_cooldown_seconds - waited) + 1} seconds "
                    "before asking for a new code.",
                )
            window_open = now - record.send_window_started_at < timedelta(hours=1)
            if window_open and record.sends_in_window >= settings.otp_max_sends_per_hour:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many codes requested for this email. Try again in an hour.",
                )

        code = generate_code()
        delivered: bool | None
        if not self.email.configured:
            delivered = False
        elif defer is not None:
            defer(self._deliver_later, email, code, purpose)
            delivered = None
        else:
            delivered = self._deliver(email, code, purpose)
        preview: dict[str, Any] = {}
        if delivered is False:
            # R6: never logged. The development preview answers this request with the code;
            # anywhere else the request fails (it used to be written to the log away from
            # production).
            if not self.dev_preview_allowed(client_address):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="We could not send the code. Try again in a moment.",
                )
            logger.info("A %s code: development preview, not sent.", purpose.lower())
            preview = {"dev_preview": True, "dev_otp": code}

        values = {
            "code_hash": hash_secret(code),
            "expires_at": now + timedelta(minutes=settings.otp_ttl_minutes),
            "attempts": 0,
            "last_sent_at": now,
        }
        if record:
            if now - record.send_window_started_at >= timedelta(hours=1):
                values.update(send_window_started_at=now, sends_in_window=1)
            else:
                values.update(sends_in_window=record.sends_in_window + 1)
            for field, value in values.items():
                setattr(record, field, value)
        else:
            self.database.add(
                EmailOtpCode(email=email, purpose=purpose, send_window_started_at=now, sends_in_window=1, **values)
            )
        self.database.flush()
        return {
            "sent": True,
            "delivered": delivered,
            "expires_in_minutes": settings.otp_ttl_minutes,
            "resend_after_seconds": settings.otp_resend_cooldown_seconds,
            **preview,
        }

    def consume(self, email: str, purpose: str, raw_code: str | None) -> None:
        """Accept the code once, or raise. The caller commits."""
        code = "".join(character for character in (raw_code or "") if character.isdigit())
        record = self.repository.find(email, purpose, for_update=True)
        now = naive_utc_now()
        if not record or record.expires_at < now:
            raise HTTPException(status_code=400, detail=WRONG_CODE_MESSAGE)
        if record.attempts >= self.settings.otp_max_attempts:
            raise HTTPException(status_code=429, detail="Too many wrong attempts. Ask for a new code.")
        if len(code) != CODE_LENGTH or not verify_secret(code, record.code_hash):
            record.attempts += 1
            # Committed now: a wrong guess must count even though the request fails.
            self.database.commit()
            raise HTTPException(status_code=400, detail=WRONG_CODE_MESSAGE)
        self.database.delete(record)
        self.database.flush()

    def _deliver_later(self, email: str, code: str, purpose: str) -> None:
        if self.email.configured and self._deliver(email, code, purpose):
            return
        # Never the code itself (R6; it used to be logged away from production).
        logger.error("A %s code could not be emailed.", purpose.lower())

    def _deliver(self, email: str, code: str, purpose: str) -> bool:
        minutes = self.settings.otp_ttl_minutes
        if purpose == PURPOSE_PASSWORD_RESET:
            action = "reset the password of your CREWNBUILD Partner account"
            subject = "Your CREWNBUILD password reset code"
        elif purpose == PURPOSE_SIGNUP:
            action = "finish creating your CREWNBUILD Partner account"
            subject = "Your CREWNBUILD verification code"
        else:
            action = "sign in to CREWNBUILD Partner"
            subject = "Your CREWNBUILD sign-in code"
        text_body = (
            f"Your CREWNBUILD code is {code}.\n\n"
            f"Use it to {action}. It expires in {minutes} minutes.\n"
            "If you did not ask for this code, you can ignore this message.\n\nCREWNBUILD"
        )
        html_body = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#10231b">
          <h2 style="margin:0 0 12px;color:#083e2b">{escape(subject)}</h2>
          <p>Use this code to {escape(action)}:</p>
          <p style="margin:20px 0;font-size:30px;font-weight:700;letter-spacing:8px;color:#083e2b">{escape(code)}</p>
          <p>It expires in {minutes} minutes. If you did not ask for this code, you can ignore this message.</p>
        </div>
        """
        return self.email.send(email, subject, text_body, html_body)
