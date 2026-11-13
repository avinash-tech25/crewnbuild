"""A builder's lead locations and the plan limits on them (India builders only; the old
app/subscription/lead_locations.py).

Limits: Free 1 location and 5 open leads per location, Professional 3 and 10, Premium
(BUSINESS) none. The free first month keeps the Free limits. The plan whose limits apply
is the one subscription_state reports in force (a paid period now, or within its grace
days); otherwise Free.
"""

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts.models import BuilderProfile
from app.modules.accounts.profile_lists import split_profile_list
from app.modules.billing import entitlements
from app.modules.identity.models import ROLE_BUILDER, User

LOCATION_LIMIT_REACHED = "LOCATION_LIMIT_REACHED"

FREE = "FREE"
PROFESSIONAL = "PROFESSIONAL"
BUSINESS = "BUSINESS"
MAX_LOCATIONS = {FREE: 1, PROFESSIONAL: 3, BUSINESS: None}
LOCATION_UPGRADE_OFFERS = {
    FREE: ["PRO_MONTHLY", "PREMIUM_MONTHLY", "PREMIUM_ANNUAL"],
    PROFESSIONAL: ["PREMIUM_MONTHLY", "PREMIUM_ANNUAL"],
}

# Six digits, not part of a longer number; an Indian pincode never starts with 0.
_PINCODE = re.compile(r"(?<!\d)([1-9]\d{5})(?!\d)")


def limited_plan(database: Session, user: User) -> str | None:
    """The tier whose limits apply to this builder now, or None when none apply (not a
    builder, or outside India)."""
    if (user.role or "").upper() != ROLE_BUILDER or not entitlements.core_tools_gated(user):
        return None
    state = entitlements.subscription_state(database, user.id)
    in_force = state.status in (entitlements.STATUS_ACTIVE, entitlements.STATUS_GRACE)
    return state.plan_code if in_force else FREE


def location_cap(plan_code: str | None) -> int | None:
    return MAX_LOCATIONS.get(plan_code or FREE, MAX_LOCATIONS[FREE]) if plan_code else None


def location_pincode(entry: str | None) -> str | None:
    match = _PINCODE.search(entry or "")
    return match.group(1) if match else None


def saved_locations(database: Session, builder: User) -> list[str]:
    value = database.scalars(
        select(BuilderProfile.service_locations).where(BuilderProfile.user_id == builder.id)
    ).first()
    return split_profile_list(value)


def registered_pincodes(entries: list[str], cap: int | None) -> list[str]:
    pincodes: list[str] = []
    for entry in entries if cap is None else entries[:cap]:
        pincode = location_pincode(entry)
        if pincode and pincode not in pincodes:
            pincodes.append(pincode)
    return pincodes


def account_pincode_allowed(pincode: str | None, registered: list[str], cap: int | None) -> bool:
    return bool(pincode) and (cap is None or pincode in registered or len(registered) < cap)


def location_limit_error(cap: int, plan_code: str, field: str, message: str) -> HTTPException:
    detail: dict[str, Any] = {
        "code": LOCATION_LIMIT_REACHED,
        "message": message,
        "fields": {field: message},
        "limit": cap,
        "plan_code": plan_code,
        "upgrade_offers": LOCATION_UPGRADE_OFFERS.get(plan_code, []),
    }
    return HTTPException(status_code=422, detail=detail)


def require_location_count(database: Session, user: User, submitted: str | None, saved: str | None) -> None:
    """Refuse a service-location save that adds a location beyond the plan's cap."""
    plan_code = limited_plan(database, user)
    cap = location_cap(plan_code)
    count = len(split_profile_list(submitted))
    if plan_code is None or cap is None or count <= cap or count <= len(split_profile_list(saved)):
        return
    raise location_limit_error(cap, plan_code, "service_locations", f"Your plan allows up to {cap} service locations.")


