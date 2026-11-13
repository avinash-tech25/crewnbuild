"""What identity reads from the technician tables that come with R4c part 2
(technician_profiles, technician_identity_verifications) and from job eligibility.

NOT PORTED YET (docs/porting-todo.md): each function answers what an account without
those rows answered in the old app, with one exception that keeps finished accounts able
to sign in: until the identity-verification table exists, the face and Aadhaar steps
count as submitted exactly when registration is complete (onboarding_completed_at),
which the old profile step only allowed after both.
"""

from typing import Any

FACE_NOT_STARTED = "NOT_STARTED"
AADHAAR_NOT_SUBMITTED = "NOT_SUBMITTED"
WORK_STATUS_OFFLINE = "OFFLINE"


def identity_steps_submitted(technician: Any) -> tuple[bool, bool]:
    """STUB (part 2): (face submitted, Aadhaar submitted)."""
    done = technician.onboarding_completed_at is not None
    return done, done


def identity_summary(technician: Any) -> dict[str, Any]:
    """STUB (part 2): the onboarding statuses shown to the technician."""
    return {"face_status": FACE_NOT_STARTED, "aadhaar_status": AADHAAR_NOT_SUBMITTED, "aadhaar_masked": None}


def profile_summary(technician: Any) -> dict[str, Any]:
    """STUB (part 2): the trade and availability fields of the technician profile."""
    return {
        "technician_type": None,
        "experience_years": 0,
        "is_available": False,
        "work_status": WORK_STATUS_OFFLINE,
        "profile_image_url": None,
    }


def job_eligibility(technician: Any) -> tuple[bool, list[str]]:
    """STUB (part 2): whether the technician may be offered jobs, and why not. Without the
    profile and identity rows the old rule always found reasons, so no one is eligible."""
    reasons = []
    if not technician.is_active:
        reasons.append("Your account is not active.")
    if not technician.onboarding_completed_at:
        reasons.append("Finish your Partner registration.")
    reasons += ["Face verification is required.", "Aadhaar details are required."]
    reasons.append("Complete your trade and service location.")
    return False, reasons


def create_onboarding_rows(database: Any, technician: Any) -> None:
    """STUB (part 2): sign-up created an empty technician profile and identity record."""
    return None
