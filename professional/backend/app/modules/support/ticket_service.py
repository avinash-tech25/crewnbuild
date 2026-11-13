"""Support tickets: creation and the person's own tickets (ported from the old
support_service.py, same rules). The staff side is modules/admin/support_desk_service.py.

* A ticket exists only once committed; the reference (CNB-000123) is issued here.
* A signed-in person's name, e-mail and phone come from the account; the form only
  fills what the account lacks.
* A repeated client_request_id returns the ticket already made.
* URGENT is for signed-in accounts only, one active urgent ticket at a time.
* Mail is best effort and never undoes a created ticket.
"""

import logging
import re
import uuid
from datetime import UTC, date, datetime
from typing import Any

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import PROFESSIONAL_SCHEMA, Settings
from app.core.local_time import local_today
from app.integrations.email.email_sender import EmailSender
from app.modules.accounts.account_deletion_service import support_mailbox
from app.modules.admin.admin_identity import account_locality
from app.modules.files.models import File
from app.modules.files.upload_service import ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, PROFILE_IMAGE, UploadService
from app.modules.identity.models import User
from app.modules.identity.schemas import RETIRED_KUWAIT_VALUES
from app.modules.messaging.notifications import add_notification
from app.modules.rate_limits import service as limits
from app.modules.support import taxonomy
from app.modules.support.models import (
    ACTIVE_STATUSES,
    AUTHOR_STAFF,
    AUTHOR_USER,
    PRIORITY_NORMAL,
    PRIORITY_URGENT,
    STATUS_CLOSED,
    STATUS_IN_PROGRESS,
    STATUS_OPEN,
    STATUS_RESOLVED,
    STATUS_WAITING_FOR_USER,
    SupportTicket,
    SupportTicketMessage,
)

logger = logging.getLogger(__name__)

REFERENCE_PREFIX = "CNB-"
LOCALITY_INDIA = "IN"
PHONE_COUNTRIES = {
    LOCALITY_INDIA: {"code": "IN", "name": "India", "dial_code": "+91", "digits": 10, "pattern": r"^[6-9]\d{9}$"},
}
DIAL_CODE_LOCALITIES = {str(spec["dial_code"]): locality for locality, spec in PHONE_COUNTRIES.items()}
INDIA_ONLY_DETAIL = "Crew&Build is available in India only."


def support_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Support tickets are not available yet. Please contact us by email.")


def tickets_installed(database: Session) -> bool:
    name = f"{PROFESSIONAL_SCHEMA}.support_tickets"
    return database.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar() is not None


def require_tickets(database: Session) -> None:
    if not tickets_installed(database):
        logger.error("support_tickets is missing from this database; run the Professional migrations.")
        raise support_unavailable()


# ---- throttle (per hour, keyed by account or address; shared by every process) ----

SUPPORT_BUCKET = "support:ticket"
_WINDOW_SECONDS = 3600


def within_rate_limit(database: Session, key: str, settings: Settings) -> bool:
    """Count this ticket against its account or address, or False when the hour's
    SUPPORT_MAX_TICKETS_PER_HOUR is used up (counted in rate_limit_events)."""
    return limits.hit(database, SUPPORT_BUCKET, key, settings.support_max_tickets_per_hour, _WINDOW_SECONDS)


# ---- public configuration ----


def support_email_address(settings: Settings) -> str:
    return (settings.support_email or "").strip() or support_mailbox(settings)


def dial_digits(value: str) -> str:
    return "".join(character for character in value if character.isdigit() or character == "+")


def public_config(user: User | None, settings: Settings) -> dict[str, Any]:
    whatsapp = (settings.support_whatsapp or "").strip()
    phone = (settings.support_phone or "").strip()
    default_country = account_locality(user) if user else LOCALITY_INDIA
    if default_country not in PHONE_COUNTRIES:
        default_country = LOCALITY_INDIA
    return {
        "contact": {
            "email": support_email_address(settings) or None,
            "phone": phone or None,
            "phone_href": f"tel:{dial_digits(phone)}" if phone else None,
            "whatsapp": whatsapp or None,
            "whatsapp_href": f"https://wa.me/{''.join(c for c in whatsapp if c.isdigit())}" if whatsapp else None,
            "hours": (settings.support_hours or "").strip() or None,
            "response_time": (settings.support_response_time or "").strip() or None,
        },
        "phone_countries": [{"locality": locality, **spec} for locality, spec in PHONE_COUNTRIES.items()],
        "default_country": default_country,
        "attachment": {"content_types": sorted(ALLOWED_CONTENT_TYPES), "max_bytes": MAX_UPLOAD_BYTES},
        "tickets_available": None,
        **taxonomy.public_taxonomy(),
    }


