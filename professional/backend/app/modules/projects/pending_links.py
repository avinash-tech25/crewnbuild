"""What the projects module reads from or writes to modules not ported yet.

NOT PORTED YET: each `pending_*` function stands in for one call into another module and
answers "nothing found" (or "allowed" for a plan check) until that module replaces it
(docs/porting-todo.md).

    messaging       conversations and their messages (request, quotation, assignment and
                    negotiation lines in the chat) are not written; notifications are
    billing         a builder's plan never gates the calendar or the site photos
    site_operations no daily records, labour logs or material usage exist, so they
                    never count as work started, never block a project deletion, and
                    a site photo is never deletable (its day has no open record)
    marketplace     an assigned supplier has no published products to show
    labour_supply   a Labour Supplier shows no active trades to a builder
    property        property enquiries are not in the request list
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.modules.identity.models import User

BUILDER_CALENDAR = "builder_calendar"
BUILDER_PHOTOS = "builder_photos"


# ---- messaging ----


def pending_create_conversation_for_users(database: Session, title: str, user_ids: list[uuid.UUID]) -> None:
    """STUB (messaging): the conversation between these accounts, created if missing."""
    return None


def pending_create_conversation_message(
    database: Session, conversation: Any, sender_id: uuid.UUID, body: str, kind: str
) -> None:
    """STUB (messaging): one message (REQUEST, QUOTATION, ASSIGNMENT, TEXT) in it."""
    return None


def pending_update_assignment_message_status(database: Session, request_id: uuid.UUID, status: str) -> None:
    """STUB (messaging): the status shown on the request's ASSIGNMENT chat card."""
    return None


# ---- billing ----


def pending_project_feature_allowed(database: Session, user: User, project: Any, feature: str) -> bool:
    """STUB (billing): whether the builder's plan (or, for the owner and the Site
    Engineer, the project's builder's plan) includes this core tool."""
    return True


def pending_require_project_feature(database: Session, user: User, project: Any, feature: str) -> None:
    """STUB (billing): pending_project_feature_allowed as a guard (403 when paused)."""
    return None


# ---- site_operations ----


def pending_work_record_label(database: Session, project_id: uuid.UUID) -> str | None:
    """STUB (site_operations): "daily site records", "material usage" or "labour logs"
    when the project has one, else None."""
    return None


def pending_has_cost_register(database: Session, project_id: uuid.UUID) -> bool:
    """STUB (site_operations): whether the project has a daily cost register."""
    return False


def pending_daily_register_status(
    database: Session, project_id: uuid.UUID, engineer_id: uuid.UUID, work_date: date
) -> str | None:
    """STUB (site_operations): the status of this engineer's daily record for that day,
    or None when there is none."""
    return None


# ---- marketplace and labour_supply ----


def pending_published_products(database: Session, supplier_ids: list[uuid.UUID]) -> list[dict[str, Any]]:
    """STUB (marketplace): the suppliers' published catalog listings as the old
    supplier_product_payload, each with its "supplier_id" and "category"."""
    return []


def pending_active_labour_trades(database: Session, supplier_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """STUB (labour_supply): the trades each Labour Supplier has active."""
    return {}


# ---- property ----


def pending_property_request_payload(listing: Any) -> dict[str, Any]:
    """STUB (property): which property a request is about; the same keys, None, on every
    request that is not a property enquiry (all of them, until property is ported)."""
    return {"property_listing_id": None, "property_title": None, "property_image_url": None, "property_price": None}
