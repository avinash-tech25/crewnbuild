"""Storing and reading uploaded files (ported from the old upload_service.py, same rules).

* Images and PDFs: at most 10 MB, PDF / JPG / PNG / WebP; videos (site and catalog
  product videos): at most 100 MB, MP4 / MOV / WebM. The content must match its
  declared type (magic bytes), not just its name.
* The category decides the bucket family, the locality its country copy (India only).
* Every file gets a random storage key; its address is /files/<id>.
"""

import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.integrations.s3_storage.object_storage import ObjectStorage, StoredObjectMissingError
from app.modules.files.models import File

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024

PROFILE_IMAGE = "PROFILE_IMAGE"
SUPPLIER_IMAGE = "SUPPLIER_IMAGE"
SITE_IMAGE = "SITE_IMAGE"
SITE_VIDEO = "SITE_VIDEO"
PRODUCT_VIDEO = "PRODUCT_VIDEO"
VIDEO_CATEGORIES = {SITE_VIDEO, PRODUCT_VIDEO}

CATEGORY_BUCKET_SETTINGS = {
    PROFILE_IMAGE: "aws_user_images_bucket",
    SUPPLIER_IMAGE: "aws_supplier_data_bucket",
    SITE_IMAGE: "aws_site_images_bucket",
    SITE_VIDEO: "aws_site_videos_bucket",
    PRODUCT_VIDEO: "aws_supplier_data_bucket",
}
CATEGORY_ENVIRONMENT_NAMES = {
    PROFILE_IMAGE: "AWS_USER_IMAGES_BUCKET",
    SUPPLIER_IMAGE: "AWS_SUPPLIER_DATA_BUCKET",
    SITE_IMAGE: "AWS_SITE_IMAGES_BUCKET",
    SITE_VIDEO: "AWS_SITE_VIDEOS_BUCKET",
    PRODUCT_VIDEO: "AWS_SUPPLIER_DATA_BUCKET",
}
LOCALITY_INDIA = "IN"
SUPPORTED_LOCALITIES = {LOCALITY_INDIA}

MAX_FILENAME_LENGTH = 255
MAX_STORAGE_KEY_LENGTH = 512
MAX_KEPT_EXTENSION_LENGTH = 16


def fit_filename(filename: str, limit: int = MAX_FILENAME_LENGTH) -> str:
    """The filename unchanged when it fits; otherwise its stem shortened so the whole
    name is at most `limit` characters, keeping a sensible extension."""
    limit = max(1, limit)
    if len(filename) <= limit:
        return filename
    extension = Path(filename).suffix
    if not extension or len(extension) > MAX_KEPT_EXTENSION_LENGTH or len(extension) >= limit:
        return filename[:limit].rstrip() or filename[:limit]
    stem = filename[: len(filename) - len(extension)]
    shortened = stem[: limit - len(extension)].rstrip(" .")
    return f"{shortened or 'file'[: limit - len(extension)]}{extension}"


def content_matches_type(content: bytes, content_type: str) -> bool:
    is_iso_media = content[4:8] == b"ftyp"
    signatures = {
        "application/pdf": content.startswith(b"%PDF-"),
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        "video/mp4": is_iso_media,
        "video/quicktime": is_iso_media,
        "video/webm": content.startswith(b"\x1a\x45\xdf\xa3"),
    }
    return signatures.get(content_type, False)


def bucket_for(settings: Settings, category: str, locality: str | None) -> str:
    prefix = CATEGORY_BUCKET_SETTINGS.get(category)
    if not prefix:
        raise HTTPException(status_code=500, detail=f"Unknown upload category: {category}")
    resolved = (locality or "").strip().upper() or LOCALITY_INDIA
    if resolved not in SUPPORTED_LOCALITIES:
        resolved = LOCALITY_INDIA
    bucket = str(getattr(settings, f"{prefix}_{resolved.lower()}", "") or "")
    if not bucket:
        variable = f"{CATEGORY_ENVIRONMENT_NAMES[category]}_{resolved}"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"File storage is not configured. Set {variable} in the backend environment file.",
        )
    return bucket


def file_address(stored: File | None) -> str | None:
    return f"/files/{stored.id}" if stored else None


