"""Database queries of the accounts module ported so far."""

import uuid

from sqlalchemy import func, or_, update
from sqlalchemy.orm import Session

from app.modules.accounts.models import EngineerProfile, engineer_category_for


class AccountRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def set_engineer_category_if_empty(self, user_id: uuid.UUID, specialization: str) -> None:
        """One statement, so of two saves racing for an empty category only the first
        writes it. A category already set is left exactly as it is. The category column
        is written with it (a bulk UPDATE skips the model's own rule)."""
        self.database.execute(
            update(EngineerProfile)
            .where(
                EngineerProfile.user_id == user_id,
                or_(EngineerProfile.specialization.is_(None), func.trim(EngineerProfile.specialization) == ""),
            )
            .values(specialization=specialization, category=engineer_category_for(specialization))
            .execution_options(synchronize_session=False)
        )
