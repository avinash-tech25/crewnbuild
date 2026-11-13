"""The paid builder features: portfolio, CSV exports and audited cost adjustments.

Every entry point runs the existing checks first -- role BUILDER and, for a
project, ensure_contractor_project_access (the awarded builder only) -- and the
plan check (entitlements.require_feature) after them. A plan never opens a
project the builder could not already open.

Cost adjustments never write the engineer's daily_site_records row. They are
separate rows (daily_record_adjustments) holding the original figure, the
builder's figure, the reason, who and when; the existing cost summary and its
calculations are unchanged and keep showing the engineer's figures. Adjusted
totals appear only in these paid views, side by side with the originals.
"""

import csv
import io
import uuid
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.types import naive_utc_now
from app.modules.billing import entitlements
from app.modules.billing import plans as catalogue
from app.modules.billing.models import ADJUSTABLE_FIELDS
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, User
from app.modules.projects.access import engineer_has_project_access, ensure_contractor_project_access
from app.modules.projects.award_service import get_awarded_contract
from app.modules.projects.daily_window import daily_record_is_open
from app.modules.projects.models import Project, ProjectImage
from app.modules.site_operations.models import DailyCostRegister, DailyRecordAdjustment


def money(value: Any) -> float:
    return float(value or 0)


def project_progress_map(database: Session, project_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """The old daily-record progress figure per project (old award_service.project_progress_map):
    for every BOQ item in a project's daily site records, the completed quantity against
    the planned quantity, averaged across the items worked on. Nothing is written."""
    if not project_ids:
        return {}
    rows = (
        database.query(
            DailyCostRegister.project_id,
            DailyCostRegister.boq_reference,
            DailyCostRegister.planned_quantity,
            DailyCostRegister.completed_quantity,
        )
        .filter(
            DailyCostRegister.project_id.in_(project_ids),
            DailyCostRegister.boq_reference.isnot(None),
            DailyCostRegister.planned_quantity.isnot(None),
        )
        .all()
    )
    planned: dict[tuple[uuid.UUID, str], float] = {}
    completed: dict[tuple[uuid.UUID, str], float] = {}
    for project_id, reference, planned_quantity, completed_quantity in rows:
        key = (project_id, str(reference).strip())
        if not key[1]:
            continue
        # One BOQ item carries one planned quantity, repeated on each day it was worked
        # on; the completed quantities are the daily contributions.
        planned[key] = max(planned.get(key, 0.0), money(planned_quantity))
        completed[key] = completed.get(key, 0.0) + money(completed_quantity)
    ratios: dict[uuid.UUID, list[float]] = {}
    for key, planned_quantity in planned.items():
        if planned_quantity <= 0:
            continue
        ratios.setdefault(key[0], []).append(min(1.0, completed.get(key, 0.0) / planned_quantity))
    return {project_id: round(sum(values) / len(values) * 100) for project_id, values in ratios.items() if values}


CLOSED_STATUSES = {"CLOSED", "COMPLETED"}
MAX_ADJUSTED_VALUE = Decimal("9999999999.99")  # Numeric(12, 2)
MIN_REASON, MAX_REASON = 3, 500


def _number(value) -> float:
    return money(value) if value is not None else 0.0


def register_is_locked(register: DailyCostRegister) -> bool:
    """Closed by the engineer, or past the day's cutoff (the engineer can no longer edit it)."""
    return register.status in CLOSED_STATUSES or not daily_record_is_open(register.work_date)


def latest_adjustments(
    database: Session, register_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict[str, DailyRecordAdjustment]]:
    """register id -> field -> its most recent adjustment."""
    if not register_ids:
        return {}
    rows = (
        database.query(DailyRecordAdjustment)
        .filter(DailyRecordAdjustment.register_id.in_(register_ids))
        .order_by(DailyRecordAdjustment.created_at, DailyRecordAdjustment.id)
        .all()
    )
    latest: dict[uuid.UUID, dict[str, DailyRecordAdjustment]] = defaultdict(dict)
    for row in rows:
        latest[row.register_id][row.field_name] = row
    return latest


def _effective(register: DailyCostRegister, adjusted: dict[str, DailyRecordAdjustment], field: str) -> float:
    row = adjusted.get(field)
    return _number(row.adjusted_value) if row is not None else _number(getattr(register, field))


def adjustment_payload(row: DailyRecordAdjustment) -> dict:
    return {
        "id": row.id,
        "register_id": row.register_id,
        "project_id": row.project_id,
        "field_name": row.field_name,
        "original_value": _number(row.original_value),
        "adjusted_value": _number(row.adjusted_value),
        "reason": row.reason,
        "builder_name": row.builder_name,
        "created_at": local_iso(row.created_at),
    }


def csv_safe(value) -> str:
    """A cell a spreadsheet will not run as a formula (CSV injection)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_text(header: list[str], rows: list[list]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_safe(cell) for cell in row])
    return buffer.getvalue()


class PremiumService:
    def __init__(self, database: Session):
        self.database = database

    # --------------------------------------------------------- portfolio

    def _builder_projects(self, user: User) -> list[Project]:
        # The same set the builder's project board shows (project_repository.list_visible_projects).
        return (
            self.database.query(Project)
            .filter(Project.contractor_id == user.id, Project.construction_type != "SELF_CONSTRUCTION")
            .order_by(Project.created_at.desc())
            .all()
        )

    def _project_rows(self, projects: list[Project]) -> list[dict]:
        project_ids = [project.id for project in projects]
        registers = (
            self.database.query(DailyCostRegister).filter(DailyCostRegister.project_id.in_(project_ids)).all()
            if project_ids
            else []
        )
        adjusted = latest_adjustments(self.database, [register.id for register in registers])
        by_project: dict[uuid.UUID, list[DailyCostRegister]] = defaultdict(list)
        for register in registers:
            by_project[register.project_id].append(register)
        photo_counts: dict[uuid.UUID, int] = defaultdict(int)
        if project_ids:
            for (project_id,) in (
                self.database.query(ProjectImage.project_id).filter(ProjectImage.project_id.in_(project_ids)).all()
            ):
                photo_counts[project_id] += 1
        progress = project_progress_map(self.database, project_ids) if project_ids else {}
        owners = (
            {
                row.id: row.name
                for row in self.database.query(User.id, User.name)
                .filter(User.id.in_({p.owner_id for p in projects if p.owner_id}))
                .all()
            }
            if projects
            else {}
        )

        rows = []
        for project in projects:
            project_registers = by_project.get(project.id, [])
            original = dict.fromkeys(ADJUSTABLE_FIELDS, 0.0)
            effective = dict.fromkeys(ADJUSTABLE_FIELDS, 0.0)
            adjusted_days = 0
            for register in project_registers:
                register_adjustments = adjusted.get(register.id, {})
                if register_adjustments:
                    adjusted_days += 1
                for field in ADJUSTABLE_FIELDS:
                    original[field] += _number(getattr(register, field))
                    effective[field] += _effective(register, register_adjustments, field)
            contract = get_awarded_contract(self.database, project)
            budget = money(contract["contract_amount"] if contract else project.budget)
            work_dates = sorted(register.work_date for register in project_registers if register.work_date)
            rows.append(
                {
                    "project_id": project.id,
                    "title": project.title,
                    "owner_name": owners.get(project.owner_id),
                    "status": project.status,
                    "project_country": project.project_country,
                    "completion_percentage": progress.get(project.id, project.completion_percentage),
                    "contract_or_budget": budget,
                    "recorded_days": len(project_registers),
                    "adjusted_days": adjusted_days,
                    "last_record_date": work_dates[-1].isoformat() if work_dates else None,
                    "photo_count": photo_counts.get(project.id, 0),
                    "original_totals": original,
                    "adjusted_totals": effective,
                    "original_spent": sum(original.values()),
                    "adjusted_spent": sum(effective.values()),
                }
            )
        return rows

    def portfolio(self, user: User) -> dict:
        entitlements.require_builder(user)
        state = entitlements.require_feature(self.database, user, catalogue.PORTFOLIO_DASHBOARD)
        rows = self._project_rows(self._builder_projects(user))
        advanced = catalogue.ADVANCED_COST_SUMMARY in state.features
        summary = {
            "project_count": len(rows),
            "active_projects": sum(1 for row in rows if (row["status"] or "").lower() == "active"),
            "average_completion": round(sum(row["completion_percentage"] or 0 for row in rows) / len(rows))
            if rows
            else 0,
            "recorded_days": sum(row["recorded_days"] for row in rows),
            "photo_count": sum(row["photo_count"] for row in rows),
        }
        if advanced:
            summary["original_totals"] = {
                field: sum(row["original_totals"][field] for row in rows) for field in ADJUSTABLE_FIELDS
            }
            summary["adjusted_totals"] = {
                field: sum(row["adjusted_totals"][field] for row in rows) for field in ADJUSTABLE_FIELDS
            }
            summary["contract_or_budget"] = sum(row["contract_or_budget"] for row in rows)
        else:
            for row in rows:  # Professional: the per-project overview only
                row.pop("original_totals", None)
                row.pop("adjusted_totals", None)
        return {"plan_code": state.plan_code, "advanced": advanced, "summary": summary, "projects": rows}

    # ----------------------------------------------------------- exports

    def project_summary_csv(self, user: User, project_id: uuid.UUID) -> tuple[str, str]:
        entitlements.require_builder(user)
        project = ensure_contractor_project_access(self.database, project_id, user)
        entitlements.require_feature(self.database, user, catalogue.PROJECT_SUMMARY_EXPORT)
        registers = (
            self.database.query(DailyCostRegister)
            .filter(DailyCostRegister.project_id == project.id)
            .order_by(DailyCostRegister.work_date, DailyCostRegister.id)
            .all()
        )
        adjusted = latest_adjustments(self.database, [register.id for register in registers])
        engineers = (
            {
                row.id: row.name
                for row in self.database.query(User.id, User.name)
                .filter(User.id.in_({register.created_by_id for register in registers if register.created_by_id}))
                .all()
            }
            if registers
            else {}
        )
        header = [
            "Work date",
            "Work description",
            "Status",
            "Site engineer",
            "Workers",
            "Labour cost",
            "Material cost",
            "Equipment cost",
            "Other expenses",
            "Day total",
            "Adjusted labour cost",
            "Adjusted material cost",
            "Adjusted equipment cost",
            "Adjusted other expenses",
            "Adjusted day total",
            "Progress note",
        ]
        rows = []
        for register in registers:
            register_adjustments = adjusted.get(register.id, {})
            original = [_number(getattr(register, field)) for field in ADJUSTABLE_FIELDS]
            effective = [_effective(register, register_adjustments, field) for field in ADJUSTABLE_FIELDS]
            rows.append(
                [
                    register.work_date.isoformat() if register.work_date else "",
                    register.work_type,
                    register.status,
                    engineers.get(register.created_by_id, ""),
                    register.labour_worker_count,
                    *original,
                    sum(original),
                    *effective,
                    sum(effective),
                    register.progress_note or "",
                ]
            )
        filename = f"project-{project.id}-summary-{naive_utc_now():%Y%m%d}.csv"
        return filename, csv_text(header, rows)

    def portfolio_csv(self, user: User) -> tuple[str, str]:
        entitlements.require_builder(user)
        entitlements.require_feature(self.database, user, catalogue.CONSOLIDATED_EXPORT)
        rows = self._project_rows(self._builder_projects(user))
        header = [
            "Project ID",
            "Project",
            "House owner",
            "Status",
            "Country",
            "Completion %",
            "Contract / budget",
            "Recorded days",
            "Days with adjustments",
            "Last record date",
            "Photos",
            *[f"{field.replace('_', ' ').title()}" for field in ADJUSTABLE_FIELDS],
            "Total spent",
            *[f"Adjusted {field.replace('_', ' ')}" for field in ADJUSTABLE_FIELDS],
            "Adjusted total spent",
        ]
        body = [
            [
                row["project_id"],
                row["title"],
                row["owner_name"] or "",
                row["status"],
                row["project_country"] or "",
                row["completion_percentage"],
                row["contract_or_budget"],
                row["recorded_days"],
                row["adjusted_days"],
                row["last_record_date"] or "",
                row["photo_count"],
                *[row["original_totals"][field] for field in ADJUSTABLE_FIELDS],
                row["original_spent"],
                *[row["adjusted_totals"][field] for field in ADJUSTABLE_FIELDS],
                row["adjusted_spent"],
            ]
            for row in rows
        ]
        return f"builder-portfolio-{naive_utc_now():%Y%m%d}.csv", csv_text(header, body)

    # ------------------------------------------------------- adjustments

    def _register(self, register_id: uuid.UUID) -> DailyCostRegister:
        register = self.database.get(DailyCostRegister, register_id)
        if register is None:
            raise HTTPException(status_code=404, detail="Daily record not found")
        return register

    def list_adjustments(self, user: User, register_id: uuid.UUID) -> dict:
        """The audit trail of one daily record: its awarded builder (any plan -- history is
        never paywalled) and its actively assigned Site Engineer. Nobody else."""
        register = self._register(register_id)
        if user.role == ROLE_BUILDER:
            ensure_contractor_project_access(self.database, register.project_id, user)
        elif not (
            user.role == ROLE_ENGINEER and engineer_has_project_access(self.database, register.project_id, user.id)
        ):
            raise HTTPException(
                status_code=403, detail="Cost adjustments are available to the project's builder and Site Engineer only"
            )
        rows = (
            self.database.query(DailyRecordAdjustment)
            .filter(DailyRecordAdjustment.register_id == register.id)
            .order_by(DailyRecordAdjustment.created_at.desc(), DailyRecordAdjustment.id.desc())
            .all()
        )
        current = latest_adjustments(self.database, [register.id]).get(register.id, {})
        return {
            "register_id": register.id,
            "locked": register_is_locked(register),
            "fields": {
                field: {
                    "original": _number(getattr(register, field)),
                    "effective": _effective(register, current, field),
                }
                for field in ADJUSTABLE_FIELDS
            },
            "adjustments": [adjustment_payload(row) for row in rows],
        }

    def create_adjustment(
        self, user: User, register_id: uuid.UUID, field_name: str, adjusted_value, reason: str
    ) -> dict:
        entitlements.require_builder(user)
        register = self._register(register_id)
        ensure_contractor_project_access(self.database, register.project_id, user)
        entitlements.require_feature(self.database, user, catalogue.BILL_ADJUSTMENTS)
        if not register_is_locked(register):
            raise HTTPException(
                status_code=409,
                detail="Cost corrections are made on closed days only. Today's record is still open to the Site Engineer.",
            )
        field_name = (field_name or "").strip()
        if field_name not in ADJUSTABLE_FIELDS:
            raise HTTPException(status_code=400, detail="This cost field cannot be adjusted.")
        try:
            value = Decimal(str(adjusted_value)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Enter a valid amount.")
        if value < 0 or value > MAX_ADJUSTED_VALUE:
            raise HTTPException(status_code=400, detail="Enter an amount between 0 and 9,999,999,999.99.")
        reason = (reason or "").strip()
        if not MIN_REASON <= len(reason) <= MAX_REASON:
            raise HTTPException(status_code=400, detail=f"Give a reason of {MIN_REASON} to {MAX_REASON} characters.")
        current = latest_adjustments(self.database, [register.id]).get(register.id, {})
        if Decimal(str(_effective(register, current, field_name))).quantize(Decimal("0.01")) == value:
            raise HTTPException(status_code=400, detail="That is already the recorded amount.")
        self.database.add(
            DailyRecordAdjustment(
                register_id=register.id,
                project_id=register.project_id,
                builder_id=user.id,
                builder_name=user.name,
                field_name=field_name,
                original_value=getattr(register, field_name) or 0,
                adjusted_value=value,
                reason=reason,
            )
        )
        self.database.commit()
        return self.list_adjustments(user, register.id)
