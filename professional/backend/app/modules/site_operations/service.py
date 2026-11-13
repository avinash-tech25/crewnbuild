"""The Site Engineer's daily record (the calendar) and the cost tool: labour and
attendance, material usage and purchases, machinery, expenses, payments, project stock,
the builder's cost summary and the House Owner's project analysis (ported from the old
daily_cost_service.py, same rules and answers).

Only a project's members reach its site data: the actively assigned Site Engineer
writes; the awarded builder and the engineer read the cost summary; the House Owner
reads the owner-safe analysis of their own project only.
"""

import json
import uuid
from datetime import date as date_value
from datetime import datetime, time, timedelta
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.local_time import local_iso as to_local_iso
from app.core.local_time import local_workflow_now
from app.database.types import naive_utc_now
from app.modules.billing.entitlements import require_builder_feature, require_project_feature
from app.modules.billing.plans import BUILDER_BILLING
from app.modules.files.upload_service import SITE_IMAGE, SITE_VIDEO, UploadService
from app.modules.identity.models import User
from app.modules.marketplace.site_links import fulfilled_orders, supplier_listings
from app.modules.projects.access import (
    ensure_contractor_project_access,
    ensure_engineer_project_write_access,
    ensure_project_cost_read_access,
    ensure_project_owner_analysis_access,
    project_progress_fields,
    resolve_project_contractor,
)
from app.modules.projects.award_service import get_awarded_contract
from app.modules.projects.daily_window import daily_record_is_open, ensure_daily_record_open
from app.modules.projects.models import Project, ProjectTimeline
from app.modules.projects.notices import create_notification
from app.modules.projects.project_service import project_locality, save_upload_files, serialize_cost_entry
from app.modules.site_operations.models import (
    CostExpense,
    CostLabourEntry,
    CostMachineryUsage,
    CostMaterialInventory,
    CostMaterialPurchase,
    CostMaterialUsage,
    CostPayment,
    CostSupplier,
    CostWorker,
    DailyCostRegister,
    LabourLog,
    MaterialLog,
)
from app.modules.site_operations.repository import DailyCostRepository
from app.modules.site_operations.schemas import (
    CostExpenseCreate,
    CostLabourEntryCreate,
    CostMachineryUsageCreate,
    CostMaterialPurchaseCreate,
    CostMaterialUsageCreate,
    CostPaymentCreate,
    DailyCostRegisterCreate,
    LabourCreate,
    MaterialCreate,
)

__all__ = ["daily_record_is_open", "ensure_daily_record_open"]

# The instants of the cost-tool rows, sent with their offset; dates stay calendar dates.
COST_TOOL_INSTANTS = ("created_at", "updated_at", "closed_at")


def money(value: Any) -> float:
    return float(value or 0)


def cost_entry(row: Any) -> dict[str, Any]:
    """A cost-tool row for the API (attribute names), its instants with their offset."""
    payload = serialize_cost_entry(row)
    for name in COST_TOOL_INSTANTS:
        value = getattr(row, name, None)
        if isinstance(value, datetime):
            payload[name] = to_local_iso(value)
    return payload


def supplier_store_name(user: User) -> str:
    """A supplier's store name, else the account name."""
    profile = user.supplier_profile
    return (profile.store_name if profile and profile.store_name else None) or user.name


def checked_work_date(value: str) -> date_value:
    """A YYYY-MM-DD work date. Crash fixed: an unreadable one used to fail with a 500."""
    try:
        return datetime.fromisoformat(value).date()
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Enter a valid work date") from None


def workflow_metadata() -> dict:
    now = local_workflow_now()
    return {
        "timezone": get_settings().local_timezone,
        "cutoff": get_settings().daily_work_cutoff,
        "local_date": now.date().isoformat(),
        "local_time": now.strftime("%H:%M"),
    }


def close_expired_daily_registers(database: Session, project_id: uuid.UUID) -> None:
    today = local_workflow_now().date()
    rows = DailyCostRepository(database).list_expired_registers(project_id, today)
    if not rows:
        return
    for register in rows:
        register.status = "CLOSED"
        register.closed_at = register.closed_at or naive_utc_now()
        register.updated_at = naive_utc_now()
    DailyCostRepository(database).commit()


def get_cost_register(database: Session, register_id: uuid.UUID, user: User) -> DailyCostRegister:
    register = DailyCostRepository(database).get(register_id)
    if not register:
        raise HTTPException(status_code=404, detail="Daily register not found")
    ensure_engineer_project_write_access(database, register.project_id, user)
    # A daily record belongs to the engineer who opened it (save_daily_workflow
    # keys it by project, engineer and date). Another engineer on the same
    # project could otherwise add labour, payments or purchases to it.
    if register.created_by_id != user.id:
        raise HTTPException(
            status_code=403, detail="Only the Site Engineer who created this daily record can add to it"
        )
    if register.status in {"COMPLETED", "CLOSED"}:
        raise HTTPException(status_code=409, detail="This day is completed and cannot be edited")
    ensure_daily_record_open(register.work_date)
    return register


