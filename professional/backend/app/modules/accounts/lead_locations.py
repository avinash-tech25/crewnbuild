"""A builder's lead locations: where they look for projects and clients.

The account's pincode first, then each saved service location's pincode, in the order
saved, without repeats. Accounts outside India use their own pincode only. (The plan
limits that once capped these were removed together with subscriptions.)
"""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts.models import BuilderProfile
from app.modules.accounts.profile_lists import split_profile_list
from app.modules.identity.models import User

# Six digits, not part of a longer number; an Indian pincode never starts with 0.
_PINCODE = re.compile(r"(?<!\d)([1-9]\d{5})(?!\d)")


def is_india_account(user: User) -> bool:
    return (user.country_code or "India").strip().upper() in {"INDIA", "IN", "IND"}


def location_pincode(entry: str | None) -> str | None:
    match = _PINCODE.search(entry or "")
    return match.group(1) if match else None


def saved_locations(database: Session, builder: User) -> list[str]:
    value = database.scalars(
        select(BuilderProfile.service_locations).where(BuilderProfile.user_id == builder.id)
    ).first()
    return split_profile_list(value)


def lead_pincodes(database: Session, user: User) -> list[str]:
    """The account's pincode first, then each service location's."""
    if not is_india_account(user):
        return [user.pincode] if user.pincode else []
    registered: list[str] = []
    for entry in saved_locations(database, user):
        pincode = location_pincode(entry)
        if pincode and pincode not in registered:
            registered.append(pincode)
    if not user.pincode:
        return registered
    return [user.pincode, *[pincode for pincode in registered if pincode != user.pincode]]
