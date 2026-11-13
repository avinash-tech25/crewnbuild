"""Manual camera device and channel management.

Every function here is handed a CctvGrant produced by access.py for the project
stored on the row being touched, so none of them decides authorization itself.
Writes go only to the five CCTV tables. ONVIF verification and channel discovery
live in connectivity.py and live playback sessions in playback.py. A device's host, ports and ONVIF service path are never returned.
"""

import threading
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from datetime import UTC, datetime

from fastapi import HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.cctv.models import CctvChannel, CctvDevice, CctvDeviceCredential
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.runtime import settings
from app.modules.cctv.schemas import (
    CctvChannelInput,
    CctvChannelOut,
    CctvChannelsReplace,
    CctvChannelStatusOut,
    CctvChannelUpdate,
    CctvCredentialsInput,
    CctvDeviceCreate,
    CctvDeviceDeleted,
    CctvDeviceOut,
    CctvDeviceUpdate,
    CctvProjectOut,
    CctvReconnectOut,
)
from app.modules.cctv.services import audit, cctv_error, field_error, media_gateway, network_policy
from app.modules.cctv.services import credentials as credential_service
from app.modules.cctv.services.access import CctvGrant, accessible_project_rows
from app.modules.identity.models import User

BROWSER_COMPATIBLE_CODECS = frozenset({"H264"})
CODE_GATEWAY_NOT_CONFIGURED = "CCTV_MEDIA_GATEWAY_NOT_CONFIGURED"
CODE_DEVICE_INACTIVE = "CCTV_DEVICE_INACTIVE"
CODE_CHANNEL_DISABLED = "CCTV_CHANNEL_DISABLED"
CODE_DEVICE_NOT_ONLINE = "CCTV_DEVICE_NOT_ONLINE"
CODE_STREAM_NOT_CONFIGURED = "CCTV_STREAM_NOT_CONFIGURED"

# Changing any of these means the last connection result no longer describes the device.
CONNECTION_FIELDS = frozenset(
    {"host", "rtsp_port", "onvif_port", "onvif_use_tls", "onvif_service_path", "connection_method"}
)
# The explicit result codes an ONVIF verification writes as the first token of
# status_detail ("CODE: message"). The status column itself only accepts its
# own vocabulary, so the code is carried here without a schema change.
VERIFICATION_RESULT_CODES = frozenset(
    {
        "NETWORK_UNREACHABLE",
        "SERVICE_UNREACHABLE",
        "AUTHENTICATION_FAILED",
        "DEVICE_PROTOCOL_ERROR",
        "DEVICE_VERIFIED",
        "UNSUPPORTED_PROTOCOL",
        "AUTHENTICATION_NOT_ENFORCED",
        "DEVICE_IDENTITY_MISMATCH",
    }
)


def last_verification_result(device: CctvDevice) -> str | None:
    code = (device.status_detail or "").split(":", 1)[0].strip()
    return code if code in VERIFICATION_RESULT_CODES else None


# Changing any of these means the channel's last status no longer describes it.
STREAM_FIELDS = frozenset({"main_stream_path", "sub_stream_path", "main_codec", "sub_codec", "preferred_stream"})


def utc_now() -> datetime:
    return datetime.now(UTC)


def media_gateway_configured() -> bool:
    """Whether live playback can be offered: the gateway's loopback control API,
    its secret and at least one browser transport URL are configured."""
    return media_gateway.configured()


# --- validation --------------------------------------------------------------


def clean_text(value: str | None, field: str, max_length: int, *, required: bool) -> str | None:
    text = (value or "").strip()
    if not text:
        if required:
            raise field_error(field, "This field is required.")
        return None
    if len(text) > max_length:
        raise field_error(field, f"Must be at most {max_length} characters.")
    if any(unicodedata.category(character) in ("Cc", "Cf") for character in text):
        raise field_error(field, "Contains characters that are not allowed.")
    return text


