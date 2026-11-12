"""Content tables (technical-architecture.md section 10).

    ads              was advertisements; integer key -> UUID
    ad_daily_stats   was advertisement_daily_stats; integer key -> UUID; FK ad_id CASCADE
    cost_estimates   was estimates; integer key -> UUID; FK owner_id CASCADE

The public side of ads (what a screen shows, views and clicks, the picture) is served
here; creating and editing ads is the admin module's.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAtMixin, TimestampMixin, UuidPrimaryKeyMixin

AD_STATUS_DRAFT = "DRAFT"
AD_STATUS_ACTIVE = "ACTIVE"
AD_STATUS_PAUSED = "PAUSED"
WIDTH_FULL = "FULL"


class Ad(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """One advert, and when and where it runs."""

    __tablename__ = "ads"

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    # /files/<id> of an uploaded advert picture, or an address typed in.
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    link_url: Mapped[str | None] = mapped_column(String(500))
    # Comma-separated "screen@position" entries (a bare "screen" means the footer).
    placements: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # GLOBAL or IN.
    scope: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=AD_STATUS_DRAFT, index=True)
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    display_width: Mapped[str] = mapped_column(
        String(10), nullable=False, default=WIDTH_FULL, server_default=WIDTH_FULL
    )
    price_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    pricing_model: Mapped[str | None] = mapped_column(String(20))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )


class AdDailyStat(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """One day of one advert on one screen, incremented in place."""

    __tablename__ = "ad_daily_stats"
    __table_args__ = (UniqueConstraint("ad_id", "placement", "day"),)

    ad_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ads.id", ondelete="CASCADE"), nullable=False, index=True)
    placement: Mapped[str] = mapped_column(String(40), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class CostEstimate(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """A construction cost estimate a House Owner saved."""

    __tablename__ = "cost_estimates"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    location: Mapped[str] = mapped_column(String(160), nullable=False)
    pincode: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    plot_area: Mapped[float] = mapped_column(Float, nullable=False)
    floors: Mapped[int] = mapped_column(Integer, nullable=False)
    floor_type: Mapped[str | None] = mapped_column(String(40))
    construction_type: Mapped[str] = mapped_column(String(60), nullable=False)
    building_type: Mapped[str] = mapped_column(String(60), nullable=False)
    finishing_type: Mapped[str] = mapped_column(String(60), nullable=False)
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    estimated_cost_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    estimated_duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    material_estimate_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    labour_estimate_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
