"""Reporting an account or a project (ported from the old reports module and
admin report_service.raise_report / describe). Resolving reports is the admin module's
(modules/admin/report_service.py).

The administrative scope is fixed from the subject when the report is raised, never
from the person complaining.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.admin.admin_identity import account_locality
from app.modules.identity.models import User
from app.modules.support.models import REPORT_CATEGORIES, REPORT_STATUS_NEW, UserReport


def find_project(database: Session, subject_id: str) -> tuple[str, str] | None:
    """(title, locality) of the project a report names, or None. A project belongs to the
    country it is built in; India is the only one."""
    from app.modules.projects.models import Project

    key = account_key(subject_id)
    project = database.get(Project, key) if key else None
    return (project.title, "IN") if project else None


def account_key(subject_id: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(subject_id))
    except (TypeError, ValueError, AttributeError):
        return None


def find_account(database: Session, subject_id: str) -> User | None:
    key = account_key(subject_id)
    return database.get(User, key) if key else None


def raise_report(
    database: Session, reporter: User, *, subject_type: str, subject_id: str, category: str, description: str
) -> UserReport:
    subject_type = (subject_type or "").strip().lower()
    description = (description or "").strip()
    category = (category or "OTHER").strip().upper()
    if subject_type not in ("user", "project"):
        raise HTTPException(status_code=400, detail="Report a user or a project.")
    if len(description) < 10:
        raise HTTPException(status_code=400, detail="Describe what happened in a little more detail.")
    if category not in REPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Choose one of: {', '.join(REPORT_CATEGORIES)}")

    if subject_type == "project":
        project = find_project(database, subject_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        scope = project[1]
    else:
        subject = find_account(database, subject_id)
        if not subject:
            raise HTTPException(status_code=404, detail="Account not found")
        if subject.id == reporter.id:
            raise HTTPException(status_code=400, detail="You cannot report your own account.")
        scope = account_locality(subject)

    report = UserReport(
        reporter_id=reporter.id,
        subject_type=subject_type,
        subject_id=subject_id,
        category=category,
        description=description,
        status=REPORT_STATUS_NEW,
        scope=scope,
    )
    database.add(report)
    database.flush()
    return report


def describe(database: Session, report: UserReport) -> dict[str, Any]:
    reporter = database.get(User, report.reporter_id)
    if report.subject_type == "project":
        project = find_project(database, report.subject_id)
        subject_name = project[0] if project else None
    else:
        subject = find_account(database, report.subject_id)
        subject_name = f"{subject.name} ({subject.role})" if subject else None
    return {
        "id": report.id,
        "category": report.category,
        "description": report.description,
        "status": report.status,
        "scope": report.scope,
        "subject_type": report.subject_type,
        "subject_id": report.subject_id,
        "subject_name": subject_name,
        "reporter_name": reporter.name if reporter else None,
        "reporter_email": reporter.email if reporter else None,
        "resolution_note": report.resolution_note,
        "resolved_at": report.resolved_at,
        "created_at": report.created_at,
    }


def create_report(
    database: Session, reporter: User, subject_type: str, subject_id: str, category: str, description: str
) -> dict[str, Any]:
    report = raise_report(
        database, reporter, subject_type=subject_type, subject_id=subject_id, category=category, description=description
    )
    database.commit()
    database.refresh(report)
    return describe(database, report)


def my_reports(database: Session, reporter: User) -> dict[str, Any]:
    rows = database.scalars(
        select(UserReport).where(UserReport.reporter_id == reporter.id).order_by(UserReport.created_at.desc())
    ).all()
    return {"reports": [describe(database, row) for row in rows]}
