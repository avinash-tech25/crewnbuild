"""Suppliers on a builder's projects, and a supplier's own projects (ported from the old
project_supplier_service.py, same rules and answers).
"""

import uuid

from fastapi import HTTPException

from app.database.types import naive_utc_now
from app.modules.accounts.profile_lists import split_profile_list
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.labour_supply.links import active_labor_trades_by_supplier
from app.modules.marketplace.project_links import published_products_by_supplier
from app.modules.messaging.live_events import queue_live_hint
from app.modules.projects.access import (
    engineer_has_project_access,
    ensure_contractor_project_access,
    ensure_role,
    project_progress_fields,
)
from app.modules.projects.models import ProjectSupplier
from app.modules.projects.notices import create_request_notification
from app.modules.projects.schemas import SupplierAssignRequest
from app.modules.projects.supplier_repository import ProjectSupplierRepository

LABOR_SUPPLIER_CATEGORY = "Labor Supplier"


class ProjectSupplierService:
    def __init__(self, repository: ProjectSupplierRepository):
        self.repository = repository
        # Still handed to other domains' helpers that take a session.
        self.database = repository.database

    def offered_categories(self, supplier: User, profile) -> list[str]:
        """What the Builder sees a supplier offering. For a Labor Supplier that is the
        trades it actually has active in labor_services -- the free-text profile list
        can name trades (or spellings) it does not provide. Others keep the profile list."""
        if not profile:
            return []
        if (profile.supplier_category or "").strip() == LABOR_SUPPLIER_CATEGORY:
            return active_labor_trades_by_supplier(self.database, [supplier.id]).get(supplier.id, [])
        return split_profile_list(profile.categories)

    def fetch_contractor_accepted_suppliers(self, user: User):
        ensure_role(user, "CONTRACTOR")
        requests = self.repository.list_accepted_contractor_supplier_requests(user.id)
        # Deduplicate by supplier (one accepted request per supplier)
        seen = set()
        suppliers = []
        for req in requests:
            supplier_id = req.sender_id if req.receiver_id == user.id else req.receiver_id
            if supplier_id in seen:
                continue
            seen.add(supplier_id)
            supplier = self.repository.get_user(supplier_id)
            if not supplier:
                continue
            profile = supplier.supplier_profile
            # Get assignments for this supplier
            assignments = self.repository.list_active_contractor_assignments(supplier_id, user.id)
            assigned_projects = []
            for a in assignments:
                project = self.repository.get_project(a.project_id)
                engineer = self.repository.get_user(a.engineer_id)
                if project:
                    assigned_projects.append(
                        {
                            "project_id": project.id,
                            "project_title": project.title,
                            "engineer_id": a.engineer_id,
                            "engineer_name": engineer.name if engineer else "",
                        }
                    )
            suppliers.append(
                {
                    "id": supplier.id,
                    "user_id": supplier.id,
                    "name": supplier.name,
                    "store_name": profile.store_name if profile else "",
                    "address": supplier.address,
                    "pincode": supplier.pincode,
                    "rating": supplier.rating,
                    "profile_image_url": supplier.profile_image_url,
                    "categories": self.offered_categories(supplier, profile),
                    # What kind of supplier this is, straight from the supplier's own
                    # profile. None until that supplier chooses one; never inferred.
                    "supplier_category": profile.supplier_category if profile else None,
                    "request_id": req.id,
                    "request_type": req.request_type,
                    "assigned_projects": assigned_projects,
                }
            )
        return suppliers

    def assign_supplier_to_project(self, project_id: uuid.UUID, payload: SupplierAssignRequest, user: User):
        project = ensure_contractor_project_access(self.database, project_id, user)

        supplier = self.repository.get_user(payload.supplier_id)
        if not supplier or supplier.role != ROLE_SUPPLIER:
            raise HTTPException(status_code=404, detail="Supplier not found")

        engineer = self.repository.get_user(payload.engineer_id)
        if not engineer or engineer.role != ROLE_ENGINEER:
            raise HTTPException(status_code=404, detail="Site engineer not found")

        # Verify the engineer is on the contractor's active team
        team_row = self.repository.find_active_team_engineer(user.id, engineer.id)
        if not team_row:
            raise HTTPException(status_code=400, detail="Only your active Site Engineers can be assigned suppliers.")

        # Verify the engineer is assigned to this project
        pe_row = self.repository.find_active_project_engineer(project.id, engineer.id)
        if not pe_row:
            raise HTTPException(status_code=400, detail="This Site Engineer is not assigned to this project.")

        # Verify an accepted Supplier ↔ Contractor relationship exists
        accepted = self.repository.find_accepted_supplier_relationship(supplier.id, user.id)
        if not accepted:
            raise HTTPException(
                status_code=400, detail="You must have an accepted relationship with this Supplier before assigning."
            )

        # Check for existing assignment
        existing = self.repository.find_assignment(project.id, supplier.id, engineer.id)
        if existing:
            if existing.status == "ACTIVE":
                raise HTTPException(
                    status_code=409, detail="This Supplier is already assigned to this Site Engineer on this project."
                )
            existing.status = "ACTIVE"
            existing.updated_at = naive_utc_now()
        else:
            assignment = ProjectSupplier(
                project_id=project.id,
                supplier_id=supplier.id,
                engineer_id=engineer.id,
                contractor_id=user.id,
                status="ACTIVE",
            )
            self.repository.add(assignment)

        supplier_name = supplier.supplier_profile.store_name if supplier.supplier_profile else supplier.name
        create_request_notification(
            self.database,
            engineer.id,
            "Supplier assigned",
            f"{user.name} assigned {supplier_name} to project {project.title}.",
            category="ASSIGNMENT",
        )
        create_request_notification(
            self.database,
            supplier.id,
            "Assigned to project",
            f"{user.name} assigned you to project {project.title}.",
            category="ASSIGNMENT",
        )
        self.repository.commit()
        return {"status": "assigned", "project_id": project.id, "supplier_id": supplier.id, "engineer_id": engineer.id}

    def unassign_supplier_from_project(self, project_id: uuid.UUID, payload: SupplierAssignRequest, user: User):
        project = ensure_contractor_project_access(self.database, project_id, user)

        assignment = self.repository.find_active_assignment(project.id, payload.supplier_id, payload.engineer_id)
        if not assignment:
            raise HTTPException(
                status_code=400, detail="This Supplier is not assigned to this Site Engineer on this project."
            )

        assignment.status = "REMOVED"
        assignment.updated_at = naive_utc_now()

        supplier = self.repository.get_user(payload.supplier_id)
        supplier_name = (
            supplier.supplier_profile.store_name
            if supplier and supplier.supplier_profile
            else (supplier.name if supplier else "Supplier")
        )
        create_request_notification(
            self.database,
            payload.engineer_id,
            "Supplier unassigned",
            f"{supplier_name} was unassigned from project {project.title} by {user.name}.",
            category="ASSIGNMENT",
        )
        # No notice for the supplier, only a reload of their open My Projects.
        queue_live_hint(self.database, payload.supplier_id)
        self.repository.commit()
        return {
            "status": "unassigned",
            "project_id": project.id,
            "supplier_id": payload.supplier_id,
            "engineer_id": payload.engineer_id,
        }

    def fetch_project_suppliers(self, project_id: uuid.UUID, user: User):
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        # Only builder, assigned engineer, or project owner can see assigned suppliers
        if user.role == ROLE_BUILDER:
            ensure_contractor_project_access(self.database, project_id, user)
        elif user.role == ROLE_ENGINEER:
            if not engineer_has_project_access(self.database, project_id, user.id):
                raise HTTPException(status_code=403, detail="You do not have access to this project")
        elif user.role == ROLE_OWNER:
            if project.owner_id != user.id:
                raise HTTPException(status_code=403, detail="You do not have access to this project")
        else:
            raise HTTPException(status_code=403, detail="Access denied")

        # If engineer, only show suppliers assigned to them on this project
        assignments = self.repository.list_active_project_assignments(project.id, user.role == ROLE_ENGINEER, user.id)
        if not assignments:
            return []

        # Collect assigned supplier ids and fetch their published products in one batch.
        assigned_supplier_ids = list({row.supplier_id for row in assignments})
        products_by_supplier = published_products_by_supplier(self.database, assigned_supplier_ids)

        result = []
        for row in assignments:
            supplier = self.repository.get_user(row.supplier_id)
            if not supplier:
                continue
            profile = supplier.supplier_profile
            supplier_products = products_by_supplier.get(supplier.id, [])
            result.append(
                {
                    "id": profile.id if profile else row.id,
                    "user_id": supplier.id,
                    "name": supplier.name,
                    "store_name": profile.store_name if profile else "",
                    "store_logo_url": profile.store_logo_url if profile else None,
                    "categories": sorted({p["category"] for p in supplier_products}),
                    "supplier_category": profile.supplier_category if profile else None,
                    "products": supplier_products,
                    "pincode": supplier.pincode,
                    "rating": supplier.rating,
                    "profile_image_url": supplier.profile_image_url,
                    "address": supplier.address,
                    "assignment_id": row.id,
                    "engineer_id": row.engineer_id,
                    "assigned_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return result

    def fetch_engineer_team_suppliers(self, project_id: uuid.UUID, user: User):
        """Every Supplier the project's Builder has an accepted relationship with,
        for a Site Engineer on that project (the Material Suppliers screen).

        The source of truth is the accepted Builder <-> Supplier request, the
        same one the Builder's own "My Suppliers" list reads, so a Supplier the
        Builder accepts shows here without being assigned again. Suppliers this
        engineer was explicitly assigned on the project stay listed as before.
        Read only: no assignment or relationship row is created."""
        ensure_role(user, "ENGINEER")
        project = self.repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not engineer_has_project_access(self.database, project_id, user.id):
            raise HTTPException(status_code=403, detail="You do not have access to this project")

        assignments = self.repository.list_active_project_assignments(project.id, True, user.id)
        assignment_by_supplier = {row.supplier_id: row for row in assignments}

        # Accepted requests only (never pending or rejected), of this project's
        # own Builder, so another Builder's suppliers never appear.
        supplier_ids = []
        if project.contractor_id:
            for req in self.repository.list_accepted_contractor_supplier_requests(project.contractor_id):
                supplier_id = req.sender_id if req.receiver_id == project.contractor_id else req.receiver_id
                if supplier_id not in supplier_ids:
                    supplier_ids.append(supplier_id)
        for supplier_id in assignment_by_supplier:
            if supplier_id not in supplier_ids:
                supplier_ids.append(supplier_id)
        if not supplier_ids:
            return []

        products_by_supplier = published_products_by_supplier(self.database, supplier_ids)

        result = []
        for supplier_id in supplier_ids:
            supplier = self.repository.get_user(supplier_id)
            if not supplier or supplier.role != ROLE_SUPPLIER:
                continue
            profile = supplier.supplier_profile
            row = assignment_by_supplier.get(supplier_id)
            supplier_products = products_by_supplier.get(supplier.id, [])
            # The same card fields as fetch_project_suppliers; the assignment
            # fields are empty for a Supplier the engineer was not assigned.
            result.append(
                {
                    "id": profile.id if profile else supplier.id,
                    "user_id": supplier.id,
                    "name": supplier.name,
                    "store_name": profile.store_name if profile else "",
                    "store_logo_url": profile.store_logo_url if profile else None,
                    "categories": sorted({p["category"] for p in supplier_products}),
                    "supplier_category": profile.supplier_category if profile else None,
                    "products": supplier_products,
                    "pincode": supplier.pincode,
                    "rating": supplier.rating,
                    "profile_image_url": supplier.profile_image_url,
                    "address": supplier.address,
                    "assignment_id": row.id if row else None,
                    "engineer_id": row.engineer_id if row else None,
                    "assigned_at": row.created_at.isoformat() if row and row.created_at else None,
                }
            )
        return result

    def fetch_supplier_my_projects(self, user: User):
        ensure_role(user, "SUPPLIER")

        assignments = self.repository.list_active_supplier_assignments(user.id)
        requests = self.repository.list_accepted_supplier_project_requests(user.id)

        entries: dict[uuid.UUID, dict] = {}
        for assignment in assignments:
            project = assignment.project
            if not project:
                continue
            contractor = assignment.contractor
            entries[project.id] = {
                "project_id": project.id,
                "title": project.title,
                "address": project.address,
                "pincode": project.pincode,
                "project_country": project.project_country,
                "cover_image_url": project.cover_image_url,
                "status": project.status,
                **project_progress_fields(project),
                "requester": {
                    "id": assignment.contractor_id,
                    "name": contractor.name if contractor else "",
                    "company_name": contractor.contractor_profile.company_name
                    if contractor and contractor.contractor_profile
                    else "",
                    # The requester's own account photo, read from the existing
                    # users column. Nothing is stored or derived; empty when they
                    # have not set one, and the card falls back to their initial.
                    "profile_image_url": contractor.profile_image_url if contractor else "",
                    "role": ROLE_BUILDER,
                },
                "assigned_on": assignment.created_at.isoformat() if assignment.created_at else None,
            }

        for request in requests:
            project = request.project
            if not project:
                continue
            # A Builder assignment already covers this project; the request that
            # preceded it must not surface a second row for the same project.
            if project.id in entries:
                continue
            # The party who is not the supplier: the owner (or builder) whose
            # accepted request binds this supplier to the project.
            counterparty = request.receiver if request.sender_id == user.id else request.sender
            entries[project.id] = {
                "project_id": project.id,
                "title": project.title,
                "address": project.address,
                "pincode": project.pincode,
                "project_country": project.project_country,
                "cover_image_url": project.cover_image_url,
                "status": project.status,
                **project_progress_fields(project),
                "requester": {
                    "id": counterparty.id if counterparty else None,
                    "name": counterparty.name if counterparty else "",
                    "company_name": counterparty.contractor_profile.company_name
                    if counterparty and counterparty.role == ROLE_BUILDER and counterparty.contractor_profile
                    else "",
                    "profile_image_url": counterparty.profile_image_url if counterparty else "",
                    "role": counterparty.role if counterparty else "",
                },
                # The accepted request is the assignment itself for the owner flow,
                # and its timestamp is the only record of when it happened.
                "assigned_on": (request.quotation_created_at or request.created_at).isoformat()
                if (request.quotation_created_at or request.created_at)
                else None,
            }

        return sorted(entries.values(), key=lambda entry: entry["assigned_on"] or "", reverse=True)
