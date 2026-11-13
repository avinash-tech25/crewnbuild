"""Who is booking, decided on the server (the old app/requester/services/requester_service.py).

Professional's Book Technician button opens Partner in a new window and hands across,
with window.postMessage (never in a URL), a one-time hand-off token Professional issued
for the signed-in account. Partner's page sends it here once, in a request body. Then:

1. the hand-off is verified: ES256 signature, issuer professional, audience partner,
   type, lifetime of at most 60 seconds (access_tokens.read_professional_handoff);
2. the account is read from Professional's view and must be ACTIVE and a House Owner or
   a Site Engineer; any other account is refused. The token carries no role: the role is
   only ever the view's;
3. the caller starts Partner's own booking session (HttpOnly cookies) and records the
   hand-off id with it, so the hand-off is spent.

Every booking request re-checks step 2, so an account that is suspended or stops being a
Site Engineer stops being able to book. The requester id and role on a booking always
come from this check, never from the request body.
"""

import uuid

from fastapi import HTTPException

from app.core.config import Settings
from app.core.security.access_tokens import read_professional_handoff
from app.modules.requesters.repository import REQUESTER_ROLE_LABELS, REQUESTER_ROLES, Requester, RequesterRepository
from app.modules.requesters.schemas import RequesterProfile, RequesterSessionResponse

HANDOFF_FAILED_MESSAGE = (
    "Your CREWNBUILD session could not be verified. "
    "Return to your CREWNBUILD dashboard and click Book Technician again."
)
SESSION_EXPIRED_MESSAGE = (
    "Your booking session has expired. Return to your CREWNBUILD dashboard and click Book Technician again."
)
NOT_ALLOWED_MESSAGE = "Book Technician is available to CREWNBUILD House Owners and Site Engineers only."
SUSPENDED_MESSAGE = "This CREWNBUILD account has been suspended. Contact CREWNBUILD support."


def requester_profile(account: Requester, role: str) -> RequesterProfile:
    return RequesterProfile(
        id=account.id,
        name=account.name or "",
        role=role,
        role_label=REQUESTER_ROLE_LABELS[role],
        pincode=(account.pincode or "").strip(),
        area=account.area,
        has_service_location=bool((account.pincode or "").strip() and (account.address or "").strip()),
    )


class RequesterIdentityService:
    def __init__(self, requesters: RequesterRepository, settings: Settings) -> None:
        self.requesters = requesters
        self.settings = settings

    def _require_requester(self, account_id: uuid.UUID, missing_message: str) -> tuple[Requester, str]:
        account = self.requesters.get(account_id)
        if not account:
            raise HTTPException(status_code=401, detail=missing_message)
        role = account.requester_role
        if role not in REQUESTER_ROLES:
            raise HTTPException(status_code=403, detail=NOT_ALLOWED_MESSAGE)
        if not account.is_active:
            raise HTTPException(status_code=403, detail=SUSPENDED_MESSAGE)
        return account, str(role)

    def verify_handoff(self, handoff_token: str) -> tuple[Requester, str, str]:
        """(account, booking role, hand-off id) for a valid one-time hand-off."""
        handoff = read_professional_handoff(self.settings, handoff_token)
        if handoff is None:
            raise HTTPException(status_code=401, detail=HANDOFF_FAILED_MESSAGE)
        account, role = self._require_requester(handoff[0], HANDOFF_FAILED_MESSAGE)
        return account, role, handoff[1]

    def resolve_account(self, account_id: uuid.UUID) -> tuple[Requester, str]:
        """The booking account a live requester session belongs to, re-checked now."""
        return self._require_requester(account_id, SESSION_EXPIRED_MESSAGE)

    def session_response(self, account: Requester, role: str, csrf_token: str) -> RequesterSessionResponse:
        return RequesterSessionResponse(
            expires_in_seconds=self.settings.requester_session_minutes * 60,
            requester=requester_profile(account, role),
            csrf_token=csrf_token,
        )
