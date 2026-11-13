"""Private job photos: validated, cleaned, encrypted, stored outside the public web root.

    upload (at most JOB_MEDIA_MAX_INPUT_BYTES read)
      -> decoded by Pillow; the format comes from the bytes, never the file name
         or the browser's declared type. Only JPEG, PNG and WebP are accepted.
      -> refused before decoding if it claims more than JOB_MEDIA_MAX_PIXELS
         (decompression bombs), and refused if it does not decode completely
      -> EXIF orientation applied to the pixels, then scaled down to at most
         JOB_MEDIA_MAX_DIMENSION on the longest side
      -> re-encoded from pixels alone, so EXIF (including GPS), XMP, ICC and
         text chunks are not carried over
      -> Fernet-encrypted with DATA_ENCRYPTION_KEY (its version in a header)
      -> written as JOB_MEDIA_DIRECTORY/<random 48-hex key>.bin

Nothing here is reachable through /uploads, and nothing the client sent ends up
in a path. Identity-verification files live in their own directory and code
(identity_service.py); this module neither reads nor writes them.
"""

import io
import logging
import os
import secrets
import warnings
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import BACKEND_ROOT
from app.core.runtime import settings
from app.core.security import data_encryption
from app.modules.bookings.models import MAX_STORED_MEDIA_BYTES

logger = logging.getLogger(__name__)

# Pillow format name -> the content type served back, and how it is re-encoded.
ACCEPTED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
UNAVAILABLE_MESSAGE = "Photo upload is not available right now. Please try again later."
UNSUPPORTED_MESSAGE = "Upload a JPG, PNG or WebP photo."
KEY_LENGTH = 48


@dataclass(frozen=True)
class ProcessedImage:
    content: bytes
    content_type: str
    width: int
    height: int


def job_media_root() -> Path:
    configured = Path(settings.job_media_directory)
    return configured if configured.is_absolute() else BACKEND_ROOT / configured


def media_path(storage_key: str) -> Path:
    # The key is our own random hex, but never trust a path component.
    if len(storage_key or "") != KEY_LENGTH or not all(ch in "0123456789abcdef" for ch in storage_key):
        raise ValueError("invalid storage key")
    return job_media_root() / f"{storage_key}.bin"


# A stored file starts with the version of the key that encrypted it (DB-11): b"v3\n".
VERSION_HEADER = b"v"


def _seal(content: bytes) -> bytes:
    if not data_encryption.encryption_configured():
        raise HTTPException(status_code=503, detail=UNAVAILABLE_MESSAGE)
    ciphertext, version = data_encryption.encrypt(content)
    return VERSION_HEADER + str(version).encode() + b"\n" + ciphertext


def _open(stored: bytes) -> bytes:
    version = 1  # files written before versions existed
    if stored.startswith(VERSION_HEADER):
        header, _, stored = stored.partition(b"\n")
        version = int(header[len(VERSION_HEADER) :])
    return data_encryption.decrypt(stored, version)


def read_upload(file) -> bytes:
    """At most one byte more than the limit is read, so an oversized upload is
    refused without being held in memory in full."""
    limit = settings.job_media_max_input_bytes
    content = file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status_code=413, detail=f"Choose a photo smaller than {limit // (1024 * 1024)} MB.")
    if not content:
        raise HTTPException(status_code=422, detail=UNSUPPORTED_MESSAGE)
    return content


def _open_checked(content: bytes) -> Image.Image:
    with warnings.catch_warnings():
        # Pillow only warns between MAX_IMAGE_PIXELS and twice that; treat it as fatal.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(content), formats=tuple(ACCEPTED_FORMATS))
        except (
            UnidentifiedImageError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            OSError,
            ValueError,
        ):
            raise HTTPException(status_code=422, detail=UNSUPPORTED_MESSAGE)
    if image.format not in ACCEPTED_FORMATS:
        raise HTTPException(status_code=422, detail=UNSUPPORTED_MESSAGE)
    width, height = image.size
    if width < 1 or height < 1 or width * height > settings.job_media_max_pixels:
        raise HTTPException(
            status_code=422, detail="This photo's dimensions are too large. Please use a smaller photo."
        )
    if getattr(image, "n_frames", 1) > 1:
        raise HTTPException(status_code=422, detail="Animated images are not accepted. Upload a still photo.")
    return image


def process_image(content: bytes) -> ProcessedImage:
    """Validate and clean an uploaded photo. Raises 413/422 for anything unacceptable."""
    image = _open_checked(content)
    source_format = image.format
    try:
        # verify() reads the whole stream for structural damage, then the image
        # must be opened again before its pixels can be used.
        image.verify()
        image = _open_checked(content)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image.load()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=422, detail="This photo could not be read. It may be damaged; please take it again."
        )

    # The camera's orientation tag becomes real rotation, because the tag itself
    # is about to be discarded with the rest of the metadata.
    image = ImageOps.exif_transpose(image)
    limit = settings.job_media_max_dimension
    if max(image.size) > limit:
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)

    # From pixels only: a fresh image carries no info dictionary, so nothing the
    # source held (EXIF, GPS, XMP, ICC profile, PNG text) can be written back.
    if source_format == "JPEG":
        pixels = image.convert("RGB") if image.mode not in ("RGB", "L") else image
    elif source_format == "PNG":
        pixels = image if image.mode in ("RGB", "RGBA", "L", "LA") else image.convert("RGBA")
    else:  # WEBP
        pixels = image if image.mode in ("RGB", "RGBA") else image.convert("RGBA")
    clean = Image.new(pixels.mode, pixels.size)
    clean.paste(pixels)

    output = io.BytesIO()
    if source_format == "JPEG":
        clean.save(output, format="JPEG", quality=85, optimize=True)
    elif source_format == "PNG":
        clean.save(output, format="PNG", optimize=True)
    else:
        clean.save(output, format="WEBP", quality=85, method=4)
    data = output.getvalue()
    if len(data) > MAX_STORED_MEDIA_BYTES:
        raise HTTPException(
            status_code=413, detail="This photo is too large even after resizing. Please use a smaller photo."
        )
    return ProcessedImage(
        content=data, content_type=ACCEPTED_FORMATS[source_format], width=clean.width, height=clean.height
    )


class JobMediaStorage:
    """Encrypted files under JOB_MEDIA_DIRECTORY, addressed only by a random key."""

    def store(self, content: bytes) -> str:
        encrypted = _seal(content)
        root = job_media_root()
        root.mkdir(parents=True, exist_ok=True)
        storage_key = secrets.token_hex(KEY_LENGTH // 2)
        final = media_path(storage_key)
        temporary = final.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        os.replace(temporary, final)
        return storage_key

    def read(self, storage_key: str) -> bytes:
        try:
            return _open(media_path(storage_key).read_bytes())
        except (FileNotFoundError, ValueError, data_encryption.DecryptionError):
            logger.error("Job photo %s is missing or unreadable.", storage_key[:8] if storage_key else "?")
            raise HTTPException(status_code=404, detail="Photo not found")

    def delete(self, storage_key: str) -> None:
        try:
            media_path(storage_key).unlink(missing_ok=True)
        except ValueError:
            pass