def _channel_values(channel: CctvChannelInput, prefix: str) -> dict:
    values = {
        "channel_number": channel.channel_number,
        "name": clean_text(channel.name, f"{prefix}name", 120, required=True),
        "location_label": clean_text(channel.location_label, f"{prefix}location_label", 160, required=False),
        "main_stream_path": network_policy.validate_stream_path(channel.main_stream_path, f"{prefix}main_stream_path"),
        "sub_stream_path": network_policy.validate_stream_path(channel.sub_stream_path, f"{prefix}sub_stream_path"),
        "main_codec": channel.main_codec,
        "sub_codec": channel.sub_codec,
        "main_width": channel.main_width,
        "main_height": channel.main_height,
        "sub_width": channel.sub_width,
        "sub_height": channel.sub_height,
        "preferred_stream": channel.preferred_stream,
        "is_enabled": channel.is_enabled,
        "display_order": channel.display_order,
    }
    _check_channel_consistency(values, prefix)
    return values


def _check_channel_consistency(values: dict, prefix: str) -> None:
    if not values["is_enabled"]:
        return
    if not values["main_stream_path"] and not values["sub_stream_path"]:
        raise field_error(f"{prefix}main_stream_path", "An enabled channel needs a main or sub stream path.")
    preferred_path = values["main_stream_path"] if values["preferred_stream"] == "MAIN" else values["sub_stream_path"]
    if not preferred_path:
        raise field_error(f"{prefix}preferred_stream", "The preferred stream has no stream path.")


def _validated_channel_inputs(channels: list[CctvChannelInput], prefix: str) -> list[dict]:
    seen: set[int] = set()
    results = []
    for index, channel in enumerate(channels):
        item_prefix = f"{prefix}{index}."
        if channel.channel_number in seen:
            raise field_error(f"{item_prefix}channel_number", "Each channel number may appear only once.")
        seen.add(channel.channel_number)
        results.append(_channel_values(channel, item_prefix))
    return results


# --- serialization -----------------------------------------------------------