def supplier_names(database: Session, supplier_ids: list) -> dict:
    """Store name (else account name) per supplier user id."""
    unique_ids = list({supplier_id for supplier_id in supplier_ids if supplier_id})
    if not unique_ids:
        return {}
    return {user.id: supplier_store_name(user) for user in DailyCostRepository(database).list_users(unique_ids)}


def received_orders(database: Session, project_id: uuid.UUID, work_date: str) -> list[dict]:
    """Material order lines fulfilled on `work_date` (site local day)."""
    day = datetime.fromisoformat(work_date).date()
    offset = timedelta(minutes=get_settings().local_utc_offset_minutes)
    start = datetime.combine(day, time.min) - offset
    rows = fulfilled_orders(database, project_id, start, start + timedelta(days=1))
    suppliers = supplier_names(database, [row.supplier_id for row in rows])
    return [
        {
            "id": row.id,
            "request_code": row.request_code,
            "material_name": row.material_name,
            "quantity": money(row.quantity),
            "unit": row.unit,
            # The price agreed when the order was placed.
            "price": money(row.price) if row.price is not None else None,
            "amount": money(row.price) * money(row.quantity) if row.price is not None else None,
            "supplier_name": suppliers.get(row.supplier_id),
            "fulfilled_at": to_local_iso(row.fulfilled_at),
        }
        for row in rows
    ]


def get_or_create_supplier(database: Session, contractor_id: uuid.UUID, supplier_name: str) -> CostSupplier:
    supplier = DailyCostRepository(database).find_supplier(contractor_id, supplier_name)
    if supplier:
        return supplier
    supplier = CostSupplier(contractor_id=contractor_id, name=supplier_name)
    DailyCostRepository(database).add(supplier)
    DailyCostRepository(database).flush()
    return supplier


def get_or_create_worker(
    database: Session, contractor_id: uuid.UUID, worker_name: str | None, category: str
) -> CostWorker | None:
    if not worker_name:
        return None
    worker = DailyCostRepository(database).find_worker(contractor_id, worker_name)
    if worker:
        worker.category = category
        return worker
    worker = CostWorker(contractor_id=contractor_id, name=worker_name, category=category)
    DailyCostRepository(database).add(worker)
    DailyCostRepository(database).flush()
    return worker


def get_or_create_inventory(
    database: Session, project_id: uuid.UUID, contractor_id: uuid.UUID, material: str, unit: str, minimum_stock: float
) -> CostMaterialInventory:
    inventory = DailyCostRepository(database).find_inventory(project_id, material)
    if inventory:
        inventory.unit = unit
        inventory.minimum_stock = minimum_stock
        return inventory
    inventory = CostMaterialInventory(
        project_id=project_id,
        contractor_id=contractor_id,
        material=material,
        unit=unit,
        current_stock=0,
        minimum_stock=minimum_stock,
    )
    DailyCostRepository(database).add(inventory)
    DailyCostRepository(database).flush()
    return inventory


def project_material_stock(database: Session, project_id: uuid.UUID) -> list[dict]:
    """Per-material project stock: received = remaining + total usage across all daily records."""
    inventory_rows = DailyCostRepository(database).list_project_inventory(project_id)
    all_register_ids = [row.id for row in DailyCostRepository(database).list_project_register_ids(project_id)]
    usages = DailyCostRepository(database).list_material_usages(all_register_ids) if all_register_ids else []
    by_material: dict[str, dict] = {}
    for usage in usages:
        aggregate = by_material.setdefault(usage.material, {"total_used": 0.0, "daily": []})
        quantity_used = money(usage.quantity_used)
        aggregate["total_used"] += quantity_used
        if usage.work_date:
            # work_date / quantity_used / unit are the original fields. The rest
            # are additive so the engineer's material history can show the rate,
            # the amount and when the row was first recorded, and link the entry
            # to its daily record. A row has no update timestamp of its own.
            aggregate["daily"].append(
                {
                    "work_date": usage.work_date.isoformat(),
                    "quantity_used": quantity_used,
                    "unit": usage.unit,
                    "id": usage.id,
                    "register_id": usage.register_id,
                    "rate": money(usage.rate),
                    "total_cost": money(usage.total_cost),
                    "recorded_at": to_local_iso(usage.created_at),
                }
            )
    materials = []
    for item in inventory_rows:
        aggregate = by_material.get(item.material, {"total_used": 0.0, "daily": []})
        total_used = aggregate["total_used"]
        remaining = money(item.current_stock)
        received = remaining + total_used
        stock_status = (
            "OUT_OF_STOCK"
            if remaining <= 0
            else ("LOW_STOCK" if item.minimum_stock and remaining <= item.minimum_stock else "IN_STOCK")
        )
        materials.append(
            {
                "id": item.id,
                "product_id": item.product_id,
                "material": item.material,
                "unit": item.unit,
                "received": received,
                "total_used": total_used,
                "remaining": remaining,
                "available": received - total_used,
                "used_today": 0,
                "minimum_stock": money(item.minimum_stock),
                "stock_status": stock_status,
                "daily_usage": sorted(aggregate["daily"], key=lambda entry: entry["work_date"]),
            }
        )
    return materials


