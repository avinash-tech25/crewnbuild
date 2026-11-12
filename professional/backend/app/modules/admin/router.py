"""Admin console endpoints under /api/v1/admin (ported from the old admin_routes.py,
admin_account_deletion_routes.py and admin_support_routes.py; paths and answers
unchanged, ids are UUIDs).

Every route needs an administrator role AND its named permission (require_admin).
GET /admin/me and GET /admin/overview need the administrator role only, as before.
The projects screens (/admin/projects, /admin/leads) answer empty until the projects
module is ported (project_links.py). The catalog, coupon and payment-history screens
come with the catalog and billing modules.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.integrations.email.email_sender import EmailSender
from app.modules.admin import (
    advert_service,
    audit_log,
    notification_service,
    overview_service,
    project_links,
    report_service,
    support_desk_service,
    verification_service,
)
from app.modules.admin.account_service import AdminAccountService
from app.modules.admin.admin_identity import MANAGER_PRESET_LABELS, MANAGER_PRESETS, PERMISSIONS, AdminIdentity
from app.modules.admin.deleted_accounts_service import DeletedAccountsService
from app.modules.admin.dependencies import current_admin, require_admin
from app.modules.admin.schemas import (
    AdministratorCreate,
    AdministratorUpdate,
    AdvertCreate,
    AdvertStatus,
    AdvertUpdate,
    Announcement,
    ReportDecision,
    StaffReply,
    StatusChange,
    VerificationDecision,
)
from app.modules.admin.scope import LOCALITY_INDIA, viewing
from app.modules.content.ad_service import placements_list
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import SITE_IMAGE, UploadService
from app.modules.identity.router import get_email_sender
from app.modules.support import ticket_service as tickets
from app.modules.support.router import attachment_response

router = APIRouter(prefix="/admin", tags=["Admin"])
# Registered later, where the old app registered the deleted-accounts and support routes.
staff_router = APIRouter(prefix="/admin", tags=["Admin"])


def get_account_service(database: Session = Depends(get_db)) -> AdminAccountService:
    return AdminAccountService(database)


@router.get("/me")
def fetch_admin_identity(admin: AdminIdentity = Depends(current_admin)) -> dict[str, Any]:
    """Who the caller is and what it may do. A convenience for the console, never a
    control: every endpoint re-checks its own permission."""
    return {
        "id": admin.user.id,
        "name": admin.user.name,
        "email": admin.user.email,
        "role": admin.user.role,
        "scope": admin.scope,
        # The caller's own WhatsApp sign-in number ("" when none).
        "phone": admin.profile.phone or "",
        "is_global": admin.is_global,
        "permissions": sorted(admin.permissions),
        "permission_catalogue": PERMISSIONS,
    }


@router.get("/users")
def fetch_admin_users(
    admin: AdminIdentity = Depends(require_admin("users.view")),
    service: AdminAccountService = Depends(get_account_service),
    role: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    country: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return service.fetch_users(
        admin, role=role, status_filter=status_filter, country=country, search=search, limit=limit, offset=offset
    )


@router.get("/projects")
def fetch_admin_projects(
    admin: AdminIdentity = Depends(require_admin("projects.view")),
    database: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return project_links.pending_admin_projects(database, viewing(admin, country), limit=limit, offset=offset)


@router.get("/manager-presets")
def list_manager_presets(admin: AdminIdentity = Depends(require_admin("admins.manage"))) -> dict[str, Any]:
    """The ready-made kinds of manager; a preset naming a permission the caller cannot
    grant is left out."""
    grantable = admin.permissions - {"admins.manage"}
    return {
        "presets": [
            {"key": key, "label": MANAGER_PRESET_LABELS.get(key, key.title()), "permissions": sorted(permissions)}
            for key, permissions in MANAGER_PRESETS.items()
            if set(permissions) <= grantable
        ],
        "permissions": [{"key": key, "label": label} for key, label in PERMISSIONS.items() if key in grantable],
    }


@router.get("/admins")
def fetch_administrators(
    admin: AdminIdentity = Depends(require_admin("admins.manage")),
    service: AdminAccountService = Depends(get_account_service),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return service.fetch_administrators(admin, country)


@router.post("/admins", status_code=201)
def create_administrator_account(
    payload: AdministratorCreate,
    admin: AdminIdentity = Depends(require_admin("admins.manage")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """The account and its audit entry are committed together."""
    return service.create_administrator(payload, admin)


@router.patch("/admins/{user_id}")
def update_administrator_account(
    user_id: uuid.UUID,
    payload: AdministratorUpdate,
    admin: AdminIdentity = Depends(require_admin("admins.manage")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.update_administrator(user_id, payload, admin)


@router.post("/admins/{user_id}/deactivate")
def deactivate_administrator_account(
    user_id: uuid.UUID,
    payload: StatusChange,
    admin: AdminIdentity = Depends(require_admin("admins.manage")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.set_administrator_status(user_id, payload, admin, active=False)


@router.post("/admins/{user_id}/reactivate")
def reactivate_administrator_account(
    user_id: uuid.UUID,
    payload: StatusChange,
    admin: AdminIdentity = Depends(require_admin("admins.manage")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.set_administrator_status(user_id, payload, admin, active=True)


@router.get("/audit")
def fetch_audit_log(
    admin: AdminIdentity = Depends(require_admin("audit.view")),
    database: Session = Depends(get_db),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    """Read only: no endpoint edits or deletes an entry, and the database refuses both."""
    return audit_log.fetch_audit_log(
        database,
        admin,
        action=action,
        actor=actor,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        country=country,
    )


@router.post("/users/{user_id}/suspend")
def suspend_user_account(
    user_id: uuid.UUID,
    payload: StatusChange,
    admin: AdminIdentity = Depends(require_admin("users.suspend")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    """Takes effect on the account's next request; a reason is required."""
    return service.suspend_user(user_id, payload, admin)


