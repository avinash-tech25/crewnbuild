"""Partner's tokens, and the check of Professional's Book Technician hand-off.

Partner's own tokens are HS256 JWTs under JWT_SECRET_KEY with `iss` and `aud` both
`partner`, so a token of another application never passes as a Partner token:

* technician access token (`type: access`) with a `scope`: `onboarding` (the
  registration session from the sign-up e-mail code, which reaches the onboarding
  steps only) or `partner` (signed in with e-mail and password: the dashboard);
* requester access token (`type: requester`), the booking session a House Owner or Site
  Engineer gets for a hand-off. It cannot pass as a technician token, nor the reverse;
* password reset token (`type: password_reset`), bound to the password hash current
  when it was issued, so it stops working when the password changes.

Every access token names its server-side session (`sid`) and session family (`fam`) and
is honoured only while that session is live (modules/identity/session_service.py).
Refresh tokens are opaque random values, stored only as a SHA-256 verifier.

The hand-off (read_professional_handoff) is signed by Professional with its ES256 (P-256)
private key; Partner holds only the public key, so it can check a hand-off but never
mint one. It must be ES256, from `iss=professional`, for `aud=partner`, of type
`partner_handoff`, carry a `jti`, and live at most 60 seconds (`exp - iat`). It carries
no role: who may book is read from Professional's view on every request. The `jti` is
recorded with the session it starts under a unique constraint, so a hand-off is used once.
"""

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import Settings

PARTNER_ISSUER = "partner"
PARTNER_AUDIENCE = "partner"
TOKEN_ACCESS = "access"  # noqa: S105 a token type name, not a secret
TOKEN_REQUESTER = "requester"  # noqa: S105 a token type name, not a secret
TOKEN_PASSWORD_RESET = "password_reset"  # noqa: S105 a token type name, not a secret

PROFESSIONAL_ISSUER = "professional"
TOKEN_PARTNER_HANDOFF = "partner_handoff"  # noqa: S105 a token type name, not a secret
HANDOFF_ALGORITHM = "ES256"

SCOPE_ONBOARDING = "onboarding"
SCOPE_PARTNER = "partner"
TECHNICIAN_SCOPES = (SCOPE_ONBOARDING, SCOPE_PARTNER)


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    family_id: uuid.UUID
    scope: str | None


def _signing_key(settings: Settings) -> str:
    return settings.jwt_secret_key.get_secret_value()


