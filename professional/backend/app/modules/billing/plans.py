"""The builder subscription catalogue: tiers, billing durations and entitlements.

One definition, read by the entitlement checks, the plan listing and the
frontend (through GET /subscriptions/plans). Nothing else names a plan or a
feature, so changing what a tier includes is an edit here and nowhere else.

A tier decides WHAT a builder may use; a duration decides only HOW LONG one
payment covers. The same tier grants the same features whatever its duration.

Prices are deliberately not here: they live in professional.subscription_plan_prices
(seeded by app/seeds/seed_subscription_plan_prices.py), so no price is ever hardcoded and a plan with no price row
simply cannot be bought.
"""

from dataclasses import dataclass, field
from typing import Any

FREE = "FREE"
PROFESSIONAL = "PROFESSIONAL"
BUSINESS = "BUSINESS"

MONTHLY = "MONTHLY"
SIX_MONTHS = "SIX_MONTHS"
ANNUAL = "ANNUAL"

# Billing months each duration covers. SIX_MONTHS stays known so any record made
# with it remains valid (the tables' CHECK constraints and history display), but it
# is no longer offered: new orders are Monthly or Annual only (OFFERED_DURATIONS).
DURATION_MONTHS = {MONTHLY: 1, SIX_MONTHS: 6, ANNUAL: 12}
DURATIONS = tuple(DURATION_MONTHS)
OFFERED_DURATIONS = (MONTHLY, ANNUAL)

# Paid features. Each one is checked on the server (entitlements.require_feature).
BILL_ADJUSTMENTS = "bill_adjustments"  # audited corrections on closed daily records
PORTFOLIO_DASHBOARD = "portfolio_dashboard"  # cross-project portfolio view
PROJECT_SUMMARY_EXPORT = "project_summary_export"  # one project's CSV summary
# The Portfolio reports: Premium (BUSINESS) only, whatever its duration -- Plus
# (Monthly) and Premium (Annual) get them alike.
ADVANCED_COST_SUMMARY = "advanced_cost_summary"  # cost breakdown across the portfolio
CONSOLIDATED_EXPORT = "consolidated_export"  # every project in one CSV
PREMIUM_BADGE = "premium_badge"
# HD (the DVR's MAIN stream) on CCTV live and recorded playback. Without it a
# builder is served the SD (SUB) stream only. Uploaded site videos are single
# original files with no SD/HD variants, so this applies to CCTV only.
HD_VIDEO = "hd_video"
# Core builder tools: the builder's own view of a project's calendar (timelines),
# its photos, and billing / cost management. While the builder has none of them, the
# house owner's calendar and photo viewing and the assigned Site Engineer's calendar
# and photo HISTORY are paused too (entitlements.project_feature_allowed); the
# engineer's own reporting, uploads and cost records are never gated.
BUILDER_CALENDAR = "builder_calendar"
BUILDER_PHOTOS = "builder_photos"
BUILDER_BILLING = "builder_billing"
CORE_FEATURES = frozenset({BUILDER_CALENDAR, BUILDER_PHOTOS, BUILDER_BILLING})

ALL_FEATURES = (
    BILL_ADJUSTMENTS,
    PORTFOLIO_DASHBOARD,
    PROJECT_SUMMARY_EXPORT,
    ADVANCED_COST_SUMMARY,
    CONSOLIDATED_EXPORT,
    PREMIUM_BADGE,
    HD_VIDEO,
    BUILDER_CALENDAR,
    BUILDER_PHOTOS,
    BUILDER_BILLING,
)

# A new builder account gets the Professional features free for this many days from
# its creation (users.created_at; accounts are ACTIVE from signup), without the PRO
# badge. FREE_ACCESS_FEATURES is set below, from the Professional plan.
FREE_ACCESS_DAYS = 30


@dataclass(frozen=True)
class Plan:
    code: str
    rank: int
    purchasable: bool
    features: frozenset[str]
    # Enforced on the server for India builders (entitlements.builder_limits).
    # None = unlimited. max_locations caps the saved service locations;
    # max_leads_per_location caps the builder's open (pending or accepted) requests
    # to house owners in any one location's pincode.
    limits: dict[str, Any] = field(default_factory=dict)


MAX_LOCATIONS = "max_locations"
MAX_LEADS_PER_LOCATION = "max_leads_per_location"
LEADS_PER_LOCATION = 10
# Free: one service location and 5 open leads in it. The free first month keeps
# these limits too (subscription_state reports plan_code FREE while TRIAL).
FREE_LOCATIONS = 1
FREE_LEADS_PER_LOCATION = 5

PLANS = {
    FREE: Plan(
        FREE, 0, False, frozenset(), {MAX_LOCATIONS: FREE_LOCATIONS, MAX_LEADS_PER_LOCATION: FREE_LEADS_PER_LOCATION}
    ),
    PROFESSIONAL: Plan(
        PROFESSIONAL,
        1,
        True,
        frozenset({BILL_ADJUSTMENTS, PORTFOLIO_DASHBOARD, PROJECT_SUMMARY_EXPORT, PREMIUM_BADGE}) | CORE_FEATURES,
        {MAX_LOCATIONS: 3, MAX_LEADS_PER_LOCATION: LEADS_PER_LOCATION},
    ),
    BUSINESS: Plan(
        BUSINESS,
        2,
        True,
        frozenset(
            {
                BILL_ADJUSTMENTS,
                PORTFOLIO_DASHBOARD,
                PROJECT_SUMMARY_EXPORT,
                PREMIUM_BADGE,
                HD_VIDEO,
                ADVANCED_COST_SUMMARY,
                CONSOLIDATED_EXPORT,
            }
        )
        | CORE_FEATURES,
        # Plus (Monthly) and Premium (Annual): unlimited locations and unlimited leads.
        {MAX_LOCATIONS: None, MAX_LEADS_PER_LOCATION: None},
    ),
}
PAID_PLANS = tuple(code for code, plan in PLANS.items() if plan.purchasable)
# The free first month: Professional without its PRO badge (so no HD, and the Free
# limits, which subscription_state applies through plan_code FREE).
FREE_ACCESS_FEATURES = PLANS[PROFESSIONAL].features - {PREMIUM_BADGE}

# The mark an ACTIVE paid plan shows on the builder's profile: a green PRO badge
# for Professional, a PREMIUM shield for Business. Granted only by a plan in force
# (entitlements.SubscriptionState.badge), never by a selection or a pending payment.
PLAN_BADGES = {PROFESSIONAL: "PRO", BUSINESS: "PREMIUM"}

# The lowest tier that includes each feature: what the "upgrade" message names.
# A feature no plan includes has no entry.
FEATURE_MINIMUM_PLAN = {
    feature: min((plan for plan in PLANS.values() if feature in plan.features), key=lambda plan: plan.rank).code
    for feature in ALL_FEATURES
    if any(feature in plan.features for plan in PLANS.values())
}


def plan_for(code: str | None) -> Plan:
    return PLANS.get((code or "").upper(), PLANS[FREE])


def is_paid_plan(code: str | None) -> bool:
    return (code or "").upper() in PAID_PLANS


def is_duration(code: str | None) -> bool:
    return (code or "").upper() in DURATION_MONTHS


def is_offered_duration(code: str | None) -> bool:
    return (code or "").upper() in OFFERED_DURATIONS
