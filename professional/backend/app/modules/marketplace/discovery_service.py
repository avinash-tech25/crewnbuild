"""Marketplace discovery: nearby builders, suppliers and Site Engineers, the builder's and
the supplier's find-clients lists, and the public profiles (ported from the old
marketplace_service.py and marketplace_repository.py; same lists, order and answers).

India is searched by pincode, any other country by the project's country. Contact
details, business identifiers and documents follow the contact rule (the account
itself, or an accepted request between the two), documents also the admin rule.
An account deleted by its holder (soft delete) is never listed or shown, as the old
purge removed it.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.local_time import local_iso
from app.modules.accounts.models import BuilderProfile, EngineerProfile, OwnerProfile, SupplierProfile
from app.modules.accounts.profile_completion import profile_complete
from app.modules.accounts.profile_lists import read_completed_project_details, split_profile_list
from app.modules.accounts.profile_payloads import (
    builder_profile_payload,
    is_verified,
    supplier_profile_is_complete,
    supplier_profile_payload,
)
from app.modules.admin.scope import refuse_kuwait
from app.modules.billing import lead_locations
from app.modules.catalog.models import CatalogProduct, CatalogSubcategory
from app.modules.files.file_access import admin_may_view_account_documents, can_view_account_documents
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.marketplace.listings import catalog_entry_payload, catalog_listings, supplier_product_payload
from app.modules.marketplace.models import SupplierProduct
from app.modules.projects.access import engineers_working_on_a_project, ensure_role
from app.modules.projects.models import ContractorEngineer, Project, ProjectRequest, Review
from app.modules.projects.pending_links import pending_active_labour_trades
from app.modules.projects.people import can_view_private_contact, engineer_summary_payload
from app.modules.projects.project_service import fetch_latest_owner_project

LABOR_SUPPLIER_CATEGORY = "Labor Supplier"
SELF_CONSTRUCTION = "SELF_CONSTRUCTION"
OWNER_SUPPLIER_REQUEST_TYPES = ["OWNER_TO_SUPPLIER", "SUPPLIER_TO_OWNER"]
BUILDER_SUPPLIER_REQUEST_TYPES = ["SUPPLIER_TO_CONTRACTOR", "CONTRACTOR_TO_SUPPLIER"]


def live(statement: Any) -> Any:
    """Only accounts not deleted by their holder."""
    return statement.where(User.deleted_at.is_(None))


def by_rating(statement: Any) -> Any:
    return statement.order_by(desc(User.rating), desc(User.created_at))


def _merged(row_lists: Any, key: Any = lambda row: row.created_at) -> list[Any]:
    """One pincode's list as it was; several pincodes' lists without repeats, newest
    first (suppliers by rating, then newest)."""
    lists = list(row_lists)
    if len(lists) == 1:
        return lists[0]
    unique = {row.id: row for rows in lists for row in rows}
    return sorted(unique.values(), key=key, reverse=True)


def resolve_marketplace_pincode(
    database: Session, user: User, pincode: str | None, project_id: uuid.UUID | None = None
) -> tuple[str, Project | None]:
    """The pincode of a nearby lookup and the owner's selected project: the owner's named
    project wins, then the typed pincode, then the owner's latest project, then the
    account's own pincode."""
    selected_project = None
    if project_id and user.role == ROLE_OWNER:
        selected_project = database.scalars(
            select(Project).where(Project.id == project_id, Project.owner_id == user.id)
        ).first()
    matching_pincode = (pincode or "").strip()
    if selected_project:
        matching_pincode = matching_pincode or (selected_project.pincode or "")
    elif not matching_pincode and user.role == ROLE_OWNER:
        selected_project = fetch_latest_owner_project(database, user.id)
        matching_pincode = (selected_project.pincode if selected_project else "") or ""
    matching_pincode = matching_pincode or (user.pincode or "")
    if user.role == ROLE_OWNER and not selected_project:
        selected_project = fetch_latest_owner_project(database, user.id, matching_pincode)
    return matching_pincode, selected_project


def located(statement: Any, country: str | None, matching_pincode: str) -> Any:
    """India by pincode (and the country when one is named); elsewhere by country."""
    if country and country != "India":
        return statement.where(User.country_code == country)
    statement = statement.where(User.pincode == matching_pincode)
    if country:
        statement = statement.where(User.country_code == country)
    return statement


