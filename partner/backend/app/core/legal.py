"""The Terms of Service and Privacy Policy a technician accepts at registration.

The texts live in the web app only (partner/frontend/src/features/legal/content/terms.js
and privacy.js). TERMS_VERSION and PRIVACY_VERSION MUST equal the "version" field of
those two files: a registration naming any other version is refused, so the page always
shows the texts the server records. Change them together, in one release.

The account keeps the versions it accepted and when (technicians.terms_version,
technicians.privacy_version, technicians.terms_accepted_at). The time is the server's,
never the client's. Accounts created before this existed keep NULLs.
"""

from pydantic import BaseModel, StrictBool, field_validator
from pydantic_core import PydanticCustomError

TERMS_VERSION = "1.0"
PRIVACY_VERSION = "1.0"

TERMS_NOT_ACCEPTED = "Accept the Terms of Service and the Privacy Policy to create an account."
TERMS_OUTDATED = "The Terms of Service have changed. Reload the page and accept the current version."
PRIVACY_OUTDATED = "The Privacy Policy has changed. Reload the page and accept the current version."


class LegalConsent(BaseModel):
    """The three consent fields the registration step that creates the account carries.
    A missing field, `accept_terms` other than true, or a version that is not the current
    one is a 422 validation error on that field."""

    accept_terms: StrictBool
    terms_version: str
    privacy_version: str

    @field_validator("accept_terms")
    @classmethod
    def must_accept(cls, value: bool) -> bool:
        if value is not True:
            raise PydanticCustomError("terms_not_accepted", TERMS_NOT_ACCEPTED)
        return value

    @field_validator("terms_version")
    @classmethod
    def current_terms(cls, value: str) -> str:
        if value != TERMS_VERSION:
            raise PydanticCustomError("terms_version_outdated", TERMS_OUTDATED)
        return value

    @field_validator("privacy_version")
    @classmethod
    def current_privacy(cls, value: str) -> str:
        if value != PRIVACY_VERSION:
            raise PydanticCustomError("privacy_version_outdated", PRIVACY_OUTDATED)
        return value
