"""Labour supply (ported from the old labor_supply_service.py; same rules and answers).

Flow: the builder assigns a Labour Supplier to a project's Site Engineer
(/projects/{id}/assign-supplier). The engineer requests workers from THAT supplier only;
the supplier accepts (allocating workers within free capacity) or rejects. An accepted
request is the project's labour assignment; the engineer records daily counts against
it and completes it.

Every rule is enforced here:
  * supplier endpoints are for suppliers whose category is exactly "Labor Supplier";
    a supplier only reaches its own services and the requests addressed to it (another
    supplier's service is "Labor service not found", 404; another supplier's request
    "You do not have access to this labor request.", 403, as before);
  * a request needs an ACTIVE assignment of this supplier to this engineer on this
    project, made by the project's own builder;
  * after the builder unassigns the supplier, new requests (and accepting pending ones)
    are refused, while accepted labour stays visible until the engineer completes it;
  * accepting locks the supplier's service row, so two accepts can never allocate more
    than the capacity; a request asking for more workers than are free is refused, and
    an identical pending request is refused as a duplicate.
"""

import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso, local_today
from app.database.types import naive_utc_now
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User
from app.modules.labour_supply.models import (
    LABOR_REQUEST_STATUSES,
    LABOR_SUPPLIER_CATEGORY,
    LABOR_TRADES,
    STATUS_ACCEPTED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_PENDING,
    STATUS_REJECTED,
    LaborDailyRecord,
    LaborRequest,
)
from app.modules.labour_supply.models import LaborService as LaborServiceRow
from app.modules.labour_supply.repository import ASSIGNMENT_ACTIVE, LaborSupplyRepository
from app.modules.labour_supply.schemas import (
    LaborAccept,
    LaborDailyRecordPut,
    LaborDecisionNote,
    LaborRequestCreate,
    LaborRequestUpdate,
    LaborServiceCreate,
    LaborServiceUpdate,
)
from app.modules.marketplace.order_service import supplier_store_name
from app.modules.messaging.live_events import queue_live_hint
from app.modules.projects.access import engineer_has_project_access, ensure_contractor_project_access, ensure_role
from app.modules.projects.models import Project, ProjectSupplier
from app.modules.projects.notices import create_request_notification

ACCESS_DENIED = "You do not have access to this labor request."


def is_labor_supplier(user: User | None) -> bool:
    profile = user.supplier_profile if user else None
    return bool(
        user
        and user.role == ROLE_SUPPLIER
        and profile
        and (profile.supplier_category or "").strip() == LABOR_SUPPLIER_CATEGORY
    )


def ensure_labor_supplier(user: User) -> None:
    ensure_role(user, "SUPPLIER")
    if not is_labor_supplier(user):
        raise HTTPException(status_code=403, detail="Only a Labor Supplier can use labor endpoints.")


def ensure_status(row: LaborRequest, *allowed: str) -> None:
    if row.status not in allowed:
        raise HTTPException(status_code=409, detail=f"This labor request is {row.status.lower()}.")


def wanted_status(status: str | None) -> str | None:
    if not status:
        return None
    wanted = status.strip().upper()
    if wanted not in LABOR_REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(LABOR_REQUEST_STATUSES)}.")
    return wanted


def daily_record_payload(record: LaborDailyRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "labor_request_id": record.labor_request_id,
        "work_date": record.work_date,
        "present_count": record.present_count,
        "absent_count": record.absent_count,
        "half_day_count": record.half_day_count,
        "overtime_workers": record.overtime_workers,
        "overtime_hours": float(record.overtime_hours or 0),
        "activity": record.activity,
        "notes": record.notes,
        "recorded_by_id": record.recorded_by_id,
        "created_at": local_iso(record.created_at),
        "updated_at": local_iso(record.updated_at),
    }