def can_view_builder_documents(
    database: Session, viewer: User, builder: User, project_id: uuid.UUID | None = None
) -> bool:
    """The builder, an accepted request between the two (on that project when given), or
    an administrator under the admin document rule."""
    return can_view_private_contact(database, viewer, builder, project_id) or admin_may_view_account_documents(
        database, viewer, builder
    )


def engineer_profile_payload(engineer: User, profile: EngineerProfile | None, can_view_contact: bool) -> dict[str, Any]:
    return {
        **engineer_summary_payload(engineer, profile, can_view_contact),
        "created_at": engineer.created_at.isoformat() if engineer.created_at else None,
    }


def published_listings_of(database: Session, supplier_ids: list[uuid.UUID]) -> list[SupplierProduct]:
    """The suppliers' published catalog listings, with their catalog rows loaded."""
    if not supplier_ids:
        return []
    statement = (
        catalog_listings(select(SupplierProduct))
        .options(
            selectinload(SupplierProduct.master_product).selectinload(CatalogProduct.brand),
            selectinload(SupplierProduct.master_product).selectinload(CatalogProduct.images),
            selectinload(SupplierProduct.master_product)
            .selectinload(CatalogProduct.subcategory)
            .selectinload(CatalogSubcategory.category),
        )
        .where(SupplierProduct.supplier_id.in_(supplier_ids), SupplierProduct.is_published.is_(True))
        .order_by(SupplierProduct.category, SupplierProduct.name)
    )
    return list(database.scalars(statement).all())