def require_account_pincode(
    database: Session, user: User, pincode: str | None, service_locations: str | None = None
) -> None:
    """Refuse changing the account's pincode to one that would be a lead location beyond
    the plan's cap. An unchanged pincode is never refused."""
    plan_code = limited_plan(database, user)
    if plan_code is None or not pincode or pincode == user.pincode:
        return
    cap = location_cap(plan_code)
    entries = (
        split_profile_list(service_locations) if service_locations is not None else saved_locations(database, user)
    )
    if cap is None or account_pincode_allowed(pincode, registered_pincodes(entries, cap), cap):
        return
    raise location_limit_error(
        cap,
        plan_code,
        "pincode",
        f"Your plan allows up to {cap} service locations. Choose the pincode of one of your service locations.",
    )


# ---- open leads (a builder's CONTRACTOR_TO_OWNER requests), counted per location ----

LEAD_LIMIT_REACHED = "LEAD_LIMIT_REACHED"
BUILDER_TO_OWNER = "CONTRACTOR_TO_OWNER"
MAX_LEADS_PER_LOCATION = {FREE: 5, PROFESSIONAL: 10, BUSINESS: None}


def lead_cap(plan_code: str | None) -> int | None:
    return MAX_LEADS_PER_LOCATION.get(plan_code or FREE, MAX_LEADS_PER_LOCATION[FREE]) if plan_code else None


def lead_pincodes(database: Session, user: User) -> list[str]:
    """The account's pincode first (when allowed), then each matched service location's."""
    plan_code = limited_plan(database, user)
    if plan_code is None:
        return [user.pincode] if user.pincode else []
    cap = location_cap(plan_code)
    registered = registered_pincodes(saved_locations(database, user), cap)
    if not account_pincode_allowed(user.pincode, registered, cap):
        return registered
    return [user.pincode, *[pincode for pincode in registered if pincode != user.pincode]]


def open_lead_counts(database: Session, builder_id: Any, pincodes: list[str]) -> dict[str, int]:
    """Open leads per pincode: pending, or accepted on a project not yet awarded."""
    from sqlalchemy import and_, func, or_
    from sqlalchemy.orm import aliased

    from app.modules.projects.models import Project, ProjectRequest

    if not pincodes:
        return {}
    receiver = aliased(User)
    location = func.coalesce(Project.pincode, receiver.pincode)
    rows = database.execute(
        select(location, func.count(ProjectRequest.id))
        .select_from(ProjectRequest)
        .outerjoin(Project, Project.id == ProjectRequest.project_id)
        .join(receiver, receiver.id == ProjectRequest.receiver_id)
        .where(
            ProjectRequest.sender_id == builder_id,
            ProjectRequest.request_type == BUILDER_TO_OWNER,
            or_(
                ProjectRequest.status == "pending",
                and_(ProjectRequest.status == "accepted", Project.id.isnot(None), Project.contractor_id.is_(None)),
            ),
            location.in_(pincodes),
        )
        .group_by(location)
    ).all()
    counts = dict.fromkeys(pincodes, 0)
    counts.update({pincode: int(count) for pincode, count in rows})
    return counts


def require_lead_slot(database: Session, user: User, pincode: str | None) -> None:
    """Refuse a new builder request when its location already holds the plan's open leads."""
    cap = lead_cap(limited_plan(database, user))
    if cap is None or not pincode:
        return
    if open_lead_counts(database, user.id, [pincode]).get(pincode, 0) >= cap:
        raise HTTPException(
            status_code=403,
            detail={
                "code": LEAD_LIMIT_REACHED,
                "limit": cap,
                "pincode": pincode,
                "message": f"You've reached the {cap}-lead limit for this location.",
            },
        )


def usage(database: Session, user: User) -> dict[str, Any] | None:
    """Locations and open leads used against the limits, for the status payload."""
    plan_code = limited_plan(database, user)
    if plan_code is None:
        return None
    cap = lead_cap(plan_code)
    counts = open_lead_counts(database, user.id, lead_pincodes(database, user))
    return {
        "plan_code": plan_code,
        "locations_used": len(saved_locations(database, user)),
        "max_locations": location_cap(plan_code),
        "max_leads_per_location": cap,
        "location_upgrade_offers": LOCATION_UPGRADE_OFFERS.get(plan_code, []),
        "leads": [
            {"pincode": pincode, "used": used, "remaining": None if cap is None else max(cap - used, 0)}
            for pincode, used in counts.items()
        ],
    }
