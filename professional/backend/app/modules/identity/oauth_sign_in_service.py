"""Google and Microsoft sign-in (OpenID Connect, authorization code + PKCE). Ported from
the old oauth_service.py with the same rules:

* Start: a random state, nonce and PKCE verifier for this one sign-in are kept in a
  short-lived, signed, HttpOnly cookie; only state, nonce and the PKCE challenge go to
  the provider.
* Callback: the returned state must equal the cookie's, is spent on first use, and the
  cookie is cleared. The code is exchanged with the PKCE verifier.
* Account: found through the linked provider subject, never through a matching e-mail.
  An unlinked identity may register a NEW account (verified e-mail required), or be
  linked to an existing account only when that same account is already signed in in
  this browser and the verified e-mail is its own.
* Session: the ordinary session, as HttpOnly cookies on the redirect back to the web
  app. Nothing is put in the URL.
"""

import secrets
import threading
import time
import uuid
from datetime import UTC, datetime
from hmac import compare_digest
from typing import Any

from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.core.config import Settings
from app.core.security.access_tokens import decode_oauth_state, encode_oauth_state
from app.core.security.password_hashing import hash_secret
from app.core.security.session_cookies import clear_oauth_state_cookie, set_oauth_state_cookie, set_session_cookies
from app.integrations.oauth_providers.openid_connect import (
    OAuthRefusedError,
    ProviderIdentity,
    authorization_url,
    exchange_code,
    pkce_challenge,
    provider_settings,
    read_id_token,
)
from app.modules.accounts.models import BuilderProfile, EngineerProfile, OwnerProfile, SupplierProfile
from app.modules.identity.models import (
    DEFAULT_COUNTRY,
    MARKETPLACE_ROLES,
    ROLE_BUILDER,
    ROLE_ENGINEER,
    ROLE_OWNER,
    ROLE_PROFESSIONAL,
    ROLE_SUPPLIER,
    User,
    UserOAuthIdentity,
)
from app.modules.identity.policies import (
    GLOBAL_ADMIN_USE_WHATSAPP,
    PARTNER_ACCOUNT_MESSAGE,
    SUSPENDED_MESSAGE,
    is_global_super_admin,
)
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import normalize_role
from app.modules.identity.session_service import ClientInfo, SessionService

OAUTH_STATE_SECONDS = 600
STATE_INVALID_MESSAGE = "This sign-in could not be verified. Start it again from the sign-in page."
ACCOUNT_EXISTS_MESSAGE = (
    "An account with this email already exists. Sign in with your email and password; "
    "the provider can then be connected while you are signed in."
)

# States already answered in this process: refuses even a replay carrying a copy of the
# cookie (the cookie is cleared on the first answer and the provider's code is single-use).
_spent_states: dict[str, float] = {}
_spent_lock = threading.Lock()


def spend_state(state: str, expires_at: float) -> bool:
    now = time.time()
    with _spent_lock:
        for stale in [value for value, until in _spent_states.items() if until < now]:
            del _spent_states[stale]
        if state in _spent_states:
            return False
        _spent_states[state] = expires_at
        return True


def role_from_oauth_state(state_role: str | None) -> str:
    role = normalize_role(state_role or ROLE_OWNER)
    return role if role in MARKETPLACE_ROLES else ROLE_OWNER


def oauth_refusal_response(error: OAuthRefusedError, settings: Settings) -> JSONResponse:
    response = JSONResponse(
        status_code=error.status_code, content={"detail": {"code": error.code, "message": error.message}}
    )
    clear_oauth_state_cookie(response, settings)
    return response


def create_oauth_user(database: Session, email: str, name: str, role: str) -> User:
    """A new account for a verified provider e-mail nobody has registered. Staged; the
    caller commits it together with its identity link."""
    user = User(
        name=name or email.split("@")[0],
        email=email,
        email_verified_at=datetime.now(UTC),
        phone="",
        password_hash=hash_secret(uuid.uuid4().hex),
        role=role,
        address="",
        pincode="",
        country_code=DEFAULT_COUNTRY,
    )
    database.add(user)
    database.flush()
    if role == ROLE_OWNER:
        database.add(
            OwnerProfile(
                user_id=user.id,
                building_type="RESIDENTIAL",
                construction_type="CONTRACTOR",
                budget_amount=0,
                land_area=0,
                floors=1,
            )
        )
    elif role == ROLE_BUILDER:
        database.add(
            BuilderProfile(
                user_id=user.id, company_name=name or "Construction Company", license_number="", experience_years=0
            )
        )
    elif role == ROLE_SUPPLIER:
        database.add(SupplierProfile(user_id=user.id, store_name=name or "Supplier Store", categories=""))
    elif role == ROLE_ENGINEER:
        database.add(EngineerProfile(user_id=user.id, qualification="", specialization="", experience_years=0))
    return user