# ---- creating a ticket ----


class TicketContact(BaseModel):
    name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=255)
    dial_code: str = Field(default="", max_length=6)
    phone: str = Field(default="", max_length=20)


class TicketSubmission(BaseModel):
    client_request_id: uuid.UUID
    account_type: str
    category: str
    issue_type: str
    subject: str = Field(default="", max_length=160)
    description: str
    details: dict[str, str] = Field(default_factory=dict)
    contact: TicketContact = Field(default_factory=TicketContact)
    priority: str = PRIORITY_NORMAL

    @field_validator("description")
    @classmethod
    def description_length(cls, value: str) -> str:
        value = (value or "").strip()
        if len(value) < taxonomy.DESCRIPTION_MIN_LENGTH:
            raise ValueError(f"Please describe the issue in at least {taxonomy.DESCRIPTION_MIN_LENGTH} characters.")
        if len(value) > taxonomy.DESCRIPTION_MAX_LENGTH:
            raise ValueError(f"Please keep the description under {taxonomy.DESCRIPTION_MAX_LENGTH} characters.")
        return value


class EmailOnly(BaseModel):
    email: EmailStr


def field_error(field: str, message: str) -> HTTPException:
    # The shape FastAPI uses for validation errors, so the page reads one.
    return HTTPException(status_code=422, detail=[{"loc": ["body", field], "msg": message}])


def parse_submission(raw: str) -> TicketSubmission:
    try:
        return TicketSubmission.model_validate_json(raw)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "loc": ["body", *[str(part) for part in issue["loc"]]],
                    "msg": issue["msg"].removeprefix("Value error, "),
                }
                for issue in error.errors()
            ],
        ) from error


def validate_choices(submission: TicketSubmission) -> tuple[str, ...]:
    if submission.account_type not in taxonomy.ACCOUNT_TYPES:
        raise field_error("account_type", "Please choose your account type.")
    if not taxonomy.category_allowed(submission.account_type, submission.category):
        raise field_error("category", "Please choose an issue category.")
    fields = taxonomy.issue_fields(submission.category, submission.issue_type)
    if fields is None:
        raise field_error("issue_type", "Please choose the issue.")
    if submission.priority not in (PRIORITY_NORMAL, PRIORITY_URGENT):
        raise field_error("priority", "Please choose Normal or Urgent.")
    return fields


def clean_details(submission: TicketSubmission, allowed: tuple[str, ...]) -> dict[str, str]:
    """Only the fields the chosen issue asks for, trimmed and bounded."""
    details: dict[str, str] = {}
    for key in allowed:
        value = str(submission.details.get(key) or "").strip()
        if not value:
            continue
        spec = taxonomy.DETAIL_FIELDS[key]
        if len(value) > int(spec["max_length"]):
            raise field_error(f"details.{key}", f"{spec['label']} is too long.")
        if spec.get("type") == "date":
            try:
                in_future = date.fromisoformat(value) > local_today()
            except ValueError as error:
                raise field_error(f"details.{key}", "Please enter a valid date.") from error
            if in_future:
                raise field_error(f"details.{key}", "The payment date cannot be in the future.")
        details[key] = value
    return details


def phone_digits(value: str) -> str:
    return "".join(character for character in (value or "") if character.isdigit())


