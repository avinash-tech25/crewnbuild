"""Account rules ported so far: the engineer's onboarding category.

Same rule as before: an empty category is written once, a repeat of the saved value is
a no-op, any other value is refused. Setting "Site Engineer" or "Store Manager" also
sets engineer_profiles.category, which the Book Technician and Store Manager rules read.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.modules.accounts.models import ENGINEER_CATEGORIES, EngineerProfile
from app.modules.accounts.repository import AccountRepository
from app.modules.accounts.schemas import EngineerCategoryUpdate
from app.modules.identity.models import ROLE_ENGINEER, User
from app.modules.identity.service import user_response

ENGINEER_CATEGORY_LOCKED = "Engineer Category is already set. Change it in Profile Settings."


class AccountService:
    def __init__(self, database: Session) -> None:
        self.database = database
        self.repository = AccountRepository(database)

    def save_engineer_category(self, payload: EngineerCategoryUpdate, user: User) -> dict[str, Any]:
        if user.role != ROLE_ENGINEER:
            raise HTTPException(status_code=403, detail="Only engineers have an Engineer Category.")
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
            saved_category = (user.engineer_profile.specialization or "").strip()
        except SQLAlchemyError:
            self.database.rollback()
            raise HTTPException(
                status_code=500, detail="Engineer Category could not be saved. Please try again."
            ) from None
        if saved_category.casefold() != category.casefold():
            raise HTTPException(status_code=409, detail=ENGINEER_CATEGORY_LOCKED)
        return {"specialization": saved_category, "user": user_response(user, self.database, include_created_at=True)}
