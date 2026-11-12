"""Password and one-time-code hashing (technical-architecture.md 3, 6.3, 14.2).

New hashes are Argon2id. Hashes written by the old application are bcrypt ($2a$/$2b$/$2y$);
they are still verified, and needs_rehash() tells the caller to replace them with an
Argon2id hash after the next successful sign-in.

The six-digit e-mail and WhatsApp codes are hashed the same way as passwords, as before:
a stolen table must not reveal a live code.
"""

import re

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_argon2 = PasswordHasher()

ARGON2_PREFIX = "$argon2"
BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")
# Verified against when the account does not exist, so an unknown identifier takes as
# long to refuse as a wrong password and the answer time reveals nothing.
_UNKNOWN_ACCOUNT_HASH = _argon2.hash("no-account-has-this-password")


def password_is_strong(password: str) -> bool:
    """The rule the old application enforced at sign-up and password reset: 10 or more
    characters with an upper-case letter, a lower-case letter, a digit and a symbol."""
    return len(password) >= 10 and all(
        (
            re.search(r"[a-z]", password),
            re.search(r"[A-Z]", password),
            re.search(r"\d", password),
            re.search(r"[^\w\s]", password),
        )
    )


def hash_secret(secret: str) -> str:
    """An Argon2id hash of a password or a one-time code."""
    return _argon2.hash(secret)


def verify_secret(secret: str, stored_hash: str | None) -> bool:
    """Whether `secret` matches `stored_hash` (Argon2id, or a legacy bcrypt hash)."""
    if not stored_hash:
        return False
    if stored_hash.startswith(ARGON2_PREFIX):
        try:
            return _argon2.verify(stored_hash, secret)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    if stored_hash.startswith(BCRYPT_PREFIXES):
        try:
            return bcrypt.checkpw(secret.encode("utf-8"), stored_hash.encode("utf-8"))
        except ValueError:
            return False
    return False


def verify_against_unknown_account(secret: str) -> None:
    """Spend the time of one verification when there is no account to check against."""
    verify_secret(secret, _UNKNOWN_ACCOUNT_HASH)


def needs_rehash(stored_hash: str) -> bool:
    """True for a legacy bcrypt hash, or an Argon2id hash with outdated parameters."""
    if not stored_hash.startswith(ARGON2_PREFIX):
        return True
    try:
        return _argon2.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True
