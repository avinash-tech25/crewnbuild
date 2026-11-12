"""The kinds of project request (ported from the old project_request_types.py). The
stored values are unchanged: rows already sent carry them."""

import uuid

from app.modules.projects.models import ProjectRequest

# A specialist invitation is an ordinary project request, answered through the same
# accept and reject endpoints.
SPECIALIST_REQUEST_TYPE = "SITE_ENGINEER_TO_SPECIALIST"
# A House Owner hiring a Site Engineer for their own self-construction project.
OWNER_ENGINEER_REQUEST_TYPE = "OWNER_TO_ENGINEER"
# The two request types that carry a House Owner <-> Builder quotation.
OWNER_BUILDER_REQUEST_TYPES = ("OWNER_TO_CONTRACTOR", "CONTRACTOR_TO_OWNER")
# A property enquiry (property module; stored in property_enquiries).
PROPERTY_REQUEST_TYPE = "PROPERTY_BUYER_TO_SELLER"
SUPPLIER_BUILDER_REQUEST_TYPES = ("SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER")
OWNER_SUPPLIER_REQUEST_TYPES = ("SUPPLIER_TO_OWNER", "OWNER_TO_SUPPLIER")
# The request types /project-requests/send creates; anything else is refused.
SEND_REQUEST_TYPES = (
    "OWNER_TO_CONTRACTOR",
    "CONTRACTOR_TO_OWNER",
    "OWNER_TO_SUPPLIER",
    "SUPPLIER_TO_OWNER",
    OWNER_ENGINEER_REQUEST_TYPE,
    "SUPPLIER_TO_CONTRACTOR",
    "CONTRACTOR_TO_SUPPLIER",
)


def builder_id_on_request(request: ProjectRequest) -> uuid.UUID | None:
    """The builder's user id on an owner/builder request, whoever sent it."""
    if request.request_type == "OWNER_TO_CONTRACTOR":
        return request.receiver_id
    if request.request_type == "CONTRACTOR_TO_OWNER":
        return request.sender_id
    return None


def owner_id_on_request(request: ProjectRequest) -> uuid.UUID | None:
    """The House Owner's user id on an owner/builder request, whoever sent it."""
    if request.request_type == "OWNER_TO_CONTRACTOR":
        return request.sender_id
    if request.request_type == "CONTRACTOR_TO_OWNER":
        return request.receiver_id
    return None


def request_notification_category(request_type: str | None) -> str:
    """Category of the generic request notifications, by the request's type."""
    if request_type in OWNER_BUILDER_REQUEST_TYPES:
        return "NEGOTIATION"
    if request_type in (OWNER_ENGINEER_REQUEST_TYPE, SPECIALIST_REQUEST_TYPE):
        return "ENGINEER"
    if request_type in OWNER_SUPPLIER_REQUEST_TYPES + SUPPLIER_BUILDER_REQUEST_TYPES:
        return "SUPPLIER"
    if request_type == PROPERTY_REQUEST_TYPE:
        return "PROPERTY"
    return "PROJECT"
