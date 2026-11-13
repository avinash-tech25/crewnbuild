"""The last registration step: the technician's profile and password (the old
AuthService.complete_profile, same rules and answers).

The step accepts a submission only when it is the account's next step (face and Aadhaar
done). It sets the password, makes the account ACTIVE and completes onboarding; the
caller then starts the dashboard session, exactly what /auth/login would issue.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.password_hashing import hash_secret
from app.database.types import naive_utc_now
from app.modules.identity.auth_service import (
    clean_address,
    clean_name,
    clean_new_password,
    clean_technician_type,
    technician_response,
)
from app.modules.identity.models import (
    ACCOUNT_STATUS_ACTIVE,
    ACCOUNT_STATUS_ONBOARDING,
    STEP_COMPLETE,
    STEP_PROFILE,
    Technician,
)
from app.modules.identity.schemas import ProfileCompleteResponse
from app.modules.locations.location_service import PincodeDirectory, clean_india_pincode
from app.modules.technicians.models import WORK_STATUS_AVAILABLE, WORK_STATUS_OFFLINE
from app.modules.technicians.schemas import ProfileCompleteRequest


def location_fields(directory: PincodeDirectory, pincode: str | None, area: str | None) -> dict[str, Any]:
    """The pincode checked against India Post and the chosen branch resolved to its postal
    hierarchy. The browser never supplies the district or block."""
    cleaned_pincode = clean_india_pincode(pincode)
    branch = directory.branch(cleaned_pincode, area or "")
    return {
        "pincode": cleaned_pincode,
        "area": branch["name"][:120],
        "block": (branch["block"] or None) and branch["block"][:120],
        "division": (branch["division"] or None) and branch["division"][:120],
        "district": branch["district"][:120],
        "state": branch["state"][:120],
    }


class OnboardingService:
    def __init__(self, database: Session, settings: Settings, directory: PincodeDirectory) -> None:
        self.database = database
        self.settings = settings
        self.directory = directory

    def complete_profile(
        self, technician: Technician, payload: ProfileCompleteRequest
    ) -> tuple[ProfileCompleteResponse, bool]:
        """The finished account, and whether it has just earned a dashboard session."""
        if technician.onboarding_step not in (STEP_PROFILE, STEP_COMPLETE):
            raise HTTPException(status_code=409, detail="Complete face verification and Aadhaar details first.")
        # The password is created with the account, at this step only; submitting the step
        # again for a finished account never replaces it.
        new_password = clean_new_password(payload.password) if technician.onboarding_step == STEP_PROFILE else None
        technician_type = clean_technician_type(payload.technician_type)
        profile = technician.technician_profile  # type: ignore[attr-defined]
        if profile.technician_type and profile.technician_type != technician_type:
            raise HTTPException(status_code=409, detail="Your trade was set when you registered and cannot be changed.")

        technician.name = clean_name(payload.name)
        technician.address = clean_address(payload.address)
        for field, value in location_fields(self.directory, payload.pincode, payload.area).items():
            setattr(technician, field, value)
        profile.technician_type = technician_type
        profile.experience_years = payload.experience_years
        # Registration asks one question, "start taking jobs now?"; PAUSED is a dashboard
        # choice, not a sign-up one.
        profile.work_status = WORK_STATUS_AVAILABLE if payload.is_available else WORK_STATUS_OFFLINE
        self.database.flush()
        if payload.work_preferences is not None:
            from app.modules.catalog.repository import ServiceRepository
            from app.modules.technicians.repository import WorkPreferencesRepository
            from app.modules.technicians.work_preferences_service import WorkPreferencesService

            # Validated and staged in this same transaction: a bad choice refuses the whole
            # step, so an account is never completed with half its preferences.
            WorkPreferencesService(WorkPreferencesRepository(self.database), ServiceRepository(self.database)).apply(
                technician, payload.work_preferences
            )
        if new_password is not None:
            technician.password_hash = hash_secret(new_password)
        if technician.status == ACCOUNT_STATUS_ONBOARDING:
            technician.status = ACCOUNT_STATUS_ACTIVE
        if technician.onboarding_step != STEP_COMPLETE:
            technician.onboarding_completed_at = naive_utc_now()
        self.database.commit()
        self.database.expire_all()

        completed = self.database.get(Technician, technician.id)
        if completed is None:
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
        answer = ProfileCompleteResponse(**technician_response(completed, self.settings).model_dump())
        if new_password is None:
            # A re-submission for a finished account earns no new session.
            return answer, False
        # Registration finished just now, on a request already authenticated as this account,
        # with the password it set this moment: everything login() verifies.
        answer.session_type = "partner"
        return answer, True


__all__ = ["ACCOUNT_STATUS_ACTIVE", "OnboardingService", "location_fields"]
