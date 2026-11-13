"""What the projects module reads from or writes to modules not ported yet.

NOT PORTED YET: each `pending_*` function stands in for one call into another module and
answers "nothing found" (or "allowed" for a plan check) until that module replaces it
(docs/porting-todo.md).

    billing         a builder's plan never gates the calendar or the site photos
"""

from typing import Any

from sqlalchemy.orm import Session

from app.modules.identity.models import User

BUILDER_CALENDAR = "builder_calendar"
BUILDER_PHOTOS = "builder_photos"


# ---- billing ----


def pending_project_feature_allowed(database: Session, user: User, project: Any, feature: str) -> bool:
    """STUB (billing): whether the builder's plan (or, for the owner and the Site
    Engineer, the project's builder's plan) includes this core tool."""
    return True


def pending_require_project_feature(database: Session, user: User, project: Any, feature: str) -> None:
    """STUB (billing): pending_project_feature_allowed as a guard (403 when paused)."""
    return None
