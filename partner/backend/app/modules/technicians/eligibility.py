"""Who may be offered jobs -- one definition, used by the dashboard and the assignment query."""

from app.core.runtime import settings
from app.modules.identity.models import Technician
from app.modules.technicians.models import AADHAAR_PENDING, AADHAAR_VERIFIED, FACE_PENDING, FACE_VERIFIED


def allowed_face_statuses() -> tuple[str, ...]:
    return (FACE_VERIFIED,) if settings.require_verified_identity_for_jobs else (FACE_PENDING, FACE_VERIFIED)


def allowed_aadhaar_statuses() -> tuple[str, ...]:
    return (AADHAAR_VERIFIED,) if settings.require_verified_identity_for_jobs else (AADHAAR_PENDING, AADHAAR_VERIFIED)


def job_eligibility(user: Technician) -> tuple[bool, list[str]]:
    """(eligible, reasons it is not). Availability and busy-with-a-job are separate, live conditions."""
    reasons = []
    if not user.is_active:
        reasons.append("Your account is not active.")
    if not user.onboarding_completed_at:
        reasons.append("Finish your Partner registration.")
    identity = user.identity
    if not identity or identity.face_status not in allowed_face_statuses():
        reasons.append("Face verification is required.")
    if not identity or identity.aadhaar_status not in allowed_aadhaar_statuses():
        reasons.append("Aadhaar details are required.")
    profile = user.technician_profile
    if not profile or not profile.technician_type or not user.pincode:
        reasons.append("Complete your trade and service location.")
    return (not reasons, reasons)


NOT_ELIGIBLE_TO_ACCEPT = "You can no longer accept this job request."


def acceptance_refusal(user: Technician, booking, *, has_selected_service: bool) -> str | None:
    """Why this technician may NOT accept this offer now, or None if they may.

    Re-checked at the moment of acceptance, on freshly read rows, because an offer
    is made up to a minute earlier and the technician may have changed since:
    account and registration, identity, availability, trade and chosen service.

    Deliberately NOT re-checked in the short offer window: personal radius,
    working hours and location freshness. The offer was made under them, and
    they drift with time and movement rather than with a decision to stop.
    """
    eligible, reasons = job_eligibility(user)
    if not eligible:
        return reasons[0]
    profile = user.technician_profile
    if not profile.is_available:
        return "You are unavailable, so you cannot accept new jobs."
    if profile.technician_type != booking.technician_type:
        return NOT_ELIGIBLE_TO_ACCEPT
    if booking.service_id is not None and not profile.offers_all_services and not has_selected_service:
        return "You no longer offer this service."
    return None
