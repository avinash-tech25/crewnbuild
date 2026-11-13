from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.core.config import BACKEND_ROOT
from app.core.runtime import settings

PROFILE_IMAGE_FOLDER = "profile-images"
MAX_PROFILE_IMAGE_BYTES = 3 * 1024 * 1024
UPLOAD_URL_PREFIX = "/uploads"

# Judged by the file's own first bytes, not by the name or the declared type,
# both of which the browser lets the user choose.
IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
)


def upload_root() -> Path:
    configured = Path(settings.upload_directory or "uploads")
    return configured if configured.is_absolute() else BACKEND_ROOT / configured


def image_extension(head: bytes) -> str | None:
    for signature, extension in IMAGE_SIGNATURES:
        if head.startswith(signature):
            return extension
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


class UploadService:
    def save_profile_image(self, file: UploadFile) -> str:
        content = file.file.read(MAX_PROFILE_IMAGE_BYTES + 1)
        if len(content) > MAX_PROFILE_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Choose an image smaller than 3 MB.")
        extension = image_extension(content[:16])
        if not extension:
            raise HTTPException(status_code=422, detail="Upload a JPG, PNG or WebP image.")

        folder = upload_root() / PROFILE_IMAGE_FOLDER
        folder.mkdir(parents=True, exist_ok=True)
        # A random name: nothing the client sent ends up in the path.
        file_name = f"{uuid4().hex}{extension}"
        (folder / file_name).write_bytes(content)
        return f"{UPLOAD_URL_PREFIX}/{PROFILE_IMAGE_FOLDER}/{file_name}"
