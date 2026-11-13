"""Equipment supply tables (technical-architecture.md section 10, domain Equipment supply).

    equipment_listings      was equipment_items; one item an Equipment Supplier rents
                            out or sells
    equipment_requests      contractor_id -> builder_id; equipment_item_id -> listing_id
    equipment_usage_logs    a rental's hours on one day

A RENT request reserves `quantity` units for its dates once ACCEPTED and is COMPLETED
when returned; a BUY request removes the units from stock when ACCEPTED and is
COMPLETED when delivered. unit_price is the listing's price when the request was made.

Every key is a UUID. The Python attribute names stay the old ones (supplier_id,
contractor_id, equipment_item_id, unit_price, start_date ...) so the ported service and
the API keys are unchanged; the column names follow section 9 (*_user_id for accounts,
*_amount for money, *_on for dates). Times are timestamptz read as naive UTC.

Delete rules (9.3): a supplier's listings go with the supplier account (CASCADE, as
before; accounts are soft-deleted, and a listing is only ever deactivated); a request
keeps its listing (RESTRICT, the old NO ACTION) and its supplier, engineer and builder
(RESTRICT); it goes with its project and with the supplier assignment it was made under
(CASCADE, as before); usage goes with its request (CASCADE).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp
from app.modules.labour_supply.models import account_fk, created_at_column, updated_at_column

EQUIPMENT_SUPPLIER_CATEGORY = "Equipment Supplier"

MODE_RENT = "RENT"
MODE_BUY = "BUY"
MODE_RENT_BUY = "RENT_BUY"
EQUIPMENT_MODES = (MODE_RENT, MODE_BUY, MODE_RENT_BUY)
EQUIPMENT_CONDITIONS = ("NEW", "USED")

KIND_RENT = "RENT"
KIND_BUY = "BUY"
REQUEST_KINDS = (KIND_RENT, KIND_BUY)

# rate_unit -> the listing attribute holding that rate.
RATE_COLUMNS = {"HOUR": "hourly_rate", "DAY": "daily_rate", "WEEK": "weekly_rate", "MONTH": "monthly_rate"}

STATUS_PENDING = "PENDING"
STATUS_ACCEPTED = "ACCEPTED"
STATUS_REJECTED = "REJECTED"
STATUS_CANCELLED = "CANCELLED"
STATUS_COMPLETED = "COMPLETED"
EQUIPMENT_REQUEST_STATUSES = (STATUS_PENDING, STATUS_ACCEPTED, STATUS_REJECTED, STATUS_CANCELLED, STATUS_COMPLETED)

_RATE_COLUMNS = ("hourly_rate_amount", "daily_rate_amount", "weekly_rate_amount", "monthly_rate_amount")


def money(column: str) -> Mapped[Decimal | None]:
    return mapped_column(column, Numeric(14, 2))


class EquipmentItem(UuidPrimaryKeyMixin, Base):
    """One item an Equipment Supplier offers to rent, to buy, or both."""

    __tablename__ = "equipment_listings"
    __table_args__ = (
        CheckConstraint("mode IN ('RENT', 'BUY', 'RENT_BUY')", name="mode"),
        CheckConstraint("condition IN ('NEW', 'USED')", name="condition"),
        CheckConstraint("quantity_total >= 0", name="quantity_total"),
        CheckConstraint(
            " AND ".join(f"({column} IS NULL OR {column} > 0)" for column in (*_RATE_COLUMNS, "sale_price_amount")),
            name="prices_positive",
        ),
        CheckConstraint(
            "mode = 'BUY' OR (" + " OR ".join(f"{rate} IS NOT NULL" for rate in _RATE_COLUMNS) + ")",
            name="rent_has_rate",
        ),
        CheckConstraint("mode = 'RENT' OR sale_price_amount IS NOT NULL", name="buy_has_price"),
        Index("ix_equipment_listings__supplier_user_id_is_active", "supplier_user_id", "is_active"),
    )

    supplier_id: Mapped[uuid.UUID] = account_fk("supplier_user_id", ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(80))
    model: Mapped[str | None] = mapped_column(String(80))
    specifications: Mapped[str | None] = mapped_column(Text)
    condition: Mapped[str] = mapped_column(String(10), nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    quantity_total: Mapped[int] = mapped_column(Integer, nullable=False)
    hourly_rate: Mapped[Decimal | None] = money("hourly_rate_amount")
    daily_rate: Mapped[Decimal | None] = money("daily_rate_amount")
    weekly_rate: Mapped[Decimal | None] = money("weekly_rate_amount")
    monthly_rate: Mapped[Decimal | None] = money("monthly_rate_amount")
    sale_price: Mapped[Decimal | None] = money("sale_price_amount")
    image_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class EquipmentRequest(UuidPrimaryKeyMixin, Base):
    """A Site Engineer's request to rent or buy a listing; once ACCEPTED it is the
    project's equipment assignment."""

    __tablename__ = "equipment_requests"
    __table_args__ = (
        CheckConstraint("request_kind IN ('RENT', 'BUY')", name="request_kind"),
        CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED')", name="status"),
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("unit_price_amount > 0", name="unit_price"),
        CheckConstraint("rate_unit IS NULL OR rate_unit IN ('HOUR', 'DAY', 'WEEK', 'MONTH')", name="rate_unit"),
        CheckConstraint(
            "(request_kind = 'RENT' AND rate_unit IS NOT NULL AND starts_on IS NOT NULL AND ends_on IS NOT NULL)"
            " OR (request_kind = 'BUY' AND rate_unit IS NULL)",
            name="kind_fields",
        ),
        CheckConstraint("ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on", name="dates"),
        Index("ix_equipment_requests__supplier_user_id_status", "supplier_user_id", "status"),
        Index("ix_equipment_requests__project_id_status", "project_id", "status"),
        Index("ix_equipment_requests__listing_id_status", "listing_id", "status"),
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
    equipment_item_id: Mapped[uuid.UUID] = mapped_column(
        "listing_id", ForeignKey("equipment_listings.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    request_kind: Mapped[str] = mapped_column(String(4), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    rate_unit: Mapped[str | None] = mapped_column(String(5))
    unit_price: Mapped[Decimal] = mapped_column("unit_price_amount", Numeric(14, 2), nullable=False)
    start_date: Mapped[date | None] = mapped_column("starts_on", Date)
    end_date: Mapped[date | None] = mapped_column("ends_on", Date)
    notes: Mapped[str | None] = mapped_column(Text)
    decision_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=STATUS_PENDING)
    decided_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    completed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class EquipmentUsageLog(UuidPrimaryKeyMixin, Base):
    """A rental's hours on one day."""

    __tablename__ = "equipment_usage_logs"
    __table_args__ = (
        UniqueConstraint("equipment_request_id", "usage_on"),
        CheckConstraint("hours_used >= 0", name="hours_used"),
    )

    equipment_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("equipment_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    usage_date: Mapped[date] = mapped_column("usage_on", Date, nullable=False)
    hours_used: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by_id: Mapped[uuid.UUID] = account_fk("recorded_by_user_id")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
