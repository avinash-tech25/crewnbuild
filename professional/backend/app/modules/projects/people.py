"""Who may see whose contact details, and how the other party on a request is shown
(ported from the old message_service.can_view_private_contact and
profile_service.request_counterparty_profile_payload / engineer_summary_payload, same
rules and fields).

Contact (phone, e-mail) is private until an accepted project request links the two
accounts in either direction. An accepted property enquiry (property_enquiries) counts
too.
"""

import uuid
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.modules.accounts.models import EngineerProfile
from app.modules.accounts.profile_completion import profile_complete
from app.modules.accounts.profile_lists import read_completed_project_details, split_profile_list
from app.modules.identity.models import ROLE_BUILDER, ROLE_SUPPLIER, User
from app.modules.projects.models import ProjectRequest
from app.modules.projects.request_types import PROPERTY_REQUEST_TYPE


def accepted_request_between(
    database: Session,
    first_user_id: uuid.UUID,
    second_user_id: uuid.UUID,
    request_types: tuple[str, ...] | None = None,
    project_id: uuid.UUID | None = None,
) -> bool:
    """Whether an accepted request links these two accounts, in either direction; with
    `project_id`, only a request on that project counts. Without one, an accepted
    property enquiry counts too, as it did when enquiries were requests rows."""
    statement = select(ProjectRequest.id).where(
        ProjectRequest.status == "accepted",
        or_(
            and_(ProjectRequest.sender_id == first_user_id, ProjectRequest.receiver_id == second_user_id),
            and_(ProjectRequest.sender_id == second_user_id, ProjectRequest.receiver_id == first_user_id),
        ),
    )
    if request_types is not None:
        statement = statement.where(ProjectRequest.request_type.in_(request_types))
    if project_id is not None:
        statement = statement.where(ProjectRequest.project_id == project_id)
    if database.scalars(statement.limit(1)).first() is not None:
        return True
    # An accepted property enquiry (once a requests row without a project) counts too.
    if project_id is None and (request_types is None or PROPERTY_REQUEST_TYPE in request_types):
        from app.modules.property.links import accepted_enquiry_between  # property reads this module

        return accepted_enquiry_between(database, first_user_id, second_user_id)
    return False


def can_view_private_contact(
    database: Session, viewer: User, profile_user: User, project_id: uuid.UUID | None = None
) -> bool:
    if viewer.id == profile_user.id:
        return True
    return accepted_request_between(database, viewer.id, profile_user.id, project_id=project_id)


def request_counterparty_profile_payload(display_user: User, can_view_contact: bool = True) -> dict[str, Any]:
    """The other party on a request; phone and e-mail withheld until it is accepted."""
    contact = {
        "profile_phone": display_user.phone if can_view_contact else "",
        "profile_email": display_user.email if can_view_contact else "",
    }
    if display_user.role == ROLE_BUILDER and display_user.contractor_profile:
        profile = display_user.contractor_profile
        return {
            "profile_user_id": str(display_user.id),
            "profile_role": display_user.role,
            "profile_name": display_user.name,
            "profile_image_url": display_user.profile_image_url,
            "profile_title": profile.company_name,
            "profile_subtitle": "Contractor",
            "profile_about": profile.about,
            "profile_rating": display_user.rating,
            **contact,
            "profile_address": display_user.address,
            "profile_pincode": display_user.pincode,
            "profile_experience_years": profile.experience_years,
            "profile_completed_projects": profile.completed_projects,
            "profile_completed_project_details": read_completed_project_details(profile.completed_project_details),
            "profile_services": split_profile_list(profile.services_offered),
            "profile_locations": split_profile_list(profile.service_locations),
            "profile_documents": split_profile_list(profile.documents),
            "profile_gallery": split_profile_list(profile.gallery),
            "profile_logo_url": profile.company_logo_url,
        }
    if display_user.role == ROLE_SUPPLIER and display_user.supplier_profile:
        supplier = display_user.supplier_profile
        return {
            "profile_user_id": str(display_user.id),
            "profile_role": display_user.role,
            "profile_name": display_user.name,
            "profile_image_url": supplier.store_logo_url or display_user.profile_image_url,
            "profile_title": supplier.store_name,
            "profile_subtitle": "Supplier",
            "profile_about": supplier.about,
            "profile_rating": display_user.rating,
            **contact,
            "profile_address": display_user.address,
            "profile_pincode": display_user.pincode,
            "profile_categories": split_profile_list(supplier.categories),
            "profile_locations": split_profile_list(supplier.delivery_locations),
            "profile_documents": split_profile_list(supplier.documents),
            "profile_gallery": split_profile_list(supplier.gallery),
            "profile_logo_url": supplier.store_logo_url,
        }
    return {
        "profile_user_id": str(display_user.id),
        "profile_role": display_user.role,
        "profile_name": display_user.name,
        "profile_image_url": display_user.profile_image_url,
        "profile_title": display_user.name,
        "profile_subtitle": display_user.role.title(),
        "profile_about": "",
        "profile_rating": display_user.rating,
        **contact,
        "profile_address": display_user.address,
        "profile_pincode": display_user.pincode,
    }


