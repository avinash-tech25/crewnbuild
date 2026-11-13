"""Face capture and Aadhaar submission for technician onboarding.

No face-verification or Aadhaar-verification provider is configured in this
project, so this service never marks anything VERIFIED on its own:

  Face     consent -> live capture from the camera -> encrypted with
           DATA_ENCRYPTION_KEY (its version stored beside it) and written to FACE_CAPTURE_DIRECTORY for review
           -> face_status PENDING. The capture is deleted when a reviewer decides
           (app/scripts/identity_review.py) or after FACE_CAPTURE_RETENTION_DAYS,
           whichever comes first. It is never served by any endpoint. No face
           template or embedding is computed or stored.

  Aadhaar  consent -> 12 digits + Verhoeff checksum (a format check, not
           verification) -> stored as Fernet ciphertext + last four digits + a
           keyed HMAC fingerprint that stops one number being linked to two
           accounts -> aadhaar_status PENDING_VERIFICATION. The full number is
           never returned, logged or placed in a URL or an error.

Plugging in a real provider means replacing `submit_face` / `submit_aadhaar`'s
"pending" outcome with the provider's decision and reference; the table already
has face_provider / face_provider_reference and *_verified_at for that.
"""

import logging
import secrets
from datetime import timedelta
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import BACKEND_ROOT
from app.core.runtime import settings
from app.core.security import data_encryption
from app.database.types import naive_utc_now
from app.modules.identity.models import STEP_AADHAAR, STEP_EMAIL, STEP_FACE, Technician
from app.modules.technicians.models import (
    AADHAAR_FAILED,
    AADHAAR_PENDING,
    AADHAAR_VERIFIED,
    FACE_FAILED,
    FACE_PENDING,
    FACE_VERIFIED,
    IdentityVerification,
)
from app.modules.technicians.repository import IdentityRepository

logger = logging.getLogger(__name__)

# Sign-up order is enforced here, not only by which screen the browser shows:
# a step's endpoint accepts a submission only when it is the account's next step.
OUT_OF_ORDER_MESSAGES = {
    STEP_EMAIL: "Verify your email address with a sign-in code first.",
    STEP_FACE: "Complete face verification first.",
}


def require_step(user: Technician, step: str) -> None:
    current = user.onboarding_step
    if current != step:
        raise HTTPException(
            status_code=409,
            detail=OUT_OF_ORDER_MESSAGES.get(current, "This registration step is already complete."),
        )


FACE_PROVIDER_MANUAL_REVIEW = "manual_review"
MAX_FACE_BYTES = 2 * 1024 * 1024
IMAGE_SIGNATURES = ((b"\xff\xd8\xff", "jpeg"), (b"\x89PNG\r\n\x1a\n", "png"))

# Verhoeff tables (the checksum UIDAI uses for Aadhaar numbers).
_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def verhoeff_valid(number: str) -> bool:
    checksum = 0
    for position, digit in enumerate(reversed(number)):
        checksum = _VERHOEFF_D[checksum][_VERHOEFF_P[position % 8][int(digit)]]
    return checksum == 0


def clean_aadhaar(raw: str | None) -> str:
    digits = "".join((raw or "").split())
    # UIDAI never issues numbers starting with 0 or 1.
    if len(digits) != 12 or not digits.isdigit() or digits[0] in "01" or not verhoeff_valid(digits):
        raise HTTPException(status_code=422, detail="Enter a valid 12-digit Aadhaar number.")
    return digits


def aadhaar_fingerprint(number: str) -> str:
    """A keyed HMAC of the number (data_encryption.fingerprint), never the number."""
    return data_encryption.fingerprint("aadhaar", number)


def face_capture_root() -> Path:
    configured = Path(settings.face_capture_directory)
    return configured if configured.is_absolute() else BACKEND_ROOT / configured


def _capture_path(reference: str) -> Path:
    # The reference is our own random hex, but never trust a path component.
    if not reference or not all(ch in "0123456789abcdef" for ch in reference):
        raise ValueError("invalid capture reference")
    return face_capture_root() / f"{reference}.bin"


def delete_face_capture(identity: IdentityVerification) -> None:
    if identity.face_provider_reference:
        try:
            _capture_path(identity.face_provider_reference).unlink(missing_ok=True)
        except (OSError, ValueError):
            logger.error("Could not delete a face capture for identity record %s", identity.id)
    identity.face_provider_reference = None
    identity.face_capture_key_version = None
    identity.face_capture_expires_at = None


def purge_expired_face_captures(database: Session) -> int:
    """Delete captures past their retention. Returns how many were removed."""
    repository = IdentityRepository(database)
    now = naive_utc_now()
    expired = repository.list_expired_face_captures(now)
    for identity in expired:
        delete_face_capture(identity)
    if expired:
        repository.commit()
        logger.info("Purged %d expired face capture(s).", len(expired))
    return len(expired)


