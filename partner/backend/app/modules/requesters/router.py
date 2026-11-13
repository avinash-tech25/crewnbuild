"""The booking (requester) session (the old Partner app/requester/routes/requester_routes.py,
session part; the bookings come with part 2). Paths and answers unchanged, under /api/v1.

    POST /requester/session   exchange Professional's one-time hand-off for a session
    GET  /requester/session   the session in progress and its CSRF token
    POST /requester/refresh   rotate the session within its fixed lifetime
    POST /requester/logout    end the session
    GET  /requester/me        who is booking
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.auth.dependencies import (
    app_settings,
    get_current_requester,
    get_requester_identity_service,
    get_session_service,
)
from app.core.config import Settings
from app.core.security.access_tokens import csrf_token_for, read_requester_access
from app.core.security.session_cookies import (
    REQUESTER,
    access_token_from,
    clear_session_cookies,
    client_info,
    refresh_token_from,
    set_session_cookies,
)
from app.modules.identity.models import PRINCIPAL_REQUESTER
from app.modules.identity.session_service import REFRESH_SUPERSEDED, SessionService
from app.modules.requesters.repository import Requester
from app.modules.requesters.schemas import RequesterProfile, RequesterSessionRequest, RequesterSessionResponse
from app.modules.requesters.service import SESSION_EXPIRED_MESSAGE, RequesterIdentityService, requester_profile

router = APIRouter(prefix="/requester", tags=["Booking (House Owner / Site Engineer)"])


def refused_requester(settings: Settings, status_code: int, detail: Any, clear_cookies: bool = True) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    if clear_cookies:
        clear_session_cookies(response, settings, REQUESTER)
    return response


@router.post("/session", response_model=RequesterSessionResponse)
def start_requester_session(
    payload: RequesterSessionRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    identity: RequesterIdentityService = Depends(get_requester_identity_service),
    sessions: SessionService = Depends(get_session_service),
) -> RequesterSessionResponse:
    """Exchange Professional's one-time hand-off for Partner's own booking session (cookies)."""
    account, role, handoff_id = identity.verify_handoff(payload.handoff_token)
    issued = sessions.start_requester(account.id, handoff_id, client_info(request))
    set_session_cookies(response, settings, REQUESTER, issued.access_token, issued.refresh_token)
    return identity.session_response(account, role, issued.csrf_token)


@router.get("/session", response_model=RequesterSessionResponse)
def read_requester_session(
    request: Request,
    settings: Settings = Depends(app_settings),
    requester: tuple[Requester, str] = Depends(get_current_requester),
    identity: RequesterIdentityService = Depends(get_requester_identity_service),
) -> RequesterSessionResponse:
    """The booking session in progress and its CSRF token (after a page reload)."""
    account, role = requester
    claims = read_requester_access(settings, access_token_from(request, settings, REQUESTER) or "")
    return identity.session_response(account, role, csrf_token_for(settings, claims.family_id) if claims else "")


@router.post("/refresh", response_model=RequesterSessionResponse)
def refresh_requester_session(
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    identity: RequesterIdentityService = Depends(get_requester_identity_service),
    sessions: SessionService = Depends(get_session_service),
) -> Any:
    """Rotate the booking session within its fixed lifetime (it is never extended)."""
    refresh_token = refresh_token_from(request, settings, REQUESTER)
    if not refresh_token:
        return refused_requester(settings, 401, SESSION_EXPIRED_MESSAGE)
    try:
        issued, (account, role) = sessions.rotate(
            refresh_token, PRINCIPAL_REQUESTER, client_info(request), identity.resolve_account
        )
    except HTTPException as error:
        return refused_requester(
            settings, error.status_code, error.detail, clear_cookies=error.detail != REFRESH_SUPERSEDED
        )
    set_session_cookies(response, settings, REQUESTER, issued.access_token, issued.refresh_token)
    return identity.session_response(account, role, issued.csrf_token)


@router.post("/logout")
def end_requester_session(
    request: Request,
    settings: Settings = Depends(app_settings),
    sessions: SessionService = Depends(get_session_service),
) -> JSONResponse:
    """End the booking session on the server and clear its cookies."""
    refresh_token = refresh_token_from(request, settings, REQUESTER)
    if refresh_token:
        sessions.end_by_refresh_token(refresh_token, PRINCIPAL_REQUESTER)
    else:
        claims = read_requester_access(settings, access_token_from(request, settings, REQUESTER) or "")
        if claims is not None:
            sessions.end_family(claims.family_id)
    response = JSONResponse({"signed_out": True})
    clear_session_cookies(response, settings, REQUESTER)
    return response


@router.get("/me", response_model=RequesterProfile)
def read_requester(requester: tuple[Requester, str] = Depends(get_current_requester)) -> RequesterProfile:
    account, role = requester
    return requester_profile(account, role)
