"""Admin > Support Tickets: staff reading and answering tickets (ported from the old
support_service.staff_list / staff_ticket / staff_update, same rules). Ticket creation
and the account holder's own view are the support module's.

Within the administrator's own country, like every other admin list.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.integrations.email.email_sender import EmailSender
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.messaging.notifications import add_notification
from app.modules.support import taxonomy
from app.modules.support.models import AUTHOR_STAFF, TICKET_STATUSES, SupportTicket, SupportTicketMessage
from app.modules.support.ticket_service import clean_reply, field_error, serialize_ticket

logger = logging.getLogger(__name__)


def staff_list(database: Session, admin: AdminIdentity, status: str | None, q: str | None) -> list[dict[str, Any]]:
    statement = select(SupportTicket)
    if not admin.is_global:
        statement = statement.where(SupportTicket.locality == admin.scope)
    if status:
        if status not in TICKET_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown status")
        statement = statement.where(SupportTicket.status == status)
    if q and q.strip():
        like = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                SupportTicket.reference.ilike(like),
                SupportTicket.contact_email.ilike(like),
                SupportTicket.contact_name.ilike(like),
                SupportTicket.subject.ilike(like),
            )
        )
    tickets = database.scalars(
        statement.order_by(SupportTicket.updated_at.desc(), SupportTicket.id.desc()).limit(200)
    ).all()
    return [serialize_ticket(database, ticket, with_messages=False, staff=True) for ticket in tickets]


def staff_ticket(database: Session, admin: AdminIdentity, ticket_id: uuid.UUID) -> SupportTicket:
    """A ticket in this administrator's scope; the same 404 whether missing or not."""
    ticket = database.get(SupportTicket, ticket_id)
    if not ticket or (not admin.is_global and ticket.locality != admin.scope):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def staff_update(
    database: Session,
    email: EmailSender,
    admin: AdminIdentity,
    ticket_id: uuid.UUID,
    body: str | None,
    status: str | None,
) -> SupportTicket:
    ticket = staff_ticket(database, admin, ticket_id)
    if status is not None and status not in TICKET_STATUSES:
        raise field_error("status", "Unknown status")
    reply = clean_reply(body) if body is not None and body.strip() else None
    if reply is None and (status is None or status == ticket.status):
        raise field_error("body", "Write a reply or choose a new status.")
    if reply:
        database.add(
            SupportTicketMessage(
                ticket_id=ticket.id, author_kind=AUTHOR_STAFF, author_user_id=admin.user.id, body=reply
            )
        )
    if status is not None:
        ticket.status = status
    ticket.updated_at = datetime.now(UTC)
    if ticket.user_id:
        add_notification(
            database,
            ticket.user_id,
            f"Update on {ticket.reference}",
            ("Support replied to your request." if reply else "The status of your request changed.")
            + f" Status: {taxonomy.STATUS_LABELS[ticket.status]}.",
            category="ACCOUNT",
        )
    database.commit()
    database.refresh(ticket)
    if reply and email.configured:
        try:
            email.send_email(
                ticket.contact_email,
                f"[{ticket.reference}] Reply from CREWNBUILD Support",
                f"Hello {ticket.contact_name},\n\n{reply}\n\nStatus: {taxonomy.STATUS_LABELS[ticket.status]}"
                "\n\nCREWNBUILD Support",
            )
        except Exception:
            logger.exception("Could not email the reply on %s", ticket.reference)
    return ticket
