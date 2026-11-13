"""What a builder's subscription allows, decided on the server for every request (ported
from the old app/subscription/entitlements.py; same rules and answers).

Order of checks, everywhere a paid feature is used:
  1. authenticated, ACTIVE account          (current_principal)
  2. role BUILDER                           (require_builder)
  3. project ownership, where a project is involved
                                            (ensure_contractor_project_access)
  4. a current paid period whose plan includes the feature, or the free first month of
     a new account (Professional without the badge)
                                            (require_feature / require_builder_feature)
A subscription never widens 1-3: it only unlocks features on what the builder could
already reach.

Expiry is evaluated when it is read. The one-time notifications (renewal reminder and
expiry notice, each to the builder and to the house owners and assigned Site Engineers of
their awarded projects) are written by `sync_lifecycle`, which runs whenever a builder's
status is read; `python -m app.jobs.subscription_renewal_sweep` runs it for every builder.

Times here are naive UTC, as the tables hand them over (NaiveUtcTimestamp).
"""

import calendar
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.billing import plans as catalogue
from app.modules.billing.models import PERIOD_ACTIVE, BuilderSubscription
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.messaging.models import Notification
from app.modules.messaging.notifications import add_notification
from app.modules.projects.models import Project, ProjectEngineer

logger = logging.getLogger(__name__)

BUILDER_ROLE = ROLE_BUILDER
OWNER_ROLE = ROLE_OWNER
ENGINEER_ROLE = ROLE_ENGINEER

STATUS_ACTIVE = "ACTIVE"
STATUS_GRACE = "GRACE"
STATUS_TRIAL = "TRIAL"  # the free first month of a new builder account: Professional, no badge
STATUS_EXPIRED = "EXPIRED"
STATUS_NONE = "NONE"

# Error codes the frontend reads from {"detail": {"code", "message", ...}}.
SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"
SUBSCRIPTION_EXPIRED = "SUBSCRIPTION_EXPIRED"
PLAN_UPGRADE_REQUIRED = "PLAN_UPGRADE_REQUIRED"
BUILDER_ONLY = "SUBSCRIPTION_BUILDER_ONLY"
FREE_ACCESS_EXPIRED = "FREE_ACCESS_EXPIRED"

# The once-only notices when a builder's free month ends without a paid plan. The
# builder's notification is also the record that it was sent (notifications are never
# deleted), written in the same transaction as the house owners' notices.
FREE_ACCESS_EXPIRED_TITLE = "Your free access has expired"
FREE_ACCESS_EXPIRED_MESSAGE = (
    "Your free access has expired. Upgrade your plan to restore subscription features. "
    "Your essential project records remain available."
)
OWNER_EXPIRY_TITLE = "Builder subscription expired"
OWNER_EXPIRY_MESSAGE = (
    "Your builder's subscription has expired. Site calendar and photo access is temporarily unavailable. "
    "Access will be restored when your builder renews their plan."
)
# A house owner's view of the calendar and site photos follows the project's builder:
# refused with this code while that builder's core access is paused.
BUILDER_ACCESS_PAUSED = "BUILDER_SUBSCRIPTION_EXPIRED"
OWNER_ACCESS_PAUSED_MESSAGE = (
    "Your builder's subscription has expired. Site calendar and photo access is temporarily unavailable."
)
# The assigned Site Engineer's calendar and photo HISTORY follows the builder too; their
# own reporting (daily records, uploads, progress) never does.
ENGINEER_EXPIRY_TITLE = "Builder subscription expired"
ENGINEER_EXPIRY_MESSAGE = (
    "The builder's subscription has expired. Site calendar and photo history is temporarily unavailable "
    "until the builder renews. Your progress updates, photo uploads and daily records continue as normal."
)
ENGINEER_ACCESS_PAUSED_MESSAGE = (
    "The builder's subscription has expired. Site calendar and photo history is temporarily unavailable."
)
# The renewal reminder's counterparts for the house owners and assigned Site Engineers
# (SUBSCRIPTION_REMINDER_DAYS before the end): no plan, price or payment, only the end
# date and what pauses if the builder does not renew.
OWNER_REMINDER_TITLE = "Builder subscription ending soon"
OWNER_REMINDER_MESSAGE = (
    "Your builder's subscription ends on {end}. If it is not renewed by then, site calendar and photo access "
    "will be temporarily unavailable until your builder renews their plan."
)
ENGINEER_REMINDER_TITLE = "Builder subscription ending soon"
ENGINEER_REMINDER_MESSAGE = (
    "The builder's subscription ends on {end}. If it is not renewed by then, site calendar and photo history "
    "will be temporarily unavailable until the builder renews. Your progress updates, photo uploads and daily "
    "records continue as normal."
)

