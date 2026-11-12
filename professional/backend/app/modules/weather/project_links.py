"""The weather module's view of projects. NOT PORTED YET: everything here is a stub
until the projects module replaces it (docs/porting-todo.md). Until then there are no
projects: every project weather endpoint answers 404 "Project not found", nothing is
monitored for a project, and only personal sites ("My location") and the public
weather work.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.identity.models import User


class Project:
    """STUB (projects): stands for the projects module's Project model, so the ported
    weather code can tell a project from a personal site. No instance is ever made."""

    id: uuid.UUID
    title: str
    owner_id: uuid.UUID
    contractor_id: uuid.UUID | None
    address: str
    pincode: str
    status: str | None
    project_city: str | None
    project_state: str | None
    project_country: str | None


def ensure_project_activity_read_access(database: Session, project_id: Any, user: User) -> Project:
    """STUB (projects): the project, if the account is its owner, awarded builder or an
    actively assigned Site Engineer; 404 when it does not exist, 403 otherwise."""
    raise HTTPException(status_code=404, detail="Project not found")


def contractor_has_project_access(database: Session, project_id: Any, user_id: uuid.UUID) -> bool:
    """STUB (projects): the builder works on this project through an accepted award."""
    return False


def store_manager_serves_project(database: Session, store_manager: User | None, project: Project) -> bool:
    """STUB (store): the Store Manager serves this project's builder."""
    return False


def project_locality(project: Project) -> str:
    """The country code of a project's site: India is the only market."""
    return "IN"
