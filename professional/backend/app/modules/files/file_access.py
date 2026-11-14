"""Who may open an uploaded file (ported from the old file_service.file_view_allowed, same
rules and order).

The uploader always (except a Site Engineer's paused past-day site photo). Anyone else
only through what the uploader actually used the file for, looked up in the uploader's
own records: published marketplace pictures (a supplier's listing pictures among them)
and Master Catalog pictures for any signed-in user; listed documents under the document
rule; listing media to whoever may see the listing; site media to whoever has project
access; chat attachments to the conversation; administrators under the admin document
rule.
"""

from sqlalchemy.orm import Session

from app.modules.accounts.profile_lists import read_completed_project_details
from app.modules.admin.admin_identity import account_locality, active_admin_identity
from app.modules.equipment_supply.links import is_equipment_listing_image
from app.modules.files.file_ownership import file_ids_in
from app.modules.files.models import File
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User
from app.modules.marketplace.account_links import is_supplier_listing_image
from app.modules.messaging.links import is_attachment_sent_to
from app.modules.projects import file_links
from app.modules.projects.people import can_view_private_contact

MASTER_CATALOG_MODULE = "master-catalog"
# Builder uploads are filed under "builder"; those made before the rename under "contractor".
BUILDER_MODULES = ("builder", "contractor")


def file_module(stored: File) -> str:
    """The module the file was uploaded under (the second part of its storage key)."""
    parts = (stored.storage_key or "").split("/")
    return parts[1] if len(parts) > 1 else "general"


# ---- the rule ----


def admin_may_view_account_documents(database: Session, viewer: User, account: User) -> bool:
    admin = active_admin_identity(database, viewer)
    if admin is None:
        return False
    if not (admin.has("verification.view") or admin.has("users.view")):
        return False
    return admin.may_reach(account_locality(account))


def can_view_account_documents(database: Session, viewer: User, account: User) -> bool:
    return can_view_private_contact(database, viewer, account) or admin_may_view_account_documents(
        database, viewer, account
    )


def file_view_allowed(database: Session, user: User, stored: File) -> bool:
    if user.role == ROLE_ENGINEER and file_links.engineer_site_photo_paused(database, user, stored.id):
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
            if is_supplier_listing_image(database, owner.id, file_id):
                return True
            if is_equipment_listing_image(database, owner.id, file_id):
                return True
        engineer_photo = owner.engineer_profile.profile_image_url if owner.engineer_profile else None
        if file_id in file_ids_in(owner.profile_image_url, engineer_photo):
            return True
        if file_links.is_project_cover_image(database, owner.id, file_id):
            return True
        # Imported here: the property module reads the files module.
        from app.modules.property.links import listing_shows_file_to

        if listing_shows_file_to(database, owner.id, file_id, user):
            return True
        if is_attachment_sent_to(database, owner.id, user.id, file_id):
            return True
        if admin_may_view_account_documents(database, user, owner):
            return True

    if file_links.project_media_visible(database, user, file_id):
        return True
    if module == "engineer" and user.role == ROLE_BUILDER and stored.owner_user_id is not None:
        return file_links.has_active_team_link(database, user.id, stored.owner_user_id)
    return False


def must_not_be_stored(database: Session, viewer: User, stored: File) -> bool:
    """Whether the file is sent with `no-store`, so no copy stays in the browser's cache:
    an account's verification documents, and anything an administrator opens that is not
    their own (documents, people's photos, attachments). The uploader's own files keep
    the normal private cache."""
    if viewer.id == stored.owner_user_id:
        return False
    if active_admin_identity(database, viewer) is not None:
        return True
    owner = database.get(User, stored.owner_user_id) if stored.owner_user_id else None
    if owner is None:
        return False
    documents = [
        profile.documents for profile in (owner.contractor_profile, owner.supplier_profile) if profile is not None
    ]
    return stored.id in file_ids_in(*documents)
