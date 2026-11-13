"""Technician sign-up, sign-in, sessions and passwords (the old Partner
app/technician/routes/auth_routes.py, and PUT /technicians/me/password from
technician_routes.py). Paths and answers unchanged, under /api/v1.
"""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.auth.dependencies import (
    app_settings,
    get_active_technician,
    get_auth_service,
    get_password_service,
    get_session_service,
    get_technician_session,
)
from app.core.config import Settings
from app.core.security.access_tokens import SCOPE_ONBOARDING, SCOPE_PARTNER, csrf_token_for, read_technician_access
from app.core.security.session_cookies import (
    TECHNICIAN,
    access_token_from,
    clear_session_cookies,
    client_info,
    refresh_token_from,
    set_session_cookies,
)
from app.modules.identity.auth_service import AuthService, technician_response
from app.modules.identity.models import PRINCIPAL_TECHNICIAN, Technician
from app.modules.identity.password_service import PasswordService
from app.modules.identity.schemas import (
    AuthResponse,
    CodeSentResponse,
    CurrentTechnicianResponse,
    EmailCodeRequest,
    MessageResponse,
    PasswordChangeRequest,
    PasswordLoginRequest,
    PasswordResetCodeResponse,
    PasswordResetRequest,
    PasswordResetVerifiedResponse,
    PasswordResetVerifyRequest,
    SignupVerifyRequest,
)
from app.modules.identity.session_service import (
    REFRESH_SUPERSEDED,
    SESSION_EXPIRED_MESSAGE,
    IssuedSession,
    SessionService,
)

router = APIRouter(prefix="/auth", tags=["Auth"])
technician_router = APIRouter(prefix="/technicians/me", tags=["Technician"])


def answer_with_session(
    response: Response, settings: Settings, auth: AuthService, technician: Technician, issued: IssuedSession
) -> AuthResponse:
    set_session_cookies(response, settings, TECHNICIAN, issued.access_token, issued.refresh_token)
    return auth.session_response(technician, issued.scope or "", issued.csrf_token)


def refused(settings: Settings, status_code: int, detail: Any, clear_cookies: bool = True) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    if clear_cookies:
        clear_session_cookies(response, settings, TECHNICIAN)
    return response


@router.post("/signup/send-code", response_model=CodeSentResponse)
def send_signup_code(
    payload: EmailCodeRequest, request: Request, auth: AuthService = Depends(get_auth_service)
) -> CodeSentResponse:
    return auth.send_signup_code(payload.email, client_info(request).ip_address)


@router.post("/signup/verify-code", response_model=AuthResponse)
def verify_signup_code(
    payload: SignupVerifyRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
) -> AuthResponse:
    technician = auth.verify_signup(payload.email, payload.phone, payload.code)
    # A registration session: the onboarding steps only, never the dashboard.
    issued = sessions.start_technician(technician.id, SCOPE_ONBOARDING, client_info(request))
    return answer_with_session(response, settings, auth, technician, issued)


# Sign-in is e-mail + password. The e-mail one-time code is for registration only.
@router.post("/login", response_model=AuthResponse)
def login(
    payload: PasswordLoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
) -> AuthResponse:
    client = client_info(request)
    technician = auth.login(payload.email, payload.password, client.ip_address)
    issued = sessions.start_technician(technician.id, SCOPE_PARTNER, client)
    return answer_with_session(response, settings, auth, technician, issued)


@router.post("/refresh", response_model=AuthResponse)
def refresh_session(
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    auth: AuthService = Depends(get_auth_service),
    sessions: SessionService = Depends(get_session_service),
) -> Any:
    """Rotate the technician session: the refresh cookie is exchanged for the next one."""
    refresh_token = refresh_token_from(request, settings, TECHNICIAN)
    if not refresh_token:
        return refused(settings, 401, SESSION_EXPIRED_MESSAGE)
    try:
        issued, technician = sessions.rotate(
            refresh_token, PRINCIPAL_TECHNICIAN, client_info(request), auth.require_session_technician
        )
    except HTTPException as error:
        # Superseded: another tab rotated this token a moment ago; keep the newer cookies.
        return refused(settings, error.status_code, error.detail, clear_cookies=error.detail != REFRESH_SUPERSEDED)
    return answer_with_session(response, settings, auth, technician, issued)


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> JSONResponse:
    """End the technician session on the server and clear its cookies."""
    refresh_token = refresh_token_from(request, settings, TECHNICIAN)
    if refresh_token:
        sessions.end_by_refresh_token(refresh_token, PRINCIPAL_TECHNICIAN)
    else:
        claims = read_technician_access(settings, access_token_from(request, settings, TECHNICIAN) or "")
        if claims is not None:
            sessions.end_family(claims.family_id)
    response = JSONResponse({"message": "Signed out."})
    clear_session_cookies(response, settings, TECHNICIAN)
    return response


# Forgot password: e-mail code -> short-lived reset token -> new password.
@router.post("/password-reset/send-code", response_model=PasswordResetCodeResponse)
def send_password_reset_code(
    payload: EmailCodeRequest,
    request: Request,
    background: BackgroundTasks,
    passwords: PasswordService = Depends(get_password_service),
) -> PasswordResetCodeResponse:
    return passwords.send_reset_code(
        payload.email, defer=background.add_task, client_address=client_info(request).ip_address
    )


@router.post("/password-reset/verify-code", response_model=PasswordResetVerifiedResponse)
def verify_password_reset_code(
    payload: PasswordResetVerifyRequest, passwords: PasswordService = Depends(get_password_service)
) -> PasswordResetVerifiedResponse:
    return passwords.verify_reset_code(payload.email, payload.code)


@router.post("/password-reset/reset", response_model=MessageResponse)
def reset_password(
    payload: PasswordResetRequest, passwords: PasswordService = Depends(get_password_service)
) -> MessageResponse:
    return passwords.reset(payload)


@router.get("/me", response_model=CurrentTechnicianResponse)
def read_current_technician(
    request: Request,
    settings: Settings = Depends(app_settings),
    session: tuple[Technician, str] = Depends(get_technician_session),
) -> CurrentTechnicianResponse:
    technician, scope = session
    claims = read_technician_access(settings, access_token_from(request, settings, TECHNICIAN) or "")
    csrf_token = csrf_token_for(settings, claims.family_id) if claims is not None else None
    return CurrentTechnicianResponse(
        **technician_response(technician, settings).model_dump(), session_type=scope, csrf_token=csrf_token
    )


@technician_router.put("/password", response_model=MessageResponse)
def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    settings: Settings = Depends(app_settings),
    technician: Technician = Depends(get_active_technician),
    passwords: PasswordService = Depends(get_password_service),
) -> MessageResponse:
    """Needs the current password. Every session signed in with the old password ends,
    this one included, so the technician signs in again with the new password."""
    answer = passwords.change(technician, payload)
    clear_session_cookies(response, settings, TECHNICIAN)
    return answer
