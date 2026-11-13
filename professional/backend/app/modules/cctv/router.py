"""Live Camera / CCTV endpoints under /api/v1 (ported from the old cctv_routes.py; paths
and answers unchanged, project ids are UUIDs) -- device and channel management.

Every /cctv endpoint needs a live session (the session cookie: 401 without one, 403
for a suspended account) and then authorizes the project stored on
the CCTV row it touches (app/modules/cctv/services/access.py). ONVIF verification and
channel discovery run server-side (app/modules/cctv/services/connectivity.py) and never
return a host, port, endpoint, stream URI, stream path or credential. Live
playback sessions (app/modules/cctv/services/playback.py) return only a media gateway
URL under a random per-session path and a short-lived playback token.

Validation errors on these routes never echo the request. FastAPI's default 422
body includes pydantic's `input`, and for a missing field that input is the
whole request body -- camera password included. CctvRoute replaces that body
for CCTV routes only; the application-wide handler is untouched.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Path, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user as get_current_user
from app.database.session import get_db as get_database
from app.modules.cctv.schemas import (
    CctvCameraSetupOut,
    CctvCameraSetupStatusOut,
    CctvCameraSetupSubmit,
    CctvChannelOut,
    CctvChannelsReplace,
    CctvChannelStatusOut,
    CctvChannelUpdate,
    CctvCredentialsInput,
    CctvDeviceCreate,
    CctvDeviceDeleted,
    CctvDeviceOut,
    CctvDeviceUpdate,
    CctvDiscoveredChannelsSave,
    CctvDiscoveryOut,
    CctvPlaybackRequest,
    CctvPlaybackSessionEnded,
    CctvPlaybackSessionOut,
    CctvPlaybackSessionRenewed,
    CctvProjectOut,
    CctvReconnectOut,
    CctvRecordedPlaybackRequest,
    CctvRecordingSearchOut,
    CctvRecordingSearchRequest,
    CctvRecordingSegmentOut,
    CctvVerifyOut,
)
from app.modules.cctv.services import access, connectivity, devices, playback, recordings, setup
from app.modules.identity.models import User

MAX_REPORTED_VALIDATION_ERRORS = 50

# Messages built from the error type and its numeric limits only. pydantic's own
# message is not used, because some types quote part of the input (a UUID
# parsing error names the offending character, for example).
_VALIDATION_MESSAGES = {
    "missing": "This field is required.",
    "extra_forbidden": "This field is not accepted.",
    "string_type": "Must be text.",
    "string_too_short": "Must be at least {min_length} characters.",
    "string_too_long": "Must be at most {max_length} characters.",
    "int_type": "Must be a whole number.",
    "int_parsing": "Must be a whole number.",
    "int_from_float": "Must be a whole number.",
    "greater_than_equal": "Must be at least {ge}.",
    "less_than_equal": "Must be at most {le}.",
    "bool_type": "Must be true or false.",
    "bool_parsing": "Must be true or false.",
    "literal_error": "Must be one of the allowed values.",
    "list_type": "Must be a list.",
    "too_long": "Too many items (at most {max_length}).",
    "too_short": "Too few items (at least {min_length}).",
    "model_type": "Must be an object.",
    "model_attributes_type": "Must be an object.",
    "dict_type": "Must be an object.",
    "json_invalid": "The request body is not valid JSON.",
    "json_type": "The request body must be JSON.",
    "uuid_parsing": "Must be a valid identifier.",
    "uuid_type": "Must be a valid identifier.",
}


def _numeric_context(error: dict) -> dict:
    context = error.get("ctx") or {}
    return {
        key: value for key, value in context.items() if isinstance(value, (int, float)) and not isinstance(value, bool)
    }


def sanitized_validation_detail(error: RequestValidationError) -> dict:
    fields = []
    for item in error.errors()[:MAX_REPORTED_VALIDATION_ERRORS]:
        location = [str(part) for part in item.get("loc", ()) if part not in ("body", "path", "query")]
        template = _VALIDATION_MESSAGES.get(item.get("type", ""), "Invalid value.")
        try:
            message = template.format(**_numeric_context(item))
        except (KeyError, IndexError, ValueError):
            message = "Invalid value."
        fields.append({"field": ".".join(location) or "request", "message": message})
    return {"code": "CCTV_VALIDATION_ERROR", "message": "Please correct the highlighted fields.", "fields": fields}


class CctvRoute(APIRoute):
    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def handler(request: Request):
            try:
                return await original_handler(request)
            except RequestValidationError as error:
                return JSONResponse(status_code=422, content={"detail": sanitized_validation_detail(error)})

        return handler


router = APIRouter(prefix="/cctv", tags=["Live Camera"], route_class=CctvRoute)

ProjectId = Annotated[uuid.UUID, Path()]


@router.get("/projects", response_model=list[CctvProjectOut])
def list_cctv_projects(
    request: Request, user: User = Depends(get_current_user), database: Session = Depends(get_database)
):
    return devices.list_projects(database, user, request)


# --- first-time camera setup -------------------------------------------------
#
# The only two CCTV routes a user without a completed verification may reach.
# The status route needs project authorization alone -- somebody who has not
# verified yet still has to be told that a setup step exists -- and it returns no
# device address, port, credential or stream location.


@router.get("/projects/{project_id}/camera-setup", response_model=CctvCameraSetupStatusOut)
def camera_setup_status(
    request: Request,
    project_id: ProjectId,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Whether this project has a recorder, and whether the signed-in user has
    finished verifying it. Decides which screen Live Camera opens on."""
    return setup.status_for(database, user, project_id, request)