class LaborSupplyService:
    def __init__(self, database: Session) -> None:
        self.database = database
        self.repository = LaborSupplyRepository(database)

    # ---- payloads ----

    def service_payload(self, service: LaborServiceRow) -> dict[str, Any]:
        allocated = self.repository.allocated_workers(service.supplier_id, service.trade)
        return {
            "id": service.id,
            "supplier_id": service.supplier_id,
            "trade": service.trade,
            "skill_level": service.skill_level,
            "worker_capacity": service.worker_capacity,
            "allocated_workers": allocated,
            "available_workers": max(service.worker_capacity - allocated, 0),
            "is_active": service.is_active,
            "notes": service.notes,
            "created_at": local_iso(service.created_at),
            "updated_at": local_iso(service.updated_at),
        }

    def request_payload(self, row: LaborRequest) -> dict[str, Any]:
        project = self.repository.get_project(row.project_id)
        supplier = self.repository.get_user(row.supplier_id)
        engineer = self.repository.get_user(row.engineer_id)
        contractor = self.repository.get_user(row.contractor_id)
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
            "trade": row.trade,
            "workers_required": row.workers_required,
            "workers_allocated": row.workers_allocated,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "work_description": row.work_description,
            "status": row.status,
            "decision_note": row.decision_note,
            "decided_at": local_iso(row.decided_at),
            "completed_at": local_iso(row.completed_at),
            "created_at": local_iso(row.created_at),
            "updated_at": local_iso(row.updated_at),
        }

    def project_title(self, project_id: uuid.UUID) -> str:
        project = self.repository.get_project(project_id)
        return project.title if project else f"project {project_id}"

    # ---- access ----

    def ensure_engineer_on_project(self, project_id: uuid.UUID, user: User) -> Project:
        ensure_role(user, "ENGINEER")
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not engineer_has_project_access(self.database, project_id, user.id):
            raise HTTPException(status_code=403, detail="You are not the Site Engineer of this project.")
        return project

    def active_labor_assignment(
        self, project: Project, supplier_id: uuid.UUID, engineer_id: uuid.UUID
    ) -> ProjectSupplier | None:
        """The ACTIVE assignment of this supplier to this engineer on this project, made
        by the project's own builder."""
        assignment = self.repository.find_active_assignment(project.id, supplier_id, engineer_id)
        if not assignment or project.contractor_id is None or assignment.contractor_id != project.contractor_id:
            return None
        return assignment

    def load_request(self, request_id: uuid.UUID, lock: bool) -> LaborRequest:
        row = self.repository.lock_request(request_id) if lock else self.repository.get(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Labor request not found")
        return row

    def engineer_request(self, request_id: uuid.UUID, user: User, lock: bool = False) -> LaborRequest:
        """A request the current Site Engineer made, on a project they are still on."""
        ensure_role(user, "ENGINEER")
        row = self.load_request(request_id, lock)
        if row.engineer_id != user.id or not engineer_has_project_access(self.database, row.project_id, user.id):
            raise HTTPException(status_code=403, detail=ACCESS_DENIED)
        return row

    def supplier_request(self, request_id: uuid.UUID, user: User, lock: bool = False) -> LaborRequest:
        ensure_labor_supplier(user)
        row = self.load_request(request_id, lock)
        if row.supplier_id != user.id:
            raise HTTPException(status_code=403, detail=ACCESS_DENIED)
        return row

    def readable_request(self, request_id: uuid.UUID, user: User) -> LaborRequest:
        """Read access: the request's engineer, its supplier, or the project's builder."""
        row = self.repository.get(request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Labor request not found")
        if user.role == ROLE_ENGINEER:
            return self.engineer_request(request_id, user)
        if user.role == ROLE_SUPPLIER:
            return self.supplier_request(request_id, user)
        if user.role == ROLE_BUILDER:
            ensure_contractor_project_access(self.database, row.project_id, user)
            return row
        raise HTTPException(status_code=403, detail="Access denied")

    def available_workers(self, service: LaborServiceRow) -> int:
        """Free workers of one supplier's trade: capacity minus ACCEPTED allocations."""
        return max(service.worker_capacity - self.repository.allocated_workers(service.supplier_id, service.trade), 0)

    def ensure_workers_available(self, service: LaborServiceRow, workers: int) -> None:
        available = self.available_workers(service)
        if workers > available:
            raise HTTPException(
                status_code=409, detail=f"Only {available} {service.trade} workers are available right now."
            )

    def owned_service(self, service_id: uuid.UUID, user: User) -> LaborServiceRow:
        ensure_labor_supplier(user)
        service = self.repository.lock_service_by_id(service_id)
        if not service or service.supplier_id != user.id:
            raise HTTPException(status_code=404, detail="Labor service not found")
        return service

    # ---- Labour Supplier: services ----

    def list_labor_trades(self, user: User) -> list[str]:
        return list(LABOR_TRADES)

    def list_labor_services(self, user: User) -> list[dict[str, Any]]:
        ensure_labor_supplier(user)
        return [self.service_payload(row) for row in self.repository.list_supplier_services(user.id)]

    def create_labor_service(self, payload: LaborServiceCreate, user: User) -> dict[str, Any]:
        ensure_labor_supplier(user)
        duplicate = f"You already offer {payload.trade}. Update that service instead."
        if self.repository.find_service_id(user.id, payload.trade):
            raise HTTPException(status_code=409, detail=duplicate)
        service = LaborServiceRow(supplier_id=user.id, **payload.model_dump())
        self.repository.add(service)
        try:
            self.repository.commit()
        except IntegrityError:
            self.repository.rollback()
            raise HTTPException(status_code=409, detail=duplicate) from None
        self.repository.refresh(service)
        return self.service_payload(service)

    def update_labor_service(self, service_id: uuid.UUID, payload: LaborServiceUpdate, user: User) -> dict[str, Any]:
        service = self.owned_service(service_id, user)  # locked: no accept slips in between
        changes = payload.model_dump(exclude_unset=True)
        if "worker_capacity" in changes:
            if changes["worker_capacity"] is None:
                raise HTTPException(status_code=400, detail="worker_capacity cannot be empty.")
            allocated = self.repository.allocated_workers(service.supplier_id, service.trade)
            if changes["worker_capacity"] < allocated:
                raise HTTPException(
                    status_code=409,
                    detail=f"{allocated} {service.trade} workers are deployed on accepted requests; "
                    "capacity cannot go below that.",
                )
        if "is_active" in changes and changes["is_active"] is None:
            raise HTTPException(status_code=400, detail="is_active cannot be empty.")
        for field, value in changes.items():
            setattr(service, field, value)
        service.updated_at = naive_utc_now()
        self.repository.commit()
        self.repository.refresh(service)
        return self.service_payload(service)

    def delete_labor_service(self, service_id: uuid.UUID, user: User) -> dict[str, Any]:
        service = self.owned_service(service_id, user)
        if self.repository.find_open_request_id_for_trade(service.supplier_id, service.trade):
            raise HTTPException(
                status_code=409,
                detail="This trade has pending or accepted labor requests. Deactivate it instead of deleting it.",
            )
        self.repository.remove(service)
        self.repository.commit()
        return {"status": "deleted", "id": service_id}

    # ---- Labour Supplier: requests ----

    def list_supplier_labor_requests(self, status: str | None, user: User) -> list[dict[str, Any]]:
        ensure_labor_supplier(user)
        rows = self.repository.list_supplier_requests(user.id, wanted_status(status))
        return [self.request_payload(row) for row in rows]

    def accept_labor_request(self, request_id: uuid.UUID, payload: LaborAccept, user: User) -> dict[str, Any]:
        row = self.supplier_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        assignment = self.repository.get_assignment(row.supplier_assignment_id)
        if not assignment or assignment.status != ASSIGNMENT_ACTIVE:
            raise HTTPException(
                status_code=409,
                detail="The builder has unassigned you from this project; this request can no longer be accepted.",
            )
        if payload.workers_allocated > row.workers_required:
            raise HTTPException(
                status_code=400, detail=f"You can allocate at most the {row.workers_required} workers requested."
            )
        # Serialises every accept and capacity edit for this supplier and trade.
        service = self.repository.lock_service(row.supplier_id, row.trade)
        if not service or not service.is_active:
            raise HTTPException(
                status_code=409, detail=f"You do not currently offer {row.trade}. Activate that service first."
            )
        available = service.worker_capacity - self.repository.allocated_workers(row.supplier_id, row.trade)
        if payload.workers_allocated > available:
            raise HTTPException(
                status_code=409, detail=f"Only {max(available, 0)} {row.trade} workers are available right now."
            )
        now = naive_utc_now()
        row.status = STATUS_ACCEPTED
        row.workers_allocated = payload.workers_allocated
        row.decision_note = payload.decision_note
        row.decided_at = now
        row.updated_at = now
        create_request_notification(
            self.database,
            row.engineer_id,
            "Labor request accepted",
            f"{supplier_store_name(user)} accepted your {row.trade} request for {self.project_title(row.project_id)} "
            f"and allocated {row.workers_allocated} of {row.workers_required} workers.",
            category="LABOR",
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def reject_labor_request(
        self, request_id: uuid.UUID, payload: LaborDecisionNote | None, user: User
    ) -> dict[str, Any]:
        row = self.supplier_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        now = naive_utc_now()
        row.status = STATUS_REJECTED
        row.decision_note = payload.decision_note if payload else None
        row.decided_at = now
        row.updated_at = now
        create_request_notification(
            self.database,
            row.engineer_id,
            "Labor request rejected",
            f"{supplier_store_name(user)} rejected your {row.trade} request for {self.project_title(row.project_id)}.",
            category="LABOR",
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def supplier_labor_daily_records(self, request_id: uuid.UUID, user: User) -> list[dict[str, Any]]:
        return self.daily_records(self.supplier_request(request_id, user))

    # ---- Site Engineer ----

    def project_labor_supplier_services(
        self, project_id: uuid.UUID, supplier_id: uuid.UUID, user: User
    ) -> list[dict[str, Any]]:
        """The active trades of a Labour Supplier the builder assigned to this engineer."""
        if user.role == ROLE_BUILDER:
            project = ensure_contractor_project_access(self.database, project_id, user)
            assigned = self.repository.find_any_active_assignment_id(project.id, supplier_id)
        else:
            project = self.ensure_engineer_on_project(project_id, user)
            assigned = self.active_labor_assignment(project, supplier_id, user.id)
        supplier = self.repository.get_user(supplier_id)
        if not supplier or supplier.role != ROLE_SUPPLIER:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if not is_labor_supplier(supplier):
            raise HTTPException(status_code=403, detail="This supplier is not a Labor Supplier.")
        if not assigned:
            raise HTTPException(status_code=403, detail="This Labor Supplier is not assigned to you on this project.")
        return [self.service_payload(row) for row in self.repository.list_active_supplier_services(supplier_id)]

    def create_labor_request(self, project_id: uuid.UUID, payload: LaborRequestCreate, user: User) -> dict[str, Any]:
        project = self.ensure_engineer_on_project(project_id, user)
        supplier = self.repository.get_user(payload.supplier_id)
        if not supplier or supplier.role != ROLE_SUPPLIER:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if not is_labor_supplier(supplier):
            raise HTTPException(status_code=403, detail="This supplier is not a Labor Supplier.")
        assignment = self.active_labor_assignment(project, supplier.id, user.id)
        if not assignment:
            raise HTTPException(status_code=403, detail="This Labor Supplier is not assigned to you on this project.")
        if payload.start_date < local_today():
            raise HTTPException(status_code=400, detail="Start date cannot be in the past.")
        if payload.end_date and payload.end_date < payload.start_date:
            raise HTTPException(status_code=400, detail="End date cannot be before the start date.")
        # Locked like an accept, so the availability read and the duplicate check are
        # serialised with any accept, capacity edit or identical submission.
        service = self.repository.lock_service(supplier.id, payload.trade)
        if not service or not service.is_active:
            raise HTTPException(
                status_code=400, detail=f"{supplier_store_name(supplier)} does not offer {payload.trade}."
            )
        self.ensure_workers_available(service, payload.workers_required)
        if self.repository.find_duplicate_pending_request_id(
            project.id, user.id, supplier.id, payload.trade, payload.start_date, payload.end_date
        ):
            raise HTTPException(
                status_code=409,
                detail=f"You already have a pending {payload.trade} request with {supplier_store_name(supplier)} "
                "for these dates.",
            )
        row = LaborRequest(
            project_id=project.id,
            supplier_assignment_id=assignment.id,
            supplier_id=supplier.id,
            engineer_id=user.id,
            contractor_id=assignment.contractor_id,
            trade=payload.trade,
            workers_required=payload.workers_required,
            start_date=payload.start_date,
            end_date=payload.end_date,
            work_description=payload.work_description,
            status=STATUS_PENDING,
        )
        self.repository.add(row)
        create_request_notification(
            self.database,
            supplier.id,
            "New labor request",
            f"{user.name} requested {payload.workers_required} {payload.trade} workers for {project.title} "
            f"from {payload.start_date.isoformat()}.",
            category="LABOR",
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def list_project_labor_requests(
        self, project_id: uuid.UUID, status: str | None, user: User
    ) -> list[dict[str, Any]]:
        """The engineer sees their own requests on the project; its builder sees all."""
        if user.role == ROLE_BUILDER:
            project = ensure_contractor_project_access(self.database, project_id, user)
            engineer_id = None
        else:
            project = self.ensure_engineer_on_project(project_id, user)
            engineer_id = user.id
        rows = self.repository.list_project_requests(project.id, engineer_id, wanted_status(status))
        return [self.request_payload(row) for row in rows]

    def cancel_labor_request(self, request_id: uuid.UUID, user: User) -> dict[str, Any]:
        row = self.engineer_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING)
        row.status = STATUS_CANCELLED
        row.updated_at = naive_utc_now()
        create_request_notification(
            self.database,
            row.supplier_id,
            "Labor request cancelled",
            f"{user.name} cancelled the {row.trade} request for {self.project_title(row.project_id)}.",
            category="LABOR",
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def complete_labor_request(self, request_id: uuid.UUID, user: User) -> dict[str, Any]:
        """Ends the labour assignment and frees its workers back to the supplier."""
        row = self.engineer_request(request_id, user, lock=True)
        ensure_status(row, STATUS_ACCEPTED)
        now = naive_utc_now()
        row.status = STATUS_COMPLETED
        row.completed_at = now
        row.updated_at = now
        create_request_notification(
            self.database,
            row.supplier_id,
            "Labor assignment completed",
            f"{user.name} completed the {row.trade} assignment on {self.project_title(row.project_id)}; "
            f"{row.workers_allocated} workers are released.",
            category="LABOR",
        )
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    def update_labor_request(self, request_id: uuid.UUID, payload: LaborRequestUpdate, user: User) -> dict[str, Any]:
        row = self.engineer_request(request_id, user, lock=True)
        ensure_status(row, STATUS_PENDING, STATUS_ACCEPTED)
        changes = payload.model_dump(exclude_unset=True)
        pending_only = {"workers_required", "start_date"} & changes.keys()
        if pending_only and row.status != STATUS_PENDING:
            raise HTTPException(
                status_code=409,
                detail=f"{', '.join(sorted(pending_only))} can only change while the request is pending.",
            )
        for field in ("workers_required", "start_date"):
            if field in changes and changes[field] is None:
                raise HTTPException(status_code=400, detail=f"{field} cannot be empty.")
        if "start_date" in changes and changes["start_date"] < local_today():
            raise HTTPException(status_code=400, detail="Start date cannot be in the past.")
        start = changes.get("start_date", row.start_date)
        end = changes.get("end_date", row.end_date)
        if end is not None and end < start:
            raise HTTPException(status_code=400, detail="End date cannot be before the start date.")
        if "workers_required" in changes and changes["workers_required"] > row.workers_required:
            # Raising a pending request is held to the same availability rule as creating one.
            service = self.repository.lock_service(row.supplier_id, row.trade)
            if not service or not service.is_active:
                raise HTTPException(
                    status_code=409,
                    detail=f"The supplier no longer offers {row.trade}; the request cannot be increased.",
                )
            self.ensure_workers_available(service, changes["workers_required"])
        if (
            row.status == STATUS_PENDING
            and ({"start_date", "end_date"} & changes.keys())
            and self.repository.find_duplicate_pending_request_id(
                row.project_id, row.engineer_id, row.supplier_id, row.trade, start, end, exclude_id=row.id
            )
        ):
            raise HTTPException(
                status_code=409, detail=f"You already have a pending {row.trade} request for these dates."
            )
        for field, value in changes.items():
            setattr(row, field, value)
        row.updated_at = naive_utc_now()
        queue_live_hint(self.database, row.supplier_id)
        self.repository.commit()
        self.repository.refresh(row)
        return self.request_payload(row)

    # ---- attendance ----

    def daily_records(self, row: LaborRequest) -> list[dict[str, Any]]:
        return [daily_record_payload(record) for record in self.repository.list_daily_records(row.id)]

    def list_labor_daily_records(self, request_id: uuid.UUID, user: User) -> list[dict[str, Any]]:
        return self.daily_records(self.readable_request(request_id, user))

    def put_labor_daily_record(
        self, request_id: uuid.UUID, work_date: date, payload: LaborDailyRecordPut, user: User
    ) -> dict[str, Any]:
        """Create or replace the one record for this assignment and date."""
        row = self.engineer_request(request_id, user, lock=True)
        if row.status != STATUS_ACCEPTED:
            raise HTTPException(
                status_code=409,
                detail="Daily records can only be kept for an accepted, not yet completed labor assignment.",
            )
        if work_date < row.start_date:
            raise HTTPException(status_code=400, detail="This date is before the assignment's start date.")
        if row.end_date and work_date > row.end_date:
            raise HTTPException(status_code=400, detail="This date is after the assignment's end date.")
        if work_date > local_today():
            raise HTTPException(status_code=400, detail="Attendance cannot be recorded for a future date.")
        counted = payload.present_count + payload.absent_count + payload.half_day_count
        if counted > (row.workers_allocated or 0):
            raise HTTPException(
                status_code=400,
                detail=f"Present + absent + half-day ({counted}) cannot exceed the "
                f"{row.workers_allocated} allocated workers.",
            )
        if payload.overtime_workers > payload.present_count + payload.half_day_count:
            raise HTTPException(status_code=400, detail="Overtime workers cannot exceed the workers present.")
        if payload.overtime_workers == 0 and payload.overtime_hours > 0:
            raise HTTPException(status_code=400, detail="Overtime hours need at least one overtime worker.")
        record_id = self.repository.upsert_daily_record(
            row.id, work_date, user.id, payload.model_dump(), naive_utc_now()
        )
        # A hint, not a notification: attendance is saved daily and must not spam.
        queue_live_hint(self.database, row.supplier_id)
        self.repository.commit()
        record = self.repository.get_daily_record_fresh(record_id)
        if record is None:  # pragma: no cover - the row was just written
            raise HTTPException(status_code=404, detail="Labor request not found")
        return daily_record_payload(record)
