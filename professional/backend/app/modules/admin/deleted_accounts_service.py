"""Admin > Account Deletion: the history of deleted accounts, read only (ported from the
old app/admin/services/account_deletion_service.py, same answers).

Each deletion leaves one account_deletion_requests row with status DELETED (written by
modules/accounts/account_deletion_service.py). Who may look is deletions.view, inside
the administrator's country scope; every record is India's.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.modules.accounts.account_deletion_service import REASONS, ROLE_LABELS, digits
from app.modules.accounts.models import DELETION_STATUS_DELETED, AccountDeletionRequest
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.scope import LOCALITY_INDIA, locality_code
from app.modules.identity.models import User


def snapshot_account(row: AccountDeletionRequest) -> dict[str, Any]:
    """The account snapshot older (purge-era) records carry; {} for soft deletions."""
    return (row.retained_records or {}).get("account") or {}


class DeletedAccountsService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def in_scope(self, admin: AdminIdentity, row: AccountDeletionRequest) -> bool:
        if admin.is_global:
            return True
        country = snapshot_account(row).get("country")
        return admin.may_reach(locality_code(country, LOCALITY_INDIA))

    def payload(self, row: AccountDeletionRequest) -> dict[str, Any]:
        account = snapshot_account(row)
        deleted_by = "Account holder"
        if row.deleted_by_id:
            administrator = self.database.get(User, row.deleted_by_id)
            deleted_by = f"Administrator ({administrator.name})" if administrator else "Administrator"
        return {
            "id": row.id,
            "reference": row.reference,
            "user_id": str(row.original_user_id or account.get("id") or "") or None,
            "name": row.account_name or account.get("name"),
            "role": row.account_role,
            "role_label": ROLE_LABELS.get(row.account_role, row.account_role),
            "phone": account.get("phone") or row.submitted_phone or None,
            "email": row.account_email or account.get("email") or None,
            "joined_at": local_iso(row.account_created_at) or account.get("created_at"),
            "deleted_at": local_iso(row.deleted_at),
            "reason_code": row.reason_code,
            "reason_label": REASONS.get(row.reason_code) if row.reason_code else None,
            "reason_details": row.reason,
            "deleted_by": deleted_by,
        }

    def list_deleted(self, admin: AdminIdentity, search: str | None = None) -> list[dict[str, Any]]:
        statement = (
            select(AccountDeletionRequest)
            .where(AccountDeletionRequest.status == DELETION_STATUS_DELETED)
            .order_by(AccountDeletionRequest.deleted_at.desc())
        )
        term = (search or "").strip()
        if term:
            like = f"%{term}%"
            matches = [
                AccountDeletionRequest.reference.ilike(like),
                AccountDeletionRequest.account_name.ilike(like),
                AccountDeletionRequest.account_email.ilike(like),
            ]
            number = digits(term)
            if len(number) >= 4:
                matches.append(AccountDeletionRequest.submitted_phone.ilike(f"%{number}%"))
            statement = statement.where(or_(*matches))
        rows = self.database.scalars(statement.limit(500)).all()
        return [self.payload(row) for row in rows if self.in_scope(admin, row)]

    def detail(self, admin: AdminIdentity, record_id: uuid.UUID) -> dict[str, Any]:
        row = self.database.scalars(
            select(AccountDeletionRequest).where(
                AccountDeletionRequest.id == record_id, AccountDeletionRequest.status == DELETION_STATUS_DELETED
            )
        ).first()
        if row is None or not self.in_scope(admin, row):
            raise HTTPException(status_code=404, detail="Deleted account not found")
        summary = row.deletion_summary or {}
        tables = (row.retained_records or {}).get("tables") or {}
        return {
            **self.payload(row),
            "source": row.source,
            "confirmed_at": local_iso(row.policy_accepted_at),
            "retained_records": {key: len(rows) for key, rows in tables.items()},
            "personal_files_removed": len(summary.get("personal_files_removed") or []),
            "personal_files_kept_shared": len(summary.get("personal_files_kept_shared") or []),
            "stored_objects_not_removed": summary.get("stored_objects_not_removed") or [],
        }
