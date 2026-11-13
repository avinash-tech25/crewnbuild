"""Encryption at rest for personal data: Aadhaar numbers, face captures, bank details and
job photos (technical-architecture.md DB-11, 14.2).

Fernet with the key in DATA_ENCRYPTION_KEY. Every ciphertext is stored with the version
of the key that wrote it (`*_key_version`), so the key can be rotated: set the new key
and a higher DATA_ENCRYPTION_KEY_VERSION, and move the old one into
DATA_ENCRYPTION_PREVIOUS_KEYS ("version:key"), which still decrypts what it wrote.

Nothing here logs, returns or raises with a plaintext or a key in it. Without a key,
every operation that needs one answers 503 (as before).
"""

import base64
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.core.config import Settings, data_encryption_keys, get_settings
from app.core.runtime import settings

UNAVAILABLE_MESSAGE = "Identity verification is not available right now. Please try again later."


class DecryptionError(Exception):
    """A ciphertext could not be read (wrong or missing key version). Carries no data."""


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail=UNAVAILABLE_MESSAGE)


def current_key_version() -> int:
    version: int = settings.data_encryption_key_version
    return version


def encryption_configured() -> bool:
    return bool(settings.data_encryption_key.get_secret_value().strip())


def _current() -> Settings:
    """The running app's Settings (the proxy's target)."""
    from app.core.runtime import _override

    return _override or get_settings()


def _fernet(version: int) -> Fernet:
    key = data_encryption_keys(_current()).get(version)
    if not key:
        raise DecryptionError(f"no key for version {version}")
    return Fernet(key.encode("utf-8"))


def encrypt(plaintext: bytes) -> tuple[bytes, int]:
    """(ciphertext, key version) with the current key, or 503 when no key is set."""
    if not encryption_configured():
        raise _unavailable()
    version = current_key_version()
    return _fernet(version).encrypt(plaintext), version


def decrypt(ciphertext: bytes, key_version: int) -> bytes:
    try:
        return _fernet(key_version).decrypt(ciphertext)
    except InvalidToken:
        raise DecryptionError("ciphertext could not be decrypted") from None


def require_encryption() -> None:
    """503 now, before any work, when no key is configured."""
    if not encryption_configured():
        raise _unavailable()


def fingerprint(purpose: str, value: str) -> str:
    """A keyed HMAC-SHA256 of a value, to find duplicates without keeping a searchable
    copy. The key is derived from DATA_ENCRYPTION_KEY of version 1 when it is still
    configured, else from the current key, so a rotation keeps old fingerprints valid
    while version 1 stays in DATA_ENCRYPTION_PREVIOUS_KEYS."""
    keys = data_encryption_keys(_current())
    base = keys.get(1) or keys.get(current_key_version())
    if not base:
        raise _unavailable()
    secret = hashlib.sha256(f"partner-{purpose}-fingerprint:".encode() + base64.urlsafe_b64decode(base)).digest()
    return hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()
