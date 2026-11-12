"""Signed tokens of the Professional API (technical-architecture.md 6.2, 6.3).

Three kinds, each with its own key and its own `typ`/`type`, so one can never pass as
another:

* access token: HS256 with JWT_SECRET_KEY, 15 minutes, bound to a live session row
  (`sid`) and its family (`fam`). `role` is a hint for the web app only; the server
  always reads the role from the database.
* Partner hand-off token: ES256 (ECDSA P-256) with PARTNER_HANDOFF_PRIVATE_KEY, at most
  60 seconds, single use (`jti`), audience `partner`. No role claim: Partner reads the
  role from the database on every requester request.
* OAuth state cookie: HS256 with a key derived from JWT_SECRET_KEY under its own label.

Also the opaque refresh token, the SHA-256 verifiers stored for random tokens, and the
CSRF token of a session family.
"""

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import Settings

ACCESS_ISSUER = "professional"
ACCESS_AUDIENCE = "professional"
TOKEN_ACCESS = "access"  # noqa: S105 a token type name, not a secret

PARTNER_HANDOFF_AUDIENCE = "partner"
PARTNER_HANDOFF_TYPE = "partner_handoff"
PARTNER_HANDOFF_ALGORITHM = "ES256"

OAUTH_STATE_TYPE = "oauth_state"


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    family_id: uuid.UUID


def create_access_token(
    settings: Settings, user_id: uuid.UUID, session_id: uuid.UUID, family_id: uuid.UUID, role: str
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "fam": str(family_id),
        "role": role,
        "typ": TOKEN_ACCESS,
        "iss": ACCESS_ISSUER,
        "aud": ACCESS_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm)


def read_access_claims(settings: Settings, token: str, allow_expired: bool = False) -> AccessClaims | None:
    """The claims of a valid access token of this service, or None.

    Signature, algorithm, issuer, audience, type, expiry and the session claims are all
    required. Whether the session is still live is the caller's check, against the
    database. `allow_expired` is for an open websocket re-checking the token it was
    admitted with: its session decides from then on.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=ACCESS_AUDIENCE,
            issuer=ACCESS_ISSUER,
            options={"verify_exp": not allow_expired, "require": ["sub", "sid", "fam", "exp", "iss", "aud"]},
        )
        if payload.get("typ") != TOKEN_ACCESS:
            return None
        return AccessClaims(
            user_id=uuid.UUID(str(payload["sub"])),
            session_id=uuid.UUID(str(payload["sid"])),
            family_id=uuid.UUID(str(payload["fam"])),
        )
    except (jwt.PyJWTError, TypeError, ValueError, KeyError):
        return None


def new_refresh_token() -> str:
    """An opaque refresh token of 256 random bits. Only its SHA-256 is stored."""
    return secrets.token_urlsafe(32)


def token_digest(value: str) -> str:
    """SHA-256 (hex) of a random token. A fast hash is right here: the token is random,
    so there is nothing to slow a guess against."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def csrf_token_for(settings: Settings, family_id: uuid.UUID) -> str:
    """The CSRF token of a session family: an HMAC of the family id under a key derived
    from JWT_SECRET_KEY with its own label. Stable for the whole family, so every tab and
    every reload of one sign-in shares it; its SHA-256 is stored on each session row
    (user_sessions.csrf_secret_hash)."""
    key = hashlib.sha256(b"professional-csrf:" + settings.jwt_secret_key.get_secret_value().encode("utf-8")).digest()
    return hmac.new(key, str(family_id).encode("utf-8"), hashlib.sha256).hexdigest()


# ---- Partner hand-off (ES256, no role claim) ----


def partner_handoff_configured(settings: Settings) -> bool:
    return bool(settings.partner_handoff_private_key.get_secret_value())


def create_partner_handoff_token(settings: Settings, user_id: uuid.UUID) -> str:
    """A one-time, minute-long proof of this account for Partner, which exchanges it once
    (by `jti`) for a requester session of its own. The caller checks
    partner_handoff_configured() first; the key was validated at startup."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": PARTNER_HANDOFF_TYPE,
        "iss": ACCESS_ISSUER,
        "aud": PARTNER_HANDOFF_AUDIENCE,
        "jti": secrets.token_urlsafe(24),
        "iat": now,
        "exp": now + timedelta(seconds=settings.partner_handoff_seconds),
    }
    return jwt.encode(
        payload, settings.partner_handoff_private_key.get_secret_value(), algorithm=PARTNER_HANDOFF_ALGORITHM
    )


# ---- OAuth state cookie ----


def _oauth_state_key(settings: Settings) -> str:
    material = b"professional-oauth-state:" + settings.jwt_secret_key.get_secret_value().encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def encode_oauth_state(settings: Settings, claims: dict[str, Any], lifetime_seconds: int) -> str:
    now = datetime.now(UTC)
    payload = {**claims, "type": OAUTH_STATE_TYPE, "iat": now, "exp": now + timedelta(seconds=lifetime_seconds)}
    return jwt.encode(payload, _oauth_state_key(settings), algorithm="HS256")


def decode_oauth_state(settings: Settings, value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        payload: dict[str, Any] = jwt.decode(value, _oauth_state_key(settings), algorithms=["HS256"])
    except (jwt.PyJWTError, TypeError, ValueError):
        return None
    if payload.get("type") != OAUTH_STATE_TYPE:
        return None
    return payload
