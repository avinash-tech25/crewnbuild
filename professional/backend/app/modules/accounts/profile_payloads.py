"""A builder's and a supplier's profile as returned by the business-logo save (ported from
the old profile_service.py). The viewer here is always the account itself, so every
contact field is visible; the other viewers (marketplace, requests) come with those
modules.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.local_time import local_today
from app.modules.accounts.models import BuilderProfile, SupplierProfile
from app.modules.accounts.profile_completion import profile_complete
from app.modules.accounts.profile_lists import document_type_labels, read_completed_project_details, split_profile_list
from app.modules.identity.models import User, UserVerificationReview

VERIFICATION_APPROVED = "APPROVED"


def is_verified(database: Session, user: User) -> bool:
    """Whether the account holds a live verification decision (an expired approval does
    not count)."""
    record = database.scalars(
        select(UserVerificationReview).where(
            UserVerificationReview.user_id == user.id, UserVerificationReview.is_current.is_(True)
        )
    ).first()
    if record is None or record.status != VERIFICATION_APPROVED:
        return False
    return not (record.expires_on and record.expires_on < local_today())


def builder_reviews(database: Session, builder: User, limit: int = 10) -> tuple[int, list[dict[str, Any]]]:
    """The builder's real reviews (project_reviews): the count and the latest few."""
    from sqlalchemy import desc, func, select

    from app.modules.projects.models import Review

    count = database.scalar(select(func.count(Review.id)).where(Review.reviewee_id == builder.id)) or 0
    if not count:
        return 0, []
    rows = database.execute(
        select(Review, User.name)
        .outerjoin(User, User.id == Review.reviewer_id)
        .where(Review.reviewee_id == builder.id)
        .order_by(desc(Review.created_at))
        .limit(limit)
    ).all()
    return count, [
        {
            "rating": review.rating,
            "comment": review.comment,
            "reviewer_name": reviewer_name or "",
            "created_at": review.created_at,
        }
        for review, reviewer_name in rows
    ]


def builder_profile_payload(
    database: Session,
    builder: User,
    profile: BuilderProfile,
    can_view_contact: bool = True,
    can_view_documents: bool | None = None,
) -> dict[str, Any]:
    if can_view_documents is None:
        can_view_documents = can_view_contact
    review_count, reviews = builder_reviews(database, builder)
    return {
        "user_id": builder.id,
        "name": builder.name,
        "email": builder.email if can_view_contact else "",
        "phone": builder.phone if can_view_contact else "",
        "address": builder.address if can_view_contact else "",
        "pincode": builder.pincode,
        "rating": builder.rating,
        "review_count": review_count,
        "reviews": reviews,
        "profile_image_url": builder.profile_image_url,
        "company_name": profile.company_name,
        "company_logo_url": profile.company_logo_url,
        "license_number": profile.license_number if can_view_contact else "",
        "experience_years": profile.experience_years,
        "completed_projects": profile.completed_projects,
        "completed_project_details": read_completed_project_details(profile.completed_project_details),
        "about": profile.about,
        "gstin": profile.gstin if can_view_contact else "",
        "pan": profile.pan if can_view_contact else "",
        "website": profile.website if can_view_contact else "",
        "business_type": profile.business_type,
        "registration_year": profile.registration_year,
        "team_size": profile.team_size,
        "insurance_available": profile.has_insurance,
        "service_locations": split_profile_list(profile.service_locations),
        "services_offered": split_profile_list(profile.services_offered),
        "equipment_owned": split_profile_list(profile.equipment_owned),
        "documents": split_profile_list(profile.documents) if can_view_documents else [],
        "document_types": document_type_labels(profile.documents),
        "can_view_documents": can_view_documents,
        "gallery": split_profile_list(profile.gallery),
        "can_view_contact": can_view_contact,
        "profile_complete": profile_complete(builder),
        "is_verified": is_verified(database, builder),
    }


def supplier_profile_is_complete(profile: SupplierProfile, supplier: User) -> bool:
    return all(
        [
            bool(profile.store_name),
            bool(profile.categories),
            bool(profile.supplier_category),
            bool(profile.about),
            bool(profile.delivery_locations),
            bool(supplier.phone),
            bool(supplier.address),
            bool(supplier.pincode),
        ]
    )


def supplier_profile_payload(
    supplier: User,
    profile: SupplierProfile,
    can_view_contact: bool = True,
    can_view_documents: bool | None = None,
) -> dict[str, Any]:
    if can_view_documents is None:
        can_view_documents = can_view_contact
    return {
        "user_id": supplier.id,
        "name": supplier.name,
        "email": supplier.email if can_view_contact else "",
        "phone": supplier.phone if can_view_contact else "",
        "address": supplier.address,
        "pincode": supplier.pincode,
        "rating": supplier.rating,
        "profile_image_url": supplier.profile_image_url,
        "store_name": profile.store_name,
        "store_logo_url": profile.store_logo_url,
        "categories": split_profile_list(profile.categories),
        "about": profile.about,
        "gstin": profile.gstin if can_view_contact else "",
        "pan": profile.pan if can_view_contact else "",
        "website": profile.website if can_view_contact else "",
        "business_type": profile.business_type,
        "supplier_category": profile.supplier_category,
        "registration_year": profile.registration_year,
        "delivery_locations": split_profile_list(profile.delivery_locations),
        "documents": split_profile_list(profile.documents) if can_view_documents else [],
        "document_types": document_type_labels(profile.documents),
        "can_view_documents": can_view_documents,
        "gallery": split_profile_list(profile.gallery),
        # Discovery (marketplace) fills in the supplier's products; the logo save never
        # passed any.
        "profile_products": [],
        "can_view_contact": can_view_contact,
        "profile_complete": supplier_profile_is_complete(profile, supplier),
    }