def channel_out(channel: CctvChannel) -> CctvChannelOut:
    return CctvChannelOut(
        id=channel.id,
        device_id=channel.device_id,
        project_id=channel.project_id,
        channel_number=channel.channel_number,
        name=channel.name,
        location_label=channel.location_label,
        has_main_stream=bool(channel.main_stream_path),
        has_sub_stream=bool(channel.sub_stream_path),
        main_codec=channel.main_codec,
        sub_codec=channel.sub_codec,
        main_width=channel.main_width,
        main_height=channel.main_height,
        sub_width=channel.sub_width,
        sub_height=channel.sub_height,
        preferred_stream=channel.preferred_stream,
        status=channel.status,
        status_detail=channel.status_detail,
        last_checked_at=channel.last_checked_at,
        is_enabled=channel.is_enabled,
        display_order=channel.display_order,
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


def _credential_summaries(database: Session, device_ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime | None]:
    """Which devices have credentials, and when they last verified. Selects the
    two columns only, so ciphertext is never even loaded."""
    if not device_ids:
        return {}
    rows = CctvRepository(database).list_credential_summaries(device_ids)
    return {row.device_id: row.last_verified_at for row in rows}


def _channels_for(database: Session, device_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[CctvChannel]]:
    grouped: dict[uuid.UUID, list[CctvChannel]] = defaultdict(list)
    if not device_ids:
        return grouped
    rows = CctvRepository(database).iter_channels_for_devices(device_ids)
    for channel in rows:
        grouped[channel.device_id].append(channel)
    return grouped


def _device_out(device: CctvDevice, channels: list[CctvChannel], credential_summaries: dict) -> CctvDeviceOut:
    return CctvDeviceOut(
        id=device.id,
        project_id=device.project_id,
        name=device.name,
        device_type=device.device_type,
        manufacturer=device.manufacturer,
        model=device.model,
        firmware_version=device.firmware_version,
        serial_number=device.serial_number,
        connection_method=device.connection_method,
        onvif_configured=device.connection_method == "ONVIF" and device.onvif_port is not None,
        status=device.status,
        status_detail=device.status_detail,
        last_verification_result=last_verification_result(device),
        last_checked_at=device.last_checked_at,
        last_online_at=device.last_online_at,
        is_active=device.is_active,
        has_credentials=device.id in credential_summaries,
        credentials_last_verified_at=credential_summaries.get(device.id),
        channel_count=len(channels),
        channels=[channel_out(channel) for channel in channels],
        created_at=device.created_at,
        updated_at=device.updated_at,
    )


def device_out(database: Session, device: CctvDevice) -> CctvDeviceOut:
    return _device_out(
        device,
        _channels_for(database, [device.id]).get(device.id, []),
        _credential_summaries(database, [device.id]),
    )


# --- queries -----------------------------------------------------------------


def list_projects(database: Session, user: User, request: Request) -> list[CctvProjectOut]:
    repository = CctvRepository(database)
    projects = accessible_project_rows(database, user, request)
    project_ids = [project.id for project, _ in projects]
    device_counts: dict[int, int] = {}
    channel_counts: dict[int, tuple[int, int]] = {}
    if project_ids:
        for project_id, count in repository.list_device_counts(project_ids):
            device_counts[project_id] = count
        for project_id, total, enabled in repository.list_channel_counts(project_ids):
            channel_counts[project_id] = (total, enabled)
    return [
        CctvProjectOut(
            project_id=project.id,
            title=project.title,
            construction_type=project.construction_type,
            access_basis=basis,
            device_count=device_counts.get(project.id, 0),
            channel_count=channel_counts.get(project.id, (0, 0))[0],
            enabled_channel_count=channel_counts.get(project.id, (0, 0))[1],
        )
        for project, basis in projects
    ]


def list_project_devices(database: Session, grant: CctvGrant) -> list[CctvDeviceOut]:
    devices = CctvRepository(database).list_project_devices(grant.project.id)
    device_ids = [device.id for device in devices]
    channels = _channels_for(database, device_ids)
    summaries = _credential_summaries(database, device_ids)
    return [_device_out(device, channels.get(device.id, []), summaries) for device in devices]


def _duplicate_device_exists(
    database: Session, project_id: uuid.UUID, host: str, rtsp_port: int, exclude_id: uuid.UUID | None = None
) -> bool:
    return CctvRepository(database).exists_duplicate_device(project_id, host, rtsp_port, exclude_id)


def _duplicate_error():
    return cctv_error(
        status.HTTP_409_CONFLICT,
        "CCTV_DEVICE_ALREADY_EXISTS",
        "A device with this address and RTSP port is already registered on this project.",
    )


def _commit(database: Session) -> None:
    repository = CctvRepository(database)
    try:
        repository.commit()
    except IntegrityError:
        repository.rollback()
        # A concurrent request won the race for a unique value, or a check
        # constraint caught something validation did not. The database message
        # is not passed on: it quotes the offending values.
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_CONFLICT",
            "The change conflicts with the current camera configuration. Reload and try again.",
        ) from None


# --- devices -----------------------------------------------------------------