@router.post("/users/{user_id}/reactivate")
def reactivate_user_account(
    user_id: uuid.UUID,
    payload: StatusChange,
    admin: AdminIdentity = Depends(require_admin("users.suspend")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.reactivate_user(user_id, payload, admin)


@router.get("/verification")
def fetch_verification_queue(
    admin: AdminIdentity = Depends(require_admin("verification.view")),
    database: Session = Depends(get_db),
    state: str = Query(default="PENDING"),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return verification_service.fetch_verification_queue(database, admin, state, country)


@router.post("/verification/{user_id}")
def decide_verification(
    user_id: uuid.UUID,
    payload: VerificationDecision,
    admin: AdminIdentity = Depends(require_admin("verification.decide")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return verification_service.decide_verification(database, admin, user_id, payload)


@router.get("/reports")
def fetch_reports(
    admin: AdminIdentity = Depends(require_admin("reports.view")),
    database: Session = Depends(get_db),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return report_service.fetch_reports(
        database, admin, status_filter=status_filter, limit=limit, offset=offset, country=country
    )


@router.post("/reports/{report_id}")
def update_report(
    report_id: uuid.UUID,
    payload: ReportDecision,
    admin: AdminIdentity = Depends(require_admin("reports.resolve")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return report_service.update_report(database, admin, report_id, payload)


@router.get("/users/{user_id}")
def fetch_user_detail(
    user_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("users.view")),
    service: AdminAccountService = Depends(get_account_service),
) -> dict[str, Any]:
    return service.fetch_user_detail(user_id, admin)


@router.get("/projects/{project_id}")
def fetch_project_detail(
    project_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("projects.view")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    detail = project_links.pending_project_detail(database, admin, project_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return detail


@router.get("/leads")
def fetch_marketplace_activity(
    admin: AdminIdentity = Depends(require_admin("projects.view")),
    database: Session = Depends(get_db),
    status_filter: str | None = Query(default=None, alias="status"),
    kind: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return project_links.pending_marketplace_activity(
        database, viewing(admin, country), status=status_filter, kind=kind, limit=limit, offset=offset
    )


@router.get("/notifications")
def fetch_notifications(
    admin: AdminIdentity = Depends(require_admin("users.view")),
    database: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return notification_service.fetch_notifications(database, admin, limit=limit, offset=offset, country=country)


@router.post("/notifications", status_code=201)
def send_announcement(
    payload: Announcement,
    admin: AdminIdentity = Depends(require_admin("users.suspend")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    """Gated on users.suspend, not users.view: writing to every account's list is an
    action on those accounts."""
    return notification_service.send_announcement(database, admin, payload)


@router.get("/overview")
def fetch_overview(
    admin: AdminIdentity = Depends(current_admin),
    database: Session = Depends(get_db),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    """Only the sections this administrator holds permissions for are computed."""
    return overview_service.fetch_overview(database, admin, country)


# ---- ads ----


@router.post("/ads/image")
def upload_advert_image(
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("ads.manage")),
    uploads: UploadService = Depends(get_upload_service),
) -> dict[str, str]:
    """An ad picture, validated and stored like every other upload (site content,
    filed under India). PDFs, which the upload service accepts, are refused here."""
    if (file.content_type or "") not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=415, detail="An advert must be a PNG, JPEG or WebP image.")
    url = uploads.save_and_address(
        file, owner_id=admin.user.id, module="adverts", category=SITE_IMAGE, locality=LOCALITY_INDIA
    )
    if not url:
        raise HTTPException(status_code=400, detail="That image could not be saved.")
    return {"url": url}


@router.get("/ads/placements")
def list_advert_placements(admin: AdminIdentity = Depends(require_admin("ads.view"))) -> list[dict[str, str]]:
    return placements_list()


@router.get("/ads")
def list_adverts(
    admin: AdminIdentity = Depends(require_admin("ads.view")),
    database: Session = Depends(get_db),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    country: str | None = Query(default=None),
) -> dict[str, Any]:
    return advert_service.list_adverts(database, admin, status=status, limit=limit, offset=offset, country=country)


@router.post("/ads", status_code=201)
def create_advert_record(
    payload: AdvertCreate,
    admin: AdminIdentity = Depends(require_admin("ads.manage")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return advert_service.create_advert(database, admin, payload)


@router.patch("/ads/{advert_id}")
def update_advert_record(
    advert_id: uuid.UUID,
    payload: AdvertUpdate,
    admin: AdminIdentity = Depends(require_admin("ads.manage")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return advert_service.update_advert(database, admin, advert_id, payload)


@router.post("/ads/{advert_id}/status")
def change_advert_status(
    advert_id: uuid.UUID,
    payload: AdvertStatus,
    admin: AdminIdentity = Depends(require_admin("ads.manage")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return advert_service.change_status(database, admin, advert_id, payload)


@router.get("/ads/{advert_id}/stats")
def advert_performance(
    advert_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("ads.view")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return advert_service.advert_performance(database, admin, advert_id)


# ---- deleted accounts (read only) ----


@staff_router.get("/deleted-accounts")
def list_deleted_accounts(
    q: str | None = Query(default=None, max_length=100),
    admin: AdminIdentity = Depends(require_admin("deletions.view")),
    database: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return DeletedAccountsService(database).list_deleted(admin, q)


@staff_router.get("/deleted-accounts/{record_id}")
def read_deleted_account(
    record_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("deletions.view")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    return DeletedAccountsService(database).detail(admin, record_id)


# ---- support tickets (staff) ----


@staff_router.get("/support/tickets")
def list_support_tickets(
    status: str | None = Query(default=None, max_length=20),
    q: str | None = Query(default=None, max_length=100),
    admin: AdminIdentity = Depends(require_admin("support.view")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    tickets.require_tickets(database)
    return {"tickets": support_desk_service.staff_list(database, admin, status, q)}


@staff_router.get("/support/tickets/{ticket_id}")
def read_support_ticket(
    ticket_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("support.view")),
    database: Session = Depends(get_db),
) -> dict[str, Any]:
    tickets.require_tickets(database)
    ticket = support_desk_service.staff_ticket(database, admin, ticket_id)
    return tickets.serialize_ticket(database, ticket, with_messages=True, staff=True)


@staff_router.get("/support/tickets/{ticket_id}/attachment")
def support_ticket_attachment(
    ticket_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("support.view")),
    database: Session = Depends(get_db),
    uploads: UploadService = Depends(get_upload_service),
) -> Response:
    tickets.require_tickets(database)
    ticket = support_desk_service.staff_ticket(database, admin, ticket_id)
    return attachment_response(uploads, tickets.attachment_for(database, ticket))


@staff_router.post("/support/tickets/{ticket_id}/reply")
def reply_on_support_ticket(
    ticket_id: uuid.UUID,
    update: StaffReply,
    admin: AdminIdentity = Depends(require_admin("support.manage")),
    database: Session = Depends(get_db),
    email: EmailSender = Depends(get_email_sender),
) -> dict[str, Any]:
    tickets.require_tickets(database)
    ticket = support_desk_service.staff_update(database, email, admin, ticket_id, update.body, update.status)
    return tickets.serialize_ticket(database, ticket, with_messages=True, staff=True)
