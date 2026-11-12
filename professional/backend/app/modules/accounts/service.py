"""The account's own profile: complete-profile, the onboarding categories, phone change,
profile photo, business logo and location. Ported from the old
app/shared/account/services/account_service.py with the same rules and messages.

Every method acts on the session's own account; none takes an account id.
"""

import json
import uuid
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.local_time import utc_now
from app.integrations.india_post.pincode_directory import clean_india_pincode, fetch_india_pincode_branches
from app.modules.accounts.models import (
    ENGINEER_CATEGORIES,
    BuilderProfile,
    EngineerProfile,
    OwnerProfile,
    SupplierProfile,
)
from app.modules.accounts.policies import ensure_engineer, ensure_has_business_logo, ensure_supplier
from app.modules.accounts.profile_lists import read_completed_project_details
from app.modules.accounts.profile_payloads import builder_profile_payload, supplier_profile_payload
from app.modules.accounts.profile_validation import is_store_manager_category, profile_field_errors
from app.modules.accounts.repository import AccountRepository
from app.modules.accounts.schemas import (
    BusinessLogoUpdate,
    CompleteProfileRequest,
    EngineerCategoryUpdate,
    LocationUpdate,
    ProfileImageUpdate,
    SupplierCategoryUpdate,
)
from app.modules.admin.audit_log import record_admin_action
from app.modules.billing import lead_locations
from app.modules.files.file_ownership import file_ids_in, own_file_ids, own_file_url, release_unreferenced_files
from app.modules.identity.models import (
    ADMIN_ROLES,
    DEFAULT_COUNTRY,
    ROLE_BUILDER,
    ROLE_ENGINEER,
    ROLE_OWNER,
    ROLE_SUPPLIER,
    PhoneVerificationCode,
    User,
)
from app.modules.identity.phone_verification_service import (
    PHONE_IN_USE_MESSAGE,
    PhoneVerificationService,
    effective_country,
    phone_in_use,
)
from app.modules.identity.service import (
    PHONE_MAX_DIGITS,
    country_is_india,
    is_phone_unique_violation,
    normalize_phone,
    user_response,
)
from app.modules.projects.owner_first_project import create_owner_profile_project_if_missing

MATERIAL_SUPPLIER_CATEGORY = "Material Supplier"
EQUIPMENT_SUPPLIER_CATEGORY = "Equipment Supplier"
LABOR_SUPPLIER_CATEGORY = "Labor Supplier"
SUPPLIER_CATEGORIES = (MATERIAL_SUPPLIER_CATEGORY, EQUIPMENT_SUPPLIER_CATEGORY, LABOR_SUPPLIER_CATEGORY)
# British spelling the profile forms also recognise; stored as the canonical value.
SUPPLIER_CATEGORY_ALIASES = {"labour supplier": LABOR_SUPPLIER_CATEGORY}

SUPPLIER_CATEGORY_LOCKED = "Supplier Category is already set and cannot be changed."
ENGINEER_CATEGORY_LOCKED = "Engineer Category is already set. Change it in Profile Settings."
STORE_MANAGER_CATEGORY_LOCKED = "A saved Engineer Category cannot be changed to or from Store Manager."
PHONE_CHANGE_NEEDS_CHECK = "Verify the new mobile number on WhatsApp first, in Profile Settings under Mobile number."
ADMIN_PHONE_CHANGED = "admin_phone_changed"


def canonical_supplier_category(value: str | None) -> str | None:
    """'labor supplier' / 'Labour Supplier' -> 'Labor Supplier'; None when unsupported."""
    wanted = (value or "").strip().casefold()
    for category in SUPPLIER_CATEGORIES:
        if category.casefold() == wanted:
            return category
    return SUPPLIER_CATEGORY_ALIASES.get(wanted)


def portfolio_file_ids(gallery: str | None, completed_project_details: str | None) -> set[uuid.UUID]:
    """The files a builder's gallery and portfolio show."""
    portfolio = read_completed_project_details(completed_project_details)
    return file_ids_in(gallery, *(image for project in portfolio for image in project["images"]))


