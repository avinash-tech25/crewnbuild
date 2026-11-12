"""Support tables (technical-architecture.md section 10, domains Support and Admin).

    support_tickets           integer key -> UUID; reference CNB-000123 from reference_number
    support_ticket_messages   integer key -> UUID; FK ticket_id CASCADE
    user_reports              was reports; integer key -> UUID

A ticket may come from a visitor who is not signed in (user_id NULL). user_id,
author_user_id and attachment_file_id are SET NULL, so neither an account nor a file
can take a ticket with it.

A report names its subject by type and id (text: an account's or a project's id), so
it survives its subject; it is not a foreign key.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAtMixin, TimestampMixin, UuidPrimaryKeyMixin

STATUS_OPEN = "OPEN"
STATUS_IN_PROGRESS = "IN_PROGRESS"
STATUS_WAITING_FOR_USER = "WAITING_FOR_USER"
STATUS_RESOLVED = "RESOLVED"
STATUS_CLOSED = "CLOSED"
TICKET_STATUSES = (STATUS_OPEN, STATUS_IN_PROGRESS, STATUS_WAITING_FOR_USER, STATUS_RESOLVED, STATUS_CLOSED)
ACTIVE_STATUSES = (STATUS_OPEN, STATUS_IN_PROGRESS, STATUS_WAITING_FOR_USER)

PRIORITY_NORMAL = "NORMAL"
PRIORITY_URGENT = "URGENT"
TICKET_PRIORITIES = (PRIORITY_NORMAL, PRIORITY_URGENT)

AUTHOR_USER = "USER"
AUTHOR_STAFF = "STAFF"
MESSAGE_AUTHORS = (AUTHOR_USER, AUTHOR_STAFF)

REPORT_STATUS_NEW = "NEW"
REPORT_STATUSES = ("NEW", "UNDER_REVIEW", "RESOLVED", "REJECTED")
REPORT_CATEGORIES = ("WORK_QUALITY", "PAYMENT", "CONDUCT", "MATERIALS", "FRAUD", "OTHER")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class SupportTicket(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint(_in("status", TICKET_STATUSES), name="status"),
        CheckConstraint(_in("priority", TICKET_PRIORITIES), name="priority"),
    )

    # The running number behind the public reference (CNB-000123); never reused.
    reference_number: Mapped[int] = mapped_column(BigInteger, Identity(), nullable=False, unique=True)
    reference: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Which administrators may see it (IN).
    locality: Mapped[str] = mapped_column(String(4), nullable=False, index=True)
    contact_name: Mapped[str] = mapped_column(String(120), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(20))
    contact_dial_code: Mapped[str | None] = mapped_column(String(6))
    account_type: Mapped[str] = mapped_column(String(30), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    issue_type: Mapped[str] = mapped_column(String(40), nullable=False)
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    attachment_file_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True
    )
    priority: Mapped[str] = mapped_column(
        String(10), nullable=False, default=PRIORITY_NORMAL, server_default=PRIORITY_NORMAL
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATUS_OPEN, server_default=STATUS_OPEN, index=True
    )
    # Sent once per form submission, so a retry returns the ticket already made.
    client_request_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)


class SupportTicketMessage(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "support_ticket_messages"
    __table_args__ = (CheckConstraint(_in("author_kind", MESSAGE_AUTHORS), name="author_kind"),)

    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)


class UserReport(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """A complaint or dispute raised by one account about another account or a project.
    The administrative scope is fixed when it is raised, from the subject."""

    __tablename__ = "user_reports"
    __table_args__ = (
        CheckConstraint(_in("status", REPORT_STATUSES), name="status"),
        CheckConstraint(_in("category", REPORT_CATEGORIES), name="category"),
    )

    reporter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    subject_type: Mapped[str] = mapped_column(String(40), nullable=False)  # "user" | "project"
    subject_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="OTHER")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=REPORT_STATUS_NEW, index=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)
