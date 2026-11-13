"""Identity endpoints under /api/v1. Paths, bodies and answers are the old /auth/* ones.

Public routes are listed in app/auth/public_routes.py; every other route here needs a
live session (enforced for the whole router by app.api.v1.router).
"""

import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import (
    Principal,
    app_settings,
    authenticate_access_token,
    current_principal,
    current_user,
)
from app.core.client_address import visitor_address
from app.core.config import Settings
from app.core.security.access_tokens import (
    create_partner_handoff_token,
    csrf_token_for,
    partner_handoff_configured,
    read_access_claims,
)
from app.core.security.session_cookies import (
    access_token_from,
    clear_session_cookies,
    oauth_state_from,
    refresh_token_from,
    set_session_cookies,
)
from app.database.session import get_db
from app.integrations.email.email_sender import EmailSender
from app.integrations.oauth_providers.openid_connect import GOOGLE, MICROSOFT
from app.modules.identity import login_throttle
from app.modules.identity.email_verification_service import EmailVerificationService
from app.modules.identity.models import User
from app.modules.identity.oauth_sign_in_service import OAuthSignInService
from app.modules.identity.phone_verification_service import LOGIN, PhoneVerificationService, send_welcome_message
from app.modules.identity.policies import HANDOFF_NOT_ALLOWED, can_create_partner_handoff
from app.modules.identity.repository import SessionRepository
from app.modules.identity.schemas import (
    AuthResponse,
    EmailCodeRequest,
    EmailCodeVerify,
    LoginRequest,
    PartnerHandoffResponse,
    PasswordResetComplete,
    PasswordResetRequest,
    PasswordResetVerify,
    PhoneCodeRequest,
    PhoneCodeVerify,
    PhoneLoginVerify,
    SessionList,
    SessionSummary,
    SignupRequest,
)
from app.modules.identity.service import AuthService, dev_account_recovery_on
from app.modules.identity.session_service import REFRESH_SUPERSEDED, ClientInfo, IssuedSession, SessionService

router = APIRouter(prefix="/auth", tags=["Auth"])

SESSION_EXPIRED = "Session expired. Please sign in again."
SESSION_LIST_OFF = "Not Found"


# ---- service wiring ----


def get_email_sender(settings: Settings = Depends(app_settings)) -> EmailSender:
    return EmailSender(settings)


def get_session_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> SessionService:
    return SessionService(SessionRepository(database), settings)


def get_email_verification_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    email: EmailSender = Depends(get_email_sender),
) -> EmailVerificationService:
    return EmailVerificationService(database, settings, email)


def get_phone_verification_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> PhoneVerificationService:
    return PhoneVerificationService(database, settings)


def get_auth_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    email: EmailSender = Depends(get_email_sender),
    email_verifications: EmailVerificationService = Depends(get_email_verification_service),
    phone_verifications: PhoneVerificationService = Depends(get_phone_verification_service),
) -> AuthService:
    return AuthService(database, settings, email, email_verifications, phone_verifications)


def get_oauth_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> OAuthSignInService:
    return OAuthSignInService(database, settings, sessions)


# ---- helpers ----


def client_info(request: Request) -> ClientInfo:
    return ClientInfo(
        user_agent=request.headers.get("user-agent"),
        ip_address=visitor_address(request, app_settings(request).trusted_proxy_ips),
    )


def answer_with_session(
    response: Response, settings: Settings, auth: AuthService, user: User, issued: IssuedSession
) -> dict[str, Any]:
    set_session_cookies(response, settings, issued.access_token, issued.refresh_token, issued.expires_at)
    return auth.session_response(user, issued.csrf_token)


def refused(status_code: int, detail: Any, settings: Settings, clear_cookies: bool = True) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    if clear_cookies:
        clear_session_cookies(response, settings)
    return response


# ---- e-mail codes ----


@router.post("/email/send-code")
def send_email_verification_code(
    payload: EmailCodeRequest,
    request: Request,
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, Any]:
    return verifications.send_code(payload.email, visitor_address(request, app_settings(request).trusted_proxy_ips))


@router.post("/email/verify-code")
def verify_email_verification_code(
    payload: EmailCodeVerify, verifications: EmailVerificationService = Depends(get_email_verification_service)
) -> dict[str, Any]:
    return verifications.verify_code(payload.email, payload.code)


@router.post("/email/profile/send-code")
def send_profile_email_code(
    payload: EmailCodeRequest,
    request: Request,
    user: User = Depends(current_user),
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, Any]:
    """Profile Settings: e-mail a code to the address the signed-in account wants."""
    return verifications.send_profile_code(
        user, payload.email, visitor_address(request, app_settings(request).trusted_proxy_ips)
    )