def cost_summary_payload(database: Session, project: Project, work_date: str | None = None) -> dict:
    close_expired_daily_registers(database, project.id)
    registers = DailyCostRepository(database).list_project_registers(project.id, work_date)
    register_ids = [register.id for register in registers]
    if register_ids:
        labour_entries = DailyCostRepository(database).list_labour_entries(register_ids)
        material_usages = DailyCostRepository(database).list_material_usages(register_ids)
        material_purchases = DailyCostRepository(database).list_material_purchases(register_ids)
        expenses = DailyCostRepository(database).list_expenses(register_ids)
        machinery_usages = DailyCostRepository(database).list_machinery_usages(register_ids)
        payments = DailyCostRepository(database).list_payments(register_ids)
    else:
        labour_entries = []
        material_usages = []
        material_purchases = []
        expenses = []
        machinery_usages = []
        payments = []
    inventory = DailyCostRepository(database).list_project_inventory(project.id)
    materials = project_material_stock(database, project.id)
    product_ids = [item.get("product_id") for item in materials if item.get("product_id")]
    product_rates = {}
    products = supplier_listings(database, product_ids) if product_ids else []
    for product in products:
        product_rates[product.id] = money(product.price)
    # Who supplies a stock material, and what exactly it is. The only link from
    # site stock to a supplier is the stock row's product_id (set by the last
    # fulfilled order), so a material bought outside the catalogue has none.
    product_details = {product.id: product for product in products}
    suppliers = supplier_names(database, [product.supplier_id for product in products])
    for material in materials:
        product = product_details.get(material.get("product_id"))
        material["supplier_id"] = str(product.supplier_id) if product else None
        material["supplier_name"] = suppliers.get(product.supplier_id) if product else None
        material["specification"] = (
            " · ".join(part for part in (product.brand, product.size) if part) if product else None
        )
    # A supplier product price wins when the material is linked to one. Otherwise
    # fall back to the rate already recorded against the material's most recent
    # usage, which was previously stored but never surfaced, leaving the rate and
    # amount columns blank for any material bought outside the catalogue.
    recorded_rates: dict[str, float] = {}
    for usage in DailyCostRepository(database).list_rated_material_usages(project.id):
        recorded_rates[usage.material] = money(usage.rate)
    for material in materials:
        material["rate"] = product_rates.get(material.get("product_id")) or recorded_rates.get(material["material"], 0)
    used_today_by_material: dict[str, float] = {}
    for usage in material_usages:
        used_today_by_material[usage.material] = used_today_by_material.get(usage.material, 0) + money(
            usage.quantity_used
        )
    for material in materials:
        used_today = used_today_by_material.get(material["material"], 0)
        material["used_today"] = used_today
        material["available"] = material["received"] - material["total_used"] + used_today
    cash_in = sum(money(payment.amount) for payment in payments if payment.direction == "IN")
    cash_out = sum(money(payment.amount) for payment in payments if payment.direction == "OUT")
    material_cost = sum(money(register.material_cost) for register in registers) or (
        sum(money(item.total_cost) for item in material_usages)
        + sum(money(item.total_amount) for item in material_purchases)
    )
    labour_cost = sum(money(register.labour_cost) for register in registers) or sum(
        money(item.total_amount) for item in labour_entries
    )
    machinery_cost = sum(money(register.equipment_cost) for register in registers) or sum(
        money(item.total_cost) for item in machinery_usages
    )
    expense_cost = sum(money(register.total_expenses) for register in registers) or sum(
        money(item.amount) for item in expenses
    )
    spent_budget = material_cost + labour_cost + machinery_cost + expense_cost
    # Spending is measured against the finalized contract once there is one,
    # and against the owner's original budget until then.
    contract = get_awarded_contract(database, project)
    estimated_budget = money(contract["contract_amount"] if contract else project.budget)
    supplier_totals = {}
    for purchase in material_purchases:
        supplier_totals.setdefault(purchase.supplier_name, {"purchase_total": 0, "paid_amount": 0})
        supplier_totals[purchase.supplier_name]["purchase_total"] += money(purchase.total_amount)
    for payment in payments:
        if payment.direction == "OUT" and payment.party_name:
            supplier_totals.setdefault(payment.party_name, {"purchase_total": 0, "paid_amount": 0})
            supplier_totals[payment.party_name]["paid_amount"] += money(payment.amount)
    supplier_ledger = [
        {
            "supplier_name": supplier_name,
            "purchase_total": totals["purchase_total"],
            "paid_amount": totals["paid_amount"],
            "pending_amount": totals["purchase_total"] - totals["paid_amount"],
        }
        for supplier_name, totals in supplier_totals.items()
    ]
    return {
        "registers": [
            {
                **cost_entry(register),
                "created_by_name": register.created_by.name if register.created_by else "",
                "last_updated_at": to_local_iso(register.updated_at or register.created_at),
                "boq_activity": boq_activity_progress(database, register),
            }
            for register in registers
        ],
        "labour_entries": [cost_entry(item) for item in labour_entries],
        "material_usages": [cost_entry(item) for item in material_usages],
        "material_purchases": [cost_entry(item) for item in material_purchases],
        "expenses": [cost_entry(item) for item in expenses],
        "machinery_usages": [cost_entry(item) for item in machinery_usages],
        "payments": [cost_entry(item) for item in payments],
        "inventory": [cost_entry(item) for item in inventory],
        "materials": materials,
        "inventory_alerts": [
            f"Only {item.current_stock:g} {item.unit} {item.material} remaining."
            for item in inventory
            if item.minimum_stock and item.current_stock <= item.minimum_stock
        ],
        "supplier_ledger": supplier_ledger,
        "dashboard": {
            "labour_cost": labour_cost,
            "material_cost": material_cost,
            "machinery_cost": machinery_cost,
            "expenses": expense_cost,
            "cash_in": cash_in,
            "cash_out": cash_out,
            "cash_balance": cash_in - cash_out,
            "spent_budget": spent_budget,
            "estimated_budget": estimated_budget,
            "remaining_budget": estimated_budget - spent_budget,
            "budget_percentage": round((spent_budget / estimated_budget) * 100, 2) if estimated_budget else 0,
            "total_workers": sum(register.labour_worker_count or 0 for register in registers)
            or sum(item.worker_count for item in labour_entries),
            "low_stock_materials": len(
                [item for item in inventory if item.minimum_stock and item.current_stock <= item.minimum_stock]
            ),
            "pending_supplier_payments": sum(max(0, item["pending_amount"]) for item in supplier_ledger),
            "project_completion": project_progress_fields(project)["completion_percentage"],
        },
        # Stock that arrived on this date. Informational only: what it cost is
        # never added to the day's spend, which counts consumption.
        "received_orders": received_orders(database, project.id, work_date) if work_date else [],
        "workflow": workflow_metadata(),
    }