def validate_phone(dial_code: str, phone: str) -> tuple[str | None, str | None, str | None]:
    """(digits, dial code, locality) for a valid number; all None for no number."""
    digits = phone_digits(phone)
    if not digits:
        return None, None, None
    if str(dial_code or "").strip().upper() in RETIRED_KUWAIT_VALUES:
        raise HTTPException(status_code=422, detail=INDIA_ONLY_DETAIL)
    locality = DIAL_CODE_LOCALITIES.get((dial_code or "").strip())
    if not locality:
        raise field_error("contact.dial_code", "Please choose a country code.")
    spec = PHONE_COUNTRIES[locality]
    code_digits = str(spec["dial_code"]).lstrip("+")
    if len(digits) == int(spec["digits"]) + len(code_digits) and digits.startswith(code_digits):
        digits = digits[len(code_digits) :]
    if not re.fullmatch(str(spec["pattern"]), digits):
        raise field_error("contact.phone", f"Please enter a valid {spec['digits']}-digit {spec['name']} number.")
    return digits, str(spec["dial_code"]), locality


def account_dial_code(user: User) -> str:
    return str(PHONE_COUNTRIES.get(account_locality(user), PHONE_COUNTRIES[LOCALITY_INDIA])["dial_code"])


def resolve_contact(submission: TicketSubmission, user: User | None) -> dict[str, Any]:
    form = submission.contact
    account_email = (user.email or "").strip() if user else ""
    if user:
        name = (user.name or "").strip() or form.name.strip()
        email = account_email or form.email.strip()
        if user.phone:
            phone, dial_code = phone_digits(user.phone), account_dial_code(user)
        else:
            phone, dial_code, _ = validate_phone(form.dial_code, form.phone)
        locality: str | None = account_locality(user)
    else:
        name, email = form.name.strip(), form.email.strip()
        phone, dial_code, locality = validate_phone(form.dial_code, form.phone)
    if not name:
        raise field_error("contact.name", "Please enter your name.")
    if not email:
        raise field_error("contact.email", "Please enter your email address.")
    # Only an address typed into the form is checked; the account's own was accepted
    # when the account was made.
    if not account_email:
        try:
            email = EmailOnly(email=email).email
        except ValidationError as error:
            raise field_error("contact.email", "Please enter a valid email address.") from error
    return {
        "contact_name": name[:120],
        "contact_email": email,
        "contact_phone": phone,
        "contact_dial_code": dial_code,
        "locality": locality or LOCALITY_INDIA,
    }


def check_priority(database: Session, submission: TicketSubmission, user: User | None) -> str:
    if submission.priority != PRIORITY_URGENT:
        return PRIORITY_NORMAL
    if not user:
        raise field_error("priority", "Urgent priority is available after signing in.")
    active_urgent = database.scalars(
        select(SupportTicket.id).where(
            SupportTicket.user_id == user.id,
            SupportTicket.priority == PRIORITY_URGENT,
            SupportTicket.status.in_(ACTIVE_STATUSES),
        )
    ).first()
    if active_urgent:
        raise field_error("priority", "You already have an urgent ticket open. Please mark this one Normal.")
    return PRIORITY_URGENT


def save_attachment(upload: UploadFile | None, uploads: UploadService, user: User | None, locality: str) -> File | None:
    if not upload or not upload.filename:
        return None
    if (upload.content_type or "") not in ALLOWED_CONTENT_TYPES:
        raise field_error("attachment", "Attach a PDF, JPG, PNG or WEBP file.")
    return uploads.save(
        upload, owner_id=user.id if user else None, module="support", category=PROFILE_IMAGE, locality=locality
    )


def ticket_by_request(database: Session, client_request_id: uuid.UUID) -> SupportTicket | None:
    return database.scalars(select(SupportTicket).where(SupportTicket.client_request_id == client_request_id)).first()