def create_device(
    database: Session, grant: CctvGrant, user: User, payload: CctvDeviceCreate, request: Request
) -> CctvDeviceOut:
    repository = CctvRepository(database)
    name = clean_text(payload.name, "name", 120, required=True)
    host = network_policy.validate_device_host(payload.host, "host")
    rtsp_port = network_policy.validate_port(payload.rtsp_port, "rtsp_port")
    onvif_port = network_policy.validate_port(payload.onvif_port, "onvif_port", required=False)
    onvif_service_path = network_policy.validate_service_path(payload.onvif_service_path, "onvif_service_path")
    if payload.connection_method == "ONVIF" and onvif_port is None:
        raise field_error("onvif_port", "An ONVIF device needs its ONVIF port.")
    channel_values = _validated_channel_inputs(payload.channels, "channels.")
    encrypted = None
    if payload.credentials is not None:
        encrypted = credential_service.encrypt_credentials(
            payload.credentials.username, payload.credentials.password, field_prefix="credentials."
        )
    if _duplicate_device_exists(database, grant.project.id, host, rtsp_port):
        raise _duplicate_error()

    device = CctvDevice(
        project_id=grant.project.id,
        name=name,
        device_type=payload.device_type,
        manufacturer=clean_text(payload.manufacturer, "manufacturer", 120, required=False),
        model=clean_text(payload.model, "model", 120, required=False),
        firmware_version=clean_text(payload.firmware_version, "firmware_version", 120, required=False),
        serial_number=clean_text(payload.serial_number, "serial_number", 120, required=False),
        host=host,
        rtsp_port=rtsp_port,
        onvif_port=onvif_port,
        onvif_use_tls=payload.onvif_use_tls,
        onvif_service_path=onvif_service_path,
        connection_method=payload.connection_method,
        status="UNKNOWN",
        is_active=payload.is_active,
        created_by_user_id=user.id,
    )
    repository.add(device)
    repository.flush()
    if encrypted is not None:
        repository.add(
            CctvDeviceCredential(
                device_id=device.id,
                username_ciphertext=encrypted.username_ciphertext,
                password_ciphertext=encrypted.password_ciphertext,
                encryption_scheme=credential_service.ENCRYPTION_SCHEME,
                key_version=encrypted.key_version,
                created_by_user_id=user.id,
            )
        )
    for values in channel_values:
        repository.add(
            CctvChannel(device_id=device.id, project_id=device.project_id, created_by_user_id=user.id, **values)
        )

    audit.record(
        database,
        action=audit.ACTION_DEVICE_CREATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"channel_count": len(channel_values)},
    )
    if encrypted is not None:
        audit.record(
            database,
            action=audit.ACTION_CREDENTIALS_UPDATED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=user,
            request=request,
            project_id=device.project_id,
            device_id=device.id,
            detail={"replaced": False},
        )
    if channel_values:
        audit.record(
            database,
            action=audit.ACTION_CHANNELS_SAVED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=user,
            request=request,
            project_id=device.project_id,
            device_id=device.id,
            detail={"created": len(channel_values), "updated": 0, "removed": 0},
        )
    _commit(database)
    repository.refresh(device)
    return device_out(database, device)


def update_device(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, payload: CctvDeviceUpdate, request: Request
) -> CctvDeviceOut:
    repository = CctvRepository(database)
    submitted = payload.model_fields_set
    changes: dict = {}
    for field in ("name",):
        if field in submitted:
            changes[field] = clean_text(getattr(payload, field), field, 120, required=True)
    for field in ("manufacturer", "model", "firmware_version", "serial_number"):
        if field in submitted:
            changes[field] = clean_text(getattr(payload, field), field, 120, required=False)
    if "device_type" in submitted:
        if payload.device_type is None:
            raise field_error("device_type", "This field is required.")
        changes["device_type"] = payload.device_type
    if "host" in submitted:
        changes["host"] = network_policy.validate_device_host(payload.host, "host")
    if "rtsp_port" in submitted:
        changes["rtsp_port"] = network_policy.validate_port(payload.rtsp_port, "rtsp_port")
    if "onvif_port" in submitted:
        changes["onvif_port"] = network_policy.validate_port(payload.onvif_port, "onvif_port", required=False)
    if "onvif_service_path" in submitted:
        changes["onvif_service_path"] = network_policy.validate_service_path(
            payload.onvif_service_path, "onvif_service_path"
        )
    for field in ("connection_method", "onvif_use_tls", "is_active"):
        if field in submitted:
            if getattr(payload, field) is None:
                raise field_error(field, "This field is required.")
            changes[field] = getattr(payload, field)

    changed = sorted(field for field, value in changes.items() if getattr(device, field) != value)
    if not changed:
        return device_out(database, device)
    if (
        changes.get("connection_method", device.connection_method) == "ONVIF"
        and changes.get("onvif_port", device.onvif_port) is None
    ):
        raise field_error("onvif_port", "An ONVIF device needs its ONVIF port.")
    new_host = changes.get("host", device.host)
    new_port = changes.get("rtsp_port", device.rtsp_port)
    if ({"host", "rtsp_port"} & set(changed)) and _duplicate_device_exists(
        database, device.project_id, new_host, new_port, exclude_id=device.id
    ):
        raise _duplicate_error()

    for field in changed:
        setattr(device, field, changes[field])
    if CONNECTION_FIELDS & set(changed):
        device.status = "UNKNOWN"
        device.status_detail = None
        device.last_checked_at = None
        repository.update_credentials_unverified(device.id)
    device.updated_by_user_id = user.id
    audit.record(
        database,
        action=audit.ACTION_DEVICE_UPDATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"changed_fields": changed},
    )
    _commit(database)
    repository.refresh(device)
    return device_out(database, device)


