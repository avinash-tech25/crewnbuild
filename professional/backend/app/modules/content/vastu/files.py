"""Turn an uploaded plan into one pixel image that the analysis measures.

Every accepted format ends up as the same thing: a decoded raster that our code
measures (the north arrow is measured from these pixels) and the exact image the
vision model is shown, so the model's coordinates and our pixels describe the
same picture.

  PNG   decoded with Pillow; sent to the model as uploaded.
  JPEG  decoded with Pillow; EXIF orientation applied. If that changed the
        picture, the corrected image is what the model receives.
  PDF   single page only. Rendered with pypdfium2 (PDFium) at a resolution
        high enough to measure a north arrow, and the rendered PNG — not the
        PDF — is what the model receives. A PDF with more than one page is
        never resolved by picking a page; it is reported back instead.

The type is decided by the file's signature, never its name. A file that cannot
be decoded is refused here, before any model call.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass, field

import pypdfium2 as pdfium
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.modules.content.vastu.geometry import Size

MAX_PLAN_BYTES = 10 * 1024 * 1024

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
PDF_SIGNATURE = b"%PDF-"

PT_PER_INCH = 72.0


class PlanFileError(ValueError):
    """The upload is not a usable plan. `code` is reported to the client."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class PixelGrid:
    """Luminance 0..255 of the decoded plan (transparency flattened onto white)."""

    def __init__(self, grey: Image.Image):
        self.width, self.height = grey.size
        self._pixels = grey.load()

    def value(self, x: int, y: int) -> int:
        if 0 <= x < self.width and 0 <= y < self.height:
            return self._pixels[x, y]
        return 255


@dataclass(frozen=True)
class PlanFile:
    content: bytes  # what the vision model is sent
    mime_type: str  # of `content`
    size: Size  # pixel size of `content`, which `pixels` matches
    page_count: int | None  # PDFs only
    source_mime_type: str = ""  # what was uploaded
    pixels: PixelGrid | None = None
    preparation: dict = field(default_factory=dict)


def _grey(image: Image.Image) -> Image.Image:
    """Greyscale with any transparency composited onto white. Pillow's 'L'
    conversion is the ITU-R 601 luminance the measurement was tuned with."""
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(white, rgba).convert("L")
    return image.convert("L")


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False)
    return buffer.getvalue()


def _decode_image(content: bytes, mime_type: str) -> PlanFile:
    started = time.perf_counter()
    try:
        with Image.open(io.BytesIO(content)) as opened:
            opened.load()  # full decode: damaged data fails here, not later
            orientation = opened.getexif().get(0x0112, 1)  # EXIF Orientation tag
            rotated = orientation not in (None, 1)
            image = ImageOps.exif_transpose(opened) if rotated else opened.copy()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise PlanFileError("corrupt_file", "The image file is damaged or incomplete.") from exc
    if image.width < 1 or image.height < 1:
        raise PlanFileError("corrupt_file", "The image has no size.")
    grey = _grey(image)
    sent, sent_mime = (content, mime_type)
    if rotated:
        # The camera's orientation tag was applied; send the model the same
        # upright picture our code measures.
        sent, sent_mime = _png_bytes(image.convert("RGB")), "image/png"
    return PlanFile(
        sent,
        sent_mime,
        Size(image.width, image.height),
        None,
        mime_type,
        PixelGrid(grey),
        {
            "decode_ms": round((time.perf_counter() - started) * 1000),
            "exif_orientation_applied": bool(rotated),
        },
    )


def _render_pdf(content: bytes) -> PlanFile:
    started = time.perf_counter()
    try:
        document = pdfium.PdfDocument(content)
    except pdfium.PdfiumError as exc:
        raise PlanFileError("corrupt_file", "The PDF file is damaged, incomplete or password-protected.") from exc
    try:
        pages = len(document)
        if pages < 1:
            raise PlanFileError("corrupt_file", "The PDF has no pages.")
        if pages > 1:
            # Reported, never resolved by picking a page.
            return PlanFile(b"", "application/pdf", Size(1, 1), pages, "application/pdf", None, {})
        page = document[0]
        width_pt, height_pt = page.get_size()
        if width_pt <= 0 or height_pt <= 0:
            raise PlanFileError("corrupt_file", "The PDF page has no size.")
        long_side = max(width_pt, height_pt)
        scale = get_settings().vastu_pdf_render_long_side_px / long_side
        scale = min(max(scale, get_settings().vastu_pdf_min_scale), get_settings().vastu_pdf_max_scale)
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil().convert("RGB")
    except pdfium.PdfiumError as exc:
        raise PlanFileError("corrupt_file", "The PDF page could not be rendered.") from exc
    finally:
        document.close()
    render_ms = round((time.perf_counter() - started) * 1000)
    encoded = _png_bytes(image)
    return PlanFile(
        encoded,
        "image/png",
        Size(image.width, image.height),
        1,
        "application/pdf",
        PixelGrid(_grey(image)),
        {
            "render_ms": render_ms,
            "render_scale": round(scale, 3),
            "render_dpi": round(scale * PT_PER_INCH),
            "rendered_px": [image.width, image.height],
            "page_size_pt": [round(width_pt, 1), round(height_pt, 1)],
        },
    )


def inspect_plan(content: bytes) -> PlanFile:
    if not content:
        raise PlanFileError("empty_file", "The file is empty.")
    if len(content) > MAX_PLAN_BYTES:
        raise PlanFileError(
            "file_too_large", "The plan is larger than 10 MB. Upload a smaller export of the same plan."
        )
    if content.startswith(PNG_SIGNATURE):
        return _decode_image(content, "image/png")
    if content.startswith(JPEG_SIGNATURE):
        return _decode_image(content, "image/jpeg")
    if content.startswith(PDF_SIGNATURE):
        return _render_pdf(content)
    raise PlanFileError("unsupported_type", "Upload the plan as a JPG, PNG or PDF file.")