# The builder's own reminder: the plan name the builder bought (the plans page's Pro /
# Plus / Premium, from plan + billing period) and its end as a local date.
PLAN_REMINDER_TITLE = "Your plan expires soon"
PLAN_REMINDER_MESSAGE = (
    "Your CREWNBUILD {plan} plan expires on {end}. Renew or upgrade from Plan & Billing to keep your "
    "subscription features."
)
PLAN_DISPLAY_NAMES = {
    (catalogue.PROFESSIONAL, "MONTHLY"): "Pro",
    (catalogue.BUSINESS, "MONTHLY"): "Plus",
    (catalogue.BUSINESS, "ANNUAL"): "Premium",
}


def is_india_account(user: User) -> bool:
    """Plans are sold in India only. Every account is IN today; the old app's check is
    kept so the rule stays visible."""
    return (user.country_code or "India").strip().upper() in {"INDIA", "IN", "IND"}


def plan_display_name(plan_code: str, duration_code: str | None) -> str:
    """Pro / Plus / Premium; a period bought otherwise is named by its tier."""
    named = PLAN_DISPLAY_NAMES.get((plan_code, duration_code or ""))
    return named or {catalogue.PROFESSIONAL: "Pro", catalogue.BUSINESS: "Premium"}.get(plan_code, plan_code.title())


def local_date_label(moment: datetime) -> str:
    """A stored UTC instant as its date in the app's local timezone, e.g. 31 Oct 2026."""
    return f"{datetime.fromisoformat(local_iso(moment) or ''):%d %b %Y}"


def add_months(moment: datetime, months: int) -> datetime:
    """Calendar months, the day clamped to the target month's length (31 Jan + 1 = 28/29 Feb)."""
    month_index = moment.month - 1 + months
    year = moment.year + month_index // 12
    month = month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def period_end_for(start: datetime, duration_code: str) -> datetime:
    return add_months(start, catalogue.DURATION_MONTHS[duration_code])


@dataclass
class SubscriptionState:
    status: str  # ACTIVE | GRACE | TRIAL | EXPIRED | NONE
    plan_code: str  # the tier whose features apply now
    current: BuilderSubscription | None = None  # the period in force (or the lapsed one)
    coverage_end: datetime | None = None  # end of the last contiguous paid period
    grace_until: datetime | None = None
    queued: list[BuilderSubscription] = field(default_factory=list)  # paid periods starting later
    free_access_until: datetime | None = None  # end of the account's free first month

    @property
    def features(self) -> frozenset[str]:
        if self.status in (STATUS_ACTIVE, STATUS_GRACE):
            return catalogue.plan_for(self.plan_code).features
        return catalogue.FREE_ACCESS_FEATURES if self.status == STATUS_TRIAL else frozenset()

    @property
    def free_access_ended(self) -> bool:
        """The free month is over and no paid plan has ever been in force."""
        return self.status == STATUS_NONE and self.free_access_until is not None

    @property
    def is_premium(self) -> bool:
        return catalogue.PREMIUM_BADGE in self.features

    @property
    def badge(self) -> str | None:
        """The PRO / PREMIUM mark while a paid plan with the badge is in force, else None."""
        return catalogue.PLAN_BADGES.get(self.plan_code) if self.is_premium else None


def _periods(database: Session, builder_id: uuid.UUID) -> list[BuilderSubscription]:
    return list(
        database.scalars(
            select(BuilderSubscription)
            .where(BuilderSubscription.builder_id == builder_id, BuilderSubscription.status == PERIOD_ACTIVE)
            .order_by(BuilderSubscription.subscription_start, BuilderSubscription.created_at)
        ).all()
    )


def coverage_end(periods: list[BuilderSubscription], plan_code: str, now: datetime) -> datetime | None:
    """End of the unbroken run of `plan_code` periods covering now (renewals chain end to start)."""
    end = None
    for period in periods:
        if period.plan_code != plan_code:
            continue
        if end is None:
            if period.subscription_start <= now < period.subscription_end:
                end = period.subscription_end
        elif period.subscription_start <= end:
            end = max(end, period.subscription_end)
    return end