def resolve_oauth_account(
    database: Session, provider: str, identity: ProviderIdentity, role: str, link_user_id: uuid.UUID | None
) -> User:
    users = UserRepository(database)
    now = datetime.now(UTC)
    link = users.find_oauth_identity(provider, identity.subject)
    if link is not None:
        linked_user = users.get(link.user_id)
        if linked_user is None:
            raise OAuthRefusedError(401, "OAUTH_ACCOUNT_MISSING", "The linked account no longer exists.")
        link.last_login_at = now
        database.commit()
        return linked_user

    if not identity.email or not identity.email_verified:
        raise OAuthRefusedError(
            403, "OAUTH_EMAIL_UNVERIFIED", "The provider did not confirm that this email address is verified."
        )
    email = identity.email.strip().lower()
    existing = users.get_by_email(email)
    if existing is None:
        user = create_oauth_user(database, email=email, name=identity.name, role=role)
    elif link_user_id is not None and existing.id == link_user_id:
        if users.find_oauth_identity_for_user(provider, existing.id) is not None:
            raise OAuthRefusedError(
                409, "OAUTH_PROVIDER_ALREADY_LINKED", "Another account from this provider is already connected."
            )
        user = existing
    else:
        raise OAuthRefusedError(409, "OAUTH_ACCOUNT_EXISTS", ACCOUNT_EXISTS_MESSAGE)

    database.add(
        UserOAuthIdentity(
            user_id=user.id, provider=provider, subject=identity.subject, email=email, created_at=now, last_login_at=now
        )
    )
    database.commit()
    database.refresh(user)
    return user


class OAuthSignInService:
    def __init__(self, database: Session, settings: Settings, sessions: SessionService) -> None:
        self.database = database
        self.settings = settings
        self.sessions = sessions

    def start(self, provider: str, role: str, link_user_id: uuid.UUID | None) -> RedirectResponse:
        client_id, _secret, redirect_uri = provider_settings(self.settings, provider)
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        response = RedirectResponse(
            authorization_url(provider, client_id, redirect_uri, state, nonce, pkce_challenge(verifier)),
            status_code=302,
        )
        claims: dict[str, Any] = {
            "prov": provider,
            "st": state,
            "non": nonce,
            "cv": verifier,
            "role": role_from_oauth_state(role),
            "lnk": str(link_user_id) if link_user_id else None,
        }
        set_oauth_state_cookie(
            response, self.settings, encode_oauth_state(self.settings, claims, OAUTH_STATE_SECONDS), OAUTH_STATE_SECONDS
        )
        return response

    async def complete(
        self, provider: str, code: str, state: str | None, state_cookie: str | None, client: ClientInfo
    ) -> Response:
        client_id, client_secret, redirect_uri = provider_settings(self.settings, provider)
        try:
            transaction = decode_oauth_state(self.settings, state_cookie)
            if (
                transaction is None
                or not all(transaction.get(key) for key in ("prov", "st", "non", "cv"))
                or transaction["prov"] != provider
                or not state
                or not compare_digest(state, transaction["st"])
            ):
                raise OAuthRefusedError(400, "OAUTH_STATE_INVALID", STATE_INVALID_MESSAGE)
            if not spend_state(transaction["st"], float(transaction["exp"])):
                raise OAuthRefusedError(400, "OAUTH_STATE_INVALID", STATE_INVALID_MESSAGE)

            tokens = await exchange_code(provider, code, client_id, client_secret, redirect_uri, transaction["cv"])
            identity = read_id_token(provider, tokens.get("id_token"), client_id, transaction["non"])
            link_user_id = uuid.UUID(transaction["lnk"]) if transaction.get("lnk") else None
            user = resolve_oauth_account(
                self.database, provider, identity, role_from_oauth_state(transaction.get("role")), link_user_id
            )
            return self.redirect_with_session(user, client)
        except OAuthRefusedError as error:
            return oauth_refusal_response(error, self.settings)

    def redirect_with_session(self, user: User, client: ClientInfo) -> RedirectResponse:
        if user.role == ROLE_PROFESSIONAL:
            raise OAuthRefusedError(403, "OAUTH_ACCOUNT_NOT_ALLOWED", PARTNER_ACCOUNT_MESSAGE)
        if is_global_super_admin(user):
            raise OAuthRefusedError(403, "OAUTH_ACCOUNT_NOT_ALLOWED", GLOBAL_ADMIN_USE_WHATSAPP)
        if not user.is_active:
            raise OAuthRefusedError(403, "ACCOUNT_SUSPENDED", SUSPENDED_MESSAGE)
        issued = self.sessions.start(user, client)
        response = RedirectResponse(f"{self.settings.frontend_origin}/oauth/callback", status_code=302)
        set_session_cookies(response, self.settings, issued.access_token, issued.refresh_token, issued.expires_at)
        clear_oauth_state_cookie(response, self.settings)
        return response