def create_ticket(
    database: Session,
    settings: Settings,
    uploads: UploadService,
    email: EmailSender,
    submission: TicketSubmission,
    user: User | None,
    attachment: UploadFile | None,
) -> tuple[SupportTicket, bool]:
    """(ticket, created); created is False when this client_request_id already made one."""
    existing = ticket_by_request(database, submission.client_request_id)
    if existing:
        if existing.user_id != (user.id if user else None):
            raise HTTPException(
                status_code=409, detail="This request was already submitted. Please refresh and try again."
            )
        return existing, False

    allowed_fields = validate_choices(submission)
    details = clean_details(submission, allowed_fields)
    contact = resolve_contact(submission, user)
    priority = check_priority(database, submission, user)
    subject = submission.subject.strip() or taxonomy.issue_label(submission.category, submission.issue_type)

    stored = save_attachment(attachment, uploads, user, contact["locality"])
    ticket = SupportTicket(
        reference=f"PENDING-{uuid.uuid4().hex}",
        user_id=user.id if user else None,
        account_type=submission.account_type,
        category=submission.category,
        issue_type=submission.issue_type,
        subject=subject[:160],
        description=submission.description,
        details=details,
        attachment_file_id=stored.id if stored else None,
        priority=priority,
        status=STATUS_OPEN,
        client_request_id=submission.client_request_id,
        **contact,
    )
    database.add(ticket)
    try:
        database.flush()
    except IntegrityError:
        # Two copies of one request arrived together; the other was stored first.
        database.rollback()
        existing = ticket_by_request(database, submission.client_request_id)
        if existing and existing.user_id == (user.id if user else None):
            return existing, False
        raise HTTPException(
            status_code=409, detail="This request was already submitted. Please refresh and try again."
        ) from None
    database.refresh(ticket, ["reference_number"])
    ticket.reference = f"{REFERENCE_PREFIX}{ticket.reference_number:06d}"
    if user:
        add_notification(
            database,
            user.id,
            "Support ticket received",
            f"We received your support request {ticket.reference}: {ticket.subject}.",
            category="ACCOUNT",
        )
    database.commit()
    database.refresh(ticket)

    send_acknowledgement(email, ticket)
    notify_support_inbox(email, ticket, settings)
    return ticket, True


# ---- mail (best effort) ----


def send_acknowledgement(email: EmailSender, ticket: SupportTicket) -> bool:
    if not email.configured:
        return False
    body = "\n".join(
        [
            f"Hello {ticket.contact_name},",
            "",
            f"We have received your support request. Your ticket reference is {ticket.reference}.",
            "",
            f"Category: {taxonomy.category_label(ticket.category)}",
            f"Issue:    {ticket.subject}",
            f"Status:   {taxonomy.STATUS_LABELS[ticket.status]}",
            "",
            "Sign in to CREWNBUILD and open Contact us > My Support Tickets to follow it and read our replies.",
            "",
            "CREWNBUILD Support",
        ]
    )
    try:
        return bool(email.send_email(ticket.contact_email, f"[{ticket.reference}] We received your request", body))
    except Exception:
        logger.exception("Could not send the acknowledgement for %s", ticket.reference)
        return False


def notify_support_inbox(email: EmailSender, ticket: SupportTicket, settings: Settings) -> None:
    inbox = support_email_address(settings)
    if not inbox or not email.configured:
        return
    lines = [
        f"Reference: {ticket.reference}",
        f"Priority:  {ticket.priority}",
        f"Account:   {taxonomy.ACCOUNT_TYPES.get(ticket.account_type, ticket.account_type)}"
        + ("" if ticket.user_id else " (not signed in)"),
        f"Category:  {taxonomy.category_label(ticket.category)}",
        f"Issue:     {ticket.subject}",
        f"Name:      {ticket.contact_name}",
        f"Email:     {ticket.contact_email}",
    ]
    if ticket.contact_phone:
        lines.append(f"Phone:     {ticket.contact_dial_code} {ticket.contact_phone}")
    for key, value in (ticket.details or {}).items():
        lines.append(f"{taxonomy.DETAIL_FIELDS.get(key, {}).get('label', key)}: {value}")
    lines.extend(["", ticket.description, "", "Reply from Admin > Support Tickets."])
    try:
        email.send_email(inbox, f"[{ticket.reference}] {ticket.subject}", "\n".join(lines))
    except Exception:
        logger.exception("Could not notify the support inbox about %s", ticket.reference)


# ---- reading tickets ----


def iso_utc(value: datetime | None) -> str | None:
    """The old answer format: UTC without an offset, then Z."""
    if not value:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.isoformat() + "Z"


