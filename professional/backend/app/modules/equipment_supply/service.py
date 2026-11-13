"""Equipment supply (ported from the old equipment_supply_service.py; same rules and
answers).

Flow: the builder assigns an Equipment Supplier to a project's Site Engineer
(/projects/{id}/assign-supplier). The engineer requests a listing from THAT supplier
only, to RENT or BUY; the supplier accepts or rejects. An accepted request is the
project's equipment assignment; the engineer logs daily hours on rentals and the
supplier completes it (rental returned, purchase delivered).

Inventory rules, enforced here under row locks:
  * a rental reserves `quantity` units for [start_date, end_date]; units free for a
    range = quantity_total - the peak number reserved on any one day of it by ACCEPTED
    rentals (an accepted rental stays out until the supplier completes it);
  * a purchase removes units: accepting it reduces quantity_total, and only units no
    current or future rental needs can be sold;
  * every accept and every stock edit first locks the listing row.

A supplier only reaches its own listings ("Equipment item not found", 404) and the
requests addressed to it ("You do not have access to this equipment request.", 403),
as before.
"""

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.equipment_supply.models import (
    EQUIPMENT_REQUEST_STATUSES,
    EQUIPMENT_SUPPLIER_CATEGORY,
    KIND_RENT,
    MODE_BUY,
    MODE_RENT,
    RATE_COLUMNS,
    STATUS_ACCEPTED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_PENDING,
    STATUS_REJECTED,
    EquipmentItem,
    EquipmentRequest,
    EquipmentUsageLog,
)
from app.modules.equipment_supply.repository import ASSIGNMENT_ACTIVE, EquipmentSupplyRepository
from app.modules.equipment_supply.schemas import (
    EquipmentDecisionNote,
    EquipmentItemCreate,
    EquipmentItemUpdate,
    EquipmentRequestCreate,
    EquipmentUsagePut,
    item_pricing_problem,
)
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User
from app.modules.marketplace.order_service import supplier_store_name
from app.modules.messaging.live_events import queue_live_hint
from app.modules.projects.access import engineer_has_project_access, ensure_contractor_project_access, ensure_role
from app.modules.projects.models import Project, ProjectSupplier
from app.modules.projects.notices import create_request_notification

NOTIFICATION_CATEGORY = "EQUIPMENT"
ACCESS_DENIED = "You do not have access to this equipment request."
ITEM_FIELDS = (
    "name", "category", "brand", "model", "specifications", "condition", "mode", "quantity_total",
    "hourly_rate", "daily_rate", "weekly_rate", "monthly_rate", "sale_price", "image_url", "is_active",
)  # fmt: skip


def is_equipment_supplier(user: User | None) -> bool:
    profile = user.supplier_profile if user else None
    return bool(
        user
        and user.role == ROLE_SUPPLIER
        and profile
        and (profile.supplier_category or "").strip() == EQUIPMENT_SUPPLIER_CATEGORY
    )


def ensure_equipment_supplier(user: User) -> None:
    ensure_role(user, "SUPPLIER")
    if not is_equipment_supplier(user):
        raise HTTPException(status_code=403, detail="Only an Equipment Supplier can use equipment endpoints.")


def allows_rent(item: EquipmentItem) -> bool:
    return item.mode != MODE_BUY


def allows_buy(item: EquipmentItem) -> bool:
    return item.mode != MODE_RENT


def peak_reserved(intervals: list[tuple[date, date, int]], start: date, end: date) -> int:
    """Most units reserved on any single day of [start, end] (inclusive)."""
    changes: dict[date, int] = defaultdict(int)
    for begin, finish, quantity in intervals:
        if begin <= end and finish >= start:  # the overlap rule
            changes[max(begin, start)] += quantity
            changes[min(finish, end) + timedelta(days=1)] -= quantity
    peak = running = 0
    for day in sorted(changes):
        running += changes[day]
        peak = max(peak, running)
    return peak


def rental_intervals(rentals: list[EquipmentRequest]) -> list[tuple[date, date, int]]:
    return [(row.start_date, row.end_date, row.quantity) for row in rentals]  # type: ignore[misc]


def money(value: Any) -> float | None:
    return float(value) if value is not None else None


