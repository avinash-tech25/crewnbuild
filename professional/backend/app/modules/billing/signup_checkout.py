"""Subscription-first builder registration: a builder who chose a paid plan when signing
up finishes checkout before using anything else.

Ported in R4b only as far as identity needs it (sign-up stores the choice, the session
answer reports it, every protected route enforces it). The rest of billing comes with
the billing module.

The choice is stored on builder_profiles (signup_plan_code / signup_duration_code) and
grants nothing. It is pending until the builder's first verified paid period exists in
builder_subscriptions. That table belongs to billing and is not created yet; while it is
missing, no builder has a paid period, which is what an empty table would say.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import PROFESSIONAL_SCHEMA
from app.modules.accounts.models import BuilderProfile
from app.modules.identity.models import ROLE_BUILDER, User

CHECKOUT_REQUIRED = "SUBSCRIPTION_CHECKOUT_REQUIRED"

PROFESSIONAL_PLAN = "PROFESSIONAL"
BUSINESS_PLAN = "BUSINESS"
MONTHLY = "MONTHLY"
ANNUAL = "ANNUAL"
SIGNUP_OFFERS = {(PROFESSIONAL_PLAN, MONTHLY), (BUSINESS_PLAN, MONTHLY), (BUSINESS_PLAN, ANNUAL)}

# What a builder with checkout pending may still call (paths after /api/v1): everything
# under /auth/ except the Book Technician hand-off; the PIN code lookup; the subscription
# routes.
ALLOWED_PREFIXES = ("/auth/", "/locations/pincode/", "/subscriptions/")
REFUSED_PATHS = ("/auth/partner-handoff",)


def valid_signup_offer(plan_code: str | None, duration_code: str | None) -> tuple[str, str] | None:
    choice = ((plan_code or "").upper(), (duration_code or "").upper())
    return choice if choice in SIGNUP_OFFERS else None


def remember_signup_plan(profile: BuilderProfile, plan_code: str | None, duration_code: str | None) -> None:
    """At sign-up: keep a valid paid choice; anything else and the builder signs up free.
    (The old check that the builder is in India always passes: India is the only market.)"""
    choice = valid_signup_offer(plan_code, duration_code)
    if choice:
        profile.signup_plan_code, profile.signup_duration_code = choice


def has_paid_period(database: Session, user: User) -> bool:
    table = f"{PROFESSIONAL_SCHEMA}.builder_subscriptions"
    if database.execute(text("SELECT to_regclass(:name)"), {"name": table}).scalar() is None:
        return False
    found = database.execute(
        text(f"SELECT 1 FROM {table} WHERE builder_id = :builder_id LIMIT 1"),  # noqa: S608 constant table name
        {"builder_id": user.id},
    ).first()
    return found is not None


def pending_checkout(user: User, database: Session) -> dict[str, Any] | None:
    """{plan_code, duration_code} while this builder's paid sign-up is unpaid, else None."""
    if (user.role or "").upper() != ROLE_BUILDER:
        return None
    choice = database.execute(
        select(BuilderProfile.signup_plan_code, BuilderProfile.signup_duration_code).where(
            BuilderProfile.user_id == user.id
        )
    ).first()
    if not choice or not choice[0] or not choice[1]:
        return None
    if has_paid_period(database, user):
        return None
    return {"plan_code": choice[0], "duration_code": choice[1]}


def enforce(database: Session, user: User, path: str) -> None:
    """Refuse everything but the onboarding routes while a paid sign-up is unpaid.
    `path` is relative to /api/v1."""
    if (user.role or "").upper() != ROLE_BUILDER:
        return
    if path.startswith(ALLOWED_PREFIXES) and not path.startswith(REFUSED_PATHS):
        return
    pending = pending_checkout(user, database)
    if pending is not None:
        raise HTTPException(
            status_code=403,
            detail={
                "code": CHECKOUT_REQUIRED,
                "message": "Finish your plan checkout to start using CREWNBUILD.",
                **pending,
            },
        )
