"""Who may open an uploaded file (ported from the old file_service.file_view_allowed, same
rules and order).

The uploader always (except a Site Engineer's paused past-day site photo). Anyone else
only through what the uploader actually used the file for, looked up in the uploader's
own records: published marketplace pictures and Master Catalog pictures for any signed-in
user; listed documents under the document rule; listing media to whoever may see the
listing; site media to whoever has project access; chat attachments to the conversation;
administrators under the admin document rule.

The lookups into modules not ported yet are the `pending_*` functions: each finds nothing
until its module replaces it (docs/porting-todo.md). Until then those files are private
to their uploader.
"""

import uuid

from sqlalchemy.orm import Session

from app.modules.accounts.profile_lists import read_completed_project_details
from app.modules.admin.admin_identity import account_locality, active_admin_identity
from app.modules.files.file_ownership import file_ids_in
from app.modules.files.models import File
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User

MASTER_CATALOG_MODULE = "master-catalog"
# Builder uploads are filed under "builder"; those made before the rename under "contractor".
BUILDER_MODULES = ("builder", "contractor")


def file_module(stored: File) -> str:
    """The module the file was uploaded under (the second part of its storage key)."""
    parts = (stored.storage_key or "").split("/")
    return parts[1] if len(parts) > 1 else "general"


# ---- lookups into modules not ported yet (stubs) ----


def pending_can_view_private_contact(database: Session, viewer: User, account: User) -> bool:
    """STUB (project_requests/messaging): the contact rule, an accepted request between
    the two accounts in either direction. The account itself is checked here."""
    return viewer.id == account.id


def pending_is_supplier_product_image(database: Session, supplier_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """STUB (marketplace): a photo on one of the supplier's listings."""
    return False


def pending_is_equipment_listing_image(database: Session, supplier_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """STUB (equipment_supply): a photo on one of the supplier's equipment listings."""
    return False


def pending_is_project_cover_image(database: Session, owner_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """STUB (projects): the cover picture of one of the owner's projects."""
    return False


def pending_listing_shows_file_to(database: Session, seller_id: uuid.UUID, file_id: uuid.UUID, viewer: User) -> bool:
    """STUB (property): a photo or video of the seller's property listing the viewer may see."""
    return False


def pending_is_attachment_sent_to(
    database: Session, sender_id: uuid.UUID, viewer_id: uuid.UUID, file_id: uuid.UUID
) -> bool:
    """STUB (messaging): an attachment the sender sent in a conversation the viewer is in."""
    return False


def pending_site_media_project_id(database: Session, file_id: uuid.UUID) -> uuid.UUID | None:
    """STUB (projects): the project a site photo or video belongs to (project_photos)."""
    return None


def pending_project_media_visible(database: Session, viewer: User, file_id: uuid.UUID) -> bool:
    """STUB (projects): site media of a project the viewer has access to (owner, awarded
    builder, assigned Site Engineer), including the builder-photos plan rule."""
    return False


def pending_engineer_site_photo_paused(database: Session, viewer: User, file_id: uuid.UUID) -> bool:
    """STUB (projects, site_operations, billing): a Site Engineer's past-day site photo
    while the project's builder's photo access is paused."""
    return False


def pending_has_active_team_link(database: Session, builder_id: uuid.UUID, engineer_id: uuid.UUID) -> bool:
    """STUB (projects): an ACTIVE team membership between the builder and the engineer."""
    return False


# ---- the rule ----


def admin_may_view_account_documents(database: Session, viewer: User, account: User) -> bool:
    admin = active_admin_identity(database, viewer)
    if admin is None:
        return False
    if not (admin.has("verification.view") or admin.has("users.view")):
        return False
    return admin.may_reach(account_locality(account))


def can_view_account_documents(database: Session, viewer: User, account: User) -> bool:
    return pending_can_view_private_contact(database, viewer, account) or admin_may_view_account_documents(
        database, viewer, account
    )


def file_view_allowed(database: Session, user: User, stored: File) -> bool:
    if user.role == ROLE_ENGINEER and pending_engineer_site_photo_paused(database, user, stored.id):
        return False
    if user.id == stored.owner_user_id:
        return True
    module = file_module(stored)
    if module == MASTER_CATALOG_MODULE:
        return True

    file_id = stored.id
    owner = database.get(User, stored.owner_user_id) if stored.owner_user_id else None
    if owner is not None:
        if module in BUILDER_MODULES and owner.role == ROLE_BUILDER and owner.contractor_profile is not None:
            builder = owner.contractor_profile
            if file_id in file_ids_in(builder.documents):
                return can_view_account_documents(database, user, owner)
            portfolio = read_completed_project_details(builder.completed_project_details)
            published = file_ids_in(
                builder.gallery, builder.company_logo_url, *(image for item in portfolio for image in item["images"])
            )
            if file_id in published:
                return True
        if module == "supplier" and owner.role == ROLE_SUPPLIER:
            supplier = owner.supplier_profile
            if supplier is not None:
                if file_id in file_ids_in(supplier.documents):
                    return can_view_account_documents(database, user, owner)
                if file_id in file_ids_in(supplier.gallery, supplier.store_logo_url):
                    return True
            if pending_is_supplier_product_image(database, owner.id, file_id):
                return True
            if pending_is_equipment_listing_image(database, owner.id, file_id):
                return True
        engineer_photo = owner.engineer_profile.profile_image_url if owner.engineer_profile else None
        if file_id in file_ids_in(owner.profile_image_url, engineer_photo):
            return True
        if pending_is_project_cover_image(database, owner.id, file_id):
            return True
        if pending_listing_shows_file_to(database, owner.id, file_id, user):
            return True
        if pending_is_attachment_sent_to(database, owner.id, user.id, file_id):
            return True
        if admin_may_view_account_documents(database, user, owner):
            return True

    if pending_project_media_visible(database, user, file_id):
        return True
    if module == "engineer" and user.role == ROLE_BUILDER and stored.owner_user_id is not None:
        return pending_has_active_team_link(database, user.id, stored.owner_user_id)
    return False
