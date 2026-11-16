"""The weather module's view of projects: the projects module's own model and access
rules (owner, awarded builder, actively assigned Site Engineer)."""

from typing import Any

from app.modules.projects.access import contractor_has_project_access, ensure_project_activity_read_access
from app.modules.projects.models import Project

__all__ = [
    "Project",
    "contractor_has_project_access",
    "ensure_project_activity_read_access",
    "project_locality",
]


def project_locality(project: Any) -> str:
    """The country code of a project's site: India is the only market."""
    return "IN"