@router.post("/email/profile/verify-code")
def verify_profile_email_code(
    payload: EmailCodeVerify,
    user: User = Depends(current_user),
    auth: AuthService = Depends(get_auth_service),
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, Any]:
    """Profile Settings: a correct code saves the address on this account, verified."""
    verifications.verify_profile_code(user, payload.email, payload.code)
    return {"user": auth.user_response(user)}


# ---- WhatsApp codes ----


@router.get("/phone/config")
def read_phone_verification_config(
    verifications: PhoneVerificationService = Depends(get_phone_verification_service),
) -> dict[str, Any]:
    return verifications.public_config()


@router.get("/recovery/config")
def read_account_recovery_config(settings: Settings = Depends(app_settings)) -> dict[str, bool]:
    """Whether this server shows the development-only account recovery page."""
    return {"enabled": dev_account_recovery_on(settings)}


@router.post("/phone/send-code")
def send_phone_verification_code(
    payload: PhoneCodeRequest,
    request: Request,
    settings: Settings = Depends(app_settings),
    verifications: PhoneVerificationService = Depends(get_phone_verification_service),
) -> dict[str, Any]:
    return verifications.send_code(payload.phone, visitor_address(request, settings.trusted_proxy_ips))


@router.post("/phone/verify-code")
def verify_phone_verification_code(
    payload: PhoneCodeVerify, verifications: PhoneVerificationService = Depends(get_phone_verification_service)
) -> dict[str, Any]:
    return verifications.verify_code(payload.phone, payload.code)


@router.post("/phone/login/send-code")
def send_phone_login_code(
    payload: PhoneCodeRequest,
    request: Request,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    verifications: PhoneVerificationService = Depends(get_phone_verification_service),
) -> dict[str, Any]:
    """A WhatsApp sign-in code, sent only to a number that belongs to exactly one account
    allowed to sign in: 404 not registered, 403 not allowed, 409 ambiguous, 422
    malformed, 429 limits."""
    return verifications.send_code(
        payload.phone,
        visitor_address(request, settings.trusted_proxy_ips),
        purpose=LOGIN,
        login_check=auth.login_account_for_phone,
    )


@router.post("/phone/login/verify-code", response_model=AuthResponse)
def verify_phone_login_code(
    payload: PhoneLoginVerify,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
) -> dict[str, Any]:
    user = auth.login_with_phone(payload.phone, payload.code)
    return answer_with_session(response, settings, auth, user, sessions.start(user, client_info(request)))


# ---- sign-up, sign-in, sign-out ----


@router.post("/signup", response_model=AuthResponse)
def signup_user(
    payload: SignupRequest,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
    phone_verifications: PhoneVerificationService = Depends(get_phone_verification_service),
) -> dict[str, Any]:
    user = auth.signup(payload)
    # Queued only once the account is committed, and run after the reply.
    if phone_verifications.required():
        background.add_task(send_welcome_message, user.phone, user.name, settings)
    return answer_with_session(response, settings, auth, user, sessions.start(user, client_info(request)))


@router.post("/password/forgot")
def start_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, Any]:
    return verifications.send_reset_code(
        payload.email, visitor_address(request, app_settings(request).trusted_proxy_ips)
    )


@router.post("/password/verify-code")
def verify_password_reset_code(
    payload: PasswordResetVerify,
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, Any]:
    return verifications.verify_reset_code(payload.email, payload.code)


@router.post("/password/reset")
def finish_password_reset(
    payload: PasswordResetComplete,
    verifications: EmailVerificationService = Depends(get_email_verification_service),
) -> dict[str, bool]:
    verifications.reset_password(payload.email, payload.password)
    return {"reset": True}