def free_access_end(database: Session, builder_id: uuid.UUID) -> datetime | None:
    """End of the account's free trial: its creation (accounts are ACTIVE from sign-up)
    plus FREE_ACCESS_DAYS days, as naive UTC."""
    created_at = database.scalar(select(User.created_at).where(User.id == builder_id))
    if created_at is None:
        return None
    if created_at.tzinfo is not None:
        created_at = created_at.astimezone(UTC).replace(tzinfo=None)
    return created_at + timedelta(days=catalogue.FREE_ACCESS_DAYS)


def subscription_state(database: Session, builder_id: uuid.UUID, now: datetime | None = None) -> SubscriptionState:
    """A paid period in force, then its grace, then the free month, then nothing."""
    now = now or naive_utc_now()
    periods = _periods(database, builder_id)
    queued = [period for period in periods if period.subscription_start > now]
    free_until = free_access_end(database, builder_id)
    current = next((period for period in periods if period.subscription_start <= now < period.subscription_end), None)
    if current is not None:
        return SubscriptionState(
            STATUS_ACTIVE,
            current.plan_code,
            current,
            coverage_end(periods, current.plan_code, now),
            queued=queued,
            free_access_until=free_until,
        )
    past = [period for period in periods if period.subscription_end <= now]
    lapsed = max(past, key=lambda period: period.subscription_end) if past else None
    grace_days = get_settings().subscription_grace_days
    grace_until = lapsed.subscription_end + timedelta(days=grace_days) if lapsed and grace_days else None
    if lapsed is not None and grace_until is not None and now < grace_until:
        return SubscriptionState(
            STATUS_GRACE, lapsed.plan_code, lapsed, lapsed.subscription_end, grace_until, queued, free_until
        )
    if free_until is not None and now < free_until:
        return SubscriptionState(STATUS_TRIAL, catalogue.FREE, None, None, None, queued, free_until)
    if lapsed is None:
        return SubscriptionState(STATUS_NONE, catalogue.FREE, queued=queued, free_access_until=free_until)
    return SubscriptionState(
        STATUS_EXPIRED, catalogue.FREE, lapsed, lapsed.subscription_end, grace_until, queued, free_until
    )


# ---- guards ----


def require_builder(user: User) -> None:
    if (user.role or "").upper() != BUILDER_ROLE:
        raise HTTPException(
            status_code=403, detail={"code": BUILDER_ONLY, "message": "Subscriptions are available to builders only."}
        )


def require_feature(database: Session, user: User, feature: str) -> SubscriptionState:
    """Refuse unless the builder's plan in force includes `feature`. Call it AFTER the
    existing role/project checks; it never grants access those checks refused."""
    require_builder(user)
    state = subscription_state(database, user.id)
    if feature in state.features:
        return state
    needed = catalogue.FEATURE_MINIMUM_PLAN.get(feature, catalogue.PROFESSIONAL)
    if state.status == STATUS_EXPIRED:
        code, message = SUBSCRIPTION_EXPIRED, "Your subscription has expired. Renew it to use this feature again."
    elif state.free_access_ended:
        code, message = FREE_ACCESS_EXPIRED, FREE_ACCESS_EXPIRED_MESSAGE
    elif state.status in (STATUS_ACTIVE, STATUS_GRACE):
        code, message = PLAN_UPGRADE_REQUIRED, "This feature is not included in your current plan."
    else:
        code, message = SUBSCRIPTION_REQUIRED, "This feature needs a paid builder plan."
    raise HTTPException(
        status_code=403, detail={"code": code, "message": message, "required_plan": needed, "feature": feature}
    )


def core_tools_gated(user: User) -> bool:
    """Plans are sold in India only. A builder elsewhere cannot buy one, so their core
    tools are never gated and no free-access notice is sent."""
    return is_india_account(user)


def require_builder_feature(database: Session, user: User, feature: str) -> None:
    """For endpoints the builder SHARES with engineers and house owners: gate the builder
    only. Every other role passes untouched, so an engineer's records and an owner's
    view never depend on a builder's subscription. Call it after the endpoint's own
    access check."""
    if (user.role or "").upper() == BUILDER_ROLE and core_tools_gated(user):
        require_feature(database, user, feature)


def builder_feature_allowed(database: Session, user: User, feature: str) -> bool:
    """require_builder_feature as a yes/no, for responses that leave the gated data out
    instead of refusing the whole request. Every other role is always allowed."""
    if (user.role or "").upper() != BUILDER_ROLE or not core_tools_gated(user):
        return True
    return feature in subscription_state(database, user.id).features