# The supplier categories, as stored on supplier_profiles.supplier_category.
MATERIAL_SUPPLIER = "material supplier"
LABOUR_SUPPLIERS = ("labor supplier", "labour supplier")
EQUIPMENT_SUPPLIER = "equipment supplier"
OFFER_CATEGORY_LIMIT = 3


def supplier_offer_summary(database: Session, supplier_user: User, category: str | None) -> dict[str, Any]:
    """What a supplier offers, from its own public catalogue: a Material Supplier's
    published listing count and up to three catalog categories they fall under, a Labour
    Supplier's active trades, an Equipment Supplier's active equipment types. Nothing
    here is private: every buyer can already browse it."""
    from sqlalchemy import func

    kind = (category or "").strip().casefold()
    if kind == MATERIAL_SUPPLIER:
        from app.modules.catalog.models import CatalogCategory, CatalogProduct, CatalogSubcategory
        from app.modules.marketplace.models import SupplierProduct

        published = and_(SupplierProduct.supplier_id == supplier_user.id, SupplierProduct.is_published.is_(True))
        count = database.scalar(select(func.count(SupplierProduct.id)).where(published)) or 0
        rows = database.execute(
            select(CatalogCategory.name, func.count(SupplierProduct.id))
            .join(CatalogProduct, CatalogProduct.id == SupplierProduct.master_product_id)
            .join(CatalogSubcategory, CatalogSubcategory.id == CatalogProduct.subcategory_id)
            .join(CatalogCategory, CatalogCategory.id == CatalogSubcategory.category_id)
            .where(published)
            .group_by(CatalogCategory.name)
            .order_by(func.count(SupplierProduct.id).desc(), CatalogCategory.name)
            .limit(OFFER_CATEGORY_LIMIT)
        ).all()
        return {"active_listings": int(count), "categories": [name for name, _ in rows]}
    if kind in LABOUR_SUPPLIERS:
        from app.modules.labour_supply.models import LaborService

        trades = database.scalars(
            select(LaborService.trade)
            .where(LaborService.supplier_id == supplier_user.id, LaborService.is_active.is_(True))
            .distinct()
            .order_by(LaborService.trade)
        ).all()
        return {"trades": list(trades)}
    if kind == EQUIPMENT_SUPPLIER:
        from app.modules.equipment_supply.models import EquipmentItem

        types = database.scalars(
            select(EquipmentItem.category)
            .where(EquipmentItem.supplier_id == supplier_user.id, EquipmentItem.is_active.is_(True))
            .distinct()
            .order_by(EquipmentItem.category)
        ).all()
        return {"equipment_types": list(types)}
    return {}


def request_counterparty_public_details(database: Session, display_user: User) -> dict[str, Any]:
    """The other party's public business details for a request's card and View details:
    for a supplier its category, location, verification, how long it has been a member
    and what it offers; for a builder its location, verification and membership. Never a
    phone number, an e-mail address or anything else private: contact stays with
    request_counterparty_profile_payload and its acceptance rule."""
    from app.core.local_time import local_iso
    from app.modules.accounts.profile_payloads import is_verified

    if display_user.role not in (ROLE_SUPPLIER, ROLE_BUILDER):
        return {}
    details: dict[str, Any] = {
        "profile_location": display_user.location or "",
        "profile_verified": is_verified(database, display_user),
        "profile_member_since": local_iso(display_user.created_at),
    }
    if display_user.role == ROLE_SUPPLIER:
        category = display_user.supplier_profile.supplier_category if display_user.supplier_profile else None
        details["profile_supplier_category"] = category or ""
        details["profile_offer"] = supplier_offer_summary(database, display_user, category)
    return details


def engineer_summary_payload(
    engineer_user: User,
    profile: EngineerProfile | None,
    can_view_contact: bool = True,
    project_count: int = 0,
    assigned_projects: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "user_id": engineer_user.id,
        "name": engineer_user.name,
        "email": engineer_user.email if can_view_contact else "",
        "phone": engineer_user.phone if can_view_contact else "",
        "address": engineer_user.address,
        "pincode": engineer_user.pincode,
        "rating": engineer_user.rating,
        "profile_image_url": engineer_user.profile_image_url,
        "qualification": profile.qualification if profile else None,
        "specialization": profile.specialization if profile else None,
        "experience_years": profile.experience_years if profile else 0,
        "license_number": profile.license_number if profile else None,
        "about": profile.about if profile else None,
        "project_count": project_count,
        "assigned_projects": assigned_projects or [],
        "can_view_contact": can_view_contact,
        "profile_complete": bool(profile) and profile_complete(engineer_user),
    }
