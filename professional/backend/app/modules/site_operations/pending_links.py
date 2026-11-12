"""What site operations reads from modules not ported yet.

NOT PORTED YET: each `pending_*` function answers "nothing found" (or "allowed" for the
plan check) until its module replaces it (docs/porting-todo.md).

    billing      a builder's plan never gates the cost tool, the owner's analysis or the
                 legacy logs
"""

from sqlalchemy.orm import Session

from app.modules.identity.models import User

BUILDER_BILLING = "builder_billing"


def pending_require_builder_feature(database: Session, user: User, feature: str) -> None:
    """STUB (billing): refuse a builder whose plan lacks this core tool (the engineer,
    owner and others are never gated here)."""
    return None
