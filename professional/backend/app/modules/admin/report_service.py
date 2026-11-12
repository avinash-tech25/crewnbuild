"""Listing and resolving reports and disputes (ported from the old
app/admin/services/report_service.py, same rules). Raising a report is the support
module's (modules/support/report_service.py), which also describes one."""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.local_time import utc_now
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import ACTION_REPORT_RESOLVED, record
from app.modules.admin.schemas import ReportDecision
from app.modules.admin.scope import viewing
from app.modules.support.models import REPORT_STATUSES, UserReport
from app.modules.support.report_service import describe

STATUS_UNDER_REVIEW = "UNDER_REVIEW"
STATUS_RESOLVED = "RESOLVED"
STATUS_REJECTED = "REJECTED"
OPEN_STATUSES = ("NEW", STATUS_UNDER_REVIEW)


def scope_reports(statement: Select[Any], admin: Any) -> Select[Any]:
    if admin.is_global:
        return statement
    return statement.where(UserReport.scope == admin.scope)


def load_in_scope(database: Session, admin: AdminIdentity, report_id: uuid.UUID) -> UserReport:
    report = database.get(UserReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not admin.is_global and report.scope != admin.scope:
        raise HTTPException(status_code=403, detail="That report belongs to another scope.")
    return report


def set_status(admin: AdminIdentity, report: UserReport, *, status: str, note: str | None) -> None:
    status = (status or "").strip().upper()
    if status not in REPORT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(REPORT_STATUSES)}")
    if status in (STATUS_RESOLVED, STATUS_REJECTED) and not (note or "").strip():
        raise HTTPException(
            status_code=400, detail="Say how this was settled — that note is the record of the decision."
        )
    report.status = status
    if status in (STATUS_RESOLVED, STATUS_REJECTED):
        report.resolved_by_id = admin.user.id
        report.resolved_at = utc_now()
        report.resolution_note = (note or "").strip()
    elif status == STATUS_UNDER_REVIEW:
        # Picking a dispute up is not settling it: an earlier settlement is cleared.
        report.resolved_by_id = None
        report.resolved_at = None
        report.resolution_note = (note or "").strip() or None


def fetch_reports(
    database: Session, admin: AdminIdentity, *, status_filter: str | None, limit: int, offset: int, country: str | None
) -> dict[str, Any]:
    statement = scope_reports(select(UserReport), viewing(admin, country))
    if status_filter:
        wanted = status_filter.upper().strip()
        # OPEN: anything still needing somebody, picked up or not.
        if wanted == "OPEN":
            statement = statement.where(UserReport.status.in_(OPEN_STATUSES))
        else:
            statement = statement.where(UserReport.status == wanted)
    total = database.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = database.scalars(statement.order_by(UserReport.created_at.desc()).offset(offset).limit(limit)).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "scope": admin.scope,
        "reports": [describe(database, row) for row in rows],
    }


def update_report(
    database: Session, admin: AdminIdentity, report_id: uuid.UUID, payload: ReportDecision
) -> dict[str, Any]:
    report = load_in_scope(database, admin, report_id)
    set_status(admin, report, status=payload.status, note=payload.note)
    # Old behaviour kept: every status change is logged as report.resolved.
    record(
        database,
        admin,
        ACTION_REPORT_RESOLVED,
        target_type="report",
        target_id=report.id,
        summary=f"Report #{report.id} ({report.category}) marked {report.status}",
        reason=payload.note,
    )
    database.commit()
    return describe(database, report)


def count_open_reports(database: Session, admin: Any) -> int:
    statement = scope_reports(select(func.count(UserReport.id)), admin).where(UserReport.status.in_(OPEN_STATUSES))
    return database.scalar(statement) or 0
