"""Files endpoints under /api/v1 (ported from the old file_routes.py, same behaviour):

    POST /files/upload     store one upload of the signed-in account; answers {"url": "/files/<id>"}
    GET  /files/{file_id}  the file, to whoever file_view_allowed lets open it

Both need a session (cookie). The download carries an ETag and private caching, and
video answers byte ranges so a <video> element can seek.
"""

import hashlib
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi import File as FileField
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.dependencies import app_settings, current_user
from app.core.config import Settings
from app.database.session import get_db
from app.integrations.s3_storage.object_storage import shared_object_storage
from app.modules.admin.admin_identity import account_locality
from app.modules.files.file_access import file_view_allowed, must_not_be_stored
from app.modules.files.upload_service import PROFILE_IMAGE, SITE_VIDEO, SUPPLIER_IMAGE, UploadService
from app.modules.identity.models import ROLE_SUPPLIER, User
from app.modules.projects.file_links import site_media_project_id

router = APIRouter(tags=["Documents"])


def get_upload_service(
    database: Session = Depends(get_db), settings: Settings = Depends(app_settings)
) -> UploadService:
    return UploadService(database, settings, shared_object_storage(settings))


@router.post("/files/upload")
def upload_file(
    file: UploadFile = FileField(...),
    user: User = Depends(current_user),
    uploads: UploadService = Depends(get_upload_service),
) -> dict[str, str]:
    """A video goes to the site-video category (its own bucket and 100 MB limit); a
    supplier's pictures to the supplier-data buckets; everything else to user images."""
    if str(file.content_type or "").startswith("video/"):
        category = SITE_VIDEO
    elif user.role == ROLE_SUPPLIER:
        category = SUPPLIER_IMAGE
    else:
        category = PROFILE_IMAGE
    address = uploads.save_and_address(
        file, owner_id=user.id, module=user.role.lower(), category=category, locality=account_locality(user)
    )
    if not address:
        raise HTTPException(status_code=400, detail="File upload failed")
    return {"url": address}


def ascii_filename(name: str) -> str:
    return "".join(character if 32 <= ord(character) < 127 and character not in '"\\' else "_" for character in name)


def byte_range(range_header: str, total: int) -> tuple[int, int] | None:
    """(start, end) of a well-formed single "bytes=" range, else None."""
    if not range_header.startswith("bytes=") or not total:
        return None
    start_text, _, end_text = range_header[6:].split(",")[0].strip().partition("-")
    try:
        start = int(start_text) if start_text else 0
        end = int(end_text) if end_text else total - 1
    except ValueError:
        start, end = 0, total - 1
    if not start_text and end_text:  # "bytes=-500": the final N bytes
        start, end = max(total - end, 0), total - 1
    start, end = max(start, 0), min(end, total - 1)
    return (start, end) if start <= end else None


@router.get("/files/{file_id}")
def fetch_file(
    file_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    uploads: UploadService = Depends(get_upload_service),
    database: Session = Depends(get_db),
) -> Response:
    stored = uploads.get(file_id)
    if not file_view_allowed(database, user, stored):
        raise HTTPException(status_code=403, detail="File access denied")

    # A file id never changes content, so the validator comes from fixed metadata
    # (hashed, so the storage key is not exposed). Site media revalidates on every
    # display, because the builder's photo access can end at any moment.
    digest = hashlib.sha256(f"{stored.id}:{stored.storage_key}:{stored.size_bytes}".encode()).hexdigest()[:20]
    entity_tag = f'"file-{stored.id}-{digest}"'
    site_media = site_media_project_id(database, stored.id) is not None
    cache_headers = {
        "Cache-Control": "private, no-store"
        if must_not_be_stored(database, user, stored)
        else "private, no-cache"
        if site_media
        else "private, max-age=3600",
        "ETag": entity_tag,
        "Vary": "Authorization, Cookie",
    }
    if_none_match = request.headers.get("if-none-match", "")
    if if_none_match and (
        if_none_match.strip() == "*"
        or entity_tag in {tag.strip().removeprefix("W/") for tag in if_none_match.split(",")}
    ):
        return Response(status_code=304, headers=cache_headers)

    is_video = stored.content_type.startswith("video/")
    disposition = "inline" if stored.content_type.startswith(("image/", "video/")) else "attachment"
    content = uploads.read_content(stored)
    original_name = stored.filename or "file"
    headers = {
        "Content-Disposition": (
            f'{disposition}; filename="{ascii_filename(original_name)}"; '
            f"filename*=UTF-8''{quote(original_name, safe='')}"
        ),
        "X-Content-Type-Options": "nosniff",
        **cache_headers,
    }
    span = byte_range(request.headers.get("range", ""), len(content)) if is_video else None
    if span is not None:
        start, end = span
        return Response(
            content=content[start : end + 1],
            status_code=206,
            media_type=stored.content_type,
            headers={
                **headers,
                "Content-Range": f"bytes {start}-{end}/{len(content)}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
            },
        )
    if is_video:
        headers["Accept-Ranges"] = "bytes"
    return Response(content=content, media_type=stored.content_type, headers=headers)
