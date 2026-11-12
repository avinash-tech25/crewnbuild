"""Accounts endpoints under /api/v1. Paths, bodies and answers are the old ones
(account_routes.py and account_deletion_routes.py). Every signed-in endpoint acts on
the session's own account; none takes an account id."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, app_settings, current_principal, current_user
from app.core.config import Settings
from app.core.security.session_cookies import clear_session_cookies
from app.database.session import get_db
from app.integrations.india_post.pincode_directory import clean_india_pincode, fetch_india_pincode_branches
from app.modules.accounts.account_deletion_service import AccountDeletionService, deletion_form, public_config
from app.modules.accounts.schemas import (
    AccountDeletionCreate,
    BusinessLogoUpdate,
    CompleteProfileRequest,
    EngineerCategorySaved,
    EngineerCategoryUpdate,
    LocationUpdate,
    PhoneChangeRequest,
    ProfileImageUpdate,
    SupplierCategorySaved,
    SupplierCategoryUpdate,
)
from app.modules.accounts.service import AccountService
from app.modules.identity.models import User
from app.modules.identity.phone_verification_service import PhoneVerificationService
from app.modules.identity.router import get_phone_verification_service
from app.modules.identity.schemas import UserResponse

router = APIRouter()


def get_account_service(
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    phone_checks: PhoneVerificationService = Depends(get_phone_verification_service),
) -> AccountService:
    return AccountService(database, settings, phone_checks)


def get_account_deletion_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> AccountDeletionService:
    return AccountDeletionService(database, settings)


# ---- profile ----


@router.patch("/auth/complete-profile", response_model=UserResponse, tags=["Auth"])
def complete_user_profile(
    payload: CompleteProfileRequest,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.complete_user_profile(payload=payload, user=user)


@router.patch("/auth/supplier-category", response_model=SupplierCategorySaved, tags=["Auth"])
def save_supplier_category(
    payload: SupplierCategoryUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Onboarding: the signed-in supplier's own Supplier Category, chosen once."""
    return service.save_supplier_category(payload=payload, user=user)


@router.patch("/auth/engineer-category", response_model=EngineerCategorySaved, tags=["Auth"])
def save_engineer_category(
    payload: EngineerCategoryUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Onboarding: the signed-in engineer's own Engineer Category, chosen once."""
    return service.save_engineer_category(payload=payload, user=user)


@router.post("/auth/phone/change", response_model=UserResponse, tags=["Auth"])
def change_phone(
    payload: PhoneChangeRequest,
    principal: Principal = Depends(current_principal),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Profile Settings: the account's own number, changed only to one whose WhatsApp
    check (/auth/phone/send-code + verify-code) it passed."""
    return service.change_phone(
        principal.user, payload.phone, payload.phone_verification_token, principal.session.token_family_id
    )


@router.patch("/auth/profile-image", response_model=UserResponse, tags=["Auth"])
def update_profile_image(
    payload: ProfileImageUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.update_profile_image(payload=payload, user=user)


@router.patch("/auth/business-logo", tags=["Auth"])
def update_business_logo(
    payload: BusinessLogoUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.update_business_logo(payload=payload, user=user)


@router.patch("/auth/location", response_model=UserResponse, tags=["Auth"])
async def update_user_location(
    payload: LocationUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Save the account's pincode and chosen India Post branch; the address is filled
    from the branch only while it is empty."""
    return await service.update_user_location(payload=payload, user=user)


@router.get("/locations/pincode/{pincode}", tags=["Users"])
async def lookup_pincode_area(pincode: str) -> dict[str, Any]:
    cleaned = clean_india_pincode(pincode)
    branches = await fetch_india_pincode_branches(cleaned)
    primary = branches[0]
    return {
        "pincode": cleaned,
        "area": primary["name"],
        "areas": [branch["name"] for branch in branches],
        "city": primary["district"],
        "district": primary["district"],
        "state": primary["state"],
        "country": primary["country"] or "India",
        "display": primary["display"],
        "post_offices": branches,
        "districts": sorted({branch["district"] for branch in branches}),
    }


# ---- account deletion ----


@router.delete("/account", tags=["Users"])
def delete_account_retired(user: User = Depends(current_user)) -> None:
    """Retired: an account is deleted through POST /account/delete. Nothing changes here."""
    raise HTTPException(
        status_code=410,
        detail={
            "code": "DELETION_FORM_REQUIRED",
            "message": "Delete your account from Profile Settings, then Delete Account.",
        },
    )


@router.get("/account-deletion-requests/config", tags=["Account deletion"])
def read_account_deletion_config(settings: Settings = Depends(app_settings)) -> dict[str, Any]:
    return public_config(settings)


@router.post("/account-deletion-requests", tags=["Account deletion"])
def submit_account_deletion_request() -> None:
    """Retired: deletion is done signed in, through /account/delete."""
    raise HTTPException(
        status_code=410,
        detail={
            "code": "DELETION_IN_APP",
            "message": "Sign in at /delete-account, or in the app under Profile Settings, then Delete Account.",
        },
    )


@router.get("/account/deletion-form", tags=["Account deletion"])
def read_deletion_form(
    user: User = Depends(current_user), settings: Settings = Depends(app_settings)
) -> dict[str, Any]:
    return deletion_form(user, settings)


@router.post("/account/delete", tags=["Account deletion"])
def delete_own_account(
    payload: AccountDeletionCreate,
    user: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
    service: AccountDeletionService = Depends(get_account_deletion_service),
) -> JSONResponse:
    """Deletes the signed-in account immediately (soft delete, anonymised). Ends every
    session and clears the session cookies."""
    response = JSONResponse(service.delete_own_account(user, payload))
    clear_session_cookies(response, settings)
    return response