def _encode(
    settings: Settings,
    subject: uuid.UUID,
    token_type: str,
    session_id: uuid.UUID,
    family_id: uuid.UUID,
    scope: str | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "sub": str(subject),
        "type": token_type,
        "iss": PARTNER_ISSUER,
        "aud": PARTNER_AUDIENCE,
        "sid": str(session_id),
        "fam": str(family_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    if scope:
        payload["scope"] = scope
    return jwt.encode(payload, _signing_key(settings), algorithm=settings.jwt_algorithm)


def create_access_token(
    settings: Settings, user_id: uuid.UUID, scope: str, session_id: uuid.UUID, family_id: uuid.UUID
) -> str:
    """A technician access token for one server-side session."""
    return _encode(settings, user_id, TOKEN_ACCESS, session_id, family_id, scope)


def create_requester_access_token(
    settings: Settings, requester_id: uuid.UUID, session_id: uuid.UUID, family_id: uuid.UUID
) -> str:
    """A booking (requester) access token for one server-side session."""
    return _encode(settings, requester_id, TOKEN_REQUESTER, session_id, family_id)


def _read_access(settings: Settings, token: str, expected_type: str, allow_expired: bool) -> AccessClaims | None:
    try:
        payload = jwt.decode(
            token,
            _signing_key(settings),
            algorithms=[settings.jwt_algorithm],
            issuer=PARTNER_ISSUER,
            audience=PARTNER_AUDIENCE,
            options={"verify_exp": not allow_expired, "require": ["sub", "sid", "fam", "exp", "iss", "aud"]},
        )
        if payload.get("type") != expected_type:
            return None
        return AccessClaims(
            user_id=uuid.UUID(str(payload["sub"])),
            session_id=uuid.UUID(str(payload["sid"])),
            family_id=uuid.UUID(str(payload["fam"])),
            scope=payload.get("scope"),
        )
    except (jwt.PyJWTError, TypeError, ValueError, KeyError):
        return None


def read_technician_access(settings: Settings, token: str, allow_expired: bool = False) -> AccessClaims | None:
    """The claims of a valid technician access token with a known scope, or None. Whether
    its session is still live is the caller's check, against the database."""
    claims = _read_access(settings, token, TOKEN_ACCESS, allow_expired)
    return claims if claims is not None and claims.scope in TECHNICIAN_SCOPES else None


def read_requester_access(settings: Settings, token: str, allow_expired: bool = False) -> AccessClaims | None:
    claims = _read_access(settings, token, TOKEN_REQUESTER, allow_expired)
    return claims if claims is not None and claims.scope is None else None


def new_refresh_token() -> str:
    """An opaque refresh token: 256 random bits. Only its digest is ever stored."""
    return secrets.token_urlsafe(32)


def token_digest(value: str) -> str:
    """The SHA-256 verifier stored for a random session token."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def csrf_token_for(settings: Settings, family_id: uuid.UUID) -> str:
    """The CSRF token of a session family: an HMAC under a key derived apart from the
    signing key. Derived, not stored, and useless as a credential."""
    key = hashlib.sha256(b"partner-csrf:" + _signing_key(settings).encode("utf-8")).digest()
    return hmac.new(key, str(family_id).encode("utf-8"), hashlib.sha256).hexdigest()


def password_binding(settings: Settings, password_hash: str | None) -> str:
    """An opaque fingerprint of the account's current password hash. A reset token carries
    it, so the token stops working the moment the password changes."""
    key = hashlib.sha256(b"partner-password-reset:" + _signing_key(settings).encode("utf-8")).digest()
    return hmac.new(key, (password_hash or "").encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def create_password_reset_token(settings: Settings, user_id: uuid.UUID, password_hash: str | None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": TOKEN_PASSWORD_RESET,
        "iss": PARTNER_ISSUER,
        "aud": PARTNER_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(minutes=settings.password_reset_token_minutes),
        "pwb": password_binding(settings, password_hash),
    }
    return jwt.encode(payload, _signing_key(settings), algorithm=settings.jwt_algorithm)


def read_password_reset_token(settings: Settings, token: str) -> tuple[uuid.UUID, str] | None:
    """(account id, password binding), or None for anything not a live reset token."""
    try:
        payload = jwt.decode(
            token,
            _signing_key(settings),
            algorithms=[settings.jwt_algorithm],
            issuer=PARTNER_ISSUER,
            audience=PARTNER_AUDIENCE,
        )
        if payload.get("type") != TOKEN_PASSWORD_RESET or not payload.get("pwb"):
            return None
        return uuid.UUID(str(payload["sub"])), str(payload["pwb"])
    except (jwt.PyJWTError, TypeError, ValueError, KeyError):
        return None


def read_professional_handoff(settings: Settings, token: str) -> tuple[uuid.UUID, str] | None:
    """(Professional account id, hand-off id) of a valid one-time hand-off, or None.

    Only ES256 with the configured public key: a token signed with any shared secret
    (HS256), Professional's own access tokens included, is refused, as is one from
    another issuer or for another audience, or one that lives longer than the hand-off
    lifetime. A role claim, if any, is never read."""
    public_key = settings.professional_handoff_public_key
    if not public_key or "PRIVATE" in public_key.upper():
        return None
    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[HANDOFF_ALGORITHM],
            audience=PARTNER_AUDIENCE,
            issuer=PROFESSIONAL_ISSUER,
            options={"require": ["sub", "jti", "iat", "exp", "iss", "aud"]},
        )
        if payload.get("type") != TOKEN_PARTNER_HANDOFF:
            return None
        lifetime = int(payload["exp"]) - int(payload["iat"])
        jti = str(payload["jti"])[:64]  # the session column's length, as before
        if not 0 < lifetime <= settings.handoff_max_seconds or not jti:
            return None
        return uuid.UUID(str(payload["sub"])), jti
    except (jwt.PyJWTError, TypeError, ValueError, KeyError):
        return None
