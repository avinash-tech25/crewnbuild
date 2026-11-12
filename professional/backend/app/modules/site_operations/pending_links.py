"""What site operations reads from modules not ported yet.

NOT PORTED YET: each `pending_*` function answers "nothing found" (or "allowed" for the
plan check) until its module replaces it (docs/porting-todo.md).

    marketplace  no supplier listing exists: a stock material has no supplier, product
                 or catalogue price (the rate recorded on the last usage is used, as for
                 any material bought outside the catalogue), and no fulfilled order
                 arrives on a day
    billing      a builder's plan never gates the cost tool, the owner's analysis or the
                 legacy logs
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.modules.identity.models import User

BUILDER_BILLING = "builder_billing"


def pending_supplier_products(database: Session, product_ids: list[Any]) -> list[Any]:
    """STUB (marketplace): the supplier listings with these ids (each with id, price,
    supplier_id, brand, size)."""
    return []


def pending_fulfilled_orders(database: Session, project_id: uuid.UUID, start: datetime, end: datetime) -> list[Any]:
    """STUB (marketplace): material order lines a supplier fulfilled for the project
    between two UTC instants."""
    return []


def pending_require_builder_feature(database: Session, user: User, feature: str) -> None:
    """STUB (billing): refuse a builder whose plan lacks this core tool (the engineer,
    owner and others are never gated here)."""
    return None