# What the House Owner's Project Analysis may show, picked field by field from
# the builder's cost summary. Anything not named here (supplier ledger, cash
# in/out/balance, payments, labour entries and wages, worker counts, purchases,
# rates, suppliers, inventory, remarks, who recorded what) never leaves the server.
OWNER_DASHBOARD_FIELDS = (
    "estimated_budget",
    "spent_budget",
    "remaining_budget",
    "budget_percentage",
    "material_cost",
    "labour_cost",
    "machinery_cost",
    "expenses",
    "project_completion",
)
OWNER_REGISTER_FIELDS = (
    "id",
    "work_date",
    "work_type",
    "material_cost",
    "labour_cost",
    "equipment_cost",
    "total_expenses",
)
OWNER_BOQ_FIELDS = (
    "boq_reference",
    "activity_category",
    "activity_unit",
    "planned_quantity",
    "completed_to_date",
    "remaining_quantity",
    "activity_progress_percent",
)
OWNER_MATERIAL_FIELDS = ("id", "material", "unit", "received", "total_used", "remaining", "stock_status")
OWNER_EXPENSE_FIELDS = ("id", "expense_date", "description", "category", "amount")


def _pick(row: dict | None, fields: tuple) -> dict:
    row = row or {}
    return {field: row.get(field) for field in fields}


def owner_analysis_payload(summary: dict, project: Project) -> dict:
    """The owner-safe subset of cost_summary_payload: budget, total and
    category-wise spend, work progress, material quantities and the schedule
    (which the project payload already carries). Expense lines are the owner's own
    only on a self-construction project; on a builder-managed one they stay with
    the builder."""
    self_construction = project.construction_type == "SELF_CONSTRUCTION"
    return {
        "dashboard": _pick(summary.get("dashboard"), OWNER_DASHBOARD_FIELDS),
        "registers": [
            {
                **_pick(register, OWNER_REGISTER_FIELDS),
                "boq_activity": _pick(register.get("boq_activity"), OWNER_BOQ_FIELDS),
            }
            for register in summary.get("registers") or []
        ],
        "materials": [_pick(material, OWNER_MATERIAL_FIELDS) for material in summary.get("materials") or []],
        "expenses": [_pick(expense, OWNER_EXPENSE_FIELDS) for expense in summary.get("expenses") or []]
        if self_construction
        else [],
    }


def material_stock_state(stock: float, minimum_stock: float) -> str:
    if stock <= 0:
        return "OUT_OF_STOCK"
    if minimum_stock and stock <= minimum_stock:
        return "LOW_STOCK"
    return "IN_STOCK"