@dataclass
class PendingObject:
    bucket: str
    storage_key: str
    file_id: uuid.UUID | None = None


@dataclass
class UploadService:
    database: Session
    settings: Settings
    storage: ObjectStorage
    pending_objects: list[PendingObject] = field(default_factory=list)

    def validate_upload(self, content: bytes, content_type: str, category: str = PROFILE_IMAGE) -> None:
        is_video = category in VIDEO_CATEGORIES
        allowed = ALLOWED_VIDEO_CONTENT_TYPES if is_video else ALLOWED_CONTENT_TYPES
        limit = MAX_VIDEO_UPLOAD_BYTES if is_video else MAX_UPLOAD_BYTES
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
        if len(content) > limit:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Videos must be {limit // (1024 * 1024)} MB or smaller"
                if is_video
                else "Files must be 10 MB or smaller",
            )
        if content_type not in allowed:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Only MP4, MOV, and WebM videos are allowed"
                if is_video
                else "Only PDF, JPG, PNG, and WebP files are allowed",
            )
        if not content_matches_type(content, content_type):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="The file contents do not match its declared type",
            )

    def delete_object(self, stored: File | PendingObject) -> None:
        """Remove a file's stored object. A file kept in the database (before the move
        to S3) has no bucket and nothing to remove."""
        if stored.bucket:
            self.storage.delete(stored.bucket, stored.storage_key)

    def save(
        self,
        upload: UploadFile | None,
        owner_id: uuid.UUID | None = None,
        module: str = "general",
        category: str = PROFILE_IMAGE,
        locality: str | None = None,
        commit: bool = True,
    ) -> File | None:
        if not upload or not upload.filename:
            return None
        content = upload.file.read()
        content_type = upload.content_type or "application/octet-stream"
        self.validate_upload(content, content_type, category)
        bucket = bucket_for(self.settings, category, locality)

        clean_module = "".join(c for c in module.lower() if c.isalnum() or c in "-_") or "general"
        key_prefix = f"uploads/{clean_module}/{owner_id or 'anonymous'}/{uuid.uuid4().hex}-"
        filename = fit_filename(
            Path(upload.filename.replace("\\", "/")).name,
            min(MAX_FILENAME_LENGTH, MAX_STORAGE_KEY_LENGTH - len(key_prefix)),
        )
        storage_key = f"{key_prefix}{filename}"
        self.storage.put(bucket, storage_key, content, content_type)
        # The object exists from here on, so it is tracked before any database work.
        pending = PendingObject(bucket=bucket, storage_key=storage_key)
        if not commit:
            self.pending_objects.append(pending)
        try:
            stored = File(
                storage_key=storage_key,
                bucket=bucket,
                filename=filename,
                content_type=content_type,
                content=None,
                size_bytes=len(content),
                owner_user_id=owner_id,
            )
            self.database.add(stored)
            self.database.flush()
            pending.file_id = stored.id
            if commit:
                self.database.commit()
        except Exception:
            if commit:
                self.remove_quietly(pending)
            raise
        if commit:
            self.database.refresh(stored)
        return stored

    def save_and_address(self, upload: UploadFile | None, **options: object) -> str | None:
        return file_address(self.save(upload, **options))  # type: ignore[arg-type]

    def remove_quietly(self, stored: File | PendingObject) -> None:
        """Delete one stored object; a failure is logged and never raised."""
        try:
            self.delete_object(stored)
        except Exception as error:
            logger.warning("upload.cleanup_failed storage_key=%s error=%s", stored.storage_key, type(error).__name__)

    def discard_pending_objects(self) -> None:
        while self.pending_objects:
            self.remove_quietly(self.pending_objects.pop())

    def get(self, file_id: uuid.UUID) -> File:
        stored = self.database.get(File, file_id)
        if not stored:
            raise HTTPException(status_code=404, detail="File not found")
        return stored

    def read_content(self, stored: File) -> bytes:
        if stored.content is not None:
            return stored.content
        if not stored.bucket:
            raise HTTPException(status_code=404, detail="Stored file not found")
        try:
            return self.storage.get(stored.bucket, stored.storage_key)
        except StoredObjectMissingError:
            raise HTTPException(status_code=404, detail="Stored file not found") from None
