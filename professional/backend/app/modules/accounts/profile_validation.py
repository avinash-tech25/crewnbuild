"""The required-field rules of the complete-profile save (ported from the old
profile_service.profile_field_errors), per role and per country."""

from app.modules.accounts.models import STORE_MANAGER_SPECIALIZATION
from app.modules.accounts.profile_lists import split_profile_list
from app.modules.accounts.schemas import CompleteProfileRequest
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User
from app.modules.identity.phone_verification_service import effective_country

# A supplier's required-field messages, by Supplier Category (lower case). Material
# keeps the wording it always had, and is also used before a category is chosen.
SUPPLIER_FIELD_MESSAGES = {
    "material supplier": {
        "store_name": "Store name is required.",
        "about": "About store is required.",
        "service_locations": "Add at least one delivery location.",
        "categories": "Select at least one product category.",
    },
    "labor supplier": {
        "store_name": "Company or agency name is required.",
        "about": "Tell builders about your labour supply.",
        "service_locations": "Add at least one service location.",
        "categories": "Select at least one trade.",
    },
    "equipment supplier": {
        "store_name": "Business name is required.",
        "about": "Tell builders about your equipment business.",
        "service_locations": "Add at least one service location.",
        "categories": "Select at least one equipment category.",
    },
}


def is_store_manager_category(category: str | None) -> bool:
    return (category or "").strip().casefold() == STORE_MANAGER_SPECIALIZATION.casefold()


def digits_of(value: str | None) -> str:
    return "".join(character for character in (value or "") if character.isdigit())


def profile_field_errors(payload: CompleteProfileRequest, user: User) -> dict[str, str]:
    """{field: message} for every required field missing or malformed. A required value
    that is already saved counts as supplied."""
    errors: dict[str, str] = {}
    role = user.role
    saved_supplier_category = (user.supplier_profile.supplier_category or "").strip() if user.supplier_profile else ""
    saved_specialization = (user.engineer_profile.specialization or "").strip() if user.engineer_profile else ""
    phone_digits = digits_of(payload.phone)
    pincode_digits = digits_of(payload.pincode)
    # The country a save names, else the account's own.
    is_india = effective_country(payload.country_of_residence, user.country_code).upper() == "INDIA"

    if not (payload.phone or "").strip():
        errors["phone"] = "Phone number is required."
    elif is_india and (
        len(phone_digits) != 10 or (role == ROLE_OWNER and any(character.isalpha() for character in payload.phone))
    ):
        errors["phone"] = "Enter a valid 10 digit phone number."
    elif not is_india and (len(phone_digits) < 8 or len(phone_digits) > 15):
        errors["phone"] = "Enter a valid phone number for your country."
    if not (payload.address or "").strip():
        errors["address"] = "Address is required."
    if not (payload.pincode or "").strip():
        errors["pincode"] = "Pincode is required."
    elif is_india and len(pincode_digits) != 6:
        errors["pincode"] = "Enter a valid 6 digit pincode."
    elif not is_india and (len(pincode_digits) < 3 or len(pincode_digits) > 10):
        errors["pincode"] = "Enter a valid postal code for your country."

    if role == ROLE_BUILDER:
        if not (payload.company_name or "").strip():
            errors["company_name"] = "Company name is required."
        if not (payload.license_number or "").strip():
            errors["license_number"] = "License number is required."
        if not payload.experience_years or payload.experience_years < 1:
            errors["experience_years"] = "Experience years must be at least 1."
        if not (payload.about or "").strip():
            errors["about"] = "About company is required."
        if not split_profile_list(payload.service_locations):
            errors["service_locations"] = "Add at least one service location."
        if not split_profile_list(payload.services_offered):
            errors["services_offered"] = "Select at least one service offered."
    elif role == ROLE_SUPPLIER:
        messages = SUPPLIER_FIELD_MESSAGES.get(
            (saved_supplier_category or (payload.supplier_category or "").strip()).casefold(),
            SUPPLIER_FIELD_MESSAGES["material supplier"],
        )
        if not (payload.store_name or "").strip():
            errors["store_name"] = messages["store_name"]
        if not (payload.about or "").strip():
            errors["about"] = messages["about"]
        if not split_profile_list(payload.service_locations):
            errors["service_locations"] = messages["service_locations"]
        if not split_profile_list(payload.categories):
            errors["categories"] = messages["categories"]
        if not ((payload.supplier_category or "").strip() or saved_supplier_category):
            errors["supplier_category"] = "Select a supplier category."
    elif role == ROLE_ENGINEER:
        if not ((payload.specialization or "").strip() or saved_specialization):
            errors["specialization"] = "Select an Engineer Category."
        if is_store_manager_category((payload.specialization or "").strip() or saved_specialization):
            profile = user.engineer_profile
            if not ((payload.location or "").strip() or user.location):
                errors["location"] = "Select your post office."
            if not ((payload.qualification or "").strip() or (profile.qualification if profile else "")):
                errors["qualification"] = "Qualification is required."
    return errors
