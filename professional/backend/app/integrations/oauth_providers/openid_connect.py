"""Google and Microsoft OpenID Connect: authorization URL, code exchange and the ID token.

Ported from the old app/shared/auth/services/oauth_service.py (provider half). The ID
token comes straight from the provider's token endpoint over TLS, which OpenID Connect
Core 3.1.3.7 accepts in place of a signature check; issuer, audience, expiry and our
nonce are checked. Its e-mail is trusted only when the provider vouches for it: Google's
`email_verified`; Microsoft's `xms_edov`, or a personal Microsoft account.
`preferred_username` is never used.
"""

import base64
import hashlib
import time
from dataclasses import dataclass
from hmac import compare_digest
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import HTTPException

from app.core.config import Settings

GOOGLE = "google"
MICROSOFT = "microsoft"
PROVIDERS = (GOOGLE, MICROSOFT)

ID_TOKEN_LEEWAY_SECONDS = 120
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
# The tenant every personal Microsoft account signs in through.
MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"
TOKEN_EXCHANGE_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class ProviderIdentity:
    subject: str
    email: str | None
    email_verified: bool
    name: str


class OAuthRefusedError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def provider_label(provider: str) -> str:
    return "Google" if provider == GOOGLE else "Microsoft"


def provider_settings(settings: Settings, provider: str) -> tuple[str, str, str]:
    """(client id, client secret, redirect uri), or 503 when not configured."""
    if provider == GOOGLE:
        client_id = settings.google_client_id
        secret = settings.google_client_secret.get_secret_value()
        redirect_uri = settings.google_redirect_uri
    else:
        client_id = settings.microsoft_client_id
        secret = settings.microsoft_client_secret.get_secret_value()
        redirect_uri = settings.microsoft_redirect_uri
    if not client_id or not secret:
        raise HTTPException(status_code=503, detail=f"{provider_label(provider)} OAuth is not configured")
    return client_id, secret, redirect_uri


def pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")


def authorization_url(provider: str, client_id: str, redirect_uri: str, state: str, nonce: str, challenge: str) -> str:
    query: dict[str, str]
    if provider == GOOGLE:
        query = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "select_account",
        }
        base = "https://accounts.google.com/o/oauth2/v2/auth"
    else:
        query = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile User.Read",
            "response_mode": "query",
        }
        base = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    query.update({"state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"})
    return f"{base}?{urlencode(query)}"


def token_endpoint(provider: str) -> str:
    if provider == GOOGLE:
        return "https://oauth2.googleapis.com/token"
    return "https://login.microsoftonline.com/common/oauth2/v2.0/token"


async def exchange_code(
    provider: str, code: str, client_id: str, client_secret: str, redirect_uri: str, verifier: str
) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=TOKEN_EXCHANGE_TIMEOUT_SECONDS) as http:
            answer = await http.post(
                token_endpoint(provider),
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
            )
            answer.raise_for_status()
            tokens: dict[str, Any] = answer.json()
            return tokens
    except (httpx.HTTPError, ValueError):
        raise OAuthRefusedError(
            502, "OAUTH_PROVIDER_ERROR", "The provider did not accept this sign-in. Start it again."
        ) from None


def _claim_true(value: object) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1"})


def read_id_token(provider: str, id_token: str | None, client_id: str, nonce: str) -> ProviderIdentity:
    if not id_token:
        raise OAuthRefusedError(401, "OAUTH_ID_TOKEN_MISSING", "The provider did not return an identity token.")
    try:
        claims: dict[str, Any] = jwt.decode(id_token, options={"verify_signature": False})
    except (jwt.PyJWTError, TypeError, ValueError):
        raise OAuthRefusedError(
            401, "OAUTH_ID_TOKEN_INVALID", "The provider's identity token could not be read."
        ) from None

    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if client_id not in audiences or (len(audiences) > 1 and claims.get("azp") != client_id):
        raise OAuthRefusedError(401, "OAUTH_AUDIENCE_INVALID", "The identity token was not issued to this application.")
    try:
        expires = float(claims.get("exp"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        expires = 0.0
    if expires + ID_TOKEN_LEEWAY_SECONDS < time.time():
        raise OAuthRefusedError(401, "OAUTH_ID_TOKEN_EXPIRED", "The provider's identity token has expired.")
    if not compare_digest(str(claims.get("nonce") or ""), nonce):
        raise OAuthRefusedError(401, "OAUTH_NONCE_INVALID", "The identity token does not belong to this sign-in.")

    name = str(claims.get("name") or "")
    if provider == GOOGLE:
        if claims.get("iss") not in GOOGLE_ISSUERS or not claims.get("sub"):
            raise OAuthRefusedError(401, "OAUTH_ISSUER_INVALID", "The identity token was not issued by Google.")
        return ProviderIdentity(
            subject=str(claims["sub"]),
            email=claims.get("email"),
            email_verified=_claim_true(claims.get("email_verified")),
            name=name,
        )

    tenant = str(claims.get("tid") or "")
    object_id = str(claims.get("oid") or claims.get("sub") or "")
    if not tenant or not object_id or claims.get("iss") != f"https://login.microsoftonline.com/{tenant}/v2.0":
        raise OAuthRefusedError(401, "OAUTH_ISSUER_INVALID", "The identity token was not issued by Microsoft.")
    verified = tenant == MICROSOFT_CONSUMER_TENANT or _claim_true(claims.get("xms_edov"))
    return ProviderIdentity(
        subject=f"{tenant}:{object_id}", email=claims.get("email"), email_verified=verified, name=name
    )
