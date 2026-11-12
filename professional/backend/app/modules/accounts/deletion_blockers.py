"""Why an account may not be deleted: the old refusals, kept exactly (same order, codes,
messages and status 409) although the deletion itself is now a soft delete. Ported
from the old self_deletion_service.shared_projects and
purge_service.account_deletion_blockers.

The project rows are read through the projects module (projects/deletion_history.py).
The rows of modules not ported yet are the `pending_*` functions below: each returns
"nothing found" until its module is ported and replaces it with the real query (see
docs/porting-todo.md). The open-booking check reads Partner's view and is live already
(it finds nothing until the view exists).
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.accounts.profile_completion import is_store_manager
from app.modules.accounts.repository import AccountRepository
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User
from app.modules.projects import deletion_history

# ---- reads of modules not ported yet (stubs) ----


def pending_builder_history_project_ids(database: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """STUB (site_operations, labour_supply, equipment_supply): projects holding this
    builder's daily registers, material inventory, and labour or equipment requests."""
    return []


def pending_supplier_transaction_history_count(database: Session, user_id: uuid.UUID) -> int:
    """STUB (marketplace, store): this supplier's order lines (material_order_items ->
    purchase_order_items) and Store Manager payment records."""
    return 0


def pending_supplier_history_project_ids(database: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """STUB (labour_supply, equipment_supply): projects holding labour or equipment
    requests addressed to this supplier."""
    return []


def pending_store_manager_shared_history_count(database: Session, user_id: uuid.UUID) -> int:
    """STUB (store, marketplace): store site requests, order lines, store payments and
    goods receipts of this Store Manager's store."""
    return 0


def pending_engineer_history_project_ids(database: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """STUB (labour_supply, equipment_supply, marketplace, store): projects holding this
    engineer's labour or equipment requests and logs, material requests and store
    requests."""
    return []


def builder_history_project_titles(database: Session, user_id: uuid.UUID) -> list[str]:
    return deletion_history.other_owners_project_titles(
        database,
        user_id,
        deletion_history.builder_history_project_ids(user_id),
        pending_builder_history_project_ids(database, user_id),
    )


def supplier_project_history_titles(database: Session, user_id: uuid.UUID) -> list[str]:
    return deletion_history.other_owners_project_titles(
        database,
        user_id,
        deletion_history.supplier_history_project_ids(user_id),
        pending_supplier_history_project_ids(database, user_id),
    )


def engineer_history_project_titles(database: Session, user_id: uuid.UUID) -> list[str]:
    return deletion_history.other_owners_project_titles(
        database,
        user_id,
        deletion_history.engineer_history_project_ids(user_id),
        pending_engineer_history_project_ids(database, user_id),
    )


# ---- the rules ----


def ensure_no_shared_projects(database: Session, user: User) -> None:
    titles = deletion_history.shared_project_titles(database, user.id)
    if titles:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SHARED_PROJECTS",
                "message": f"You own projects other users are working on ({', '.join(titles)}). "
                "Contact us to resolve them before deleting your account, so that their records are protected.",
            },
        )


def account_deletion_blockers(database: Session, user: User) -> dict[str, Any] | None:
    """The first reason this account cannot be deleted, as a 409 detail, or None."""
    if AccountRepository(database).count_open_partner_bookings(user.id):
        return {
            "code": "PARTNER_OPEN_BOOKINGS",
            "message": "You have an open Book Technician booking. "
            "Cancel it or let it finish before deleting your account.",
        }
    if user.role == ROLE_BUILDER:
        titles = builder_history_project_titles(database, user.id)
        if titles:
            return {
                "code": "BUILDER_PROJECT_HISTORY",
                "message": f"Your account holds project history for house owners ({', '.join(titles)}). "
                "Deleting it would remove their records, so contact support to delete your account.",
            }
    if user.role == ROLE_SUPPLIER and pending_supplier_transaction_history_count(database, user.id):
        return {
            "code": "SUPPLIER_TRANSACTION_HISTORY",
            "message": "Your account has transaction history (orders, payments or deliveries) that buyers rely on. "
            "Contact support to delete your account; your past orders are kept.",
        }
    if user.role == ROLE_SUPPLIER:
        titles = supplier_project_history_titles(database, user.id)
        if titles:
            return {
                "code": "SUPPLIER_PROJECT_HISTORY",
                "message": "Your account holds labour or equipment records on other users' projects "
                f"({', '.join(titles)}). Deleting it would remove their history, so contact support to delete "
                "your account.",
            }
    if (
        user.role == ROLE_ENGINEER
        and is_store_manager(user)
        and pending_store_manager_shared_history_count(database, user.id)
    ):
        return {
            "code": "STORE_MANAGER_HISTORY",
            "message": "Your store holds requests, purchases, payments or deliveries that site engineers, builders "
            "and suppliers rely on. Contact support to delete your account; these records are kept.",
        }
    if user.role == ROLE_ENGINEER and not is_store_manager(user):
        titles = engineer_history_project_titles(database, user.id)
        if titles:
            return {
                "code": "ENGINEER_PROJECT_HISTORY",
                "message": "Your account holds site records or an active assignment on other users' projects "
                f"({', '.join(titles)}): labour, equipment, material or store requests. Deleting it would remove "
                "their history, so contact support to delete your account.",
            }
    return None


def ensure_account_deletable(database: Session, user: User) -> None:
    """The old order: shared projects first, then the other refusals."""
    ensure_no_shared_projects(database, user)
    blocker = account_deletion_blockers(database, user)
    if blocker:
        raise HTTPException(status_code=409, detail=blocker)
