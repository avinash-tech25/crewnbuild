"""Request and answer shapes of the technician auth routes (the old app/schemas/auth.py)."""

from uuid import UUID

from pydantic import BaseModel, Field


class EmailCodeRequest(BaseModel):
    email: str = Field(max_length=255)


class SignupVerifyRequest(BaseModel):
    email: str = Field(max_length=255)
    phone: str = Field(max_length=30)
    code: str = Field(max_length=12)


class PasswordLoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=256)


class CodeSentResponse(BaseModel):
    sent: bool
    expires_in_minutes: int
    resend_after_seconds: int
    # Sign-up only: False when this development machine could not send mail and
    # wrote the code to the server console instead.
    delivered: bool | None = None


class OnboardingState(BaseModel):
    step: str  # FACE | AADHAAR | PROFILE | COMPLETE
    face_status: str
    aadhaar_status: str
    aadhaar_masked: str | None = None
    can_receive_jobs: bool
    pending_requirements: list[str]


class TechnicianResponse(BaseModel):
    id: UUID
    email: str | None = None
    phone: str
    status: str
    name: str | None = None
    address: str | None = None
    pincode: str | None = None
    area: str | None = None
    block: str | None = None
    district: str | None = None
    state: str | None = None
    location: str
    technician_type: str | None = None
    experience_years: int
    is_available: bool
    # OFFLINE | AVAILABLE | PAUSED. `is_available` is true exactly when this is AVAILABLE.
    work_status: str = "OFFLINE"
    profile_image_url: str | None = None
    created_at: str  # ISO 8601 with the local offset
    onboarding: OnboardingState


class CurrentTechnicianResponse(TechnicianResponse):
    # How this request is signed in: "partner" (email + password) or "onboarding" (registration session).
    session_type: str
    # This session's CSRF token, for a page that was reloaded and lost it from memory.
    csrf_token: str | None = None


class ProfileCompleteResponse(TechnicianResponse):
    """The finished account, and the dashboard session it has just earned.

    The last registration step creates the account: it sets the password, makes the
    account ACTIVE and completes onboarding, all on a request already authenticated
    as that account. Those are exactly the conditions /auth/login checks, so the
    same session it would issue is issued here instead of asking the technician to
    type the password they set seconds earlier.

    The session itself is set as HttpOnly cookies. `session_type` and `csrf_token`
    are absent when the step was submitted again for an account that was already
    complete: re-sending the form must not mint a session.
    """

    # "partner" -- the dashboard session, the same kind /auth/login returns.
    session_type: str | None = None
    csrf_token: str | None = None


class AuthResponse(BaseModel):
    # The session itself is in two HttpOnly cookies the page cannot read. The page
    # keeps this CSRF token in memory and sends it as X-CSRF-Token on every write.
    # "partner" after email + password sign-in; "onboarding" for the registration session.
    session_type: str
    user: TechnicianResponse
    csrf_token: str


# ------------------------------------------------------------------ passwords


class PasswordChangeRequest(BaseModel):
    """Signed in: the current password proves it is the account holder."""

    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)
    confirm_new_password: str = Field(max_length=256)


class PasswordResetVerifyRequest(BaseModel):
    email: str = Field(max_length=255)
    code: str = Field(max_length=12)


class PasswordResetVerifiedResponse(BaseModel):
    # Proof that the emailed code was accepted; only /auth/password-reset/reset takes it.
    reset_token: str
    expires_in_minutes: int


class PasswordResetRequest(BaseModel):
    reset_token: str = Field(max_length=2048)
    new_password: str = Field(max_length=256)
    confirm_new_password: str = Field(max_length=256)


class PasswordResetCodeResponse(BaseModel):
    """The same answer whether or not the email has an account."""

    message: str
    expires_in_minutes: int
    resend_after_seconds: int


class MessageResponse(BaseModel):
    message: str
