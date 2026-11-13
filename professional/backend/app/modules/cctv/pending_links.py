"""What the CCTV code reads from modules not ported yet.

NOT PORTED YET: billing. A builder's plan never limits a camera to SD: every viewer may
choose HD until billing replaces this (docs/porting-todo.md).
"""

from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.modules.identity.models import User

# The refusal code the old plan check answered with (kept for the day it applies again).
PLAN_UPGRADE_REQUIRED = "PLAN_UPGRADE_REQUIRED"
catalogue = SimpleNamespace(HD_VIDEO="hd_video")


def builder_feature_allowed(database: Session, user: User, feature: str) -> bool:
    """STUB (billing): whether the builder's plan includes this feature (HD video)."""
    return True
