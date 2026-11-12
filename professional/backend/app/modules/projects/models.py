"""Projects tables (technical-architecture.md section 10, domain Projects).

    projects                      integer key -> UUID; contractor_id -> builder_id; budget ->
                                  budget_amount (and the estimate money columns -> *_amount);
                                  start_date / end_date -> starts_on / ends_on
    project_photos                was project_media; timeline_id -> timeline_entry_id (SET NULL)
    project_timeline_entries      was project_timelines; created_by_id -> created_by_user_id
    project_requests              was requests, project rows only (property enquiries move to
                                  property_enquiries with the property module)
    project_awards                UUID; agreed_offer_id -> its own offer (composite FK)
    project_award_offers          was award_offers
    project_engineer_assignments  UUID
    project_supplier_assignments  UUID; contractor_id -> builder_id
    team_invitations              was builder_engineer_invitations
    team_memberships              was builder_engineer_memberships
    project_reviews               was reviews
    project_escrow_milestones     was escrow_milestones

Python attribute names stay the old ones (contractor_id, budget, start_date, timeline_id,
...) so the ported services and the API keys are unchanged; the column names follow
section 9. Times are timestamptz read as naive UTC (NaiveUtcTimestamp), as the ported
code expects. Status values are stored exactly as before ("active", "pending", "ACTIVE").

Deleting a project is a hard delete, as before (decided: no soft-delete column).

Delete rules (9.3): a project's own rows (photos, timeline, requests, awards and offers,
assignments, reviews, escrow) go with it (CASCADE), which is how deleting an unstarted
project removes them; an account referenced from here is RESTRICT (accounts are soft
deleted); a timeline entry's photo keeps the photo (SET NULL).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

AWARD_AWAITING_BUILDER = "awaiting_builder"
AWARD_NEGOTIATING = "negotiating"
AWARD_CONFIRMED = "confirmed"
AWARD_DECLINED = "declined"
AWARD_CANCELLED = "cancelled"
AWARD_STATUSES = (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING, AWARD_CONFIRMED, AWARD_DECLINED, AWARD_CANCELLED)
# At most one of these per project.
AWARD_ACTIVE_STATUSES = (AWARD_AWAITING_BUILDER, AWARD_NEGOTIATING, AWARD_CONFIRMED)

OFFER_OPEN = "open"
OFFER_ACCEPTED = "accepted"
OFFER_REJECTED = "rejected"
OFFER_SUPERSEDED = "superseded"
OFFER_WITHDRAWN = "withdrawn"
OFFER_STATUSES = (OFFER_OPEN, OFFER_ACCEPTED, OFFER_REJECTED, OFFER_SUPERSEDED, OFFER_WITHDRAWN)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


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


def user_fk(column: str, *, nullable: bool = False, ondelete: str = "RESTRICT") -> Mapped[uuid.UUID]:
    return mapped_column(column, ForeignKey("users.id", ondelete=ondelete), nullable=nullable, index=True)


class Project(UuidPrimaryKeyMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on", name="schedule_order"),
        Index("ix_projects__pincode_status", "pincode", "status"),
    )

    owner_id: Mapped[uuid.UUID] = user_fk("owner_id")
    # The awarded builder (`contractor_id` in the code and the API, as before).
    contractor_id: Mapped[uuid.UUID | None] = user_fk("builder_id", nullable=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    project_country: Mapped[str | None] = mapped_column(String(60), default="India", index=True)
    project_state: Mapped[str | None] = mapped_column(String(120))
    project_city: Mapped[str | None] = mapped_column(String(120))
    building_type: Mapped[str] = mapped_column(String(60), nullable=False, default="RESIDENTIAL")
    construction_type: Mapped[str] = mapped_column(String(60), nullable=False, default="CONTRACTOR")
    budget: Mapped[Decimal] = mapped_column("budget_amount", Numeric(14, 2), nullable=False, default=0)
    land_area: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    floors: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    floor_type: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="active", index=True)
    compliance_status: Mapped[str | None] = mapped_column(String(40), default="Pending Verification")
    # Legacy manual figure; no longer read for progress (progress_service).
    completion_percentage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cover_image_url: Mapped[str | None] = mapped_column(String(500))
    estimated_cost: Mapped[Decimal | None] = mapped_column("estimated_cost_amount", Numeric(14, 2))
    estimated_duration_days: Mapped[int | None] = mapped_column(Integer)
    material_estimate: Mapped[Decimal | None] = mapped_column("material_estimate_amount", Numeric(14, 2))
    labour_estimate: Mapped[Decimal | None] = mapped_column("labour_estimate_amount", Numeric(14, 2))
    start_date: Mapped[date | None] = mapped_column("starts_on", Date)
    end_date: Mapped[date | None] = mapped_column("ends_on", Date)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    owner = relationship("User", foreign_keys=[owner_id])
    contractor = relationship("User", foreign_keys=[contractor_id])
    timelines = relationship("ProjectTimeline", back_populates="project", passive_deletes=True)
    escrow_milestones = relationship(
        "EscrowMilestone", back_populates="project", order_by="EscrowMilestone.sort_order", passive_deletes=True
    )


class ProjectTimeline(UuidPrimaryKeyMixin, Base):
    """A Site Engineer's daily activity entry (the calendar), with its photos."""

    __tablename__ = "project_timeline_entries"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = user_fk("created_by_user_id", nullable=True, ondelete="SET NULL")
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # The day the engineer picked, kept exactly as sent (not a UTC instant).
    date: Mapped[datetime] = mapped_column("activity_at", NaiveUtcTimestamp, nullable=False)
    completion_status: Mapped[str] = mapped_column(String(40), nullable=False, default="active")
    created_at: Mapped[datetime] = created_at_column()

    project = relationship("Project", back_populates="timelines")
    created_by = relationship("User", foreign_keys=[created_by_id])
    images = relationship("ProjectImage", back_populates="timeline", passive_deletes=True)


