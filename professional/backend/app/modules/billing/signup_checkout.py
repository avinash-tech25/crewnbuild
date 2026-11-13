"""Subscription-first builder registration: a builder who chose a paid plan when signing
up finishes checkout before using anything else.

The choice is stored on builder_profiles (signup_plan_code / signup_duration_code) and
grants nothing. It is pending until the builder's first verified paid period exists in
builder_subscriptions, read on every check, so a payment verified by a webhook or a
recovery while the browser was closed counts the moment it is recorded.

While pending, every authenticated request is refused except the few the onboarding
needs (`enforce`, run for every protected route): sign-in and session, the PIN code step,
the subscription and checkout routes. Every other role, every free builder and every
builder who has paid is untouched.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts.models import BuilderProfile
from app.modules.billing.models import BuilderSubscription
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
# Deleting the account never waits on a payment (the old deletion routes skipped this
# rule altogether).
ALWAYS_ALLOWED_PATHS = ("/account/deletion-form", "/account/delete")


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
    """A verified payment has activated a period: onboarding is over."""
    found = database.scalar(select(BuilderSubscription.id).where(BuilderSubscription.builder_id == user.id).limit(1))
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
    if path in ALWAYS_ALLOWED_PATHS:
        return
    # Viewing a file never waited on a payment either (the old download route skipped
    # this rule); uploading does.
    if path.startswith("/files/") and path != "/files/upload":
        return
    # Support stays reachable: an unpaid builder is exactly who may need payment help.
    if path.startswith("/support/"):
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


PINCODE_REQUIRED = "SUBSCRIPTION_PINCODE_REQUIRED"
FREE_PLAN = "FREE"


def change_signup_plan(
    database: Session, user: User, plan_code: str | None, duration_code: str | None
) -> dict[str, Any] | None:
    """Before paying: switch between the paid offers, or (plan FREE) give up the paid
    sign-up and continue on the free plan. Refused once a paid period exists."""
    pending = pending_checkout(user, database)
    if pending is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "SUBSCRIPTION_SIGNUP_PLAN_CLOSED", "message": "There is no unpaid plan choice to change."},
        )
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == user.id)).one()
    if (plan_code or "").upper() == FREE_PLAN:
        profile.signup_plan_code = profile.signup_duration_code = None
    else:
        choice = valid_signup_offer(plan_code, duration_code)
        if choice is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "SUBSCRIPTION_PLAN_NOT_AVAILABLE",
                    "message": "Choose Professional Pro Monthly or Premium Annual.",
                },
            )
        profile.signup_plan_code, profile.signup_duration_code = choice
    database.commit()
    return pending_checkout(user, database)


def require_pincode(user: User, database: Session) -> None:
    """A paid sign-up pays only after the PIN code step (PATCH /auth/location, which
    checks it against India Post)."""
    if pending_checkout(user, database) is not None and not (user.pincode or "").strip():
        raise HTTPException(
            status_code=409,
            detail={"code": PINCODE_REQUIRED, "message": "Verify your PIN code before paying for your plan."},
        )