def project_builder_allows(database: Session, project: Project | None, feature: str) -> bool:
    """Whether the project's builder currently has `feature`. A project with no builder
    (self-construction) or a builder outside the gated region is never paused."""
    if project is None or project.contractor_id is None:
        return True
    builder = database.get(User, project.contractor_id)
    if builder is None or (builder.role or "").upper() != BUILDER_ROLE or not core_tools_gated(builder):
        return True
    return feature in subscription_state(database, builder.id).features


def project_feature_allowed(database: Session, user: User, project: Project | None, feature: str) -> bool:
    """A core tool on one project, as a yes/no: the builder by their own plan, the house
    owner and the Site Engineer by the project's builder's plan, every other role always.
    For the engineer this covers VIEWING only; reporting is never gated."""
    role = (user.role or "").upper()
    if role == BUILDER_ROLE:
        return builder_feature_allowed(database, user, feature)
    if role in (OWNER_ROLE, ENGINEER_ROLE):
        return project_builder_allows(database, project, feature)
    return True


def require_project_feature(database: Session, user: User, project: Project | None, feature: str) -> None:
    """project_feature_allowed as a guard, after the endpoint's own access check. The
    builder gets the usual subscription codes; the owner and the engineer
    BUILDER_SUBSCRIPTION_EXPIRED."""
    role = (user.role or "").upper()
    if role == BUILDER_ROLE:
        require_builder_feature(database, user, feature)
    elif role in (OWNER_ROLE, ENGINEER_ROLE) and not project_builder_allows(database, project, feature):
        message = OWNER_ACCESS_PAUSED_MESSAGE if role == OWNER_ROLE else ENGINEER_ACCESS_PAUSED_MESSAGE
        raise HTTPException(
            status_code=403, detail={"code": BUILDER_ACCESS_PAUSED, "message": message, "feature": feature}
        )


# ---- lifecycle ----


