"""Checks on file addresses a client hands back to the API (ported from the old
app/shared/files/services/file_urls.py and the id helpers of file_service.py).

Every upload is answered with its address, /files/<id>. A field that stores such an
address (profile photo, business logo, portfolio photo) must hold one of the caller's
OWN uploads: not an external URL and not somebody else's file.

The id is a UUID now (was an integer); the data copy (R8) rewrites stored addresses.
"""

import re
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.files.models import File
from app.modules.identity.models import User

UUID_PATTERN = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
FILE_ADDRESS = re.compile(rf"^/files/({UUID_PATTERN})$")
FILE_ADDRESS_ANYWHERE = re.compile(rf"/files/({UUID_PATTERN})")


def file_ids_in(*values: str | None) -> set[uuid.UUID]:
    """Every file id named by these stored values (an address, or a list of them)."""
    return {uuid.UUID(match) for value in values if value for match in FILE_ADDRESS_ANYWHERE.findall(str(value))}


def own_file_ids(database: Session, user: User, file_ids: set[uuid.UUID]) -> set[uuid.UUID]:
    if not file_ids:
        return set()
    return set(database.scalars(select(File.id).where(File.id.in_(file_ids), File.owner_user_id == user.id)))


def own_file_url(database: Session, user: User, url: str | None, *, field: str, allow_empty: bool = True) -> str | None:
    """`url` unchanged when it is one of `user`'s uploads (or empty, when allowed);
    otherwise a 422 naming the field."""
    value = (url or "").strip()
    if not value:
        if allow_empty:
            return url
        raise HTTPException(status_code=422, detail=f"{field} is required.")
    match = FILE_ADDRESS.match(value)
    if match and own_file_ids(database, user, {uuid.UUID(match.group(1))}):
        return value
    raise HTTPException(status_code=422, detail=f"{field} must be a file you uploaded.")


def release_unreferenced_files(database: Session, owner: User, file_ids: set[uuid.UUID]) -> list[uuid.UUID]:
    """Delete the owner's files that nothing references any more, record and stored
    object. NOT PORTED YET: it scans every table that can hold a file address and
    deletes from S3, both of which come with the files module. Until then a replaced
    photo or logo is only unlinked and its file stays."""
    return []