def serialize_ticket(
    database: Session, ticket: SupportTicket, *, with_messages: bool, staff: bool = False
) -> dict[str, Any]:
    attachment = database.get(File, ticket.attachment_file_id) if ticket.attachment_file_id else None
    data: dict[str, Any] = {
        "reference": ticket.reference,
        "status": ticket.status,
        "status_label": taxonomy.STATUS_LABELS.get(ticket.status, ticket.status),
        "priority": ticket.priority,
        "account_type": ticket.account_type,
        "account_type_label": taxonomy.ACCOUNT_TYPES.get(ticket.account_type, ticket.account_type),
        "category": ticket.category,
        "category_label": taxonomy.category_label(ticket.category),
        "issue_type": ticket.issue_type,
        "issue_label": taxonomy.issue_label(ticket.category, ticket.issue_type),
        "subject": ticket.subject,
        "created_at": iso_utc(ticket.created_at),
        "updated_at": iso_utc(ticket.updated_at),
    }
    if staff:
        data.update({"id": ticket.id, "locality": ticket.locality, "signed_in": ticket.user_id is not None})
    if with_messages:
        messages = database.scalars(
            select(SupportTicketMessage)
            .where(SupportTicketMessage.ticket_id == ticket.id)
            .order_by(SupportTicketMessage.created_at, SupportTicketMessage.id)
        ).all()
        data.update(
            {
                "description": ticket.description,
                "details": [
                    {"key": key, "label": taxonomy.DETAIL_FIELDS.get(key, {}).get("label", key), "value": value}
                    for key, value in (ticket.details or {}).items()
                ],
                "contact": {
                    "name": ticket.contact_name,
                    "email": ticket.contact_email,
                    "phone": f"{ticket.contact_dial_code} {ticket.contact_phone}" if ticket.contact_phone else None,
                },
                "attachment": {"name": attachment.filename, "content_type": attachment.content_type}
                if attachment
                else None,
                "messages": [
                    {
                        "id": message.id,
                        "author": message.author_kind,
                        "author_label": "CREWNBUILD Support" if message.author_kind == AUTHOR_STAFF else "You",
                        "body": message.body,
                        "created_at": iso_utc(message.created_at),
                    }
                    for message in messages
                ],
            }
        )
    return data


def own_ticket(database: Session, user: User, reference: str) -> SupportTicket:
    """The account's own ticket; the same 404 whether it is missing or someone else's."""
    ticket = database.scalars(
        select(SupportTicket).where(
            SupportTicket.reference == reference.strip().upper(), SupportTicket.user_id == user.id
        )
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def list_own(database: Session, user: User) -> list[dict[str, Any]]:
    tickets = database.scalars(
        select(SupportTicket)
        .where(SupportTicket.user_id == user.id)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
        .limit(200)
    ).all()
    return [serialize_ticket(database, ticket, with_messages=False) for ticket in tickets]


def clean_reply(body: str) -> str:
    body = (body or "").strip()
    if not body:
        raise field_error("body", "Please write a message.")
    if len(body) > taxonomy.REPLY_MAX_LENGTH:
        raise field_error("body", f"Please keep the message under {taxonomy.REPLY_MAX_LENGTH} characters.")
    return body


def add_user_reply(database: Session, user: User, reference: str, body: str) -> SupportTicket:
    ticket = own_ticket(database, user, reference)
    if ticket.status == STATUS_CLOSED:
        raise HTTPException(status_code=409, detail="This ticket is closed. Please open a new request.")
    database.add(
        SupportTicketMessage(
            ticket_id=ticket.id, author_kind=AUTHOR_USER, author_user_id=user.id, body=clean_reply(body)
        )
    )
    # Answering puts the ticket back with the team; a reply to a resolved ticket reopens it.
    if ticket.status == STATUS_WAITING_FOR_USER:
        ticket.status = STATUS_IN_PROGRESS
    elif ticket.status == STATUS_RESOLVED:
        ticket.status = STATUS_OPEN
    ticket.updated_at = datetime.now(UTC)
    database.commit()
    database.refresh(ticket)
    return ticket


def attachment_for(database: Session, ticket: SupportTicket) -> File:
    attachment = database.get(File, ticket.attachment_file_id) if ticket.attachment_file_id else None
    if not attachment:
        raise HTTPException(status_code=404, detail="No attachment")
    return attachment
