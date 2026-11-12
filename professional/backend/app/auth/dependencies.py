"""Who is calling, and may they (technical-architecture.md 7.4).

* enforce_route_access: mounted on every module router by app.api.v1.router. A route
  not in PUBLIC_ROUTES needs a live session; the builder checkout rule runs here too.
* current_principal / current_user: the signed-in account behind the request.
* require_roles / require_permission: role and permission checks for a route.

Sessions are read from the HttpOnly access cookie only; an Authorization header is not
a credential here (no caller of this API sends one).
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from hmac import compare_digest

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth.permissions import KNOWN_PERMISSIONS, permissions_for_role
from app.auth.public_routes import is_public
from app.core.config import Settings
from app.core.security.access_tokens import read_access_claims, token_digest
from app.core.security.csrf_protection import CSRF_FAILED, CSRF_HEADER, SAFE_METHODS
from app.core.security.session_cookies import API_PREFIX, access_token_from
from app.database.session import get_db
from app.modules.billing.signup_checkout import enforce as enforce_signup_checkout
from app.modules.identity.models import User, UserSession
from app.modules.identity.policies import session_role, suspended_message
from app.modules.identity.repository import SessionRepository
from app.modules.identity.session_service import SESSION_EXPIRED_MESSAGE, SessionService


def app_settings(request: Request) -> Settings:
    """The settings the running app was created with."""
    settings: Settings = request.app.state.settings
    return settings


@dataclass(frozen=True)
class Principal:
    user: User
    session: UserSession
    role: str
    permissions: frozenset[str]

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id


def authenticate_access_token(token: str | None, database: Session, settings: Settings) -> tuple[User, UserSession]:
    """The account and live session behind an access token, or the old HTTP errors."""
    claims = read_access_claims(settings, token) if token else None
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    session = SessionService(SessionRepository(database), settings).validate(claims)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=SESSION_EXPIRED_MESSAGE)
    user = database.get(User, claims.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # A suspension ends the sessions that already exist, on the very next request.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=suspended_message(user))
    return user, session


def authenticate_request(request: Request, database: Session, settings: Settings) -> Principal:
    user, session = authenticate_access_token(access_token_from(request, settings), database, settings)
    if request.method not in SAFE_METHODS:
        # The CSRF middleware has checked the token against the family; here it is also
        # matched against the live session row's stored hash.
        sent = request.headers.get(CSRF_HEADER) or ""
        if not sent or not compare_digest(token_digest(sent), session.csrf_secret_hash):
            raise HTTPException(status_code=403, detail={"code": "CSRF_FAILED", "message": CSRF_FAILED})
    role = session_role(user)
    return Principal(user=user, session=session, role=role, permissions=permissions_for_role(role))


def route_path(request: Request) -> str:
    """The path of the matched route as registered, without /api/v1."""
    route = request.scope.get("route")
    path = str(getattr(route, "path_format", request.url.path))
    return path.removeprefix(API_PREFIX)


# Routes whose old answer to a request with no session cookie at all was a different
# 401 message; kept so the web app sees the same text.
NO_SESSION_MESSAGES: dict[tuple[str, str], str] = {
    ("GET", "/files/{file_id}"): "Authentication required",
}


def enforce_route_access(
    request: Request, database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> None:
    """Every module route needs a live session unless it is in PUBLIC_ROUTES (AZ-01)."""
    path = route_path(request)
    if is_public(request.method, path):
        return
    message = NO_SESSION_MESSAGES.get((request.method.upper(), path))
    if message and not access_token_from(request, settings):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)
    principal = authenticate_request(request, database, settings)
    request.state.principal = principal
    enforce_signup_checkout(database, principal.user, request.url.path.removeprefix(API_PREFIX))


def current_principal(
    request: Request, database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> Principal:
    principal: Principal | None = getattr(request.state, "principal", None)
    if principal is None:
        principal = authenticate_request(request, database, settings)
        request.state.principal = principal
    return principal


def current_user(principal: Principal = Depends(current_principal)) -> User:
    return principal.user


def optional_user(
    request: Request, database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> User | None:
    """For public routes that also serve signed-in people: the account behind a valid
    session, else None. An expired or foreign cookie counts as signed out, not refused."""
    token = access_token_from(request, settings)
    if not token:
        return None
    try:
        user, _session = authenticate_access_token(token, database, settings)
    except HTTPException:
        return None
    return user


def require_roles(*roles: str) -> Callable[..., Principal]:
    """Dependency factory: the caller's session role must be one of `roles`."""
    allowed = frozenset(roles)

    def check(principal: Principal = Depends(current_principal)) -> Principal:
        if principal.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ROLE_NOT_ALLOWED")
        return principal

    return check


def require_permission(permission: str) -> Callable[..., Principal]:
    """Dependency factory: the caller's role must grant `permission` (section 7.2)."""
    if permission not in KNOWN_PERMISSIONS:
        # Raised at import time, so a mistyped permission breaks the build instead of
        # guarding nothing.
        raise ValueError(f"Unknown permission: {permission}")

    def check(principal: Principal = Depends(current_principal)) -> Principal:
        if permission not in principal.permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PERMISSION_DENIED")
        return principal

    return check
