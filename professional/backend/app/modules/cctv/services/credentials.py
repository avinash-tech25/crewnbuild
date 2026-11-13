"""The only code that ever holds a camera credential in plaintext.

    encrypt_credentials()     runs immediately before persistence
    decrypt_for_connection()  the single decryption point, reserved for the
                              component that signs in to a device (ONVIF /
                              media gateway -- not implemented yet)

Username and password are encrypted separately with Fernet, using the key in
CAMERA_CREDENTIALS_KEY (backend/.env only). Nothing in this module logs,
returns, or raises with a credential value -- or the key -- in it.
"""

import unicodedata
from dataclasses import dataclass
from secrets import compare_digest

from cryptography.fernet import Fernet, InvalidToken
from fastapi import status
from pydantic import SecretStr

from app.modules.cctv.runtime import settings
from app.modules.cctv.services import cctv_error, field_error

CURRENT_KEY_VERSION = 1
ENCRYPTION_SCHEME = "FERNET"
USERNAME_MAX_LENGTH = 64
PASSWORD_MAX_LENGTH = 128

# The value config.py falls back to when no JWT secret is configured, and the
# length below which a JWT secret is treated as weak.
DEFAULT_JWT_SECRET = "change-this-secret"
MIN_JWT_SECRET_LENGTH = 32


@dataclass(frozen=True)
class EncryptedCredentials:
    username_ciphertext: bytes
    password_ciphertext: bytes
    key_version: int

    def __repr__(self) -> str:
        return "<EncryptedCredentials>"


@dataclass(frozen=True)
class PlainCredentials:
    """Decrypted credentials, wrapped so printing one prints nothing useful."""

    username: SecretStr
    password: SecretStr

    def __repr__(self) -> str:
        return "<PlainCredentials>"


def ensure_credentials_may_be_stored() -> None:
    """Refuse to accept camera credentials while the platform JWT secret is weak.

    Every CCTV authorization decision trusts the JWT. With the default secret a
    token can be forged for any account, so storing a real recorder's login
    behind it would protect nothing. Rotating the secret is a separate task;
    until it is done, credential operations stay closed.
    """
    secret = settings.jwt_secret_key.get_secret_value() or ""
    if compare_digest(secret, DEFAULT_JWT_SECRET) or len(secret) < MIN_JWT_SECRET_LENGTH:
        raise cctv_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CCTV_CREDENTIALS_REQUIRE_JWT_ROTATION",
            "Camera credentials cannot be stored or used until the platform JWT secret has been rotated.",
        )


def ensure_credentials_may_be_used() -> None:
    """The same gate, applied before any stored credential is decrypted for a
    device connection. Using a recorder's login behind a forgeable JWT would be
    no safer than storing it."""
    ensure_credentials_may_be_stored()


def _fernet() -> Fernet:
    key = settings.camera_credentials_key.get_secret_value().strip()
    if not key:
        raise cctv_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CCTV_CREDENTIAL_KEY_NOT_CONFIGURED",
            "Camera credential encryption is not configured.",
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError, UnicodeEncodeError):
        # The exception text is not passed on: it could describe the key.
        raise cctv_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CCTV_CREDENTIAL_KEY_INVALID",
            "Camera credential encryption is not configured correctly.",
        ) from None


def credential_key_configured() -> bool:
    """True when a valid key is present. Never exposes the key."""
    try:
        _fernet()
        return True
    except Exception:
        return False


def _read_secret(value: SecretStr | None, field: str, max_length: int) -> str:
    """Unwrap a SecretStr and check it, with messages that never include it."""
    raw = value.get_secret_value() if isinstance(value, SecretStr) else ""
    if not raw:
        raise field_error(field, "This field is required.")
    if len(raw) > max_length:
        raise field_error(field, f"Must be at most {max_length} characters.")
    if any(unicodedata.category(character) in ("Cc", "Cf") for character in raw):
        raise field_error(field, "Contains characters that are not allowed.")
    return raw


def encrypt_credentials(
    username: SecretStr | None, password: SecretStr | None, *, field_prefix: str = ""
) -> EncryptedCredentials:
    ensure_credentials_may_be_stored()
    fernet = _fernet()
    username_text = _read_secret(username, f"{field_prefix}username", USERNAME_MAX_LENGTH)
    password_text = _read_secret(password, f"{field_prefix}password", PASSWORD_MAX_LENGTH)
    encrypted = EncryptedCredentials(
        username_ciphertext=fernet.encrypt(username_text.encode("utf-8")),
        password_ciphertext=fernet.encrypt(password_text.encode("utf-8")),
        key_version=CURRENT_KEY_VERSION,
    )
    del username_text, password_text
    return encrypted


def decrypt_for_connection(
    username_ciphertext: bytes, password_ciphertext: bytes, key_version: int
) -> PlainCredentials:
    """The single decryption point.

    Only the code that signs in to a device may call this, and it must keep the
    result in local variables: never log it, store it, return it, or build a URL
    from it that leaves the backend process.
    """
    ensure_credentials_may_be_used()
    if key_version != CURRENT_KEY_VERSION:
        raise cctv_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CCTV_CREDENTIAL_KEY_VERSION_UNSUPPORTED",
            "Stored camera credentials use an encryption key version this server does not have.",
        )
    fernet = _fernet()
    try:
        return PlainCredentials(
            username=SecretStr(fernet.decrypt(bytes(username_ciphertext)).decode("utf-8")),
            password=SecretStr(fernet.decrypt(bytes(password_ciphertext)).decode("utf-8")),
        )
    except (InvalidToken, UnicodeDecodeError, TypeError):
        raise cctv_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CCTV_CREDENTIAL_KEY_MISMATCH",
            "Stored camera credentials cannot be decrypted with the configured key.",
        ) from None