@router.post("/login", response_model=AuthResponse)
def login_user(
    payload: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    address = visitor_address(request, settings.trusted_proxy_ips)
    login_throttle.ensure_allowed(database, settings, payload.email, address)
    try:
        user = auth.login(payload.email, payload.password)
    except HTTPException as error:
        if error.status_code == 401:
            database.rollback()
            login_throttle.record_failure(database, payload.email, address)
        raise
    login_throttle.record_success(database, payload.email)
    return answer_with_session(response, settings, auth, user, sessions.start(user, client_info(request)))


@router.post("/refresh", response_model=AuthResponse)
def refresh_access_token(
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
) -> Any:
    """Rotate the session: the refresh cookie is exchanged for the next one."""
    refresh_token = refresh_token_from(request, settings)
    if not refresh_token:
        return refused(401, SESSION_EXPIRED, settings)
    try:
        issued, user = sessions.rotate(refresh_token, client_info(request), auth.require_session_user)
    except HTTPException as error:
        # Superseded: another tab rotated this token a moment ago and the browser already
        # holds the newer cookies, which must not be cleared.
        return refused(error.status_code, error.detail, settings, clear_cookies=error.detail != REFRESH_SUPERSEDED)
    return answer_with_session(response, settings, auth, user, issued)


@router.post("/logout")
def logout_user(
    request: Request,
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> JSONResponse:
    """End this session on the server and clear its cookies, with whichever cookie is
    still present: the refresh cookie ends its family; an access cookie alone ends the
    family it names."""
    refresh_token = refresh_token_from(request, settings)
    if refresh_token:
        sessions.end_by_refresh_token(refresh_token)
    else:
        claims = read_access_claims(settings, access_token_from(request, settings) or "")
        if claims is not None:
            sessions.end_family(claims.family_id)
    response = JSONResponse({"signed_out": True})
    clear_session_cookies(response, settings)
    return response


@router.get("/session", response_model=AuthResponse)
def read_current_session(
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
) -> dict[str, Any]:
    """Who is signed in, and this session's CSRF token (after a page reload)."""
    return auth.session_response(principal.user, csrf_token_for(settings, principal.session.token_family_id))


# ---- the account's own sign-ins (section 6.5; off unless SESSION_LIST_ENABLED) ----


@router.get("/sessions", response_model=SessionList)
def list_my_sessions(
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> SessionList:
    if not settings.session_list_enabled:
        raise HTTPException(status_code=404, detail=SESSION_LIST_OFF)
    return SessionList(
        items=[
            SessionSummary(
                id=row.token_family_id,
                user_agent=row.user_agent,
                ip_address=str(row.ip_address) if row.ip_address else None,
                last_used_at=row.last_used_at,
                expires_at=row.expires_at,
                is_current=row.token_family_id == principal.session.token_family_id,
            )
            for row in sessions.live_sessions_for(principal.user_id)
        ]
    )


@router.delete("/sessions/{session_id}")
def revoke_my_session(
    session_id: uuid.UUID,
    principal: Principal = Depends(current_principal),
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> dict[str, bool]:
    """End one of the account's own sign-ins. Another account's id answers 404."""
    if not settings.session_list_enabled:
        raise HTTPException(status_code=404, detail=SESSION_LIST_OFF)
    if not sessions.end_family_of_user(principal.user_id, session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"revoked": True}


# ---- Book Technician hand-off to Partner ----


@router.post("/partner-handoff", response_model=PartnerHandoffResponse)
def create_partner_handoff(
    user: User = Depends(current_user), settings: Settings = Depends(app_settings)
) -> PartnerHandoffResponse:
    """A one-time, minute-long ES256 proof of this account for the Book Technician
    window. Partner exchanges it once for a session of its own and decides from the
    database, on every request, which accounts may book."""
    if not partner_handoff_configured(settings):
        raise HTTPException(status_code=503, detail="Book Technician is not configured on this server.")
    if not can_create_partner_handoff(user):
        raise HTTPException(status_code=403, detail=HANDOFF_NOT_ALLOWED)
    return PartnerHandoffResponse(
        handoff_token=create_partner_handoff_token(settings, user.id),
        expires_in_seconds=settings.partner_handoff_seconds,
    )


# ---- Google and Microsoft sign-in ----


def signed_in_user_id(request: Request, database: Session, settings: Settings) -> uuid.UUID | None:
    """The account already signed in in this browser, if any: only that account can have
    a provider connected to it."""
    token = access_token_from(request, settings)
    if not token:
        return None
    try:
        user, _session = authenticate_access_token(token, database, settings)
    except HTTPException:
        return None
    return user.id


@router.get("/oauth/google/start")
def start_google_oauth(
    request: Request,
    role: str = Query(default="OWNER"),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    service: OAuthSignInService = Depends(get_oauth_service),
) -> Response:
    return service.start(GOOGLE, role, signed_in_user_id(request, database, settings))


@router.get("/oauth/google/callback")
async def complete_google_oauth(
    request: Request,
    code: str,
    state: str | None = None,
    settings: Settings = Depends(app_settings),
    service: OAuthSignInService = Depends(get_oauth_service),
) -> Response:
    return await service.complete(GOOGLE, code, state, oauth_state_from(request, settings), client_info(request))


@router.get("/oauth/microsoft/start")
def start_microsoft_oauth(
    request: Request,
    role: str = Query(default="OWNER"),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    service: OAuthSignInService = Depends(get_oauth_service),
) -> Response:
    return service.start(MICROSOFT, role, signed_in_user_id(request, database, settings))


@router.get("/oauth/microsoft/callback")
async def complete_microsoft_oauth(
    request: Request,
    code: str,
    state: str | None = None,
    settings: Settings = Depends(app_settings),
    service: OAuthSignInService = Depends(get_oauth_service),
) -> Response:
    return await service.complete(MICROSOFT, code, state, oauth_state_from(request, settings), client_info(request))