def identity_for(database: Session, user: Technician) -> IdentityVerification:
    if user.identity is None:
        user.identity = IdentityVerification(user_id=user.id)
        IdentityRepository(database).flush()
    return user.identity


class IdentityService:
    def __init__(self, repository: IdentityRepository):
        self.repository = repository

    def submit_face(self, user: Technician, capture: UploadFile, consent: bool) -> IdentityVerification:
        require_step(user, STEP_FACE)
        if not consent:
            raise HTTPException(status_code=422, detail="Please agree to the face verification consent to continue.")
        identity = identity_for(self.repository.database, user)
        if identity.face_status == FACE_VERIFIED:
            raise HTTPException(status_code=409, detail="Your face verification is already complete.")

        content = capture.file.read(MAX_FACE_BYTES + 1)
        if len(content) > MAX_FACE_BYTES:
            raise HTTPException(status_code=413, detail="The capture is too large. Please take the photo again.")
        if not any(content.startswith(signature) for signature, _ in IMAGE_SIGNATURES):
            raise HTTPException(status_code=422, detail="Please capture your face with the camera.")

        encrypted, key_version = data_encryption.encrypt(content)
        # Replacing a previous capture (retake, or after FAILED) removes the old file first.
        delete_face_capture(identity)
        root = face_capture_root()
        root.mkdir(parents=True, exist_ok=True)
        reference = secrets.token_hex(24)
        _capture_path(reference).write_bytes(encrypted)

        now = naive_utc_now()
        identity.face_consent_at = now
        identity.face_provider = FACE_PROVIDER_MANUAL_REVIEW
        identity.face_provider_reference = reference
        identity.face_capture_key_version = key_version
        identity.face_submitted_at = now
        identity.face_capture_expires_at = now + timedelta(days=settings.face_capture_retention_days)
        identity.face_status = FACE_PENDING
        identity.face_verified_at = None
        self.repository.commit()
        purge_expired_face_captures(self.repository.database)
        return identity

    def submit_aadhaar(self, user: Technician, raw_number: str | None, consent: bool) -> IdentityVerification:
        require_step(user, STEP_AADHAAR)
        if not consent:
            raise HTTPException(status_code=422, detail="Please agree to the Aadhaar consent to continue.")
        identity = identity_for(self.repository.database, user)
        if identity.aadhaar_status == AADHAAR_VERIFIED:
            raise HTTPException(status_code=409, detail="Your Aadhaar is already verified.")
        number = clean_aadhaar(raw_number)
        data_encryption.require_encryption()
        fingerprint = aadhaar_fingerprint(number)
        taken = self.repository.find_other_with_aadhaar_fingerprint(fingerprint, user.id)
        if taken:
            raise HTTPException(
                status_code=409, detail="This Aadhaar number is already linked to another CREWNBUILD Partner account."
            )

        now = naive_utc_now()
        identity.aadhaar_consent_at = now
        identity.aadhaar_last4 = number[-4:]
        identity.aadhaar_fingerprint = fingerprint
        identity.aadhaar_ciphertext, identity.aadhaar_key_version = data_encryption.encrypt(number.encode())
        identity.aadhaar_submitted_at = now
        identity.aadhaar_status = AADHAAR_PENDING
        identity.aadhaar_verified_at = None
        self.repository.commit()
        return identity


# ---------------------------------------------------------------- review decisions


def decide_face(database: Session, identity: IdentityVerification, verified: bool) -> None:
    if identity.face_status != FACE_PENDING:
        raise ValueError(f"face status is {identity.face_status}, not PENDING")
    identity.face_status = FACE_VERIFIED if verified else FACE_FAILED
    identity.face_verified_at = naive_utc_now() if verified else None
    delete_face_capture(identity)
    IdentityRepository(database).commit()


def decide_aadhaar(database: Session, identity: IdentityVerification, verified: bool) -> None:
    if identity.aadhaar_status != AADHAAR_PENDING:
        raise ValueError(f"aadhaar status is {identity.aadhaar_status}, not PENDING_VERIFICATION")
    identity.aadhaar_status = AADHAAR_VERIFIED if verified else AADHAAR_FAILED
    identity.aadhaar_verified_at = naive_utc_now() if verified else None
    IdentityRepository(database).commit()


def decrypt_face_capture(identity: IdentityVerification) -> bytes:
    """For the reviewer script only."""
    if not identity.face_provider_reference:
        raise ValueError("no capture is stored for this record")
    try:
        ciphertext = _capture_path(identity.face_provider_reference).read_bytes()
        return data_encryption.decrypt(ciphertext, identity.face_capture_key_version or 1)
    except (OSError, data_encryption.DecryptionError) as error:
        raise ValueError(f"capture could not be read: {type(error).__name__}")
