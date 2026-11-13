"""POST /api/v1/vastu/plan-analysis: stateless automatic Vastu plan analysis (ported unchanged).

Nothing is stored: the uploaded plan is held in memory for the one request,
sent to the vision provider, and dropped. No table, no file, no S3 object.

Status meanings, and the HTTP code each is returned with:
  success               200  every required component is reliable; the
                             directionMapping may be scored by evaluateVastu()
  insufficient_data     200  analysis ran, but something required is missing,
                             uncertain or ambiguous; no score must be shown
  needs_page_selection  200  a multi-page PDF; page selection is not built yet
  invalid_file          400 / 413 / 415  the upload itself is unusable
  unavailable           503  provider not configured, failing or timed out
  rate_limited          429  too many analyses from this connection
"""

import logging
import time

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.client_address import visitor_address
from app.core.config import get_settings
from app.database.session import get_db
from app.modules.content.vastu import gemini_client
from app.modules.content.vastu.analysis import analyse
from app.modules.content.vastu.files import MAX_PLAN_BYTES, PlanFileError, inspect_plan
from app.modules.rate_limits import service as limits

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Vastu"])

# Per-address throttle over an hour, shared by every process (rate_limit_events): a
# guard against abuse of a paid call.
VASTU_BUCKET = "vastu:address"
_WINDOW_SECONDS = 3600

_FILE_ERROR_STATUS = {"file_too_large": 413, "unsupported_type": 415}


def _within_rate_limit(database: Session, client: str) -> bool:
    limit = get_settings().vastu_analysis_max_per_hour_per_ip
    return limits.hit(database, VASTU_BUCKET, client, limit, _WINDOW_SECONDS)


def _answer(status_code: int, status: str, reason: str, **extra) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"status": status, "reason": reason, "vastuResult": None, **extra}
    )


@router.post("/vastu/plan-analysis")
def analyse_plan(request: Request, plan: UploadFile = File(...), database: Session = Depends(get_db)):
    # Read one byte past the limit so an oversized upload is refused without
    # holding more than that in memory.
    request_started = time.monotonic()
    # Rate-limited before the upload is read or decoded: decoding a large image
    # is the expensive part, so it must not be free to repeat.
    client = visitor_address(request, get_settings().trusted_proxy_ips) or "unknown"
    if not _within_rate_limit(database, client):
        return _answer(429, "rate_limited", "Too many plan analyses from this connection. Please try again later.")
    content = plan.file.read(MAX_PLAN_BYTES + 1)
    try:
        plan_file = inspect_plan(content)
    except PlanFileError as error:
        return _answer(_FILE_ERROR_STATUS.get(error.code, 400), "invalid_file", error.message, code=error.code)

    # A multi-page PDF is refused before any paid call when its pages can be
    # counted from the file; otherwise the model's own page count is checked
    # in analyse().
    if plan_file.page_count and plan_file.page_count > 1:
        return _answer(
            200,
            "needs_page_selection",
            f"The PDF has {plan_file.page_count} pages. Page selection for multi-page plans is not supported "
            "yet; upload the floor-plan page on its own.",
        )

    if not gemini_client.configured():
        logger.error("A Vastu plan analysis was requested but the vision provider is not configured.")
        return _answer(503, "unavailable", "Plan analysis is temporarily unavailable.")

    model_started = time.monotonic()
    try:
        detections = gemini_client.extract_plan(plan_file.content, plan_file.mime_type)
    except gemini_client.VisionRejectedInputError as error:
        return _answer(400, "invalid_file", str(error), code="unreadable_plan")
    except gemini_client.VisionUnavailableError as error:
        return _answer(503, "unavailable", str(error))

    model_seconds = time.monotonic() - model_started
    result = analyse(plan_file, detections)
    result["page"] = {
        "width": plan_file.size.width,
        "height": plan_file.size.height,
        "uploaded_as": plan_file.source_mime_type,
        "analysed_as": plan_file.mime_type,
        **plan_file.preparation,
    }
    result["model"] = gemini_client.vision_model()
    result["timings"] = {
        "prepare_ms": plan_file.preparation.get("render_ms", plan_file.preparation.get("decode_ms")),
        "model_seconds": round(model_seconds, 1),
        "total_seconds": round(time.monotonic() - request_started, 1),
    }
    result["elapsed_seconds"] = result["timings"]["total_seconds"]
    result.setdefault("vastuResult", None)
    return result