def replace_credentials(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, payload: CctvCredentialsInput, request: Request
) -> CctvDeviceOut:
    repository = CctvRepository(database)
    encrypted = credential_service.encrypt_credentials(payload.username, payload.password)
    existing = repository.lock_device_credential(device.id)
    if existing is None:
        repository.add(
            CctvDeviceCredential(
                device_id=device.id,
                username_ciphertext=encrypted.username_ciphertext,
                password_ciphertext=encrypted.password_ciphertext,
                encryption_scheme=credential_service.ENCRYPTION_SCHEME,
                key_version=encrypted.key_version,
                created_by_user_id=user.id,
            )
        )
    else:
        existing.username_ciphertext = encrypted.username_ciphertext
        existing.password_ciphertext = encrypted.password_ciphertext
        existing.encryption_scheme = credential_service.ENCRYPTION_SCHEME
        existing.key_version = encrypted.key_version
        existing.last_verified_at = None
        existing.updated_by_user_id = user.id
    if device.status == "AUTH_FAILED":
        device.status = "UNKNOWN"
        device.status_detail = None
    device.updated_by_user_id = user.id
    audit.record(
        database,
        action=audit.ACTION_CREDENTIALS_UPDATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"replaced": existing is not None},
    )
    _commit(database)
    repository.refresh(device)
    return device_out(database, device)


def delete_device(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, request: Request
) -> CctvDeviceDeleted:
    repository = CctvRepository(database)
    device_id, project_id = device.id, device.project_id
    channel_count = repository.count_device_channels(device_id)
    # The audit row has no foreign key, so it survives the delete it records.
    audit.record(
        database,
        action=audit.ACTION_DEVICE_DELETED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=project_id,
        device_id=device_id,
        detail={"channel_count": channel_count},
    )
    repository.expunge(device)
    # Credentials, channels and playback sessions go with it through the
    # CCTV-to-CCTV ON DELETE CASCADE foreign keys.
    repository.delete_device(device_id, project_id)
    _commit(database)
    return CctvDeviceDeleted(deleted=True, device_id=device_id)


# --- channels ----------------------------------------------------------------


def replace_channels(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, payload: CctvChannelsReplace, request: Request
) -> CctvDeviceOut:
    repository = CctvRepository(database)
    wanted = {values["channel_number"]: values for values in _validated_channel_inputs(payload.channels, "channels.")}
    existing = {channel.channel_number: channel for channel in repository.iter_locked_device_channels(device.id)}
    created = updated = 0
    removed_ids = [channel.id for number, channel in existing.items() if number not in wanted]
    for number, values in wanted.items():
        channel = existing.get(number)
        if channel is None:
            repository.add(
                CctvChannel(device_id=device.id, project_id=device.project_id, created_by_user_id=user.id, **values)
            )
            created += 1
            continue
        changed = [field for field, value in values.items() if getattr(channel, field) != value]
        if not changed:
            continue
        for field in changed:
            setattr(channel, field, values[field])
        if STREAM_FIELDS & set(changed):
            channel.status = "UNKNOWN"
            channel.status_detail = None
            channel.last_checked_at = None
        channel.updated_by_user_id = user.id
        updated += 1
    if removed_ids:
        for number in [number for number in existing if number not in wanted]:
            repository.expunge(existing[number])
        repository.delete_channels(removed_ids, device.id)
    if created or updated or removed_ids:
        device.updated_by_user_id = user.id
        audit.record(
            database,
            action=audit.ACTION_CHANNELS_SAVED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=user,
            request=request,
            project_id=device.project_id,
            device_id=device.id,
            detail={"created": created, "updated": updated, "removed": len(removed_ids)},
        )
        _commit(database)
        repository.refresh(device)
    return device_out(database, device)


