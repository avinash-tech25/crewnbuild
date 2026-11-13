"""Support endpoints under /api/v1 (ported from the old support_routes.py,
report_routes.py and contact_routes.py; paths and answers unchanged).

Public (a signed-in person is recognised when there is a valid session):
    GET  /support/config, POST /support/tickets, GET /report-categories, POST /contact
Signed in (the account's own tickets and reports only):
    GET  /support/tickets, GET /support/tickets/{reference},
    POST /support/tickets/{reference}/messages, GET /support/tickets/{reference}/attachment,
    POST /reports, GET /reports/mine

Staff ticket and report handling: /admin/support/tickets and /admin/reports (modules/admin).
"""

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import app_settings, current_user, optional_user
from app.core.client_address import visitor_address
from app.core.config import Settings
from app.database.session import get_db
from app.integrations.email.email_sender import EmailSender
from app.modules.files.models import File as StoredFile
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import User
from app.modules.identity.router import get_email_sender
from app.modules.rate_limits import service as limits
from app.modules.support import report_service
from app.modules.support import ticket_service as tickets
from app.modules.support.models import REPORT_CATEGORIES

logger = logging.getLogger(__name__)

router = APIRouter()


# ---- support tickets ----


@router.get("/support/config", tags=["Support"])
def support_config(
    user: User | None = Depends(optional_user),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    config = tickets.public_config(user, settings)
    config["tickets_available"] = tickets.tickets_installed(database)
    if user:
        config["account"] = {
            "name": user.name or "",
            "email": user.email or "",
            "phone": tickets.phone_digits(user.phone or "") or "",
            "dial_code": tickets.account_dial_code(user),
            "account_type": tickets.taxonomy.ROLE_ACCOUNT_TYPES.get(user.role),
        }
    return config


@router.post("/support/tickets", status_code=201, tags=["Support"])
def submit_ticket(
    request: Request,
    response: Response,
    payload: str = Form(...),
    attachment: UploadFile | None = File(default=None),
    user: User | None = Depends(optional_user),
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    uploads: UploadService = Depends(get_upload_service),
    email: EmailSender = Depends(get_email_sender),
) -> dict[str, Any]:
    tickets.require_tickets(database)
    submission = tickets.parse_submission(payload)
    key = f"user:{user.id}" if user else f"ip:{visitor_address(request, settings.trusted_proxy_ips)}"
    # A repeat of a request already made is answered without counting again.
    already = tickets.ticket_by_request(database, submission.client_request_id)
    if not already and not tickets.within_rate_limit(database, key, settings):
        raise HTTPException(status_code=429, detail="Too many support requests. Please try again later.")
    ticket, created = tickets.create_ticket(database, settings, uploads, email, submission, user, attachment)
    if not created:
        response.status_code = 200
    return {
        "created": created,
        "signed_in": user is not None,
        **tickets.serialize_ticket(database, ticket, with_messages=False),
    }


@router.get("/support/tickets", tags=["Support"])
def my_tickets(user: User = Depends(current_user), database: Session = Depends(get_db)) -> dict[str, Any]:
    tickets.require_tickets(database)
    return {"tickets": tickets.list_own(database, user)}


@router.get("/support/tickets/{reference}", tags=["Support"])
def my_ticket(
    reference: str, user: User = Depends(current_user), database: Session = Depends(get_db)
) -> dict[str, Any]:
    tickets.require_tickets(database)
    return tickets.serialize_ticket(database, tickets.own_ticket(database, user, reference), with_messages=True)


class ReplyBody(BaseModel):
    body: str


@router.post("/support/tickets/{reference}/messages", tags=["Support"])
def reply_on_my_ticket(
    reference: str, reply: ReplyBody, user: User = Depends(current_user), database: Session = Depends(get_db)
) -> dict[str, Any]:
    tickets.require_tickets(database)
    ticket = tickets.add_user_reply(database, user, reference, reply.body)
    return tickets.serialize_ticket(database, ticket, with_messages=True)


def attachment_response(uploads: UploadService, stored: StoredFile) -> Response:
    ascii_name = stored.filename.encode("ascii", "ignore").decode().replace('"', "") or "attachment"
    return Response(
        content=uploads.read_content(stored),
        media_type=stored.content_type,
        headers={
            "Content-Disposition": (
                f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(stored.filename, safe='')}"
            ),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/support/tickets/{reference}/attachment", tags=["Support"])
def my_ticket_attachment(
    reference: str,
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
    uploads: UploadService = Depends(get_upload_service),
) -> Response:
    tickets.require_tickets(database)
    ticket = tickets.own_ticket(database, user, reference)
    return attachment_response(uploads, tickets.attachment_for(database, ticket))


# ---- reports ----


class ReportCreate(BaseModel):
    subject_type: str  # "user" or "project"
    subject_id: str
    category: str = "OTHER"
    description: str


@router.get("/report-categories", tags=["Reports"])
def fetch_report_categories() -> dict[str, list[str]]:
    return {"categories": list(REPORT_CATEGORIES)}


@router.post("/reports", status_code=201, tags=["Reports"])
def create_report(
    payload: ReportCreate, user: User = Depends(current_user), database: Session = Depends(get_db)
) -> dict[str, Any]:
    """The administrator who handles it is decided from the subject's country."""
    return report_service.create_report(
        database, user, payload.subject_type, payload.subject_id, payload.category, payload.description
    )


@router.get("/reports/mine", tags=["Reports"])
def fetch_my_reports(user: User = Depends(current_user), database: Session = Depends(get_db)) -> dict[str, Any]:
    return report_service.my_reports(database, user)


# ---- public contact form (stores nothing; delivered by e-mail) ----

CONTACT_BUCKET = "contact:address"
_CONTACT_WINDOW_SECONDS = 3600


class ContactEnquiry(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(default="", max_length=40)
    message: str = Field(min_length=1, max_length=4000)
    interest: str = Field(default="", max_length=120)
    city: str = Field(default="", max_length=120)


def contact_within_rate_limit(database: Session, client: str | None, settings: Settings) -> bool:
    """CONTACT_MAX_PER_HOUR_PER_IP per address, shared by every process."""
    return limits.hit(
        database, CONTACT_BUCKET, client or "unknown", settings.contact_max_per_hour_per_ip, _CONTACT_WINDOW_SECONDS
    )


def compose_enquiry(enquiry: ContactEnquiry) -> tuple[str, str]:
    lines = [f"Name:     {enquiry.name}", f"Email:    {enquiry.email}"]
    if enquiry.phone:
        lines.append(f"Phone:    {enquiry.phone}")
    if enquiry.interest:
        lines.append(f"Interest: {enquiry.interest}")
    if enquiry.city:
        lines.append(f"City:     {enquiry.city}")
    lines.extend(["", enquiry.message])
    return f"Website enquiry from {enquiry.name}", "\n".join(lines)


@router.post("/contact", status_code=202, tags=["Contact"])
def submit_contact_enquiry(
    enquiry: ContactEnquiry,
    request: Request,
    settings: Settings = Depends(app_settings),
    email: EmailSender = Depends(get_email_sender),
    database: Session = Depends(get_db),
) -> dict[str, bool]:
    """202 only once the mail service took the enquiry; nothing is stored (but the attempt
    is counted against the address, in rate_limit_events)."""
    destination = settings.contact_destination_email.strip()
    if not destination:
        logger.error("A contact enquiry arrived but CONTACT_DESTINATION_EMAIL is not set; it was not delivered.")
        raise HTTPException(status_code=503, detail="Enquiries are temporarily unavailable.")
    if not email.configured:
        logger.error("A contact enquiry arrived but email delivery is not configured; it was not delivered.")
        raise HTTPException(status_code=503, detail="Enquiries are temporarily unavailable.")
    if not contact_within_rate_limit(database, visitor_address(request, settings.trusted_proxy_ips), settings):
        raise HTTPException(status_code=429, detail="Too many enquiries from this connection. Please try again later.")
    subject, body = compose_enquiry(enquiry)
    if not email.send_email(destination, subject, body):
        raise HTTPException(status_code=502, detail="We could not send your enquiry. Please try again.")
    return {"accepted": True}