class MarketplaceService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def contact(self, viewer: User, other: User, project_id: uuid.UUID | None = None) -> bool:
        return can_view_private_contact(self.database, viewer, other, project_id)

    # ---- builders ----

    def fetch_nearby_contractors(
        self, pincode: str | None, country: str | None, project_id: uuid.UUID | None, user: User
    ) -> list[dict[str, Any]]:
        refuse_kuwait(country)
        matching_pincode, latest_project = resolve_marketplace_pincode(self.database, user, pincode, project_id)
        statement = located(
            live(select(BuilderProfile, User).join(User, BuilderProfile.user_id == User.id)), country, matching_pincode
        )
        # The owner's own project's builder is left out; other builders stay.
        if user.role == ROLE_OWNER and latest_project and latest_project.contractor_id:
            statement = statement.where(User.id != latest_project.contractor_id)
        builders = self.database.execute(by_rating(statement)).all()
        builder_ids = [builder.id for _, builder in builders]
        review_counts = (
            dict(
                self.database.execute(
                    select(Review.reviewee_id, func.count(Review.id))
                    .where(Review.reviewee_id.in_(builder_ids))
                    .group_by(Review.reviewee_id)
                ).all()
            )
            if builder_ids
            else {}
        )
        return [
            {
                "id": profile.id,
                "user_id": builder.id,
                "name": builder.name,
                "company_name": profile.company_name,
                "company_logo_url": profile.company_logo_url,
                "pincode": builder.pincode,
                "rating": builder.rating,
                "joined_at": builder.created_at.isoformat() if builder.created_at else None,
                "review_count": review_counts.get(builder.id, 0),
                "services_offered": split_profile_list(profile.services_offered),
                "experience_years": profile.experience_years,
                "completed_projects": profile.completed_projects,
                "completed_project_details": read_completed_project_details(profile.completed_project_details),
                "gallery": profile.gallery,
                "profile_image_url": builder.profile_image_url,
                "profile_complete": profile_complete(builder),
                "is_verified": is_verified(self.database, builder),
            }
            for profile, builder in builders
        ]

    def fetch_contractor_profile(
        self, contractor_id: uuid.UUID, user: User, project_id: uuid.UUID | None = None
    ) -> dict[str, Any]:
        builder = self.database.scalars(
            live(select(User).where(User.id == contractor_id, User.role == ROLE_BUILDER))
        ).first()
        if not builder or not builder.contractor_profile:
            raise HTTPException(status_code=404, detail="Builder profile not found")
        # From an owner's project, contact and documents follow that project's request only.
        scoped_project_id = project_id if user.role == ROLE_OWNER else None
        return builder_profile_payload(
            self.database,
            builder,
            builder.contractor_profile,
            self.contact(user, builder, scoped_project_id),
            can_view_documents=can_view_builder_documents(self.database, user, builder, scoped_project_id),
        )

    def fetch_nearby_projects(self, country: str | None, user: User) -> list[dict[str, Any]]:
        """A builder's find-clients: open projects (not awarded, not Self Construction),
        owners without a project, and suppliers, in the builder's locality."""
        refuse_kuwait(country)
        ensure_role(user, "CONTRACTOR")
        use_country = country.strip() if country else None
        country_is_india = (use_country or "India").upper() == "INDIA"
        open_projects = select(Project).where(
            Project.contractor_id.is_(None), Project.construction_type != SELF_CONSTRUCTION
        )
        owners_query = live(
            select(User).join(OwnerProfile, OwnerProfile.user_id == User.id).where(User.role == ROLE_OWNER)
        )
        suppliers_query = live(
            select(User).join(SupplierProfile, SupplierProfile.user_id == User.id).where(User.role == ROLE_SUPPLIER)
        )
        if use_country and not country_is_india:
            owner_ids_with_any_projects = set(
                self.database.scalars(select(Project.owner_id).where(Project.project_country == use_country)).all()
            )
            projects = list(
                self.database.scalars(
                    open_projects.where(Project.project_country == use_country).order_by(desc(Project.created_at))
                ).all()
            )
            owners = list(
                self.database.scalars(
                    owners_query.where(User.country_code == use_country).order_by(desc(User.created_at))
                ).all()
            )
            suppliers = list(
                self.database.scalars(by_rating(suppliers_query.where(User.country_code == use_country))).all()
            )
        else:
            # The account's pincode and each saved service location's, newest first.
            pincodes = lead_locations.lead_pincodes(self.database, user) or [user.pincode]
            owner_ids_with_any_projects = set(
                self.database.scalars(select(Project.owner_id).where(Project.pincode.in_(pincodes))).all()
            )
            projects = _merged(
                list(
                    self.database.scalars(
                        open_projects.where(Project.pincode == pincode).order_by(desc(Project.created_at))
                    ).all()
                )
                for pincode in pincodes
            )
            owners = _merged(
                list(
                    self.database.scalars(
                        owners_query.where(User.pincode == pincode).order_by(desc(User.created_at))
                    ).all()
                )
                for pincode in pincodes
            )
            suppliers = _merged(
                (
                    list(self.database.scalars(by_rating(suppliers_query.where(User.pincode == pincode))).all())
                    for pincode in pincodes
                ),
                key=lambda row: (row.rating or 0, row.created_at),
            )
        owner_ids_with_projects = {project.owner_id for project in projects}

        project_clients = []
        for project in projects:
            owner = project.owner
            visible = bool(owner) and self.contact(user, owner)
            project_clients.append(
                {
                    "id": project.id,
                    "client_type": "PROJECT",
                    "owner_id": project.owner_id,
                    "project_id": project.id,
                    "title": project.title,
                    "owner_name": owner.name if owner else "",
                    "owner_profile_image_url": owner.profile_image_url if owner else "",
                    "email": owner.email if owner and visible else "",
                    "phone": owner.phone if owner and visible else "",
                    "can_view_contact": visible,
                    "project_title": project.title,
                    "project_description": project.description,
                    "address": project.address,
                    "pincode": project.pincode,
                    "budget": float(project.budget or 0),
                    "land_area": project.land_area or 0,
                    "floors": project.floors or 0,
                    "building_type": project.building_type,
                    "construction_type": project.construction_type,
                    "cover_image_url": project.cover_image_url,
                    "created_at": local_iso(project.created_at),
                    "start_date": project.start_date.isoformat() if project.start_date else None,
                    "end_date": project.end_date.isoformat() if project.end_date else None,
                }
            )

        owner_clients = []
        for owner in owners:
            if owner.id in owner_ids_with_projects or owner.id in owner_ids_with_any_projects:
                continue
            profile = owner.owner_profile
            visible = self.contact(user, owner)
            owner_clients.append(
                {
                    "id": f"owner-{owner.id}",
                    "client_type": "OWNER",
                    "owner_id": owner.id,
                    "project_id": None,
                    "title": owner.name,
                    "owner_name": owner.name,
                    "owner_profile_image_url": owner.profile_image_url,
                    "email": owner.email if visible else "",
                    "phone": owner.phone if visible else "",
                    "can_view_contact": visible,
                    "project_title": profile.project_title if profile else "",
                    "project_description": profile.project_description if profile else "",
                    "address": owner.address,
                    "pincode": owner.pincode,
                    "budget": float(profile.budget_amount or 0) if profile else 0,
                    "land_area": (profile.land_area or 0) if profile else 0,
                    "floors": (profile.floors or 0) if profile else 0,
                    "building_type": profile.building_type if profile else "",
                    "construction_type": profile.construction_type if profile else "",
                    "site_status": profile.site_status if profile else "",
                    "start_timeline": profile.start_timeline if profile else "",
                    "design_status": profile.design_status if profile else "",
                    "contact_preference": profile.contact_preference if profile else "",
                    "cover_image_url": owner.profile_image_url,
                    "created_at": local_iso(owner.created_at),
                }
            )

        def is_labour(supplier: User) -> bool:
            profile = supplier.supplier_profile
            return bool(profile and (profile.supplier_category or "").strip() == LABOR_SUPPLIER_CATEGORY)

        labour_trades = pending_active_labour_trades(
            self.database, [supplier.id for supplier in suppliers if is_labour(supplier)]
        )
        supplier_clients = []
        for supplier in suppliers:
            profile = supplier.supplier_profile
            supplier_clients.append(
                {
                    "id": f"supplier-{supplier.id}",
                    "client_type": "SUPPLIER",
                    "owner_id": supplier.id,
                    "project_id": None,
                    "title": profile.store_name if profile else supplier.name,
                    "store_name": profile.store_name if profile else supplier.name,
                    "name": supplier.name,
                    "supplier_category": profile.supplier_category if profile else "",
                    "categories": (
                        ", ".join(labour_trades.get(supplier.id, []))
                        if is_labour(supplier)
                        else profile.categories
                        if profile
                        else ""
                    ),
                    "address": supplier.address,
                    "pincode": supplier.pincode,
                    "rating": supplier.rating,
                    "cover_image_url": (profile.store_logo_url or supplier.profile_image_url)
                    if profile
                    else supplier.profile_image_url,
                    "created_at": local_iso(supplier.created_at),
                }
            )
        return project_clients + owner_clients + supplier_clients

    # ---- suppliers ----

    def fetch_nearby_suppliers(
        self, pincode: str | None, country: str | None, project_id: uuid.UUID | None, user: User
    ) -> list[dict[str, Any]]:
        refuse_kuwait(country)
        matching_pincode, latest_project = resolve_marketplace_pincode(self.database, user, pincode, project_id)
        has_listing = (
            catalog_listings(select(SupplierProduct.id))
            .where(SupplierProduct.supplier_id == User.id, SupplierProduct.is_published.is_(True))
            .exists()
        )
        statement = located(
            live(select(SupplierProfile, User).join(User, SupplierProfile.user_id == User.id).where(has_listing)),
            country,
            matching_pincode,
        )
        # Each supplier's standing on the named project only (never a fallback project's).
        status_project = latest_project
        if project_id is not None and (latest_project is None or latest_project.id != project_id):
            status_project = None
        status_by_supplier: dict[uuid.UUID, str] = {}
        if status_project:
            rank = {"accepted": 3, "pending": 2, "rejected": 1}
            requests = self.database.scalars(
                select(ProjectRequest).where(
                    ProjectRequest.project_id == status_project.id,
                    ProjectRequest.request_type.in_(OWNER_SUPPLIER_REQUEST_TYPES),
                    or_(ProjectRequest.sender_id == user.id, ProjectRequest.receiver_id == user.id),
                )
            ).all()
            for item in requests:
                other_id = item.receiver_id if item.sender_id == user.id else item.sender_id
                current = status_by_supplier.get(other_id)
                if current is None or rank.get(item.status, 0) > rank.get(current, 0):
                    status_by_supplier[other_id] = item.status

        suppliers = self.database.execute(by_rating(statement)).all()
        products_by_supplier: dict[uuid.UUID, list[dict[str, Any]]] = {}
        for product in published_listings_of(self.database, [supplier.id for _, supplier in suppliers]):
            products_by_supplier.setdefault(product.supplier_id, []).append(catalog_entry_payload(product))
        return [
            {
                "id": profile.id,
                "user_id": supplier.id,
                "name": supplier.name,
                "store_name": profile.store_name,
                "store_logo_url": profile.store_logo_url,
                "categories": sorted({product["category"] for product in products_by_supplier.get(supplier.id, [])}),
                "products": products_by_supplier.get(supplier.id, []),
                "pincode": supplier.pincode,
                "rating": supplier.rating,
                "profile_image_url": supplier.profile_image_url,
                "profile_complete": supplier_profile_is_complete(profile, supplier),
                "request_status": status_by_supplier.get(supplier.id, "none"),
            }
            for profile, supplier in suppliers
        ]

    def fetch_supplier_profile(self, supplier_id: uuid.UUID, user: User) -> dict[str, Any]:
        supplier = self.database.scalars(
            live(select(User).where(User.id == supplier_id, User.role == ROLE_SUPPLIER))
        ).first()
        if not supplier or not supplier.supplier_profile:
            raise HTTPException(status_code=404, detail="Supplier profile not found")
        statement = select(SupplierProduct).where(SupplierProduct.supplier_id == supplier.id)
        if user.id != supplier.id:
            statement = catalog_listings(statement).where(SupplierProduct.is_published.is_(True))
        products = self.database.scalars(statement.order_by(desc(SupplierProduct.created_at))).all()
        return {
            **supplier_profile_payload(
                supplier,
                supplier.supplier_profile,
                self.contact(user, supplier),
                can_view_documents=can_view_account_documents(self.database, user, supplier),
            ),
            "profile_products": [supplier_product_payload(product, with_catalog=True) for product in products],
        }

    def fetch_supplier_clients(self, country: str | None, user: User) -> list[dict[str, Any]]:
        """A supplier's find-clients: Self Construction projects and builders nearby,
        without those already connected to."""
        refuse_kuwait(country)
        ensure_role(user, "SUPPLIER")
        use_country = country.strip() if country else None
        country_is_india = (use_country or "India").upper() == "INDIA"
        projects_query = live(
            select(Project, User)
            .join(User, Project.owner_id == User.id)
            .where(Project.construction_type == SELF_CONSTRUCTION)
            .order_by(desc(Project.created_at))
        )
        builders_query = live(select(User).join(BuilderProfile, BuilderProfile.user_id == User.id))
        if use_country and not country_is_india:
            projects_query = projects_query.where(Project.project_country == use_country)
            builders_query = builders_query.where(User.country_code == use_country)
        else:
            projects_query = projects_query.where(Project.pincode == user.pincode)
            builders_query = builders_query.where(User.pincode == user.pincode)

        def accepted_with(request_types: list[str], project_only: bool) -> list[ProjectRequest]:
            statement = select(ProjectRequest).where(
                ProjectRequest.status == "accepted",
                ProjectRequest.request_type.in_(request_types),
                or_(ProjectRequest.sender_id == user.id, ProjectRequest.receiver_id == user.id),
            )
            if project_only:
                statement = statement.where(ProjectRequest.project_id.isnot(None))
            return list(self.database.scalars(statement).all())

        accepted_project_ids = {item.project_id for item in accepted_with(OWNER_SUPPLIER_REQUEST_TYPES, True)}
        owner_projects = [
            (project, owner)
            for project, owner in self.database.execute(projects_query).all()
            if project.id not in accepted_project_ids
        ]
        accepted_builder_ids = {
            item.sender_id if item.sender_id != user.id else item.receiver_id
            for item in accepted_with(BUILDER_SUPPLIER_REQUEST_TYPES, False)
        }
        if accepted_builder_ids:
            builders_query = builders_query.where(User.id.notin_(accepted_builder_ids))
        builders = list(self.database.scalars(by_rating(builders_query)).all())

        owner_clients = [
            {
                "user_id": owner.id,
                "name": owner.name,
                "type": owner.role,
                "pincode": project.pincode,
                "project_id": project.id,
                "project_title": project.title,
                "project_image_url": project.cover_image_url,
                "profile_image_url": owner.profile_image_url,
                "construction_type": project.construction_type,
            }
            for project, owner in owner_projects
        ]
        builder_clients = []
        for item in builders:
            profile = item.contractor_profile
            visible = self.contact(user, item)
            builder_clients.append(
                {
                    "user_id": item.id,
                    "name": item.name,
                    "type": item.role,
                    "pincode": item.pincode,
                    "address": item.address,
                    "email": item.email if visible else "",
                    "phone": item.phone if visible else "",
                    "profile_image_url": item.profile_image_url,
                    "company_name": profile.company_name if profile else item.name,
                    "company_logo_url": profile.company_logo_url if profile else "",
                    "license_number": profile.license_number if profile and visible else "",
                    "gstin": profile.gstin if profile and visible else "",
                    "pan": profile.pan if profile and visible else "",
                    "website": profile.website if profile else "",
                    "business_type": profile.business_type if profile else "",
                    "registration_year": profile.registration_year if profile else None,
                    "team_size": profile.team_size if profile else "",
                    "about": profile.about if profile else "",
                    "insurance_available": profile.has_insurance if profile else False,
                    "experience_years": profile.experience_years if profile else 0,
                    "completed_projects": profile.completed_projects if profile else 0,
                    "completed_project_details": read_completed_project_details(
                        profile.completed_project_details if profile else ""
                    ),
                    "services_offered": split_profile_list(profile.services_offered if profile else ""),
                    "service_locations": split_profile_list(profile.service_locations if profile else ""),
                    "equipment_owned": split_profile_list(profile.equipment_owned if profile else ""),
                    "gallery": split_profile_list(profile.gallery if profile else ""),
                    "documents": split_profile_list(profile.documents if profile else ""),
                    "can_view_contact": visible,
                    "rating": item.rating,
                }
            )
        return owner_clients + builder_clients

    # ---- Site Engineers ----

    def fetch_nearby_engineers(
        self,
        pincode: str | None,
        country: str | None,
        project_id: uuid.UUID | None,
        category: str | None,
        user: User,
    ) -> list[dict[str, Any]]:
        refuse_kuwait(country)
        # A House Owner on a Self Construction project reads the same list a builder does.
        if user.role not in (ROLE_BUILDER, ROLE_OWNER):
            raise HTTPException(status_code=403, detail="CONTRACTOR role required")
        typed_pincode = (pincode or "").strip()
        matching_pincode = typed_pincode or (user.pincode or "")
        matching_country = country
        if project_id:
            project = self.database.get(Project, project_id)
            if project and (project.contractor_id == user.id or project.owner_id == user.id):
                if not typed_pincode:
                    matching_pincode = project.pincode or matching_pincode
                matching_country = project.project_country or matching_country
        memberships = (
            list(
                self.database.scalars(
                    select(ContractorEngineer).where(
                        ContractorEngineer.contractor_id == user.id,
                        ContractorEngineer.status.in_(["PENDING", "ACTIVE"]),
                    )
                ).all()
            )
            if user.role == ROLE_BUILDER
            else []
        )
        connected_engineer_ids = {item.engineer_id for item in memberships if item.status == "ACTIVE"}
        pending_by_engineer = {item.engineer_id: item for item in memberships if item.status == "PENDING"}

        statement = live(
            select(User).join(EngineerProfile, EngineerProfile.user_id == User.id).where(User.role == ROLE_ENGINEER)
        )
        # One category, or several comma-separated ("Site Engineer,Store Manager").
        categories = [value.strip() for value in (category or "").split(",") if value.strip()]
        if categories:
            statement = statement.where(EngineerProfile.specialization.in_(categories))
        statement = located(statement, matching_country, matching_pincode)
        if connected_engineer_ids:
            statement = statement.where(User.id.notin_(connected_engineer_ids))
        engineers = list(self.database.scalars(by_rating(statement)).all())
        results = [
            engineer_summary_payload(engineer, engineer.engineer_profile, self.contact(user, engineer))
            for engineer in engineers
        ]
        if user.role == ROLE_BUILDER:
            for engineer, item in zip(engineers, results, strict=True):
                pending = pending_by_engineer.get(engineer.id)
                item["relationship_id"] = pending.id if pending else None
                item["request_status"] = (
                    ("INCOMING" if pending.request_sender_role == "ENGINEER" else "SENT") if pending else None
                )
        if user.role == ROLE_OWNER:
            working = engineers_working_on_a_project(
                self.database, [engineer.id for engineer in engineers], exclude_project_id=project_id
            )
            for engineer, item in zip(engineers, results, strict=True):
                item["working_on_project"] = engineer.id in working
        return results

    def fetch_engineer_profile(self, engineer_id: uuid.UUID, user: User) -> dict[str, Any]:
        engineer = self.database.scalars(
            live(select(User).where(User.id == engineer_id, User.role == ROLE_ENGINEER))
        ).first()
        if not engineer or not engineer.engineer_profile:
            raise HTTPException(status_code=404, detail="Site engineer profile not found")
        return engineer_profile_payload(engineer, engineer.engineer_profile, self.contact(user, engineer))
