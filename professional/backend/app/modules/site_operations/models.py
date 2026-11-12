"""Site operations tables (technical-architecture.md section 10).

    site_daily_records             was daily_site_records; contractor_id -> builder_id
    site_labour_entries            attendance and wages of a day; FK daily_record_id CASCADE
    site_material_usages           FK daily_record_id CASCADE
    site_material_purchases        FK daily_record_id CASCADE
    site_machinery_usages          FK daily_record_id CASCADE
    site_expenses                  FK daily_record_id CASCADE
    site_payments                  FK daily_record_id CASCADE
    site_daily_record_adjustments  was daily_record_adjustments (written by billing's
                                   builder corrections of closed records)
    project_material_stock         was project_material_inventory
    builder_workers, builder_offline_suppliers   UUID; contractor_id -> builder_id
    legacy_labour_logs, legacy_material_logs     was labour_logs, material_logs; deprecated
                                                 with their endpoints

Every key is a UUID. The Python attribute names stay the old ones (contractor_id,
register_id, labour_cost, work_date ...) so the ported service and the API keys are
unchanged; the column names follow section 9 (builder_id, daily_record_id, *_amount for
money, *_on for dates). Times are timestamptz read as naive UTC (NaiveUtcTimestamp).

Delete rules (9.3): a day's entries go with the day (CASCADE); a daily record is cost
history and keeps its project (RESTRICT, which the project delete already refuses);
stock and the legacy logs go with their project (CASCADE), as the old project delete
removed them; a builder's own worker and supplier lists go with the builder; a link to a
listed worker, supplier or engineer is SET NULL, as is the link to a supplier listing
(product_id, column listing_id), which the old listing delete unlinked.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, Float, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

ADJUSTABLE_FIELDS = ("labour_cost", "material_cost", "equipment_cost", "total_expenses")


def created_at_column() -> Mapped[datetime]:
    return mapped_column(
        "created_at", NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


def money(column: str, *, nullable: bool = False, default: object = None) -> Mapped[Decimal]:
    return mapped_column(column, Numeric(14, 2), nullable=nullable, default=default)


def listing_fk() -> Mapped[uuid.UUID | None]:
    """A supplier listing; the row stays when the listing is deleted (SET NULL)."""
    return mapped_column("listing_id", ForeignKey("supplier_listings.id", ondelete="SET NULL"), index=True)


def record_fk() -> Mapped[uuid.UUID]:
    return mapped_column(
        "daily_record_id", ForeignKey("site_daily_records.id", ondelete="CASCADE"), nullable=False, index=True
    )


class DailyCostRegister(UuidPrimaryKeyMixin, Base):
    """One Site Engineer's record of one day on one project."""

    __tablename__ = "site_daily_records"
    __table_args__ = (Index("ix_site_daily_records__project_id_work_on", "project_id", "work_on"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    contractor_id: Mapped[uuid.UUID] = mapped_column(
        "builder_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        "created_by_user_id", ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    work_date: Mapped[date] = mapped_column("work_on", Date, nullable=False, index=True)
    floor: Mapped[str] = mapped_column(String(80), nullable=False)
    block: Mapped[str] = mapped_column(String(80), nullable=False)
    work_type: Mapped[str] = mapped_column(String(120), nullable=False)
    # BOQ linkage of the day's activity; remaining and progress are derived on read.
    activity_category: Mapped[str | None] = mapped_column(String(120))
    boq_reference: Mapped[str | None] = mapped_column(String(80))
    activity_unit: Mapped[str | None] = mapped_column(String(40))
    planned_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    completed_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    progress_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="IN_PROGRESS", index=True)
    inspection_remarks: Mapped[str | None] = mapped_column(Text)
    labour_worker_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_expenses: Mapped[Decimal] = money("total_expenses_amount", default=0)
    labour_cost: Mapped[Decimal] = money("labour_cost_amount", default=0)
    material_cost: Mapped[Decimal] = money("material_cost_amount", default=0)
    equipment_cost: Mapped[Decimal] = money("equipment_cost_amount", default=0)
    material_used: Mapped[str | None] = mapped_column(Text)
    equipment_used: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, onupdate=naive_utc_now, server_default=text("now()")
    )
    closed_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)

    project = relationship("Project")
    created_by = relationship("User", foreign_keys=[created_by_id])


