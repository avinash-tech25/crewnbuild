"""The Partner service catalog (technical-architecture.md section 11, domain Catalog).

    catalog_services                  was services
    catalog_service_checklist_steps   was service_step_templates; service_id -> catalog_service_id

The Python names stay the old ones (Service, ServiceStepTemplate, service_id), so the
ported services are unchanged; the tables and columns follow section 9.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, new_uuid7
from app.database.types import NaiveUtcTimestamp, naive_utc_now
from app.modules.technicians.models import TECHNICIAN_TYPES

KIND_SERVICE = "SERVICE"
KIND_CONSULTATION = "CONSULTATION"
SERVICE_KINDS = (KIND_SERVICE, KIND_CONSULTATION)
SERVICE_KIND_CHECK = "service_kind IN (" + ", ".join(f"'{kind}'" for kind in SERVICE_KINDS) + ")"

# The catalog is offered per trade, so the four values are the four technician
# types -- built from that one tuple rather than copied, so a trade can never be
# bookable without a technician who does it, or the reverse.
TRADE_CHECK = "trade IN (" + ", ".join(f"'{trade}'" for trade in TECHNICIAN_TYPES) + ")"

# Partner is an India-only application: one currency, fixed. The column exists so
# a stored price says what it is in rather than relying on a convention, and the
# CHECK keeps it honest -- there is no conversion anywhere in this application.
CURRENCY_INR = "INR"


class Service(Base):
    """One bookable item in the Partner service catalog.

    The catalog is what the requester chooses from before a booking exists:
    a trade (Plumber), then a service within it (Tap Repair), at a price this
    application publishes. `price` is the only authority for what a booking
    costs -- a requester never sends an amount, and nothing computes one.

    These are this application's own catalog prices. They are not represented
    anywhere as an external company's or provider's verified rates.

    Retire a service with `is_active = False` rather than deleting it: bookings
    reference this row, and the foreign key is RESTRICT precisely so priced
    history cannot be deleted out from under itself.

    `image_url`, `description` and `includes` are nullable on purpose. The
    catalog is usable the moment prices exist; artwork and copy arrive later and
    the UI renders without them rather than showing invented content.
    """

    __tablename__ = "catalog_services"
    __table_args__ = (
        # Consultation exists once per trade, so a slug is unique within a trade
        # rather than across the catalog.
        UniqueConstraint("trade", "slug"),
        CheckConstraint(TRADE_CHECK, name="trade"),
        CheckConstraint(SERVICE_KIND_CHECK, name="service_kind"),
        CheckConstraint("price >= 0", name="price"),
        CheckConstraint(f"currency = '{CURRENCY_INR}'", name="currency"),
        # The one query the catalog endpoint runs: a trade's live services in
        # their published order.
        Index("ix_catalog_services__trade_is_active_sort_order", "trade", "is_active", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    trade: Mapped[str] = mapped_column(String(20), nullable=False)
    # Stable, URL-safe and the stem of the service's image file, so neither the
    # address bar nor an asset path moves when a display name is reworded.
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    service_name: Mapped[str] = mapped_column(String(120), nullable=False)
    service_kind: Mapped[str] = mapped_column(String(12), nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    includes: Mapped[str | None] = mapped_column(Text)
    # Numeric, never float: a price is an exact decimal amount and binary
    # floating point cannot hold one.
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), default=CURRENCY_INR, server_default=text(f"'{CURRENCY_INR}'"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    # The published order within a trade. Without it the list would come back in
    # whatever order the rows were written, which is not the order they were
    # approved in.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )


MAX_STEP_POSITION = 20


class ServiceStepTemplate(Base):
    """One step of the default checklist for a catalog service ("Inspect leakage").

    A template is only ever COPIED: a booking made for the service gets its own
    `service_request_steps` rows at booking time, so editing or retiring a step
    here never changes a job that already exists. Retire a step with
    `is_active = False`; the foreign key from the booking copies is SET NULL, and
    the one to the service is RESTRICT, like every other reference to a service.
    """

    __tablename__ = "catalog_service_checklist_steps"
    __table_args__ = (
        UniqueConstraint("catalog_service_id", "position"),
        CheckConstraint(f"position BETWEEN 1 AND {MAX_STEP_POSITION}", name="position"),
        CheckConstraint("btrim(title) <> ''", name="title"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    service_id: Mapped[uuid.UUID] = mapped_column(
        "catalog_service_id", ForeignKey("catalog_services.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, default=naive_utc_now, server_default=text("now()"), onupdate=naive_utc_now, nullable=False
    )
