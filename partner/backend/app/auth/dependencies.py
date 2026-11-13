"""Who is calling: the request dependencies of both principals (the old Partner
app/dependencies/dependencies.py, identity part).

Sessions are cookie-only: an Authorization header is never read (the old Bearer path is
gone). Every request re-checks its server-side session, and the account behind it:

* technician  the live session row, then the technician (a suspension ends it at once);
* requester   the live session row, then Professional's requester view: still ACTIVE
              and still a House Owner or a Site Engineer (re-read on every request).
"""

from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.access_tokens import SCOPE_PARTNER, read_requester_access, read_technician_access
from app.core.security.session_cookies import REQUESTER, TECHNICIAN, access_token_from
from app.database.session import get_db
from app.integrations.email.email_sender import EmailSender, SmtpEmailSender
from app.modules.identity.auth_service import SUSPENDED_MESSAGE, AuthService
from app.modules.identity.models import PRINCIPAL_REQUESTER, PRINCIPAL_TECHNICIAN, STEP_COMPLETE, Technician
from app.modules.identity.otp_service import OtpService
from app.modules.identity.password_service import PasswordService
from app.modules.identity.repository import TechnicianRepository
from app.modules.identity.session_service import SESSION_EXPIRED_MESSAGE, SessionService
from app.modules.requesters.repository import Requester, RequesterRepository
from app.modules.requesters.service import SESSION_EXPIRED_MESSAGE as REQUESTER_SESSION_EXPIRED
from app.modules.requesters.service import RequesterIdentityService

if TYPE_CHECKING:
    from app.modules.catalog.service import CatalogService


def app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_email_sender(settings: Settings = Depends(app_settings)) -> EmailSender:
    return SmtpEmailSender(settings)


def get_otp_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    email: EmailSender = Depends(get_email_sender),
) -> OtpService:
    return OtpService(database, settings, email)


def get_auth_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    otps: OtpService = Depends(get_otp_service),
) -> AuthService:
    return AuthService(database, settings, otps)


def get_password_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    otps: OtpService = Depends(get_otp_service),
) -> PasswordService:
    return PasswordService(database, settings, otps)


def get_session_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> SessionService:
    return SessionService(database, settings)


def get_requester_identity_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> RequesterIdentityService:
    return RequesterIdentityService(RequesterRepository(database, settings.professional_schema), settings)


# ---- technicians ----


def get_technician_session(
    request: Request,
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> tuple[Technician, str]:
    """The signed-in technician account and its session scope (onboarding or partner)."""
    token = access_token_from(request, settings, TECHNICIAN)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    claims = read_technician_access(settings, token)
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if SessionService(database, settings).validate(claims, PRINCIPAL_TECHNICIAN) is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=SESSION_EXPIRED_MESSAGE)
    technician = TechnicianRepository(database).get(claims.user_id)
    if not technician:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Checked on every request, so a suspension ends sessions that already exist.
    if technician.is_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SUSPENDED_MESSAGE)
    return technician, claims.scope or ""


def get_current_technician(session: tuple[Technician, str] = Depends(get_technician_session)) -> Technician:
    """Any signed-in technician account, including one still onboarding."""
    return session[0]


def get_active_technician(session: tuple[Technician, str] = Depends(get_technician_session)) -> Technician:
    """A technician who has finished registration and signed in with e-mail and password.
    A registration session never reaches these routes."""
    technician, scope = session
    if not technician.is_active or technician.onboarding_step != STEP_COMPLETE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ONBOARDING_INCOMPLETE",
                "message": "Finish your Partner registration first.",
                "step": technician.onboarding_step,
            },
        )
    if scope != SCOPE_PARTNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PASSWORD_SIGN_IN_REQUIRED",
                "message": "Sign in with your email and password to open your dashboard.",
            },
        )
    return technician


# ---- requesters ----


def get_current_requester(
    request: Request,
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    identity: RequesterIdentityService = Depends(get_requester_identity_service),
) -> tuple[Requester, str]:
    """The booking account behind a live requester session, re-checked against
    Professional's view now (ACTIVE, and still a House Owner or a Site Engineer)."""
    token = access_token_from(request, settings, REQUESTER)
    claims = read_requester_access(settings, token) if token else None
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Booking session required")
    if SessionService(database, settings).validate(claims, PRINCIPAL_REQUESTER) is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=REQUESTER_SESSION_EXPIRED)
    return identity.resolve_account(claims.user_id)


def get_catalog_service(database: Session = Depends(get_db)) -> "CatalogService":
    from app.modules.catalog.service import CatalogService

    return CatalogService(database)
