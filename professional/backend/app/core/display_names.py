"""A name that is really a phone number.

Every card, list, chat and profile shows an account by its company or store name, else
its person's name. None of those may ever be a phone number: it would put a private
contact detail where the platform keeps contact hidden until a request is accepted, and
it is not a name. Sign-up and complete-profile refuse one (identity/service.py,
accounts/profile_validation.py), and migration 0004 corrected the rows saved before.

"Phone-like" is what is left of the value once spaces, +, -, (, ) and . are taken out:
nothing but ASCII digits 0-9, at least six of them (the same test as migration 0004's
SQL and the frontend's displayName). A name with letters ("Builders 24x7", "A1
Constructions") is never phone-like.
"""

import re

PHONE_LIKE_MIN_DIGITS = 6
_PUNCTUATION = re.compile(r"[\s()+.\-]")
_DIGITS_ONLY = re.compile(rf"[0-9]{{{PHONE_LIKE_MIN_DIGITS},}}")


def looks_like_phone(value: str | None) -> bool:
    stripped = _PUNCTUATION.sub("", value or "")
    return _DIGITS_ONLY.fullmatch(stripped) is not None


def public_name(value: str | None) -> str:
    """The name to show another account: "" when it is really a phone number."""
    return "" if looks_like_phone(value) else (value or "")


NAME_IS_PHONE = "Enter your name, not a phone number."
COMPANY_IS_PHONE = "Enter your company name, not a phone number."
STORE_IS_PHONE = "Enter your business name, not a phone number."