def update_channel(
    database: Session,
    grant: CctvGrant,
    channel: CctvChannel,
    device: CctvDevice,
    user: User,
    payload: CctvChannelUpdate,
    request: Request,
) -> CctvChannelOut:
    submitted = payload.model_fields_set
    changes: dict = {}
    if "name" in submitted:
        changes["name"] = clean_text(payload.name, "name", 120, required=True)
    if "location_label" in submitted:
        changes["location_label"] = clean_text(payload.location_label, "location_label", 160, required=False)
    for field in ("main_stream_path", "sub_stream_path"):
        if field in submitted:
            changes[field] = network_policy.validate_stream_path(getattr(payload, field), field)
    for field in ("main_codec", "sub_codec", "main_width", "main_height", "sub_width", "sub_height"):
        if field in submitted:
            changes[field] = getattr(payload, field)
    for field in ("preferred_stream", "is_enabled", "display_order"):
        if field in submitted:
            if getattr(payload, field) is None:
                raise field_error(field, "This field is required.")
            changes[field] = getattr(payload, field)

    changed = sorted(field for field, value in changes.items() if getattr(channel, field) != value)
    if not changed:
        return channel_out(channel)
    merged = {
        "main_stream_path": changes.get("main_stream_path", channel.main_stream_path),
        "sub_stream_path": changes.get("sub_stream_path", channel.sub_stream_path),
        "preferred_stream": changes.get("preferred_stream", channel.preferred_stream),
        "is_enabled": changes.get("is_enabled", channel.is_enabled),
    }
    _check_channel_consistency(merged, "")
    for field in changed:
        setattr(channel, field, changes[field])
    if STREAM_FIELDS & set(changed):
        channel.status = "UNKNOWN"
        channel.status_detail = None
        channel.last_checked_at = None
    channel.updated_by_user_id = user.id
    audit.record(
        database,
        action=audit.ACTION_CHANNEL_UPDATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=channel.project_id,
        device_id=device.id,
        channel_id=channel.id,
        detail={"changed_fields": changed},
    )
    _commit(database)
    CctvRepository(database).refresh(channel)
    return channel_out(channel)


def channel_status(channel: CctvChannel, device: CctvDevice) -> CctvChannelStatusOut:
    preferred_path = channel.main_stream_path if channel.preferred_stream == "MAIN" else channel.sub_stream_path
    preferred_codec = channel.main_codec if channel.preferred_stream == "MAIN" else channel.sub_codec
    if not device.is_active:
        unavailable = CODE_DEVICE_INACTIVE
    elif not channel.is_enabled:
        unavailable = CODE_CHANNEL_DISABLED
    elif not media_gateway_configured():
        unavailable = CODE_GATEWAY_NOT_CONFIGURED
    elif device.status != "ONLINE":
        unavailable = CODE_DEVICE_NOT_ONLINE
    elif not preferred_path:
        unavailable = CODE_STREAM_NOT_CONFIGURED
    else:
        unavailable = None
    return CctvChannelStatusOut(
        channel_id=channel.id,
        device_id=device.id,
        project_id=channel.project_id,
        channel_status=channel.status,
        channel_status_detail=channel.status_detail,
        channel_last_checked_at=channel.last_checked_at,
        channel_enabled=channel.is_enabled,
        device_status=device.status,
        device_status_detail=device.status_detail,
        device_last_checked_at=device.last_checked_at,
        device_active=device.is_active,
        preferred_stream=channel.preferred_stream,
        preferred_stream_configured=bool(preferred_path),
        preferred_codec=preferred_codec,
        browser_compatible_codec=None if preferred_codec is None else preferred_codec in BROWSER_COMPATIBLE_CODECS,
        playback_available=unavailable is None,
        playback_unavailable_code=unavailable,
    )


# --- reconnect ---------------------------------------------------------------

_reconnect_lock = threading.Lock()
_reconnect_by_device: dict[uuid.UUID, float] = {}
_reconnect_by_user: dict[uuid.UUID, deque] = defaultdict(deque)


