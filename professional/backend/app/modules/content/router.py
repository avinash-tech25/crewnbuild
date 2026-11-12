"""Content endpoints under /api/v1 (ported from the old estimate_routes.py,
advertisement_routes.py and translation_routes.py; paths and answers unchanged).

Public: the ads a screen shows, their pictures, view/click counts, the placement list,
and the two estimate calculators. Signed in: translating display text (each miss is a billed provider call).
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import app_settings, current_user
from app.core.config import Settings
from app.database.session import get_db
from app.integrations.s3_storage.object_storage import StorageUnavailableError, shared_object_storage
from app.modules.content import ad_service, estimate_service
from app.modules.content.estimate_location_check import verify_estimate_location
from app.modules.content.models import Ad
from app.modules.content.schemas import (
    AdvertEvent,
    EstimateCreate,
    PublicEstimateRequest,
    TranslationRequest,
    TranslationResponse,
)
from app.modules.content.translation_service import (
    MAX_TEXTS_PER_REQUEST,
    SUPPORTED_TARGETS,
    TranslationService,
    get_translation_service,
)
from app.modules.files.file_access import file_module
from app.modules.files.file_ownership import file_ids_in
from app.modules.files.models import File
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import User

# The signed address outlives the hour a browser caches the redirect.
ADVERT_IMAGE_LINK_SECONDS = 6 * 60 * 60
ADVERT_UPLOAD_MODULE = "adverts"

router = APIRouter()


# ---- estimates ----


@router.post("/estimates/calculate", tags=["Owners"])
def calculate_public_estimate(payload: EstimateCreate) -> dict[str, Any]:
    return estimate_service.estimate_calculation(payload)


@router.post("/estimates/public-calculate", tags=["Owners"])
async def calculate_verified_public_estimate(payload: PublicEstimateRequest) -> dict[str, Any]:
    """The PIN must be confirmed by India Post to be in the selected state and city."""
    payload.pincode = await verify_estimate_location(payload.pincode, payload.state, payload.city)
    return estimate_service.estimate_calculation(payload.to_estimate_create())


# ---- ads ----


@router.get("/ads", tags=["adverts"])
def adverts_for_screen(
    placement: str = Query(..., description="Which screen is asking"),
    country: str | None = Query(default=None, description="India"),
    position: str | None = Query(default=None, description="top or footer"),
    database: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """An unknown screen gets an empty list, not an error."""
    return ad_service.adverts_for_screen(database, placement, country, position)


@router.post("/ads/{advert_id}/event", status_code=204, tags=["adverts"])
def report_advert_event(advert_id: uuid.UUID, payload: AdvertEvent, database: Session = Depends(get_db)) -> None:
    ad_service.record_event(database, advert_id, payload.placement, payload.event)


@router.get("/ads/{advert_id}/image", tags=["adverts"])
def advert_image(
    advert_id: uuid.UUID,
    database: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    uploads: UploadService = Depends(get_upload_service),
) -> Response:
    """The picture an administrator put into an advert, to anyone. Only a file uploaded
    as an advert picture is published here, so no other upload becomes public."""
    advert = database.get(Ad, advert_id)
    if advert is None:
        raise HTTPException(status_code=404, detail="No such advert.")
    stored_address = (advert.image_url or "").strip()
    if not stored_address.startswith("/files/"):
        raise HTTPException(status_code=404, detail="That advert has no stored image.")
    file_ids = file_ids_in(stored_address)
    uploaded = database.get(File, next(iter(file_ids))) if file_ids else None
    if uploaded is None:
        raise HTTPException(status_code=404, detail="That advert's image is missing.")
    if file_module(uploaded) != ADVERT_UPLOAD_MODULE:
        raise HTTPException(status_code=404, detail="That advert has no stored image.")
    if uploaded.bucket and uploaded.storage_key:
        try:
            address = shared_object_storage(settings).presigned_get_url(
                uploaded.bucket,
                uploaded.storage_key,
                content_type=uploaded.content_type,
                cache_control="public, max-age=3600",
                expires_in=ADVERT_IMAGE_LINK_SECONDS,
            )
        except StorageUnavailableError:
            address = None  # serve it ourselves: slow beats a hole where the advert should be
        if address:
            return RedirectResponse(address, status_code=307, headers={"Cache-Control": "public, max-age=3600"})
    return Response(
        content=uploads.read_content(uploaded),
        media_type=uploaded.content_type,
        headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/ad-placements", tags=["adverts"])
def public_placements() -> list[dict[str, str]]:
    return ad_service.placements_list()


# ---- translation ----


@router.post("/translate", response_model=TranslationResponse, tags=["Translation"])
def translate_for_display(
    payload: TranslationRequest,
    user: User = Depends(current_user),
    translator: TranslationService = Depends(get_translation_service),
) -> TranslationResponse:
    """Every requested string maps to what should be shown; nothing is stored."""
    target = (payload.target or "").strip().lower()
    if target not in SUPPORTED_TARGETS:
        raise HTTPException(status_code=422, detail="Unsupported language.")
    if len(payload.texts) > MAX_TEXTS_PER_REQUEST:
        raise HTTPException(status_code=422, detail=f"Send at most {MAX_TEXTS_PER_REQUEST} strings per request.")
    return TranslationResponse(
        translations=translator.translate(payload.texts, target), configured=translator.configured
    )
