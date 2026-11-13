"""Technician registration steps after the e-mail code (the old Partner
app/technician/routes/onboarding_routes.py; paths and answers unchanged, under /api/v1).

    POST /onboarding/face      the live face capture (consent), encrypted for review
    POST /onboarding/aadhaar   the Aadhaar number (consent), encrypted; only the last four
                               digits are ever shown
    POST /onboarding/profile   the profile and password; earns the dashboard session

Each step accepts a submission only when it is the account's next step. A registration
(onboarding) session or a dashboard session may call them.
"""

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy.orm import Session

from app.auth.dependencies import app_settings, get_current_technician, get_session_service
from app.core.config import Settings
from app.core.security.access_tokens import SCOPE_PARTNER
from app.core.security.session_cookies import TECHNICIAN, client_info, set_session_cookies
from app.database.session import get_db
from app.modules.identity.auth_service import technician_response
from app.modules.identity.models import Technician
from app.modules.identity.schemas import ProfileCompleteResponse, TechnicianResponse
from app.modules.identity.session_service import SessionService
from app.modules.locations.location_service import PincodeDirectory, get_pincode_directory
from app.modules.technicians.identity_service import IdentityService
from app.modules.technicians.onboarding_service import OnboardingService
from app.modules.technicians.repository import IdentityRepository
from app.modules.technicians.schemas import AadhaarSubmitRequest, ProfileCompleteRequest

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])


def get_identity_service(database: Session = Depends(get_db)) -> IdentityService:
    return IdentityService(IdentityRepository(database))


def get_onboarding_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    directory: PincodeDirectory = Depends(get_pincode_directory),
) -> OnboardingService:
    return OnboardingService(database, settings, directory)


@router.post("/face", response_model=TechnicianResponse)
def submit_face_capture(
    capture: UploadFile = File(...),
    consent: bool = Form(False),
    settings: Settings = Depends(app_settings),
    technician: Technician = Depends(get_current_technician),
    identity: IdentityService = Depends(get_identity_service),
) -> TechnicianResponse:
    identity.submit_face(technician, capture, consent)
    return technician_response(technician, settings)


@router.post("/aadhaar", response_model=TechnicianResponse)
def submit_aadhaar(
    payload: AadhaarSubmitRequest,
    settings: Settings = Depends(app_settings),
    technician: Technician = Depends(get_current_technician),
    identity: IdentityService = Depends(get_identity_service),
) -> TechnicianResponse:
    identity.submit_aadhaar(technician, payload.aadhaar_number, payload.consent)
    return technician_response(technician, settings)


@router.post("/profile", response_model=ProfileCompleteResponse)
def complete_profile(
    payload: ProfileCompleteRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(app_settings),
    technician: Technician = Depends(get_current_technician),
    onboarding: OnboardingService = Depends(get_onboarding_service),
    sessions: SessionService = Depends(get_session_service),
) -> ProfileCompleteResponse:
    answer, earned_session = onboarding.complete_profile(technician, payload)
    if earned_session:
        # Registration finished just now: the dashboard session, set as cookies.
        issued = sessions.start_technician(technician.id, SCOPE_PARTNER, client_info(request))
        set_session_cookies(response, settings, TECHNICIAN, issued.access_token, issued.refresh_token)
        answer.csrf_token = issued.csrf_token
    return answer