class ProjectImage(UuidPrimaryKeyMixin, Base):
    """A site photo or video ("/files/<id>") of a project, usually of one timeline entry."""

    __tablename__ = "project_photos"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timeline_id: Mapped[uuid.UUID | None] = mapped_column(
        "timeline_entry_id", ForeignKey("project_timeline_entries.id", ondelete="SET NULL"), index=True
    )
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = created_at_column()

    timeline = relationship("ProjectTimeline", back_populates="images")


class ProjectRequest(UuidPrimaryKeyMixin, Base):
    """A request between two accounts, usually about a project: a quotation, a supplier
    or engineer invitation, a specialist invitation."""

    __tablename__ = "project_requests"
    __table_args__ = (
        Index("ix_project_requests__project_id_request_type_status", "project_id", "request_type", "status"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    sender_id: Mapped[uuid.UUID] = user_fk("sender_id")
    receiver_id: Mapped[uuid.UUID] = user_fk("receiver_id")
    request_type: Mapped[str] = mapped_column(String(60), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", index=True)
    quotation_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    quotation_created_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()

    project = relationship("Project")
    sender = relationship("User", foreign_keys=[sender_id])
    receiver = relationship("User", foreign_keys=[receiver_id])


class ProjectAward(UuidPrimaryKeyMixin, Base):
    """One negotiation with one builder over a project, tied to that builder's quotation.
    Its offers are an append-only ledger; the agreed offer must be one of its own."""

    __tablename__ = "project_awards"
    __table_args__ = (
        CheckConstraint(_in("status", AWARD_STATUSES), name="status"),
        CheckConstraint("(status = 'confirmed') = (confirmed_at IS NOT NULL)", name="confirmed_at"),
        ForeignKeyConstraint(
            ["agreed_offer_id", "id"],
            ["project_award_offers.id", "project_award_offers.award_id"],
            name="fk_project_awards__agreed_offer_id__project_award_offers",
            use_alter=True,
        ),
        Index(
            "uq_project_awards__project_id_active",
            "project_id",
            unique=True,
            postgresql_where=text(_in("status", AWARD_ACTIVE_STATUSES)),
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    builder_id: Mapped[uuid.UUID] = user_fk("builder_id")
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    agreed_offer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    created_at: Mapped[datetime] = created_at_column()
    responded_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    confirmed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)


class AwardOffer(UuidPrimaryKeyMixin, Base):
    __tablename__ = "project_award_offers"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(_in("status", OFFER_STATUSES), name="status"),
        UniqueConstraint("id", "award_id"),
        Index(
            "uq_project_award_offers__award_id_open", "award_id", unique=True, postgresql_where=text("status = 'open'")
        ),
        Index("ix_project_award_offers__award_id_created_at", "award_id", "created_at"),
    )

    award_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project_awards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    proposed_by_id: Mapped[uuid.UUID] = user_fk("proposed_by_user_id")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    responded_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)


class ProjectEngineer(UuidPrimaryKeyMixin, Base):
    """A Site Engineer (or the owner-hired one) on a project: ACTIVE or REMOVED."""

    __tablename__ = "project_engineer_assignments"
    __table_args__ = (UniqueConstraint("project_id", "engineer_id"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    engineer_id: Mapped[uuid.UUID] = user_fk("engineer_id")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="ACTIVE", index=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    project = relationship("Project", foreign_keys=[project_id])
    engineer = relationship("User", foreign_keys=[engineer_id])


class ProjectSupplier(UuidPrimaryKeyMixin, Base):
    """A supplier a builder put on one of its projects for one Site Engineer."""

    __tablename__ = "project_supplier_assignments"
    __table_args__ = (UniqueConstraint("project_id", "supplier_id", "engineer_id"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID] = user_fk("supplier_id")
    engineer_id: Mapped[uuid.UUID] = user_fk("engineer_id")
    contractor_id: Mapped[uuid.UUID] = user_fk("builder_id")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="ACTIVE", index=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    project = relationship("Project", foreign_keys=[project_id])
    supplier = relationship("User", foreign_keys=[supplier_id])
    engineer = relationship("User", foreign_keys=[engineer_id])
    contractor = relationship("User", foreign_keys=[contractor_id])


class EngineerInvitation(UuidPrimaryKeyMixin, Base):
    """A builder's invitation code for a Site Engineer to join its team."""

    __tablename__ = "team_invitations"

    contractor_id: Mapped[uuid.UUID] = user_fk("builder_id", ondelete="CASCADE")
    invite_code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="PENDING", index=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    contractor = relationship("User", foreign_keys=[contractor_id])


class ContractorEngineer(UuidPrimaryKeyMixin, Base):
    """A Site Engineer on a builder's team: PENDING, ACTIVE or REJECTED."""

    __tablename__ = "team_memberships"
    __table_args__ = (UniqueConstraint("builder_id", "engineer_id"),)

    contractor_id: Mapped[uuid.UUID] = user_fk("builder_id", ondelete="CASCADE")
    engineer_id: Mapped[uuid.UUID] = user_fk("engineer_id", ondelete="CASCADE")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="PENDING", index=True)
    request_sender_role: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class Review(UuidPrimaryKeyMixin, Base):
    """A rating one account gave another on a project (read by the builder profile)."""

    __tablename__ = "project_reviews"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewer_id: Mapped[uuid.UUID] = user_fk("reviewer_id")
    reviewee_id: Mapped[uuid.UUID] = user_fk("reviewee_id")
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class EscrowMilestone(UuidPrimaryKeyMixin, Base):
    """One construction stage's share of the project amount (written at creation and
    re-split when the contract is confirmed)."""

    __tablename__ = "project_escrow_milestones"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    # The stage order (the old integer key's order; a UUID does not keep it).
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = created_at_column()

    project = relationship("Project", back_populates="escrow_milestones")
