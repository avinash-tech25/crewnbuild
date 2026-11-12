"""Accounts endpoints under /api/v1 ported so far. The rest of the old account_routes.py
(complete-profile, supplier category, phone change, profile image, business logo,
location, pincode lookup) comes with the accounts module."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.accounts.schemas import EngineerCategorySaved, EngineerCategoryUpdate
from app.modules.accounts.service import AccountService
from app.modules.identity.models import User

router = APIRouter(tags=["Auth"])


def get_account_service(database: Session = Depends(get_db)) -> AccountService:
    return AccountService(database)


@router.patch("/auth/engineer-category", response_model=EngineerCategorySaved)
def save_engineer_category(
    payload: EngineerCategoryUpdate,
    user: User = Depends(current_user),
    service: AccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Onboarding: the signed-in engineer's own Engineer Category, chosen once."""
    return service.save_engineer_category(payload=payload, user=user)
