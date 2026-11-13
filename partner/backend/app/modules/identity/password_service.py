"""Changing a password (signed in) and resetting a forgotten one by e-mail code (the old
app/technician/services/password_service.py, same rules and answers).

Forgot password:
1. send-code    the same neutral answer for every address, with or without an account,
                suspended or throttled; the e-mail goes out after the reply.
2. verify-code  the PASSWORD_RESET code is exchanged for a short-lived reset token; an
                unknown address fails exactly like a wrong code.
3. reset        only a valid reset token sets a password. It is bound to the password
                hash current when it was issued, so it cannot be used twice.
A change or a reset ends every technician session of the account.
"""

import hmac
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.access_tokens import (
    create_password_reset_token,
    password_binding,
    read_password_reset_token,
)
from app.core.security.password_hashing import (
    PASSWORD_MAX_BYTES,
    hash_secret,
    verify_against_unknown_account,
    verify_secret,
)
from app.modules.identity.auth_service import clean_new_password
from app.modules.identity.models import PURPOSE_PASSWORD_RESET, STEP_COMPLETE, Technician
from app.modules.identity.otp_service import WRONG_CODE_MESSAGE, OtpService, generate_code, normalize_email
from app.modules.identity.repository import TechnicianRepository
from app.modules.identity.schemas import (
    MessageResponse,
    PasswordChangeRequest,
    PasswordResetCodeResponse,
    PasswordResetRequest,
    PasswordResetVerifiedResponse,
)
from app.modules.identity.session_service import SessionService

WRONG_CURRENT_PASSWORD = "Your current password is not correct."  # noqa: S105 a message or a name, not a secret
MISMATCH = "The new passwords do not match."
SAME_PASSWORD = "Choose a new password that is different from your current one."  # noqa: S105 a message or a name, not a secret
RESET_SENT = "If an account exists for this email, a reset code has been sent."
RESET_EXPIRED = "This password reset has expired. Please start again."
PASSWORD_CHANGED = "Your password has been changed."  # noqa: S105 a message or a name, not a secret
PASSWORD_RESET_DONE = "Your password has been reset. Sign in with your new password."  # noqa: S105 a message or a name, not a secret


def _may_reset(technician: Technician | None) -> bool:
    """A finished, not suspended account."""
    return technician is not None and technician.onboarding_step == STEP_COMPLETE and not technician.is_suspended


def _matches(password: str, confirmation: str) -> bool:
    return hmac.compare_digest(password.encode("utf-8"), confirmation.encode("utf-8"))


class PasswordService:
    def __init__(self, database: Session, settings: Settings, otps: OtpService) -> None:
        self.database = database
        self.technicians = TechnicianRepository(database)
        self.settings = settings
        self.otps = otps
        self.sessions = SessionService(database, settings)

    # ---- signed in ----

    def change(self, technician: Technician, payload: PasswordChangeRequest) -> MessageResponse:
        current = payload.current_password or ""
        within_limit = len(current.encode("utf-8")) <= PASSWORD_MAX_BYTES
        if technician.password_hash:
            current_matches = verify_secret(current, technician.password_hash)
        else:
            # Checked against a throwaway hash when there is none, so it takes as long.
            verify_against_unknown_account(current)
            current_matches = False
        if not (current_matches and within_limit):
            # 400, not 401: the session is fine; only the typed password is wrong.
            raise HTTPException(status_code=400, detail=WRONG_CURRENT_PASSWORD)
        if not _matches(payload.new_password or "", payload.confirm_new_password or ""):
            raise HTTPException(status_code=422, detail=MISMATCH)
        new_password = clean_new_password(payload.new_password)
        if verify_secret(new_password, technician.password_hash):
            raise HTTPException(status_code=422, detail=SAME_PASSWORD)
        technician.password_hash = hash_secret(new_password)
        # Every session signed in with the old password ends, this one included.
        self.sessions.revoke_technician_sessions_after_password_change(technician.id)
        self.database.commit()
        return MessageResponse(message=PASSWORD_CHANGED)

    # ---- forgot password ----

    def send_reset_code(
        self, raw_email: str, defer: Callable[..., Any], client_address: str | None = None
    ) -> PasswordResetCodeResponse:
        email = normalize_email(raw_email)
        technician = self.technicians.get_by_email(email) if email else None
        preview: dict[str, Any] = {}
        if _may_reset(technician):
            try:
                sent = self.otps.send(email, PURPOSE_PASSWORD_RESET, defer=defer, client_address=client_address)
                preview = {key: sent[key] for key in ("dev_preview", "dev_otp") if key in sent}
                self.database.commit()
            except HTTPException as error:
                self.database.rollback()
                # Throttled: said nowhere, or the answer would differ from an unknown address.
                if error.status_code != 429:
                    raise
        else:
            # The hashing work a real send does, so an unknown address takes as long.
            hash_secret(generate_code())
        return PasswordResetCodeResponse(
            message=RESET_SENT,
            expires_in_minutes=self.settings.otp_ttl_minutes,
            resend_after_seconds=self.settings.otp_resend_cooldown_seconds,
            **preview,
        )

    def verify_reset_code(self, raw_email: str, code: str) -> PasswordResetVerifiedResponse:
        email = normalize_email(raw_email)
        self.otps.consume(email, PURPOSE_PASSWORD_RESET, code)
        technician = self.technicians.get_by_email(email)
        if technician is None or not _may_reset(technician):
            self.database.rollback()
            raise HTTPException(status_code=400, detail=WRONG_CODE_MESSAGE)
        self.database.commit()  # the code is used up now
        return PasswordResetVerifiedResponse(
            reset_token=create_password_reset_token(self.settings, technician.id, technician.password_hash),
            expires_in_minutes=self.settings.password_reset_token_minutes,
        )

    def reset(self, payload: PasswordResetRequest) -> MessageResponse:
        claim = read_password_reset_token(self.settings, payload.reset_token or "")
        technician = self.technicians.get(claim[0]) if claim else None
        if not (
            claim
            and technician is not None
            and _may_reset(technician)
            and hmac.compare_digest(claim[1], password_binding(self.settings, technician.password_hash))
        ):
            raise HTTPException(status_code=400, detail=RESET_EXPIRED)
        if not _matches(payload.new_password or "", payload.confirm_new_password or ""):
            raise HTTPException(status_code=422, detail=MISMATCH)
        technician.password_hash = hash_secret(clean_new_password(payload.new_password))
        # Whoever held a session before the reset must sign in again with the new password.
        self.sessions.revoke_technician_sessions_after_password_change(technician.id)
        self.database.commit()
        return MessageResponse(message=PASSWORD_RESET_DONE)