def usage_payload(log: EquipmentUsageLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "equipment_request_id": log.equipment_request_id,
        "usage_date": log.usage_date,
        "hours_used": float(log.hours_used),
        "notes": log.notes,
        "recorded_by_id": log.recorded_by_id,
        "created_at": local_iso(log.created_at),
        "updated_at": local_iso(log.updated_at),
    }


def ensure_status(row: EquipmentRequest, *allowed: str) -> None:
    if row.status not in allowed:
        raise HTTPException(status_code=409, detail=f"This equipment request is {row.status.lower()}.")


def parse_status(status: str | None) -> str | None:
    if not status:
        return None
    wanted = status.strip().upper()
    if wanted not in EQUIPMENT_REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(EQUIPMENT_REQUEST_STATUSES)}.")
    return wanted


def describe(row: EquipmentRequest, item_name: str) -> str:
    if row.request_kind == KIND_RENT:
        return f"rent {row.quantity} x {item_name} ({row.start_date.isoformat()} to {row.end_date.isoformat()})"  # type: ignore[union-attr]
    return f"buy {row.quantity} x {item_name}"


class EquipmentSupplyService:
    def __init__(self, database: Session) -> None:
        self.database = database
        self.repository = EquipmentSupplyRepository(database)

    # ---- availability ----

    def available_to_rent(self, item: EquipmentItem, start: date, end: date) -> int:
        # An accepted rental is out until the supplier completes it, so an overdue one
        # is still out today.
        today = date.today()
        intervals = [
            (first, max(last, today) if first <= today else last, quantity)
            for first, last, quantity in rental_intervals(self.repository.list_accepted_rentals(item.id))
        ]
        return max(item.quantity_total - peak_reserved(intervals, start, end), 0)

    def committed_to_rentals(self, item: EquipmentItem, today: date | None = None) -> int:
        """Units current and future accepted rentals need at their peak."""
        today = today or date.today()
        intervals = [
            (max(row.start_date, today), max(row.end_date, today), row.quantity)  # type: ignore[type-var]
            for row in self.repository.list_accepted_rentals(item.id)
        ]
        if not intervals:
            return 0
        return peak_reserved(intervals, today, max(finish for _, finish, _ in intervals))

    def available_to_buy(self, item: EquipmentItem) -> int:
        return max(item.quantity_total - self.committed_to_rentals(item), 0)

    # ---- payloads ----

    def item_payload(self, item: EquipmentItem, start: date | None = None, end: date | None = None) -> dict[str, Any]:
        today = date.today()
        range_start, range_end = (start, end) if start and end else (today, today)
        return {
            "id": item.id,
            "supplier_id": item.supplier_id,
            "name": item.name,
            "category": item.category,
            "brand": item.brand,
            "model": item.model,
            "specifications": item.specifications,
            "condition": item.condition,
            "mode": item.mode,
            "quantity_total": item.quantity_total,
            "hourly_rate": money(item.hourly_rate),
            "daily_rate": money(item.daily_rate),
            "weekly_rate": money(item.weekly_rate),
            "monthly_rate": money(item.monthly_rate),
            "sale_price": money(item.sale_price),
            "image_url": item.image_url,
            "is_active": item.is_active,
            # Rental availability for the asked range (today when none was given).
            "availability_start": range_start,
            "availability_end": range_end,
            "available_to_rent": self.available_to_rent(item, range_start, range_end) if allows_rent(item) else 0,
            "available_to_buy": self.available_to_buy(item) if allows_buy(item) else 0,
            "created_at": local_iso(item.created_at),
            "updated_at": local_iso(item.updated_at),
        }

    def request_payload(self, row: EquipmentRequest) -> dict[str, Any]:
        project = self.repository.get_project(row.project_id)
        supplier = self.repository.get_user(row.supplier_id)
        engineer = self.repository.get_user(row.engineer_id)
        contractor = self.repository.get_user(row.contractor_id)
        item = self.repository.get_item(row.equipment_item_id)
        assignment = self.repository.get_assignment(row.supplier_assignment_id)
        return {
            "id": row.id,
            "project_id": row.project_id,
            "project_title": project.title if project else None,
            "project_address": project.address if project else None,
            "supplier_assignment_id": row.supplier_assignment_id,
            "supplier_assignment_active": bool(assignment and assignment.status == ASSIGNMENT_ACTIVE),
            "supplier_id": row.supplier_id,
            "supplier_name": supplier_store_name(supplier) if supplier else None,
            "engineer_id": row.engineer_id,
            "engineer_name": engineer.name if engineer else None,
            "contractor_id": row.contractor_id,
            "contractor_name": contractor.name if contractor else None,
            "equipment_item_id": row.equipment_item_id,
            "item_name": item.name if item else None,
            "item_category": item.category if item else None,
            "request_kind": row.request_kind,
            "quantity": row.quantity,
            "rate_unit": row.rate_unit,
            "unit_price": money(row.unit_price),
            "start_date": row.start_date,
            "end_date": row.end_date,
            "notes": row.notes,
            "decision_note": row.decision_note,
            "status": row.status,
            "decided_at": local_iso(row.decided_at),
            "completed_at": local_iso(row.completed_at),
            "created_at": local_iso(row.created_at),
            "updated_at": local_iso(row.updated_at),
        }

    # ---- access ----

    def lock_request(self, request_id: uuid.UUID) -> EquipmentRequest:
        row = self.repository.lock_request(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Equipment request not found")
        return row

    def ensure_engineer_on_project(self, project_id: uuid.UUID, user: User) -> Project:
        ensure_role(user, "ENGINEER")
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not engineer_has_project_access(self.database, project_id, user.id):
            raise HTTPException(status_code=403, detail="You are not the Site Engineer of this project.")
        return project

    def active_equipment_assignment(
        self, project: Project, supplier_id: uuid.UUID, engineer_id: uuid.UUID
    ) -> ProjectSupplier | None:
        """The ACTIVE assignment of this supplier to this engineer on this project, made
        by the project's own builder."""
        assignment = self.repository.find_active_assignment(project.id, supplier_id, engineer_id)
        if not assignment or project.contractor_id is None or assignment.contractor_id != project.contractor_id:
            return None
        return assignment

    def ensure_assigned_equipment_supplier(self, supplier_id: uuid.UUID) -> User:
        supplier = self.repository.get_user(supplier_id)
        if not supplier or supplier.role != ROLE_SUPPLIER:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if not is_equipment_supplier(supplier):
            raise HTTPException(status_code=403, detail="This supplier is not an Equipment Supplier.")
        return supplier

    def engineer_request(self, request_id: uuid.UUID, user: User, lock: bool = False) -> EquipmentRequest:
        ensure_role(user, "ENGINEER")
        row = self.lock_request(request_id) if lock else self.repository.get_request(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Equipment request not found")
        if row.engineer_id != user.id or not engineer_has_project_access(self.database, row.project_id, user.id):
            raise HTTPException(status_code=403, detail=ACCESS_DENIED)
        return row

    def supplier_request(self, request_id: uuid.UUID, user: User, lock: bool = False) -> EquipmentRequest:
        ensure_equipment_supplier(user)
        row = self.lock_request(request_id) if lock else self.repository.get_request(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Equipment request not found")
        if row.supplier_id != user.id:
            raise HTTPException(status_code=403, detail=ACCESS_DENIED)
        return row

    def readable_request(self, request_id: uuid.UUID, user: User) -> EquipmentRequest:
        """Read access: the request's engineer, its supplier, or the project's builder."""
        row = self.repository.get_request(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Equipment request not found")
        if user.role == ROLE_ENGINEER:
            return self.engineer_request(request_id, user)
        if user.role == ROLE_SUPPLIER:
            return self.supplier_request(request_id, user)
        if user.role == ROLE_BUILDER:
            ensure_contractor_project_access(self.database, row.project_id, user)
            return row
        raise HTTPException(status_code=403, detail="Access denied")

    def project_title(self, project_id: uuid.UUID) -> str:
        project = self.repository.get_project(project_id)
        return project.title if project else f"project {project_id}"

    def owned_item(self, item_id: uuid.UUID, user: User) -> EquipmentItem:
        ensure_equipment_supplier(user)
        item = self.repository.lock_item(item_id)
        if not item or item.supplier_id != user.id:
            raise HTTPException(status_code=404, detail="Equipment item not found")
        return item

    # ---- Equipment Supplier: listings ----

    def list_equipment_items(self, user: User) -> list[dict[str, Any]]:
        ensure_equipment_supplier(user)
        return [self.item_payload(row) for row in self.repository.list_supplier_items(user.id)]

    def create_equipment_item(self, payload: EquipmentItemCreate, user: User) -> dict[str, Any]:
        ensure_equipment_supplier(user)
        item = EquipmentItem(supplier_id=user.id, **payload.model_dump())
        self.repository.add(item)
        self.repository.commit()
        self.repository.refresh(item)
        return self.item_payload(item)

    def update_equipment_item(self, item_id: uuid.UUID, payload: EquipmentItemUpdate, user: User) -> dict[str, Any]:
        item = self.owned_item(item_id, user)  # locked: no accept slips in between
        changes = payload.model_dump(exclude_unset=True)
        for field in ("name", "category", "condition", "mode", "quantity_total", "is_active"):
            if field in changes and changes[field] is None:
                raise HTTPException(status_code=400, detail=f"{field} cannot be empty.")
        merged = {field: getattr(item, field) for field in ITEM_FIELDS}
        merged.update(changes)
        problem = item_pricing_problem(merged["mode"], merged)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if "quantity_total" in changes:
            needed = self.committed_to_rentals(item)
            if changes["quantity_total"] < needed:
                raise HTTPException(
                    status_code=409,
                    detail=f"{needed} units are reserved by accepted rentals; the quantity cannot go below that.",
                )
        for field, value in changes.items():
            setattr(item, field, value)
        item.updated_at = naive_utc_now()
        self.repository.commit()
        self.repository.refresh(item)
        return self.item_payload(item)

    def delete_equipment_item(self, item_id: uuid.UUID, user: User) -> dict[str, Any]:
        """Soft delete: deactivated, never removed, so its requests keep their history."""
        item = self.owned_item(item_id, user)
        item.is_active = False
        item.updated_at = naive_utc_now()
        self.repository.commit()
        return {"status": "deactivated", "id": item.id}

    # ---- Equipment Supplier: requests ----

    def list_supplier_equipment_requests(self, status: str | None, user: User) -> list[dict[str, Any]]:
        ensure_equipment_supplier(user)
        rows = self.repository.list_supplier_requests(user.id, parse_status(status))
        return [self.request_payload(row) for row in rows]

    def accept_equipment_request(
        self, request_id: uuid.UUID, payload: EquipmentDecisionNote | None, user: User
    ) -> dict[str, Any]:
        row = self.supplier_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        assignment = self.repository.get_assignment(row.supplier_assignment_id)
        if not assignment or assignment.status != ASSIGNMENT_ACTIVE:
            raise HTTPException(
                status_code=409,
                detail="The builder has unassigned you from this project; this request can no longer be accepted.",
            )
        # Serialises every accept and stock edit on this listing.
        item = self.repository.lock_item(row.equipment_item_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=409, detail="This equipment item is no longer active.")
        if row.request_kind == KIND_RENT:
            if not allows_rent(item):
                raise HTTPException(status_code=409, detail=f"{item.name} is no longer offered for rent.")
            free = self.available_to_rent(item, row.start_date, row.end_date)  # type: ignore[arg-type]
            if row.quantity > free:
                raise HTTPException(
                    status_code=409,
                    detail=f"Only {free} x {item.name} are free for {row.start_date.isoformat()} to "  # type: ignore[union-attr]
                    f"{row.end_date.isoformat()}.",  # type: ignore[union-attr]
                )
        else:
            if not allows_buy(item):
                raise HTTPException(status_code=409, detail=f"{item.name} is no longer offered for sale.")
            free = self.available_to_buy(item)
            if row.quantity > free:
                raise HTTPException(status_code=409, detail=f"Only {free} x {item.name} are available to sell.")
            item.quantity_total -= row.quantity  # the units leave the supplier's stock
            item.updated_at = naive_utc_now()
        now = naive_utc_now()
        row.status = STATUS_ACCEPTED
        row.decision_note = payload.decision_note if payload else None
        row.decided_at = now
        row.updated_at = now
        create_request_notification(
            self.database,
            row.engineer_id,
            "Equipment request accepted",
            f"{supplier_store_name(user)} accepted your request to {describe(row, item.name)} "
            f"for {self.project_title(row.project_id)}.",
            category=NOTIFICATION_CATEGORY,
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def reject_equipment_request(
        self, request_id: uuid.UUID, payload: EquipmentDecisionNote | None, user: User
    ) -> dict[str, Any]:
        row = self.supplier_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        now = naive_utc_now()
        row.status = STATUS_REJECTED
        row.decision_note = payload.decision_note if payload else None
        row.decided_at = now
        row.updated_at = now
        item = self.repository.get_item(row.equipment_item_id)
        create_request_notification(
            self.database,
            row.engineer_id,
            "Equipment request rejected",
            f"{supplier_store_name(user)} rejected your request to {describe(row, item.name if item else 'equipment')} "
            f"for {self.project_title(row.project_id)}.",
            category=NOTIFICATION_CATEGORY,
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def complete_equipment_request(self, request_id: uuid.UUID, user: User) -> dict[str, Any]:
        """RENT: returned, its units free again. BUY: the purchased units are delivered."""
        row = self.supplier_request(request_id, user, lock=True)
        ensure_status(row, STATUS_ACCEPTED)
        if row.request_kind == KIND_RENT:
            self.repository.lock_item(row.equipment_item_id)  # releasing capacity is a stock change too
        now = naive_utc_now()
        row.status = STATUS_COMPLETED
        row.completed_at = now
        row.updated_at = now
        item = self.repository.get_item(row.equipment_item_id)
        item_name = item.name if item else "equipment"
        rented = row.request_kind == KIND_RENT
        create_request_notification(
            self.database,
            row.engineer_id,
            "Equipment returned" if rented else "Equipment delivered",
            f"{supplier_store_name(user)} marked {row.quantity} x {item_name} on {self.project_title(row.project_id)} "
            f"as {'returned' if rented else 'delivered'}.",
            category=NOTIFICATION_CATEGORY,
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    # ---- Site Engineer ----

    def project_equipment_supplier_items(
        self, project_id: uuid.UUID, supplier_id: uuid.UUID, start_date: date | None, end_date: date | None, user: User
    ) -> list[dict[str, Any]]:
        """An assigned Equipment Supplier's active listings, with rental availability for
        [start_date, end_date] (today when not given) and what can be bought."""
        if (start_date is None) != (end_date is None):
            raise HTTPException(status_code=400, detail="Give both start_date and end_date, or neither.")
        if start_date and end_date and end_date < start_date:
            raise HTTPException(status_code=400, detail="end_date cannot be before start_date.")
        if user.role == ROLE_BUILDER:
            project = ensure_contractor_project_access(self.database, project_id, user)
            assigned = self.repository.find_any_active_assignment_id(project.id, supplier_id)
        else:
            project = self.ensure_engineer_on_project(project_id, user)
            assigned = self.active_equipment_assignment(project, supplier_id, user.id)
        self.ensure_assigned_equipment_supplier(supplier_id)
        if not assigned:
            raise HTTPException(
                status_code=403, detail="This Equipment Supplier is not assigned to you on this project."
            )
        rows = self.repository.list_active_supplier_items(supplier_id)
        return [self.item_payload(row, start_date, end_date) for row in rows]

    def create_equipment_request(
        self, project_id: uuid.UUID, payload: EquipmentRequestCreate, user: User
    ) -> dict[str, Any]:
        project = self.ensure_engineer_on_project(project_id, user)
        item = self.repository.get_item(payload.equipment_item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Equipment item not found")
        # The supplier is the listing's owner, never a supplier id from the browser.
        supplier = self.ensure_assigned_equipment_supplier(item.supplier_id)
        assignment = self.active_equipment_assignment(project, supplier.id, user.id)
        if not assignment:
            raise HTTPException(
                status_code=403, detail="This Equipment Supplier is not assigned to you on this project."
            )
        if not item.is_active:
            raise HTTPException(status_code=409, detail=f"{item.name} is no longer offered.")
        if payload.start_date and payload.start_date < date.today():
            raise HTTPException(status_code=400, detail="Start date cannot be in the past.")
        if payload.request_kind == KIND_RENT:
            if not allows_rent(item):
                raise HTTPException(status_code=400, detail=f"{item.name} is not offered for rent.")
            unit_price = getattr(item, RATE_COLUMNS[payload.rate_unit])  # type: ignore[index]
            if unit_price is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"{item.name} has no {payload.rate_unit.lower()}ly rate.",  # type: ignore[union-attr]
                )
            free = self.available_to_rent(item, payload.start_date, payload.end_date)  # type: ignore[arg-type]
            if payload.quantity > free:
                raise HTTPException(status_code=409, detail=f"Only {free} x {item.name} are free for those dates.")
        else:
            if not allows_buy(item):
                raise HTTPException(status_code=400, detail=f"{item.name} is not offered for sale.")
            unit_price = item.sale_price
            free = self.available_to_buy(item)
            if payload.quantity > free:
                raise HTTPException(status_code=409, detail=f"Only {free} x {item.name} are available to buy.")
        row = EquipmentRequest(
            project_id=project.id,
            supplier_assignment_id=assignment.id,
            supplier_id=supplier.id,
            engineer_id=user.id,
            contractor_id=assignment.contractor_id,
            equipment_item_id=item.id,
            request_kind=payload.request_kind,
            quantity=payload.quantity,
            rate_unit=payload.rate_unit if payload.request_kind == KIND_RENT else None,
            unit_price=unit_price,  # snapshot: later price changes do not touch it
            start_date=payload.start_date,
            end_date=payload.end_date,
            notes=payload.notes,
            status=STATUS_PENDING,
        )
        self.repository.add(row)
        self.repository.flush()
        create_request_notification(
            self.database,
            supplier.id,
            "New equipment request",
            f"{user.name} requested to {describe(row, item.name)} for {project.title}.",
            category=NOTIFICATION_CATEGORY,
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def list_project_equipment_requests(
        self, project_id: uuid.UUID, status: str | None, user: User
    ) -> list[dict[str, Any]]:
        """The engineer sees their own requests on the project; its builder sees all."""
        if user.role == ROLE_BUILDER:
            project = ensure_contractor_project_access(self.database, project_id, user)
            engineer_id = None
        else:
            project = self.ensure_engineer_on_project(project_id, user)
            engineer_id = user.id
        rows = self.repository.list_project_requests(project.id, engineer_id, parse_status(status))
        return [self.request_payload(row) for row in rows]

    def cancel_equipment_request(self, request_id: uuid.UUID, user: User) -> dict[str, Any]:
        """Only a PENDING request can be cancelled; an accepted one is completed by the supplier."""
        row = self.engineer_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        row.status = STATUS_CANCELLED
        row.updated_at = naive_utc_now()
        item = self.repository.get_item(row.equipment_item_id)
        create_request_notification(
            self.database,
            row.supplier_id,
            "Equipment request cancelled",
            f"{user.name} cancelled the request to {describe(row, item.name if item else 'equipment')} "
            f"for {self.project_title(row.project_id)}.",
            category=NOTIFICATION_CATEGORY,
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    # ---- usage logs ----

    def list_equipment_usage(self, request_id: uuid.UUID, user: User) -> list[dict[str, Any]]:
        row = self.readable_request(request_id, user)
        return [usage_payload(log) for log in self.repository.list_usage_logs(row.id)]

    def put_equipment_usage(
        self, request_id: uuid.UUID, usage_date: date, payload: EquipmentUsagePut, user: User
    ) -> dict[str, Any]:
        """Create or replace the one usage row for this rental and date."""
        row = self.engineer_request(request_id, user, lock=True)
        if row.request_kind != KIND_RENT:
            raise HTTPException(status_code=400, detail="Usage is recorded for rentals only, not purchases.")
        if row.status != STATUS_ACCEPTED:
            raise HTTPException(
                status_code=409, detail="Usage can only be recorded for an accepted, not yet returned rental."
            )
        if usage_date < row.start_date or usage_date > row.end_date:  # type: ignore[operator]
            raise HTTPException(status_code=400, detail="This date is outside the rental period.")
        if usage_date > date.today():
            raise HTTPException(status_code=400, detail="Usage cannot be recorded for a future date.")
        if payload.hours_used > 24 * row.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"{row.quantity} unit(s) can be used at most {24 * row.quantity} hours in a day.",
            )
        values = {"hours_used": payload.hours_used, "notes": payload.notes}
        log_id = self.repository.upsert_usage_log(row.id, usage_date, user.id, values, naive_utc_now())
        # A hint, not a notification: usage is logged daily and must not spam.
        queue_live_hint(self.database, row.supplier_id)
        self.repository.commit()
        log = self.repository.get_usage_log(log_id)
        if log is None:  # pragma: no cover - the row was just written
            raise HTTPException(status_code=404, detail="Equipment request not found")
        return usage_payload(log)