def _awarded_owner_projects(database: Session, builder_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
    """Owners of the builder's active awarded projects -> their project titles."""
    rows = database.execute(
        select(Project.owner_id, Project.title).where(
            Project.contractor_id == builder_id, Project.status == "active", Project.owner_id.isnot(None)
        )
    ).all()
    owners: dict[uuid.UUID, list[str]] = {}
    for owner_id, title in rows:
        owners.setdefault(owner_id, []).append(title)
    return owners


def _lock_builder(database: Session, builder_id: uuid.UUID) -> None:
    database.execute(select(User.id).where(User.id == builder_id).with_for_update())


def sync_lifecycle(database: Session, builder: User, now: datetime | None = None) -> SubscriptionState:
    """Write the once-only reminder / expiry notices due for this builder, then commit.

    Idempotent: each notice is recorded on the period row (reminder_sent_at,
    expiry_notified_at), so reading the status again never repeats it. A renewal creates
    a new period row, so the next lapse is notified again, once.
    """
    now = now or naive_utc_now()
    state = subscription_state(database, builder.id, now)
    settings = get_settings()
    changed = False

    if state.status == STATUS_ACTIVE and state.coverage_end is not None:
        last = _period_ending_at(database, builder.id, state.plan_code, state.coverage_end)
        reminder_from = state.coverage_end - timedelta(days=settings.subscription_reminder_days)
        due = (
            bool(settings.subscription_reminder_days) and last is not None and now >= reminder_from and not state.queued
        )
        if due and last is not None and last.reminder_sent_at is None:
            # Serialise concurrent callers on the builder's row, then re-read this
            # period's marker, so it goes out once.
            _lock_builder(database, builder.id)
            database.refresh(last)
        if due and last is not None and last.reminder_sent_at is None:
            add_notification(
                database,
                builder.id,
                PLAN_REMINDER_TITLE,
                PLAN_REMINDER_MESSAGE.format(
                    plan=plan_display_name(last.plan_code, last.duration_code),
                    end=local_date_label(state.coverage_end),
                ),
                category="ACCOUNT",
            )
            # The house owners and assigned Site Engineers of this builder's active
            # awarded projects, in the same transaction as the marker below.
            end = f"{state.coverage_end:%d %b %Y}"
            _notify_owners(database, builder, OWNER_REMINDER_TITLE, OWNER_REMINDER_MESSAGE.format(end=end))
            _notify_engineers(database, builder, ENGINEER_REMINDER_TITLE, ENGINEER_REMINDER_MESSAGE.format(end=end))
            last.reminder_sent_at = now
            changed = True

    lapsed = state.current if state.status == STATUS_EXPIRED else None
    if lapsed is not None and lapsed.expiry_notified_at is None:
        _lock_builder(database, builder.id)
        database.refresh(lapsed)
    if lapsed is not None and lapsed.expiry_notified_at is None:
        add_notification(
            database,
            builder.id,
            "Your plan has ended",
            f"Your CREWNBUILD {lapsed.plan_code.title()} plan ended on {lapsed.subscription_end:%d %b %Y}. "
            "Your calendar, site photos and billing tools are paused, and your clients' and site engineers' "
            "calendar and photo access is temporarily unavailable until you renew. Your records are kept. "
            "Renew from Plan & billing.",
            category="ACCOUNT",
        )
        # Neutral notices to the house owners and the assigned Site Engineers of this
        # builder's active awarded projects: no plan name, price, payment or date.
        _notify_owners(database, builder)
        _notify_engineers(database, builder)
        lapsed.expiry_notified_at = now
        changed = True

    free_until = state.free_access_until
    if (
        state.free_access_ended
        and free_until is not None
        and now >= free_until
        and core_tools_gated(builder)
        and not _free_access_notice_sent(database, builder.id)
    ):
        # Only when a notice looks due: serialise concurrent callers (the sweep and a
        # request) on the builder's row, then re-check, so it goes out once.
        _lock_builder(database, builder.id)
        if not _free_access_notice_sent(database, builder.id):
            add_notification(
                database, builder.id, FREE_ACCESS_EXPIRED_TITLE, FREE_ACCESS_EXPIRED_MESSAGE, category="ACCOUNT"
            )
            _notify_owners(database, builder)
            _notify_engineers(database, builder)
            changed = True

    if changed:
        database.commit()
        logger.info("subscription.lifecycle_notified builder=%s status=%s", builder.id, state.status)
    return state


def _notify_owners(
    database: Session, builder: User, title: str = OWNER_EXPIRY_TITLE, message: str = OWNER_EXPIRY_MESSAGE
) -> None:
    """One neutral notice to each house owner with an active project awarded to this
    builder: no plan, price or payment (the expiry notice, or the reminder)."""
    for owner_id, titles in _awarded_owner_projects(database, builder.id).items():
        project_names = ", ".join(sorted(set(titles)))
        add_notification(
            database,
            owner_id,
            title,
            f"{message} (Builder: {builder.name}; project: {project_names}.)",
            category="PROJECT",
        )


def _assigned_engineer_projects(database: Session, builder_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
    """Site Engineers actively assigned to the builder's active awarded projects -> titles."""
    rows = database.execute(
        select(ProjectEngineer.engineer_id, Project.title)
        .join(Project, Project.id == ProjectEngineer.project_id)
        .where(Project.contractor_id == builder_id, Project.status == "active", ProjectEngineer.status == "ACTIVE")
    ).all()
    engineers: dict[uuid.UUID, list[str]] = {}
    for engineer_id, title in rows:
        engineers.setdefault(engineer_id, []).append(title)
    return engineers


def _notify_engineers(
    database: Session, builder: User, title: str = ENGINEER_EXPIRY_TITLE, message: str = ENGINEER_EXPIRY_MESSAGE
) -> None:
    """One neutral notice to each assigned Site Engineer: no plan, price or payment."""
    for engineer_id, titles in _assigned_engineer_projects(database, builder.id).items():
        project_names = ", ".join(sorted(set(titles)))
        add_notification(
            database,
            engineer_id,
            title,
            f"{message} (Builder: {builder.name}; project: {project_names}.)",
            category="PROJECT",
        )


def _free_access_notice_sent(database: Session, builder_id: uuid.UUID) -> bool:
    found = database.scalar(
        select(Notification.id).where(
            Notification.user_id == builder_id, Notification.title == FREE_ACCESS_EXPIRED_TITLE
        )
    )
    return found is not None


def _period_ending_at(
    database: Session, builder_id: uuid.UUID, plan_code: str, end: datetime
) -> BuilderSubscription | None:
    return database.scalars(
        select(BuilderSubscription).where(
            BuilderSubscription.builder_id == builder_id,
            BuilderSubscription.status == PERIOD_ACTIVE,
            BuilderSubscription.plan_code == plan_code,
            BuilderSubscription.subscription_end == end,
        )
    ).first()
