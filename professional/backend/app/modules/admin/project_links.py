"""What the admin console reads from projects and project requests.

NOT PORTED YET: the projects module owns these tables. Each `pending_*` function answers
"nothing found" until that module replaces it (docs/porting-todo.md), so the admin
screens that show projects stay up with empty lists:

    GET /admin/projects           empty list
    GET /admin/projects/{id}      404 "Project not found"
    GET /admin/leads              empty list
    user detail                   no projects owned or being built
    overview                      stalled requests 0, projects 0
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session


def pending_projects_owned_by(database: Session, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """STUB (projects): [{id, title, status}] of the projects this account owns."""
    return []


def pending_projects_built_by(database: Session, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """STUB (projects): [{id, title, status}] of the projects this account is building."""
    return []


def pending_admin_projects(database: Session, admin: Any, *, limit: int, offset: int) -> dict[str, Any]:
    """STUB (projects): the old AdminProjectService.fetch_admin_projects page."""
    return {"total": 0, "limit": limit, "offset": offset, "scope": admin.scope, "projects": []}


def pending_project_detail(database: Session, admin: Any, project_id: uuid.UUID) -> dict[str, Any] | None:
    """STUB (projects): the old AdminProjectService.fetch_project_detail answer, or None."""
    return None


def pending_marketplace_activity(
    database: Session, admin: Any, *, status: str | None, kind: str | None, limit: int, offset: int
) -> dict[str, Any]:
    """STUB (projects, project_requests): the old AdminLeadService answer."""
    return {
        "scope": admin.scope,
        "total": 0,
        "limit": limit,
        "offset": offset,
        "summary": {
            "pending": 0,
            "accepted": 0,
            "rejected": 0,
            "withdrawn": 0,
            "stalled": 0,
            "acceptance_rate": None,
        },
        "requests": [],
    }


def pending_stalled_request_count(database: Session, admin: Any, stalled_after_days: int) -> int:
    """STUB (project_requests): pending requests older than the threshold, in scope."""
    return 0


def pending_project_count(database: Session, country: str) -> int:
    """STUB (projects): projects being built in this country."""
    return 0
