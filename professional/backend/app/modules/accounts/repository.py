"""Database queries of the accounts module. No rules here: the services decide."""

import uuid

from sqlalchemy import func, or_, text, update
from sqlalchemy.orm import Session

from app.modules.accounts.models import AdminProfile, EngineerProfile, SupplierProfile, engineer_category_for
from app.modules.identity.models import UserSession

# Statuses of a Partner booking that is still open (CONNECTIONS.md 2.4).
OPEN_BOOKING_STATUSES = ("SEARCHING", "OFFERED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS")
PARTNER_BOOKINGS_VIEW = "partner.v_professional_bookings"


class AccountRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def set_supplier_category_if_empty(self, user_id: uuid.UUID, category: str) -> None:
        """One statement, so of two saves racing for an empty category only the first
        writes it. A category already set is left exactly as it is."""
        self.database.execute(
            update(SupplierProfile)
            .where(
                SupplierProfile.user_id == user_id,
                or_(SupplierProfile.supplier_category.is_(None), func.trim(SupplierProfile.supplier_category) == ""),
            )
            .values(supplier_category=category)
            .execution_options(synchronize_session=False)
        )

    def set_engineer_category_if_empty(self, user_id: uuid.UUID, specialization: str) -> None:
        """The same single-statement rule; the category column is written with it (a bulk
        UPDATE skips the model's own rule)."""
        self.database.execute(
            update(EngineerProfile)
            .where(
                EngineerProfile.user_id == user_id,
                or_(EngineerProfile.specialization.is_(None), func.trim(EngineerProfile.specialization) == ""),
            )
            .values(specialization=specialization, category=engineer_category_for(specialization))
            .execution_options(synchronize_session=False)
        )

    def admin_profile_for(self, user_id: uuid.UUID) -> AdminProfile | None:
        return self.database.query(AdminProfile).filter(AdminProfile.user_id == user_id).first()

    def revoke_other_sessions(
        self, user_id: uuid.UUID, keep_family_id: uuid.UUID | None, reason: str, now: object
    ) -> None:
        query = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        if keep_family_id is not None:
            query = query.where(UserSession.token_family_id != keep_family_id)
        self.database.execute(
            query.values(revoked_at=now, revoke_reason=reason).execution_options(synchronize_session=False)
        )

    def count_open_partner_bookings(self, user_id: uuid.UUID) -> int:
        """Open Book Technician bookings of this account, read from the view Partner
        publishes for Professional (section 11.2). Before Partner's baseline creates the
        view (or grants it), there are none to count."""
        visible = self.database.execute(
            text(
                "SELECT 1 FROM information_schema.views "
                "WHERE table_schema = 'partner' AND table_name = 'v_professional_bookings'"
            )
        ).first()
        if visible is None:
            return 0
        count = self.database.execute(
            text(
                f"SELECT count(*) FROM {PARTNER_BOOKINGS_VIEW} "  # noqa: S608 constant view name
                "WHERE requested_by_user_id = :user_id AND status = ANY(:statuses)"
            ),
            {"user_id": user_id, "statuses": list(OPEN_BOOKING_STATUSES)},
        ).scalar()
        return int(count or 0)