def parse_activity_quantity(raw_value: str, label: str) -> float | None:
    """Read an optional BOQ quantity. Blank stays None so the day is simply
    'not measured against a BOQ item' rather than recorded as zero."""
    text_value = (raw_value or "").strip()
    if not text_value:
        return None
    try:
        quantity = float(text_value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} must be a number.")
    if quantity < 0:
        raise HTTPException(status_code=400, detail=f"{label} cannot be negative.")
    return quantity


def boq_activity_progress(database: Session, register: DailyCostRegister) -> dict:
    """Cumulative progress for the BOQ item this day's record belongs to.

    Sums completed quantity across every day recorded against the same BOQ
    reference on the same project, so remaining and percentage always follow the
    stored daily quantities instead of a separately maintained figure.
    """
    planned = money(register.planned_quantity) if register.planned_quantity is not None else None
    reference = (register.boq_reference or "").strip()
    if not reference:
        completed_to_date = money(register.completed_quantity) if register.completed_quantity is not None else 0.0
    else:
        rows = DailyCostRepository(database).list_completed_quantities(register.project_id, reference)
        completed_to_date = sum(money(row[0]) for row in rows)
    remaining = None
    percent = None
    if planned is not None and planned > 0:
        remaining = max(0.0, planned - completed_to_date)
        percent = min(100, int(round((completed_to_date / planned) * 100)))
    return {
        "planned_quantity": planned,
        "completed_today": money(register.completed_quantity) if register.completed_quantity is not None else None,
        "completed_to_date": completed_to_date if planned is not None or reference else None,
        "remaining_quantity": remaining,
        "activity_progress_percent": percent,
        "activity_unit": register.activity_unit,
        "boq_reference": register.boq_reference,
        "activity_category": register.activity_category,
    }


