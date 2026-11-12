"""What "profile complete" means for each role, and the progress the dashboards render.

One definition: `profile_complete` (the gate) and `profile_completion` (the meter) are
both derived from completion_fields(), so they can never disagree. Ported from the old
User.profile_completion_fields with the same per-role rules.
"""

from typing import Any

from app.modules.accounts.models import CATEGORY_STORE_MANAGER
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User


def is_store_manager(user: User) -> bool:
    """Role ENGINEER with the Store Manager category, read from the database row."""
    profile = user.engineer_profile
    return user.role == ROLE_ENGINEER and profile is not None and profile.category == CATEGORY_STORE_MANAGER


def completion_fields(user: User) -> list[tuple[str, str, bool]]:
    """(field, label, is_present) for every field this role must supply."""
    fields: list[tuple[str, str, bool]] = [
        ("name", "Name", bool(user.name)),
        ("email", "Email", bool(user.email)),
        ("phone", "Phone number", bool(user.phone)),
        ("address", "Address", bool(user.address)),
        ("pincode", "Pincode", bool(user.pincode)),
    ]
    if user.role == ROLE_BUILDER:
        builder = user.contractor_profile
        fields += [
            ("company_name", "Company name", bool(builder and builder.company_name)),
            ("license_number", "License number", bool(builder and builder.license_number)),
            ("experience_years", "Years of experience", bool(builder and builder.experience_years)),
            ("about", "About the company", bool(builder and builder.about)),
            ("service_locations", "Service locations", bool(builder and builder.service_locations)),
            ("services_offered", "Services offered", bool(builder and builder.services_offered)),
        ]
        return fields
    if user.role == ROLE_SUPPLIER:
        supplier = user.supplier_profile
        fields += [
            ("store_name", "Store name", bool(supplier and supplier.store_name)),
            ("categories", "Product categories", bool(supplier and supplier.categories)),
            ("supplier_category", "Supplier category", bool(supplier and supplier.supplier_category)),
            ("about", "About the store", bool(supplier and supplier.about)),
            ("delivery_locations", "Delivery locations", bool(supplier and supplier.delivery_locations)),
        ]
        return fields
    if user.role == ROLE_OWNER:
        return fields
    if user.role == ROLE_ENGINEER:
        engineer = user.engineer_profile
        fields += [("specialization", "Engineer Category", bool(engineer and engineer.specialization))]
        if is_store_manager(user):
            fields += [
                ("location", "Post office", bool(user.location)),
                ("qualification", "Qualification", bool(engineer and engineer.qualification)),
            ]
        return fields
    # A role this application does not serve is never complete.
    fields.append(("role", "Supported account type", False))
    return fields


def profile_complete(user: User) -> bool:
    return all(is_present for _, _, is_present in completion_fields(user))


def profile_completion(user: User) -> dict[str, Any]:
    fields = completion_fields(user)
    required_count = len(fields)
    completed_count = sum(1 for _, _, is_present in fields if is_present)
    return {
        "percent": round(completed_count * 100 / required_count) if required_count else 100,
        "completed_count": completed_count,
        "required_count": required_count,
        "is_complete": completed_count == required_count,
        "required_fields": [{"field": field, "label": label} for field, label, _ in fields],
        "missing_fields": [{"field": field, "label": label} for field, label, present in fields if not present],
    }
