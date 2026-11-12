"""Who may see whose contact details, and how the other party on a request is shown
(ported from the old message_service.can_view_private_contact and
profile_service.request_counterparty_profile_payload / engineer_summary_payload, same
rules and fields).

Contact (phone, e-mail) is private until an accepted project request links the two
accounts in either direction. Property enquiries will also count once the property
module is ported (they move to property_enquiries).
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


def accepted_request_between(
    database: Session,
    first_user_id: uuid.UUID,
    second_user_id: uuid.UUID,
    request_types: tuple[str, ...] | None = None,
    project_id: uuid.UUID | None = None,
) -> bool:
    """Whether an accepted request links these two accounts, in either direction; with
    `project_id`, only a request on that project counts."""
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
    return database.scalars(statement.limit(1)).first() is not None


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