class AccountService:
    def __init__(self, database: Session, settings: Settings, phone_checks: PhoneVerificationService) -> None:
        self.database = database
        self.settings = settings
        self.repository = AccountRepository(database)
        self.phone_checks = phone_checks

    def answer(self, user: User) -> dict[str, Any]:
        return user_response(user, self.database, include_created_at=True)

    # ---- phone ----

    def verified_phone_change(
        self, user: User, new_phone: str, token: str | None, country: str | None
    ) -> PhoneVerificationCode | None:
        """The WhatsApp check a changed Indian number must pass, or None when none is needed."""
        if new_phone == (user.phone or "") and country_is_india(user.country_code):
            return None
        if not self.phone_checks.required() or not country_is_india(country):
            return None
        refused = {"message": PHONE_CHANGE_NEEDS_CHECK, "fields": {"phone": PHONE_CHANGE_NEEDS_CHECK}}
        if not (token or "").strip():
            raise HTTPException(status_code=422, detail=refused)
        try:
            return self.phone_checks.require_verified(new_phone, token)
        except HTTPException as error:
            detail = error.detail if isinstance(error.detail, str) else PHONE_CHANGE_NEEDS_CHECK
            raise HTTPException(status_code=422, detail={"message": detail, "fields": {"phone": detail}}) from None

    def change_phone(self, user: User, raw_phone: str, token: str, current_family_id: uuid.UUID) -> dict[str, Any]:
        """Profile Settings: replace the account's mobile number with a WhatsApp-verified
        one. An administrator's number lives on its admin profile, and changing it ends
        every other session of the account."""
        if not self.phone_checks.required():
            raise HTTPException(status_code=404, detail="WhatsApp verification is not enabled.")
        if not country_is_india(user.country_code):
            raise HTTPException(
                status_code=422, detail="WhatsApp verification is only available for Indian mobile numbers."
            )
        record = self.phone_checks.require_verified(raw_phone, token)
        phone = record.phone
        admin_profile = None
        if user.role in ADMIN_ROLES:
            admin_profile = self.repository.admin_profile_for(user.id)
            if not admin_profile:
                raise HTTPException(status_code=409, detail="This administrator account has no admin profile.")
        current = admin_profile.phone if admin_profile else user.phone
        if phone != current and phone_in_use(self.database, phone, DEFAULT_COUNTRY, exclude_user_id=user.id):
            raise HTTPException(status_code=409, detail=PHONE_IN_USE_MESSAGE)
        if admin_profile:
            admin_profile.phone = phone
            record_admin_action(
                self.database,
                user,
                "admin.phone_changed",
                summary="Changed own sign-in mobile number",
                target_type="user",
                target_id=user.id,
            )
            self.repository.revoke_other_sessions(user.id, current_family_id, ADMIN_PHONE_CHANGED, utc_now())
        else:
            user.phone = phone
        self.phone_checks.consume(record)
        try:
            self.database.commit()
        except IntegrityError as error:
            self.database.rollback()
            if is_phone_unique_violation(error):
                raise HTTPException(status_code=409, detail=PHONE_IN_USE_MESSAGE) from None
            raise
        self.database.refresh(user)
        return self.answer(user)

    # ---- complete-profile ----

    def complete_user_profile(self, payload: CompleteProfileRequest, user: User) -> dict[str, Any]:
        removed_media: set[uuid.UUID] = set()
        field_errors = profile_field_errors(payload, user)
        if field_errors:
            raise HTTPException(
                status_code=422,
                detail={"message": "Please complete the highlighted required fields.", "fields": field_errors},
            )
        if user.role == ROLE_BUILDER and payload.service_locations:
            saved = user.contractor_profile.service_locations if user.contractor_profile else None
            lead_locations.require_location_count(self.database, user, payload.service_locations, saved)
        if user.role == ROLE_BUILDER:
            lead_locations.require_account_pincode(self.database, user, payload.pincode, payload.service_locations)

        country = effective_country(payload.country_of_residence, user.country_code)
        canonical_phone = normalize_phone(payload.phone or "", PHONE_MAX_DIGITS)
        phone_taken = {"message": PHONE_IN_USE_MESSAGE, "fields": {"phone": PHONE_IN_USE_MESSAGE}}
        if phone_in_use(self.database, canonical_phone, country, exclude_user_id=user.id):
            raise HTTPException(status_code=422, detail=phone_taken)
        phone_check = self.verified_phone_change(user, canonical_phone, payload.phone_verification_token, country)

        if payload.name is not None:
            user.name = payload.name.strip() or user.name
        user.phone = canonical_phone
        user.address = payload.address
        user.pincode = payload.pincode
        if payload.location is not None:
            user.location = payload.location.strip() or user.location
        if payload.country_of_residence:
            user.country_code = payload.country_of_residence.strip() or user.country_code
        try:
            self.database.flush()
        except IntegrityError as error:
            self.database.rollback()
            if is_phone_unique_violation(error):
                raise HTTPException(status_code=422, detail=phone_taken) from None
            raise
        if phone_check:
            self.phone_checks.consume(phone_check)
        if payload.profile_image_url:
            user.profile_image_url = payload.profile_image_url

        if user.role == ROLE_OWNER:
            self.save_owner_profile(payload, user)
        elif user.role == ROLE_BUILDER:
            removed_media = self.save_builder_profile(payload, user)
        elif user.role == ROLE_SUPPLIER:
            self.save_supplier_profile(payload, user)
        elif user.role == ROLE_ENGINEER:
            self.save_engineer_profile(payload, user)

        self.database.commit()
        if user.role == ROLE_BUILDER and removed_media:
            release_unreferenced_files(self.database, user, removed_media)
        self.database.expire(user)
        self.database.refresh(user)
        return self.answer(user)

    def save_owner_profile(self, payload: CompleteProfileRequest, user: User) -> None:
        owner = user.owner_profile or OwnerProfile(user_id=user.id)
        user.owner_profile = owner
        owner.building_type = payload.building_type or owner.building_type or "RESIDENTIAL"
        owner.construction_type = payload.construction_type or owner.construction_type or "CONTRACTOR"
        owner.budget_amount = Decimal(str(payload.budget or 0))
        owner.land_area = payload.land_area or 0
        owner.floors = payload.floors or 1
        if payload.floor_type is not None:
            owner.floor_type = payload.floor_type
        owner.project_title = payload.project_title or owner.project_title
        owner.project_description = payload.project_description or owner.project_description
        owner.site_status = payload.site_status or owner.site_status
        owner.start_timeline = payload.start_timeline or owner.start_timeline
        owner.design_status = payload.design_status or owner.design_status
        owner.contact_preference = payload.contact_preference or owner.contact_preference
        self.database.add(owner)
        self.database.flush()
        create_owner_profile_project_if_missing(self.database, user)

    def save_builder_profile(self, payload: CompleteProfileRequest, user: User) -> set[uuid.UUID]:
        """A field the request does not carry keeps its saved value; the optional lists
        are the one place an explicit empty value clears. Returns the media this save
        removed."""
        submitted = payload.model_fields_set
        builder = user.contractor_profile or BuilderProfile(
            user_id=user.id, company_name=payload.company_name or user.name
        )
        media_before = portfolio_file_ids(builder.gallery, builder.completed_project_details)
        builder.company_name = payload.company_name or builder.company_name or user.name
        builder.company_logo_url = payload.company_logo_url or builder.company_logo_url
        builder.license_number = payload.license_number or builder.license_number or ""
        if "experience_years" in submitted and payload.experience_years is not None:
            builder.experience_years = payload.experience_years
        else:
            builder.experience_years = builder.experience_years or 0
        builder.about = payload.about or builder.about
        for text_field in ("gstin", "pan", "website", "business_type", "team_size"):
            if text_field in submitted:
                setattr(builder, text_field, (getattr(payload, text_field) or "").strip() or None)
        if "registration_year" in submitted:
            builder.registration_year = payload.registration_year or None
        if "insurance_available" in submitted and payload.insurance_available is not None:
            builder.has_insurance = bool(payload.insurance_available)
        builder.service_locations = payload.service_locations or builder.service_locations
        builder.services_offered = payload.services_offered or builder.services_offered
        for list_field in ("equipment_owned", "documents", "gallery"):
            value = getattr(payload, list_field)
            if list_field in submitted and value is not None:
                setattr(builder, list_field, value)
        if "completed_project_details" in submitted and payload.completed_project_details is not None:
            # Written as sent (an empty list removes every project), cleaned, and a
            # project photo must be one of this builder's own uploads.
            portfolio = read_completed_project_details(payload.completed_project_details or "[]")
            image_ids = file_ids_in(*(image for project in portfolio for image in project["images"]))
            own_ids = own_file_ids(self.database, user, image_ids)
            for project in portfolio:
                project["images"] = [image for image in project["images"] if file_ids_in(image) <= own_ids]
            builder.completed_project_details = json.dumps(portfolio)
            builder.completed_projects = len(portfolio)
        else:
            builder.completed_projects = (
                len(read_completed_project_details(builder.completed_project_details))
                or builder.completed_projects
                or 0
            )
        self.database.add(builder)
        return media_before - portfolio_file_ids(builder.gallery, builder.completed_project_details)

    def save_supplier_profile(self, payload: CompleteProfileRequest, user: User) -> None:
        supplier = user.supplier_profile or SupplierProfile(user_id=user.id, store_name=payload.store_name or user.name)
        supplier.store_name = payload.store_name or supplier.store_name or user.name
        supplier.store_logo_url = payload.store_logo_url or supplier.store_logo_url
        supplier.categories = payload.categories or supplier.categories or ""
        supplier.about = payload.about or supplier.about
        for text_field in ("gstin", "pan", "website", "business_type"):
            if text_field in payload.model_fields_set:
                setattr(supplier, text_field, (getattr(payload, text_field) or "").strip() or None)
        # Chosen once: a repeat of the saved value, or leaving it out, is a no-op.
        submitted_category = (payload.supplier_category or "").strip()
        saved_category = (supplier.supplier_category or "").strip()
        if not saved_category:
            if submitted_category:
                canonical = canonical_supplier_category(submitted_category)
                if not canonical:
                    message = "Select a supplier category."
                    raise HTTPException(
                        status_code=422, detail={"message": message, "fields": {"supplier_category": message}}
                    )
                submitted_category = canonical
            supplier.supplier_category = submitted_category or supplier.supplier_category
        elif submitted_category and submitted_category.casefold() != saved_category.casefold():
            raise HTTPException(status_code=409, detail=SUPPLIER_CATEGORY_LOCKED)
        if "registration_year" in payload.model_fields_set:
            supplier.registration_year = payload.registration_year or None
        supplier.delivery_locations = payload.service_locations or supplier.delivery_locations
        supplier.documents = payload.documents or supplier.documents
        supplier.gallery = payload.gallery or supplier.gallery
        self.database.add(supplier)

    def save_engineer_profile(self, payload: CompleteProfileRequest, user: User) -> None:
        engineer = user.engineer_profile or EngineerProfile(user_id=user.id)
        # An account cannot move across the Store Manager line once it holds a category.
        submitted_category = (payload.specialization or "").strip()
        saved_category = (engineer.specialization or "").strip()
        if (
            submitted_category
            and saved_category
            and is_store_manager_category(submitted_category) != is_store_manager_category(saved_category)
        ):
            raise HTTPException(status_code=409, detail=STORE_MANAGER_CATEGORY_LOCKED)
        engineer.qualification = payload.qualification or engineer.qualification
        # Setting the specialization also sets engineer_profiles.category.
        engineer.specialization = payload.specialization or engineer.specialization
        engineer.experience_years = (
            payload.experience_years if payload.experience_years is not None else (engineer.experience_years or 0)
        )
        engineer.license_number = payload.license_number or engineer.license_number
        engineer.about = payload.about or engineer.about
        self.database.add(engineer)

    # ---- onboarding categories ----

    def save_supplier_category(self, payload: SupplierCategoryUpdate, user: User) -> dict[str, Any]:
        ensure_supplier(user)
        category = payload.supplier_category.strip()
        if category not in SUPPLIER_CATEGORIES:
            message = "Select a supplier category."
            raise HTTPException(status_code=422, detail={"message": message, "fields": {"supplier_category": message}})
        try:
            if not user.supplier_profile:
                self.database.add(SupplierProfile(user_id=user.id, store_name=user.name, categories=""))
                self.database.flush()
            self.repository.set_supplier_category_if_empty(user.id, category)
            self.database.commit()
            self.database.expire(user)
            self.database.refresh(user)
            saved = (user.supplier_profile.supplier_category or "").strip()
        except SQLAlchemyError:
            self.database.rollback()
            raise HTTPException(
                status_code=500, detail="Supplier Category could not be saved. Please try again."
            ) from None
        if saved.casefold() != category.casefold():
            raise HTTPException(status_code=409, detail=SUPPLIER_CATEGORY_LOCKED)
        return {"supplier_category": saved, "user": self.answer(user)}

    def save_engineer_category(self, payload: EngineerCategoryUpdate, user: User) -> dict[str, Any]:
        ensure_engineer(user)
        category = payload.specialization.strip()
        if category not in ENGINEER_CATEGORIES:
            message = "Select an Engineer Category."
            raise HTTPException(status_code=422, detail={"message": message, "fields": {"specialization": message}})
        try:
            if not user.engineer_profile:
                self.database.add(EngineerProfile(user_id=user.id))
                self.database.flush()
            self.repository.set_engineer_category_if_empty(user.id, category)
            self.database.commit()
            self.database.expire(user)
            self.database.refresh(user)
            saved = (user.engineer_profile.specialization or "").strip()
        except SQLAlchemyError:
            self.database.rollback()
            raise HTTPException(
                status_code=500, detail="Engineer Category could not be saved. Please try again."
            ) from None
        if saved.casefold() != category.casefold():
            raise HTTPException(status_code=409, detail=ENGINEER_CATEGORY_LOCKED)
        return {"specialization": saved, "user": self.answer(user)}

    # ---- photo, logo, location ----

    def update_profile_image(self, payload: ProfileImageUpdate, user: User) -> dict[str, Any]:
        """Only one of the caller's own uploads (or empty, to clear it)."""
        previous = user.profile_image_url
        user.profile_image_url = own_file_url(self.database, user, payload.profile_image_url, field="Profile image")
        self.database.commit()
        release_unreferenced_files(self.database, user, file_ids_in(previous) - file_ids_in(user.profile_image_url))
        self.database.refresh(user)
        return self.answer(user)

    def update_business_logo(self, payload: BusinessLogoUpdate, user: User) -> dict[str, Any]:
        ensure_has_business_logo(user)
        if user.role == ROLE_BUILDER:
            builder = user.contractor_profile
            if not builder:
                raise HTTPException(status_code=404, detail="Builder profile not found")
            previous = builder.company_logo_url
            builder.company_logo_url = own_file_url(self.database, user, payload.logo_url, field="Business logo")
            self.database.commit()
            release_unreferenced_files(
                self.database, user, file_ids_in(previous) - file_ids_in(builder.company_logo_url)
            )
            self.database.refresh(builder)
            return builder_profile_payload(self.database, user, builder)
        supplier = user.supplier_profile
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier profile not found")
        previous = supplier.store_logo_url
        supplier.store_logo_url = own_file_url(self.database, user, payload.logo_url, field="Business logo")
        self.database.commit()
        release_unreferenced_files(self.database, user, file_ids_in(previous) - file_ids_in(supplier.store_logo_url))
        self.database.refresh(supplier)
        return supplier_profile_payload(user, supplier)

    async def update_user_location(self, payload: LocationUpdate, user: User) -> dict[str, Any]:
        """Save the account's pincode and the India Post branch chosen for it; the
        address is filled from the branch only while it is empty."""
        if (user.country_code or DEFAULT_COUNTRY).strip().upper() != "INDIA":
            raise HTTPException(status_code=400, detail="Pincode lookup is available for accounts in India.")
        pincode = clean_india_pincode(payload.pincode)
        lead_locations.require_account_pincode(self.database, user, pincode)
        branches = await fetch_india_pincode_branches(pincode)
        wanted = (payload.branch_name or "").strip().casefold()
        branch = next((item for item in branches if item["name"].casefold() == wanted), None)
        if not branch:
            raise HTTPException(status_code=422, detail="Select one of the branches listed for this pincode.")
        user.pincode = pincode
        user.location = branch["display"][:180]
        if not (user.address or "").strip():
            user.address = branch["display"]
        self.database.commit()
        self.database.refresh(user)
        return self.answer(user)