@router.post("/projects/{project_id}/camera-setup", response_model=CctvCameraSetupOut)
def camera_setup_connect(
    payload: CctvCameraSetupSubmit,
    request: Request,
    project_id: ProjectId,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Verify the DVR/NVR credentials this user typed and, on success, grant them
    the project's shared camera.

    The credentials are used for one live ONVIF exchange and dropped. They are
    stored only when this call registers the project's first recorder; for a
    recorder that already exists the stored credential row is never touched.
    """
    return setup.connect(database, user, project_id, payload, request)


@router.get("/projects/{project_id}/devices", response_model=list[CctvDeviceOut])
def list_project_devices(
    request: Request,
    project_id: ProjectId,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    grant = access.authorize_project(database, user, project_id, request)
    access.require_project_access(database, user, project_id, request)
    return devices.list_project_devices(database, grant)


@router.post("/projects/{project_id}/devices", response_model=CctvDeviceOut, status_code=201)
def create_project_device(
    payload: CctvDeviceCreate,
    request: Request,
    project_id: ProjectId,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    grant = access.authorize_project(database, user, project_id, request)
    return devices.create_device(database, grant, user, payload, request)


@router.get("/devices/{device_id}", response_model=CctvDeviceOut)
def get_device(
    device_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, _grant = access.load_device(database, user, device_id, request)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.device_out(database, device)


@router.patch("/devices/{device_id}", response_model=CctvDeviceOut)
def update_device(
    device_id: uuid.UUID,
    payload: CctvDeviceUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request, for_update=True)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.update_device(database, grant, device, user, payload, request)


@router.put("/devices/{device_id}/credentials", response_model=CctvDeviceOut)
def replace_device_credentials(
    device_id: uuid.UUID,
    payload: CctvCredentialsInput,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request, for_update=True)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.replace_credentials(database, grant, device, user, payload, request)


@router.delete("/devices/{device_id}", response_model=CctvDeviceDeleted)
def delete_device(
    device_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request, for_update=True)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.delete_device(database, grant, device, user, request)


@router.put("/devices/{device_id}/channels", response_model=CctvDeviceOut)
def replace_device_channels(
    device_id: uuid.UUID,
    payload: CctvChannelsReplace,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request, for_update=True)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.replace_channels(database, grant, device, user, payload, request)


@router.post("/devices/{device_id}/reconnect", response_model=CctvReconnectOut)
def reconnect_device(
    device_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return devices.reconnect_device(database, grant, device, user, request)


@router.post("/devices/{device_id}/verify", response_model=CctvVerifyOut)
def verify_device(
    device_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """ONVIF identity and authentication check. Credential-dependent: 503 while
    the platform JWT secret is the default."""
    device, grant = access.load_device(database, user, device_id, request)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return connectivity.verify_device(database, grant, device, user, request)


@router.post("/devices/{device_id}/channels/discover", response_model=CctvDiscoveryOut)
def discover_device_channels(
    device_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Read the video sources and profiles the device reports. Nothing is saved
    to cctv_channels until the user selects candidates."""
    device, grant = access.load_device(database, user, device_id, request)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return connectivity.discover_channels(database, grant, device, user, request)


@router.put("/devices/{device_id}/channels/discovered", response_model=CctvDeviceOut)
def save_discovered_device_channels(
    device_id: uuid.UUID,
    payload: CctvDiscoveredChannelsSave,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    device, grant = access.load_device(database, user, device_id, request, for_update=True)
    access.require_project_access(database, user, device.project_id, request, device_id=device.id)
    return connectivity.save_discovered_channels(database, grant, device, user, payload, request)


@router.get("/channels/{channel_id}", response_model=CctvChannelOut)
def get_channel(
    channel_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    channel, device, _grant = access.load_channel(database, user, channel_id, request)
    access.require_project_access(
        database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id
    )
    return devices.channel_out(channel)


@router.patch("/channels/{channel_id}", response_model=CctvChannelOut)
def update_channel(
    channel_id: uuid.UUID,
    payload: CctvChannelUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    channel, device, grant = access.load_channel(database, user, channel_id, request, for_update=True)
    access.require_project_access(
        database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id
    )
    return devices.update_channel(database, grant, channel, device, user, payload, request)


@router.get("/channels/{channel_id}/status", response_model=CctvChannelStatusOut)
def get_channel_status(
    channel_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    channel, device, _grant = access.load_channel(database, user, channel_id, request)
    access.require_project_access(
        database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id
    )
    return devices.channel_status(channel, device)


@router.post("/channels/{channel_id}/playback", response_model=CctvPlaybackSessionOut, status_code=201)
def start_channel_playback(
    channel_id: uuid.UUID,
    request: Request,
    payload: CctvPlaybackRequest | None = Body(default=None),
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Open a short-lived live view. The response holds a gateway playback URL
    and a playback token for `Authorization: Bearer`; never a camera address,
    stream path or credential."""
    return playback.create_session(database, user, channel_id, payload or CctvPlaybackRequest(), request)


@router.post("/channels/{channel_id}/recordings/search", response_model=CctvRecordingSearchOut)
def search_channel_recordings(
    channel_id: uuid.UUID,
    payload: CctvRecordingSearchRequest,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Search the DVR's own recordings for a channel inside a local-time window.
    Read-only: it queries the recorder and writes nothing. Returns real recorded
    segments (local time); never a device address, path or credential."""
    channel, device, _grant, segments = recordings.search_recordings(
        database, user, channel_id, payload.start, payload.end, request
    )
    return CctvRecordingSearchOut(
        channel_id=channel.id,
        device_id=device.id,
        project_id=channel.project_id,
        device_status=device.status,
        searched_start=payload.start,
        searched_end=payload.end,
        segments=[
            CctvRecordingSegmentOut(
                start_local=s.start_local, end_local=s.end_local, duration_seconds=s.duration_seconds
            )
            for s in segments
        ],
    )


@router.post("/channels/{channel_id}/recordings/playback", response_model=CctvPlaybackSessionOut, status_code=201)
def start_recorded_playback(
    channel_id: uuid.UUID,
    payload: CctvRecordedPlaybackRequest,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Open a recorded-playback view for an explicit [start, end] window at the
    chosen speed. Same secure session/token model as live: the response holds a
    gateway URL and playback token, never a camera address, path or credential."""
    return playback.create_recorded_session(database, user, channel_id, payload, request)


@router.post("/playback/{session_id}/renew", response_model=CctvPlaybackSessionRenewed)
def renew_playback(
    session_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    """Keep one of your own live views open for another session lifetime.
    Re-checks access to the channel; returns no URL, token or device detail."""
    return playback.renew_session(database, user, session_id, request)


@router.delete("/playback/{session_id}", response_model=CctvPlaybackSessionEnded)
def end_playback(
    session_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_database),
):
    return playback.end_session(database, user, session_id, request)


# The media gateway's authentication callback. It is called by the gateway on
# this machine -- not by browsers -- for every viewer request and for the
# gateway's own control API, so it takes no user JWT and lives outside /cctv.
# The body is read by hand: a validation error must never echo it, because it
# carries the playback token or the gateway API secret.
gateway_router = APIRouter(prefix="/internal/cctv", include_in_schema=False)


@gateway_router.post("/media-gateway/auth")
async def media_gateway_auth(request: Request, background_tasks: BackgroundTasks):
    client_host = request.client.host if request.client else None
    if client_host not in playback.LOOPBACK_CLIENTS:
        return Response(status_code=404)
    try:
        body = await request.json()
    except ValueError:
        body = None
    allowed, stale_paths = await run_in_threadpool(playback.gateway_authorization, body, client_host)
    for gateway_path in stale_paths:
        background_tasks.add_task(playback.remove_gateway_path_quietly, gateway_path)
    return Response(status_code=200 if allowed else 401)
