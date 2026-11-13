"""Labour supply tables (technical-architecture.md section 10, domain Labour supply).

    labour_services             was labor_services (spelling); one trade a Labour Supplier
                                offers, with its worker capacity
    labour_requests             was labor_requests; contractor_id -> builder_id
    labour_attendance_records   was labor_daily_records

Every key is a UUID. The Python attribute names stay the old ones (supplier_id,
contractor_id, labor_request_id, start_date, work_date ...) so the ported service and
the API keys are unchanged; the column names follow section 9 (*_user_id for accounts,
*_on for dates). Times are timestamptz read as naive UTC (NaiveUtcTimestamp).

Delete rules (9.3): a supplier's services go with the supplier account (CASCADE, as
before; accounts are soft-deleted); a request goes with its project and with the
supplier assignment it was made under (CASCADE, as the old tables had it: the project
delete is refused while a Site Engineer is assigned); a request keeps its supplier,
engineer and builder (RESTRICT: accounts are soft-deleted); attendance goes with its
request (CASCADE) and keeps who recorded it (RESTRICT).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

LABOR_SUPPLIER_CATEGORY = "Labor Supplier"

# Stored as text so the list can grow without a migration.
LABOR_TRADES = (
    "Mason",
    "Carpenter",
    "Electrician",
    "Plumber",
    "Painter",
    "Welder",
    "Tile Worker",
    "Steel Fixer",
    "Shuttering",
    "HVAC",
    "Helper",
    "General Labour",
)

STATUS_PENDING = "PENDING"
STATUS_ACCEPTED = "ACCEPTED"
STATUS_REJECTED = "REJECTED"
STATUS_CANCELLED = "CANCELLED"
STATUS_COMPLETED = "COMPLETED"
LABOR_REQUEST_STATUSES = (STATUS_PENDING, STATUS_ACCEPTED, STATUS_REJECTED, STATUS_CANCELLED, STATUS_COMPLETED)


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


def updated_at_column() -> Mapped[datetime]:
    return mapped_column(
        "updated_at",
        NaiveUtcTimestamp,
        nullable=False,
        default=naive_utc_now,
        onupdate=naive_utc_now,
        server_default=text("now()"),
    )


def account_fk(column: str, ondelete: str = "RESTRICT") -> Mapped[uuid.UUID]:
    return mapped_column(column, ForeignKey("users.id", ondelete=ondelete), nullable=False, index=True)


class LaborService(UuidPrimaryKeyMixin, Base):
    """One trade a Labour Supplier offers."""

    __tablename__ = "labour_services"
    __table_args__ = (
        UniqueConstraint("supplier_user_id", "trade"),
        CheckConstraint("worker_capacity >= 0", name="worker_capacity"),
    )

    supplier_id: Mapped[uuid.UUID] = account_fk("supplier_user_id", ondelete="CASCADE")
    trade: Mapped[str] = mapped_column(String(60), nullable=False)
    skill_level: Mapped[str | None] = mapped_column(String(20))
    worker_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class LaborRequest(UuidPrimaryKeyMixin, Base):
    """A Site Engineer's request for workers of one trade; once ACCEPTED it is the
    project's labour assignment until COMPLETED."""

    __tablename__ = "labour_requests"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED')", name="status"),
        CheckConstraint("workers_required > 0", name="workers_required"),
        CheckConstraint(
            "workers_allocated IS NULL OR (workers_allocated > 0 AND workers_allocated <= workers_required)",
            name="workers_allocated",
        ),
        CheckConstraint(
            "status NOT IN ('ACCEPTED', 'COMPLETED') OR workers_allocated IS NOT NULL",
            name="allocated_when_accepted",
        ),
        CheckConstraint("ends_on IS NULL OR ends_on >= starts_on", name="dates"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project_supplier_assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID] = account_fk("supplier_user_id")
    engineer_id: Mapped[uuid.UUID] = account_fk("engineer_user_id")
    contractor_id: Mapped[uuid.UUID] = account_fk("builder_id")
    trade: Mapped[str] = mapped_column(String(60), nullable=False)
    workers_required: Mapped[int] = mapped_column(Integer, nullable=False)
    workers_allocated: Mapped[int | None] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column("starts_on", Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column("ends_on", Date)
    work_description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=STATUS_PENDING, index=True)
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    completed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class LaborDailyRecord(UuidPrimaryKeyMixin, Base):
    """One day's attendance (counts, not named workers) on an accepted request."""

    __tablename__ = "labour_attendance_records"
    __table_args__ = (
        UniqueConstraint("labour_request_id", "work_on"),
        CheckConstraint(
            "present_count >= 0 AND absent_count >= 0 AND half_day_count >= 0 AND overtime_workers >= 0",
            name="counts",
        ),
        CheckConstraint("overtime_hours >= 0", name="overtime_hours"),
    )

    labor_request_id: Mapped[uuid.UUID] = mapped_column(
        "labour_request_id", ForeignKey("labour_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    work_date: Mapped[date] = mapped_column("work_on", Date, nullable=False)
    present_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    absent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    half_day_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overtime_workers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    activity: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by_id: Mapped[uuid.UUID] = account_fk("recorded_by_user_id")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
