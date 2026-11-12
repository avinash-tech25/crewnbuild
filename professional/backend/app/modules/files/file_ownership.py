"""Checks on file addresses a client hands back to the API (ported from the old
app/shared/files/services/file_urls.py and the id helpers of file_service.py).

Every upload is answered with its address, /files/<id>. A field that stores such an
address (profile photo, business logo, portfolio photo) must hold one of the caller's
OWN uploads: not an external URL and not somebody else's file.

The id is a UUID now (was an integer); the data copy (R8) rewrites stored addresses.
"""

import logging
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import PROFESSIONAL_SCHEMA, get_settings
from app.integrations.s3_storage.object_storage import ObjectStorage, shared_object_storage
from app.modules.files.models import File
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

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


def file_reference_sources(database: Session) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Where a file can be referenced from, read from the schema: every text column of
    every table (an address may be stored anywhere) and every foreign key to files."""
    text_columns = [
        (str(row[0]), str(row[1]))
        for row in database.execute(
            text(
                "SELECT c.table_name, c.column_name FROM information_schema.columns c "
                "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
                "WHERE c.table_schema = :schema AND t.table_type = 'BASE TABLE' "
                "AND c.data_type IN ('text', 'character varying') AND c.table_name <> 'files'"
            ),
            {"schema": PROFESSIONAL_SCHEMA},
        )
    ]
    foreign_keys = [
        (str(row[0]), str(row[1]))
        for row in database.execute(
            text(
                "SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc "
                "JOIN information_schema.key_column_usage kcu "
                "ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema "
                "JOIN information_schema.constraint_column_usage ccu "
                "ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema "
                "WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = :schema AND ccu.table_name = 'files'"
            ),
            {"schema": PROFESSIONAL_SCHEMA},
        )
    ]
    return text_columns, foreign_keys


def quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def file_is_referenced(database: Session, file_id: uuid.UUID) -> bool:
    """Whether anything still points at this file. True whenever it cannot be sure, so a
    file is only deleted on a definite "no"."""
    text_columns, foreign_keys = file_reference_sources(database)
    schema = quoted(PROFESSIONAL_SCHEMA)
    for table_name, column_name in foreign_keys:
        found = database.execute(
            text(f"SELECT 1 FROM {schema}.{quoted(table_name)} WHERE {quoted(column_name)} = :file_id LIMIT 1"),  # noqa: S608 names from the catalog
            {"file_id": file_id},
        ).first()
        if found:
            return True
    if not text_columns:
        return True
    checks = " UNION ALL ".join(
        f"SELECT 1 FROM {schema}.{quoted(table_name)} WHERE {quoted(column_name)} ~* :pattern"  # noqa: S608 names from the catalog
        for table_name, column_name in text_columns
    )
    return bool(database.execute(text(f"SELECT EXISTS ({checks})"), {"pattern": f"/files/{file_id}"}).scalar())


def release_unreferenced_files(
    database: Session, owner: User, file_ids: set[uuid.UUID], storage: ObjectStorage | None = None
) -> list[uuid.UUID]:
    """Delete files the owner explicitly removed, once nothing uses them any more: the
    stored object, then the row. Only the owner's own files; anything else, or any
    failure, keeps the file. Never raises: the save it follows has already succeeded."""
    released: list[uuid.UUID] = []
    for file_id in sorted(file_ids):
        try:
            stored = database.get(File, file_id)
            if stored is None or stored.owner_user_id != owner.id or file_is_referenced(database, file_id):
                continue
            if stored.bucket:
                (storage or shared_object_storage(get_settings())).delete(stored.bucket, stored.storage_key)
            database.delete(stored)
            database.commit()
            released.append(file_id)
        except Exception:
            database.rollback()
            logger.exception("Could not release uploaded file %s", file_id)
    return released