class CostWorker(UuidPrimaryKeyMixin, Base):
    """A worker a builder has named on a labour entry (the builder's own list)."""

    __tablename__ = "builder_workers"
    __table_args__ = (Index("ix_builder_workers__builder_id_name", "builder_id", "name"),)

    contractor_id: Mapped[uuid.UUID] = mapped_column(
        "builder_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class CostSupplier(UuidPrimaryKeyMixin, Base):
    """A supplier outside the platform a builder has bought from (the builder's own list)."""

    __tablename__ = "builder_offline_suppliers"
    __table_args__ = (Index("ix_builder_offline_suppliers__builder_id_name", "builder_id", "name"),)

    contractor_id: Mapped[uuid.UUID] = mapped_column(
        "builder_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = created_at_column()


class CostMaterialInventory(UuidPrimaryKeyMixin, Base):
    """A material's stock on one project site."""

    __tablename__ = "project_material_stock"
    __table_args__ = (Index("uq_project_material_stock__project_id_material", "project_id", "material", unique=True),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contractor_id: Mapped[uuid.UUID] = mapped_column(
        "builder_id", ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # The supplier listing the last fulfilled order came from.
    product_id: Mapped[uuid.UUID | None] = listing_fk()
    material: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    current_stock: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    minimum_stock: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


class CostLabourEntry(UuidPrimaryKeyMixin, Base):
    """Attendance and wages of one labour category (or named worker) on a day."""

    __tablename__ = "site_labour_entries"

    register_id: Mapped[uuid.UUID] = record_fk()
    worker_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("builder_workers.id", ondelete="SET NULL"), index=True
    )
    labour_category: Mapped[str] = mapped_column(String(80), nullable=False)
    worker_name: Mapped[str | None] = mapped_column(String(120))
    worker_count: Mapped[int] = mapped_column(Integer, nullable=False)
    daily_wage: Mapped[Decimal] = money("daily_wage_amount")
    attendance_status: Mapped[str] = mapped_column(String(40), nullable=False)
    overtime_hours: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    overtime_rate: Mapped[Decimal] = money("overtime_rate_amount", default=0)
    advance_paid: Mapped[Decimal] = money("advance_paid_amount", default=0)
    remarks: Mapped[str | None] = mapped_column(Text)
    regular_amount: Mapped[Decimal] = money("regular_amount")
    overtime_amount: Mapped[Decimal] = money("overtime_amount")
    total_amount: Mapped[Decimal] = money("total_amount")
    payable_amount: Mapped[Decimal] = money("payable_amount")
    created_at: Mapped[datetime] = created_at_column()


class CostMaterialUsage(UuidPrimaryKeyMixin, Base):
    __tablename__ = "site_material_usages"
    __table_args__ = (
        Index("ix_site_material_usages__project_id_material_work_on", "project_id", "material", "work_on"),
    )

    register_id: Mapped[uuid.UUID] = record_fk()
    product_id: Mapped[uuid.UUID | None] = listing_fk()
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    engineer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    material: Mapped[str] = mapped_column(String(120), nullable=False)
    opening_stock: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_used: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    rate: Mapped[Decimal] = money("rate_amount")
    total_cost: Mapped[Decimal] = money("total_cost_amount")
    closing_stock: Mapped[float] = mapped_column(Float, nullable=False)
    work_date: Mapped[date | None] = mapped_column("work_on", Date, index=True)
    created_at: Mapped[datetime] = created_at_column()


class CostMaterialPurchase(UuidPrimaryKeyMixin, Base):
    __tablename__ = "site_material_purchases"

    register_id: Mapped[uuid.UUID] = record_fk()
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        "offline_supplier_id", ForeignKey("builder_offline_suppliers.id", ondelete="SET NULL"), index=True
    )
    supplier_name: Mapped[str] = mapped_column(String(160), nullable=False)
    invoice_number: Mapped[str | None] = mapped_column(String(80))
    material: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    rate: Mapped[Decimal] = money("rate_amount")
    transport_cost: Mapped[Decimal] = money("transport_cost_amount", default=0)
    loading_cost: Mapped[Decimal] = money("loading_cost_amount", default=0)
    unloading_cost: Mapped[Decimal] = money("unloading_cost_amount", default=0)
    gst_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    discount: Mapped[Decimal] = money("discount_amount", default=0)
    subtotal: Mapped[Decimal] = money("subtotal_amount")
    tax_amount: Mapped[Decimal] = money("tax_amount")
    total_amount: Mapped[Decimal] = money("total_amount")
    purchase_date: Mapped[date] = mapped_column("purchased_on", Date, nullable=False, index=True)
    created_at: Mapped[datetime] = created_at_column()


class CostExpense(UuidPrimaryKeyMixin, Base):
    __tablename__ = "site_expenses"

    register_id: Mapped[uuid.UUID] = record_fk()
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = money("amount")
    expense_date: Mapped[date] = mapped_column("expense_on", Date, nullable=False, index=True)
    created_at: Mapped[datetime] = created_at_column()


class CostMachineryUsage(UuidPrimaryKeyMixin, Base):
    __tablename__ = "site_machinery_usages"

    register_id: Mapped[uuid.UUID] = record_fk()
    machine: Mapped[str] = mapped_column(String(120), nullable=False)
    hours: Mapped[float] = mapped_column(Float, nullable=False)
    rate_per_hour: Mapped[Decimal] = money("rate_per_hour_amount")
    operator_charge: Mapped[Decimal] = money("operator_charge_amount", default=0)
    fuel_cost: Mapped[Decimal] = money("fuel_cost_amount", default=0)
    maintenance_cost: Mapped[Decimal] = money("maintenance_cost_amount", default=0)
    total_cost: Mapped[Decimal] = money("total_cost_amount")
    created_at: Mapped[datetime] = created_at_column()


class CostPayment(UuidPrimaryKeyMixin, Base):
    __tablename__ = "site_payments"

    register_id: Mapped[uuid.UUID] = record_fk()
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_type: Mapped[str] = mapped_column(String(80), nullable=False)
    party_name: Mapped[str | None] = mapped_column(String(160))
    amount: Mapped[Decimal] = money("amount")
    payment_date: Mapped[date] = mapped_column("paid_on", Date, nullable=False, index=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()


class DailyRecordAdjustment(UuidPrimaryKeyMixin, Base):
    """A builder's audited correction of one cost total on a closed daily record (the
    engineer's record itself is never written). Written by billing's premium tools."""

    __tablename__ = "site_daily_record_adjustments"
    __table_args__ = (
        CheckConstraint(
            "field_name IN ('labour_cost', 'material_cost', 'equipment_cost', 'total_expenses')", name="field"
        ),
        CheckConstraint("adjusted_value >= 0", name="value"),
    )

    register_id: Mapped[uuid.UUID] = record_fk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    builder_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    builder_name: Mapped[str] = mapped_column(String(150), nullable=False)
    field_name: Mapped[str] = mapped_column(String(40), nullable=False)
    original_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    adjusted_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class MaterialLog(UuidPrimaryKeyMixin, Base):
    """Deprecated: the builder's early material log (POST /materials/create)."""

    __tablename__ = "legacy_material_logs"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_name: Mapped[str] = mapped_column(String(80), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    cost: Mapped[Decimal] = money("cost_amount")
    created_at: Mapped[datetime] = created_at_column()


class LabourLog(UuidPrimaryKeyMixin, Base):
    """Deprecated: the builder's early labour log (POST /labour/create)."""

    __tablename__ = "legacy_labour_logs"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    labour_count: Mapped[int] = mapped_column(Integer, nullable=False)
    labour_cost: Mapped[Decimal] = money("labour_cost_amount")
    work_date: Mapped[datetime] = mapped_column("worked_at", NaiveUtcTimestamp, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