def _reserve_reconnect(user: User, device_id: uuid.UUID) -> None:
    """Rate-limit reconnects so they cannot be used to sweep a network's ports."""
    now = time.monotonic()
    with _reconnect_lock:
        last = _reconnect_by_device.get(device_id)
        if last is not None and now - last < max(0, settings.cctv_reconnect_min_interval_seconds):
            raise cctv_error(
                status.HTTP_429_TOO_MANY_REQUESTS, "CCTV_RATE_LIMITED", "Please wait before checking this device again."
            )
        history = _reconnect_by_user[user.id]
        while history and now - history[0] > 60:
            history.popleft()
        if len(history) >= max(1, settings.cctv_reconnect_max_per_minute):
            raise cctv_error(
                status.HTTP_429_TOO_MANY_REQUESTS, "CCTV_RATE_LIMITED", "Too many device checks. Please wait a minute."
            )
        history.append(now)
        _reconnect_by_device[device_id] = now


def reconnect_device(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, request: Request
) -> CctvReconnectOut:
    if not device.is_active:
        raise cctv_error(
            status.HTTP_409_CONFLICT, CODE_DEVICE_INACTIVE, "This device is inactive. Activate it before checking it."
        )
    _reserve_reconnect(user, device.id)
    device_id, project_id = device.id, device.project_id

    # The stored address is checked again under the current policy: a device
    # saved before the policy was tightened must not be contacted.
    try:
        host = network_policy.validate_device_host(device.host, "host")
    except HTTPException as policy_error:
        if policy_error.status_code >= 500:
            # The policy itself is unreadable: a server problem, not a device fault.
            raise
        device.status = "ERROR"
        device.status_detail = "The device address is not permitted by the current network policy."
        device.last_checked_at = utc_now()
        audit.record(
            database,
            action=audit.ACTION_RECONNECT_CHECKED,
            outcome=audit.OUTCOME_FAILED,
            actor=user,
            request=request,
            project_id=project_id,
            device_id=device_id,
            detail={"reason": "NETWORK_POLICY_REJECTED", "camera_verified": False},
        )
        _commit(database)
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_NETWORK_POLICY_REJECTED",
            "The device address is not permitted by the current network policy.",
        ) from policy_error

    timeout = max(0.5, min(float(settings.cctv_connect_timeout_seconds), 10.0))
    rtsp_reachable = network_policy.tcp_port_reachable(host, device.rtsp_port, timeout)
    onvif_reachable = network_policy.tcp_port_reachable(host, device.onvif_port, timeout) if device.onvif_port else None
    checked_at = utc_now()

    if rtsp_reachable:
        # Deliberately not ONLINE: no camera has answered and no credential has
        # been tried. The status stays UNKNOWN and says exactly what was checked.
        device.status = "UNKNOWN"
        device.status_detail = (
            "RTSP port accepted a TCP connection. Camera sign-in and video were not verified "
            "(ONVIF and the media gateway are not configured)."
        )
    else:
        device.status = "UNREACHABLE"
        device.status_detail = f"RTSP port did not accept a TCP connection within {timeout:g} seconds."
    device.last_checked_at = checked_at
    audit.record(
        database,
        action=audit.ACTION_RECONNECT_CHECKED,
        outcome=audit.OUTCOME_SUCCESS if rtsp_reachable else audit.OUTCOME_FAILED,
        actor=user,
        request=request,
        project_id=project_id,
        device_id=device_id,
        detail={
            "check": "TCP_PORT_REACHABILITY",
            "rtsp_port_reachable": rtsp_reachable,
            "onvif_port_reachable": onvif_reachable,
            "camera_verified": False,
        },
    )
    _commit(database)
    CctvRepository(database).refresh(device)
    return CctvReconnectOut(
        device_id=device.id,
        check="TCP_PORT_REACHABILITY",
        camera_verified=False,
        rtsp_port_reachable=rtsp_reachable,
        onvif_port_reachable=onvif_reachable,
        device_status=device.status,
        status_detail=device.status_detail,
        checked_at=checked_at,
        playback_available=False,
        playback_unavailable_code=CODE_GATEWAY_NOT_CONFIGURED,
    )
