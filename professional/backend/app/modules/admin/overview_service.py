"""The first screen: what needs attention (ported from the old
app/admin/services/overview_service.py, same rules).

Only the sections the administrator holds permissions for are computed. A Global Super
Admin also gets the same queues per country and the country's headline numbers.
"""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.accounts.models import AdminProfile
from app.modules.admin import project_links
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.report_service import OPEN_STATUSES, count_open_reports
from app.modules.admin.scope import LOCALITY_INDIA, SCOPE_COUNTRY_NAMES, NarrowedTo, locality_code, scope_users, viewing
from app.modules.admin.verification_service import queue as verification_queue
from app.modules.identity.models import (
    DEFAULT_COUNTRY,
    ROLE_BUILDER,
    ROLE_ENGINEER,
    ROLE_OWNER,
    ROLE_PROFESSIONAL,
    ROLE_SUPPLIER,
    STATUS_SUSPENDED,
    User,
)
from app.modules.support.models import UserReport

# A request nobody has answered in a week is the one worth chasing (the Leads screen
# uses the same threshold).
STALLED_AFTER_DAYS = 7
MARKETPLACE_ROLES = (ROLE_OWNER, ROLE_BUILDER, ROLE_SUPPLIER, ROLE_ENGINEER, ROLE_PROFESSIONAL)


def country_slice(database: Session, country: str) -> dict[str, Any]:
    """One country's headline numbers."""
    if country == DEFAULT_COUNTRY:
        account_filter = or_(User.country_code == DEFAULT_COUNTRY, User.country_code.is_(None))
    else:
        account_filter = User.country_code == country
    locality = locality_code(country, LOCALITY_INDIA)
    accounts = database.scalar(select(func.count(User.id)).where(User.role.in_(MARKETPLACE_ROLES), account_filter))
    open_reports = database.scalar(
        select(func.count(UserReport.id)).where(UserReport.scope == locality, UserReport.status.in_(OPEN_STATUSES))
    )
    administrators = database.scalar(select(func.count(AdminProfile.id)).where(AdminProfile.scope == locality))
    return {
        "country": country,
        "scope": locality,
        "accounts": accounts or 0,
        "projects": project_links.pending_project_count(database, country),
        "open_reports": open_reports or 0,
        "administrators": administrators or 0,
    }


def attention_for(database: Session, viewer: Any, permissions: set[str]) -> dict[str, int]:
    """The four queues, as seen by `viewer`."""
    attention: dict[str, int] = {}
    if "verification.view" in permissions:
        attention["pending_verifications"] = len(verification_queue(database, viewer, "PENDING"))
    if "reports.view" in permissions:
        attention["open_reports"] = count_open_reports(database, viewer)
    if "users.view" in permissions:
        suspended = scope_users(select(func.count(User.id)), viewer).where(User.status == STATUS_SUSPENDED)
        attention["suspended_accounts"] = database.scalar(suspended) or 0
    if "projects.view" in permissions:
        attention["stalled_requests"] = project_links.pending_stalled_request_count(
            database, viewer, STALLED_AFTER_DAYS
        )
    return attention


def build(database: Session, admin: Any) -> dict[str, Any]:
    permissions = admin.permissions
    attention = attention_for(database, admin, permissions)
    attention_by_country = None
    countries = None
    if admin.is_global:
        attention_by_country = {LOCALITY_INDIA: attention_for(database, NarrowedTo(admin, LOCALITY_INDIA), permissions)}
        if "users.view" in permissions:
            countries = [country_slice(database, DEFAULT_COUNTRY)]
    elif "users.view" in permissions:
        own = SCOPE_COUNTRY_NAMES.get(admin.scope)
        if own:
            countries = [country_slice(database, own)]
    return {
        "scope": admin.scope,
        "is_global": admin.is_global,
        "attention": attention,
        "attention_by_country": attention_by_country,
        "countries": countries,
        "stalled_after_days": STALLED_AFTER_DAYS,
    }


def fetch_overview(database: Session, admin: AdminIdentity, country: str | None) -> dict[str, Any]:
    # A country here narrows the totals and drops the per-country split.
    return build(database, viewing(admin, country))