def apply_daily_material_usage(
    database: Session,
    register: DailyCostRegister,
    project: Project,
    contractor_id: uuid.UUID,
    engineer_id: uuid.UUID,
    work_date: date_value,
    raw_payload: str,
) -> None:
    """Upsert one usage row per material per daily record and adjust project stock.

    Saving the same day updates the existing row (never adds), so total usage is
    the sum of each day's recorded usage. Project stock is untouched on the
    supplier side; only CostMaterialInventory.current_stock changes.
    """
    try:
        entries = json.loads(raw_payload) if raw_payload and raw_payload.strip() else []
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Material usage payload must be valid JSON.")
    if not isinstance(entries, list):
        raise HTTPException(status_code=400, detail="Material usage payload must be a list.")
    for entry in entries:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="Material usage items must be objects.")
        material_name = str(entry.get("material_name") or entry.get("material") or "").strip()
        if not material_name:
            continue
        try:
            new_used = float(entry.get("quantity_used") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid quantity for {material_name}.")
        if new_used < 0:
            raise HTTPException(status_code=400, detail=f"Used quantity cannot be negative for {material_name}.")
        unit = str(entry.get("unit") or "").strip()
        product_id = entry.get("product_id") or None
        product_rate = 0
        if product_id:
            product = next(iter(supplier_listings(database, [product_id])), None)
            if not product:
                # Crash fixed: an unknown product used to fail on its foreign key (500).
                raise HTTPException(status_code=400, detail=f"Unknown product for {material_name}.")
            product_id = product.id
            product_rate = money(product.price)
        inventory = DailyCostRepository(database).find_inventory(project.id, material_name)
        if not inventory:
            inventory = CostMaterialInventory(
                project_id=project.id,
                contractor_id=contractor_id,
                material=material_name,
                unit=unit or "nos",
                current_stock=0,
                minimum_stock=0,
                product_id=product_id,
            )
            DailyCostRepository(database).add(inventory)
            DailyCostRepository(database).flush()
        else:
            if unit:
                inventory.unit = unit
            if product_id:
                inventory.product_id = product_id
        usage = DailyCostRepository(database).find_register_material_usage(register.id, material_name)
        old_used = money(usage.quantity_used) if usage else 0
        available = money(inventory.current_stock) + old_used
        if new_used > available:
            raise HTTPException(
                status_code=409, detail=f"Only {available:g} {inventory.unit} {material_name} are currently available."
            )
        rate = product_rate if product_rate else (money(usage.rate) if usage else 0)
        previous_stock = available - old_used
        next_stock = available - new_used
        if usage:
            usage.product_id = product_id or usage.product_id
            usage.project_id = project.id
            usage.engineer_id = engineer_id
            usage.work_date = work_date
            usage.quantity_used = new_used
            usage.opening_stock = available
            usage.closing_stock = next_stock
            usage.rate = rate
            usage.total_cost = new_used * rate
            usage.unit = unit or usage.unit
        else:
            usage = CostMaterialUsage(
                register_id=register.id,
                product_id=product_id,
                project_id=project.id,
                engineer_id=engineer_id,
                material=material_name,
                opening_stock=available,
                quantity_used=new_used,
                unit=unit or inventory.unit,
                rate=rate,
                total_cost=new_used * rate,
                closing_stock=next_stock,
                work_date=work_date,
            )
            DailyCostRepository(database).add(usage)
        inventory.current_stock = next_stock
        inventory.updated_at = naive_utc_now()
        previous_state = material_stock_state(previous_stock, money(inventory.minimum_stock))
        next_state = material_stock_state(next_stock, money(inventory.minimum_stock))
        if next_state != previous_state and next_state in {"LOW_STOCK", "OUT_OF_STOCK"}:
            message = f"{material_name} now has only {next_stock:g} {inventory.unit} remaining in {project.title}."
            create_notification(
                database,
                contractor_id,
                "Out of stock" if next_state == "OUT_OF_STOCK" else "Low stock",
                message,
                category="MATERIAL",
            )
            create_notification(
                database,
                engineer_id,
                "Out of stock" if next_state == "OUT_OF_STOCK" else "Low stock",
                message,
                category="MATERIAL",
            )


class DailyCostService:
    def __init__(self, repository: DailyCostRepository):
        self.repository = repository
        self.database = repository.database

    def fetch_cost_tool_summary(self, project_id: uuid.UUID, work_date: str | None, user: User):
        # Builder and assigned Site Engineer only: the summary is builder financial data.
        project = ensure_project_cost_read_access(self.database, project_id, user)
        if work_date:
            checked_work_date(work_date)
        require_builder_feature(self.database, user, BUILDER_BILLING)  # builder only; the engineer is never gated
        return cost_summary_payload(self.database, project, work_date)

    def fetch_owner_project_analysis(self, project_id: uuid.UUID, user: User):
        # The project's own House Owner only, and only the owner-safe subset.
        project = ensure_project_owner_analysis_access(self.database, project_id, user)
        # The same rule as the owner's calendar and photos: paused while the
        # project's builder has lost the feature (BUILDER_ACCESS_PAUSED).
        require_project_feature(self.database, user, project, BUILDER_BILLING)
        return owner_analysis_payload(cost_summary_payload(self.database, project), project)

    def save_daily_cost_register(self, payload: DailyCostRegisterCreate, user: User):
        project = ensure_engineer_project_write_access(self.database, payload.project_id, user)
        ensure_daily_record_open(payload.work_date)
        # The party the day's costs belong to. resolve_project_contractor gives the
        # builder for a builder-managed project and the owner for a self-construction
        # one, which is the rule the daily site record above already follows. Reading
        # projects.contractor_id directly refused every owner-hired site engineer,
        # who by definition works a project that has no builder.
        contractor_id = resolve_project_contractor(self.database, project, user.id)
        if not contractor_id:
            raise HTTPException(status_code=400, detail="Project has no assigned builder")
        register = self.repository.find_user_register(payload.project_id, user.id, payload.work_date)
        if not register:
            register = DailyCostRegister(contractor_id=contractor_id, created_by_id=user.id, **payload.model_dump())
            self.repository.add(register)
        else:
            register.floor = payload.floor
            register.block = payload.block
            register.work_type = payload.work_type
            register.progress_note = payload.progress_note
        self.repository.commit()
        self.repository.refresh(register)
        return {
            "register": cost_entry(register),
            "summary": cost_summary_payload(self.database, project, payload.work_date.isoformat()),
        }

    def save_cost_labour_entry(self, register_id: uuid.UUID, payload: CostLabourEntryCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        attendance_multiplier = {"Present": 1, "Half Day": 0.5, "Overtime": 1, "Absent": 0, "Leave": 0}.get(
            payload.attendance_status, 1
        )
        regular_amount = payload.worker_count * payload.daily_wage * attendance_multiplier
        overtime_amount = payload.worker_count * payload.overtime_hours * payload.overtime_rate
        total_amount = regular_amount + overtime_amount
        worker = get_or_create_worker(
            self.database, register.contractor_id, payload.worker_name, payload.labour_category
        )
        entry = CostLabourEntry(
            register_id=register_id,
            worker_id=worker.id if worker else None,
            **payload.model_dump(),
            regular_amount=regular_amount,
            overtime_amount=overtime_amount,
            total_amount=total_amount,
            payable_amount=total_amount - payload.advance_paid,
        )
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_cost_material_usage(self, register_id: uuid.UUID, payload: CostMaterialUsageCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        inventory = get_or_create_inventory(
            self.database,
            register.project_id,
            register.contractor_id,
            payload.material,
            payload.unit,
            payload.minimum_stock,
        )
        if inventory.current_stock == 0 and payload.opening_stock > 0:
            inventory.current_stock = payload.opening_stock
        total_cost = payload.quantity_used * payload.rate
        closing_stock = inventory.current_stock - payload.quantity_used
        inventory.current_stock = closing_stock
        inventory.updated_at = naive_utc_now()
        entry = CostMaterialUsage(
            register_id=register_id,
            material=payload.material,
            opening_stock=payload.opening_stock,
            quantity_used=payload.quantity_used,
            unit=payload.unit,
            rate=payload.rate,
            total_cost=total_cost,
            closing_stock=closing_stock,
        )
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_cost_material_purchase(self, register_id: uuid.UUID, payload: CostMaterialPurchaseCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        supplier = get_or_create_supplier(self.database, register.contractor_id, payload.supplier_name)
        inventory = get_or_create_inventory(
            self.database,
            register.project_id,
            register.contractor_id,
            payload.material,
            payload.unit,
            payload.minimum_stock,
        )
        subtotal = (
            payload.quantity * payload.rate + payload.transport_cost + payload.loading_cost + payload.unloading_cost
        )
        tax_amount = subtotal * payload.gst_percent / 100
        total_amount = subtotal + tax_amount - payload.discount
        inventory.current_stock += payload.quantity
        inventory.updated_at = naive_utc_now()
        entry = CostMaterialPurchase(
            register_id=register_id,
            supplier_id=supplier.id,
            **payload.model_dump(exclude={"minimum_stock"}),
            subtotal=subtotal,
            tax_amount=tax_amount,
            total_amount=total_amount,
        )
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_cost_expense(self, register_id: uuid.UUID, payload: CostExpenseCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        entry = CostExpense(register_id=register_id, **payload.model_dump())
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_cost_machinery_usage(self, register_id: uuid.UUID, payload: CostMachineryUsageCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        total_cost = (
            payload.hours * payload.rate_per_hour
            + payload.operator_charge
            + payload.fuel_cost
            + payload.maintenance_cost
        )
        entry = CostMachineryUsage(register_id=register_id, **payload.model_dump(), total_cost=total_cost)
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_cost_payment(self, register_id: uuid.UUID, payload: CostPaymentCreate, user: User):
        register = get_cost_register(self.database, register_id, user)
        if payload.direction not in ["IN", "OUT"]:
            raise HTTPException(status_code=400, detail="Payment direction must be IN or OUT")
        entry = CostPayment(register_id=register_id, **payload.model_dump())
        self.repository.add(entry)
        self.repository.commit()
        self.repository.refresh(entry)
        return {
            "entry": cost_entry(entry),
            "summary": cost_summary_payload(self.database, register.project, register.work_date.isoformat()),
        }

    def save_material_log(self, payload: MaterialCreate, user: User):
        # The builder the project is awarded to, checked before anything is written
        # or anyone is notified -- not merely any builder naming a project id.
        project = ensure_contractor_project_access(self.database, payload.project_id, user)
        require_builder_feature(self.database, user, BUILDER_BILLING)
        log = MaterialLog(**payload.model_dump())
        self.repository.add(log)
        create_notification(
            self.database,
            project.owner_id,
            "Material log updated",
            f"{user.name} added material entry: {payload.material_name}.",
            category="PROJECT",
        )
        self.repository.commit()
        self.repository.refresh(log)
        return log

    def save_labour_log(self, payload: LabourCreate, user: User):
        # As above: only the awarded builder may record labour on this project.
        project = ensure_contractor_project_access(self.database, payload.project_id, user)
        require_builder_feature(self.database, user, BUILDER_BILLING)
        log = LabourLog(**payload.model_dump())
        self.repository.add(log)
        create_notification(
            self.database,
            project.owner_id,
            "Labour log updated",
            f"{user.name} added labour details for the project.",
            category="PROJECT",
        )
        self.repository.commit()
        self.repository.refresh(log)
        return log

    def save_daily_workflow(
        self,
        project_id: uuid.UUID,
        work_date: str,
        work_title: str,
        activity_category: str,
        boq_reference: str,
        activity_unit: str,
        planned_quantity: str,
        completed_quantity: str,
        detailed_remarks: str,
        labour_worker_count: int,
        labour_cost: float,
        material_cost: float,
        equipment_cost: float,
        total_expenses: float,
        material_used: str,
        material_usage: str,
        equipment_used: str,
        inspection_remarks: str,
        action: str,
        images: list[UploadFile],
        videos: list[UploadFile],
        user: User,
        uploads: UploadService,
    ):
        project = ensure_engineer_project_write_access(self.database, project_id, user)
        contractor_id = resolve_project_contractor(self.database, project, user.id)
        if not contractor_id:
            raise HTTPException(
                status_code=400, detail="This project assignment is not linked to an active builder team."
            )
        selected_date = checked_work_date(work_date)
        ensure_daily_record_open(selected_date)
        normalized_status = action.strip().upper()
        if normalized_status not in {"IN_PROGRESS", "CLOSED"}:
            raise HTTPException(status_code=400, detail="Invalid daily workflow action")
        if not work_title.strip():
            raise HTTPException(status_code=400, detail="Work Description / Title is required")
        # Every photo and video is checked (type, size) before anything is
        # written, so a bad file can no longer leave the day half-saved.
        for files, category in ((images or [], SITE_IMAGE), (videos or [], SITE_VIDEO)):
            for upload in files:
                if upload and upload.filename:
                    content = upload.file.read()
                    uploads.validate_upload(content, upload.content_type or "application/octet-stream", category)
                    upload.file.seek(0)
        register = self.repository.find_user_register(project_id, user.id, selected_date)
        if register and register.status in {"COMPLETED", "CLOSED"}:
            raise HTTPException(status_code=409, detail="This day is completed and cannot be edited")
        if not register:
            register = DailyCostRegister(
                project_id=project_id,
                contractor_id=contractor_id,
                created_by_id=user.id,
                work_date=selected_date,
                floor="Site",
                block="Main",
                work_type=work_title,
            )
            self.repository.add(register)
            self.repository.flush()
        else:
            register.contractor_id = contractor_id
        register.work_type = work_title.strip()
        # BOQ linkage. Blank means "not recorded against a BOQ item", which is how
        # every day saved before these fields existed reads back.
        register.activity_category = activity_category.strip() or None
        register.boq_reference = boq_reference.strip() or None
        register.activity_unit = activity_unit.strip() or None
        register.planned_quantity = parse_activity_quantity(planned_quantity, "Planned quantity")
        register.completed_quantity = parse_activity_quantity(completed_quantity, "Completed quantity")
        register.progress_note = detailed_remarks.strip() or None
        register.labour_worker_count = max(0, labour_worker_count)
        register.labour_cost = max(0, labour_cost)
        register.material_cost = max(0, material_cost)
        register.equipment_cost = max(0, equipment_cost)
        register.total_expenses = max(0, total_expenses)
        register.material_used = material_used.strip() or None
        register.equipment_used = equipment_used.strip() or None
        register.inspection_remarks = inspection_remarks.strip() or None
        register.status = normalized_status
        register.updated_at = naive_utc_now()
        register.closed_at = naive_utc_now() if normalized_status == "CLOSED" else None

        expense = self.repository.find_daily_total_expense(register.id)
        if not expense:
            expense = CostExpense(
                register_id=register.id,
                category="DAILY_WORKFLOW_TOTAL",
                description="Daily total expenses",
                amount=0,
                expense_date=selected_date,
            )
            self.repository.add(expense)
        expense.amount = max(0, total_expenses)
        expense.expense_date = selected_date

        activity_at = datetime.combine(selected_date, time(hour=9))
        timeline = self.repository.find_day_timeline(project_id, user.id, selected_date)
        if not timeline:
            timeline = ProjectTimeline(
                project_id=project_id,
                created_by_id=user.id,
                date=activity_at,
                title=register.work_type,
                description=register.inspection_remarks or register.progress_note or "Daily site update",
                completion_status=normalized_status,
            )
            self.repository.add(timeline)
            self.repository.flush()
        timeline.title = register.work_type
        timeline.description = register.inspection_remarks or register.progress_note or "Daily site update"
        timeline.completion_status = normalized_status
        # Material usage first: it can still refuse (stock), and must do so before
        # any file is stored. Files are then stored WITHOUT their own commits, so
        # the register, timeline, usage and photos commit together below.
        apply_daily_material_usage(
            self.database, register, project, contractor_id, user.id, selected_date, material_usage
        )
        try:
            save_upload_files(
                project_id,
                timeline.id,
                images,
                self.database,
                uploads,
                owner_id=user.id,
                module=user.role.lower(),
                locality=project_locality(project),
                commit=False,
            )
            # Videos attach to the same timeline row as the day's photos, so they carry
            # the same project, calendar date and site engineer.
            save_upload_files(
                project_id,
                timeline.id,
                videos,
                self.database,
                uploads,
                owner_id=user.id,
                module=user.role.lower(),
                locality=project_locality(project),
                category=SITE_VIDEO,
                commit=False,
            )
            create_notification(
                self.database,
                contractor_id,
                "Daily site record updated",
                f"{user.name} saved {project.title} for {selected_date.isoformat()} as {normalized_status.replace('_', ' ').title()}.",
                category="PROJECT",
            )
            self.repository.commit()
        except Exception:
            # Nothing was committed (the request's session rolls back); the
            # objects already stored for this save are removed as well.
            uploads.discard_pending_objects()
            raise
        uploads.pending_objects.clear()
        self.repository.refresh(register)
        day_number = self.repository.count_work_days(project_id, user.id, selected_date)
        return {
            "register": {
                **cost_entry(register),
                "created_by_name": user.name,
                "day_number": day_number,
                "boq_activity": boq_activity_progress(self.database, register),
            },
            "summary": cost_summary_payload(self.database, project, selected_date.isoformat()),
        }
