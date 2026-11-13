"""ONVIF device verification and controlled channel discovery.

    verify_device             is this the device, does it speak ONVIF, do the
                              stored credentials work, is authentication enforced
    discover_channels         which video sources and media profiles the device
                              actually reports; stream locations kept server-side
    save_discovered_channels  store the channels the user picked from that list

Every operation here is credential-dependent, so each starts with the JWT gate:
while the platform JWT secret is the default, nothing is decrypted and no
network traffic is sent. Every device address is re-checked against the CCTV
network policy immediately before use; there is no scanning of any kind.

What is persisted, and where:
    cctv_devices              status (its own vocabulary), status_detail starting
                              with the explicit result code, timestamps, and the
                              identity the device reports
    cctv_device_credentials   last_verified_at, only on DEVICE_VERIFIED
    cctv_channels             only channels the user selects from a discovery
    cctv_audit_events         every attempt and its result code

Never persisted or returned: credentials, device host, ports, ONVIF endpoints,
stream URIs. Stream PATHS are stored server-side after network-policy checks and
are never returned. Nothing here claims a channel or a video stream works.
"""

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.modules.cctv.models import CctvChannel, CctvDevice, CctvDeviceCredential
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.runtime import settings
from app.modules.cctv.schemas import (
    CctvDeviceOut,
    CctvDiscoveredChannelOut,
    CctvDiscoveredChannelsSave,
    CctvDiscoveredStreamOut,
    CctvDiscoveryOut,
    CctvVerifyOut,
)
from app.modules.cctv.services import audit, cctv_error, devices, field_error, network_policy, rate_limits
from app.modules.cctv.services import credentials as credential_service
from app.modules.cctv.services import onvif_client as onvif
from app.modules.cctv.services.access import CctvGrant
from app.modules.identity.models import User

DISCOVERY_TTL_SECONDS = 600
MAX_DISCOVERIES_PER_USER = 5
MAX_DISCOVERIES_TOTAL = 200
DISCOVERY_DEADLINE_SECONDS = 90.0
RTSP_SCHEMES = ("rtsp",)
# RFC 2326 default port for an rtsp:// URI that does not name one. Used only to
# interpret a URI the device returned, never as a device setting.
RTSP_URI_DEFAULT_PORT = 554

# Result code -> the nearest value the cctv_devices.status CHECK constraint allows.
STATUS_FOR_RESULT = {
    onvif.RESULT_DEVICE_VERIFIED: "ONLINE",
    onvif.RESULT_AUTHENTICATION_NOT_ENFORCED: "UNKNOWN",
    onvif.RESULT_AUTHENTICATION_FAILED: "AUTH_FAILED",
    onvif.RESULT_NETWORK_UNREACHABLE: "UNREACHABLE",
    onvif.RESULT_SERVICE_UNREACHABLE: "OFFLINE",
    onvif.RESULT_DEVICE_PROTOCOL_ERROR: "ERROR",
    onvif.RESULT_UNSUPPORTED_PROTOCOL: "ERROR",
    onvif.RESULT_DEVICE_IDENTITY_MISMATCH: "ERROR",
}
MESSAGE_FOR_RESULT = {
    onvif.RESULT_DEVICE_VERIFIED: "ONVIF device answered, refused anonymous access and accepted the stored credentials. No video stream has been verified.",
    onvif.RESULT_AUTHENTICATION_NOT_ENFORCED: "ONVIF device answered, but also answered without credentials, so the stored credentials are not proven.",
    onvif.RESULT_AUTHENTICATION_FAILED: "The device refused the stored credentials.",
    onvif.RESULT_NETWORK_UNREACHABLE: "The device address did not answer on the network.",
    onvif.RESULT_SERVICE_UNREACHABLE: "The device answered on the network but its ONVIF service port refused the connection.",
    onvif.RESULT_DEVICE_PROTOCOL_ERROR: "The device's ONVIF service returned a response that could not be used.",
    onvif.RESULT_UNSUPPORTED_PROTOCOL: "The device does not provide the ONVIF operations this version supports.",
    onvif.RESULT_DEVICE_IDENTITY_MISMATCH: "The device reports a different serial number than the one on record.",
}
CODE_GATEWAY_NOT_CONFIGURED = devices.CODE_GATEWAY_NOT_CONFIGURED


def utc_now() -> datetime:
    return datetime.now(UTC)


# --- preflight ---------------------------------------------------------------


@dataclass
class ConnectionContext:
    host: str
    credential_row: CctvDeviceCredential
    service_path: str


def _prepare(database: Session, device: CctvDevice, user: User, request: Request, action: str) -> ConnectionContext:
    """Every check that must pass before a single packet is sent."""
    # 1. The JWT gate: credential-dependent operations fail closed.
    credential_service.ensure_credentials_may_be_used()
    # 2. Configuration.
    if not device.is_active:
        raise cctv_error(
            status.HTTP_409_CONFLICT, devices.CODE_DEVICE_INACTIVE, "This device is inactive. Activate it first."
        )
    if device.connection_method != "ONVIF" or device.onvif_port is None:
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_ONVIF_NOT_CONFIGURED",
            "This device is not set up for ONVIF (connection method and ONVIF port).",
        )
    credential_row = CctvRepository(database).find_device_credential(device.id)
    if credential_row is None:
        raise cctv_error(
            status.HTTP_409_CONFLICT, "CCTV_CREDENTIALS_MISSING", "Store the device credentials before verifying it."
        )
    # 3. The existing rate limit, shared with reconnect.
    rate_limits.reserve_device_check(database, device.id, user.id)
    # 4. The stored address and service path, under the current policy.
    try:
        host = network_policy.validate_device_host(device.host, "host")
        network_policy.validate_port(device.onvif_port, "onvif_port")
        service_path = (
            network_policy.validate_service_path(device.onvif_service_path, "onvif_service_path")
            or onvif.DEFAULT_DEVICE_SERVICE_PATH
        )
    except HTTPException as policy_error:
        if policy_error.status_code >= 500:
            raise
        device.status = "ERROR"
        device.status_detail = "The device address is not permitted by the current network policy."
        device.last_checked_at = utc_now()
        audit.record(
            database,
            action=action,
            outcome=audit.OUTCOME_FAILED,
            actor=user,
            request=request,
            project_id=device.project_id,
            device_id=device.id,
            detail={"reason": "NETWORK_POLICY_REJECTED"},
        )
        devices._commit(database)
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_NETWORK_POLICY_REJECTED",
            "The device address is not permitted by the current network policy.",
        ) from policy_error
    return ConnectionContext(host=host, credential_row=credential_row, service_path=service_path)


def _classify_unreachable(host: str, onvif_port: int, rtsp_port: int, timeout: float) -> onvif.OnvifFailure | None:
    """TCP-level classification before any HTTP: nothing is sent or read."""
    probe = network_policy.tcp_probe(host, onvif_port, timeout)
    if probe == network_policy.TCP_OPEN:
        return None
    if probe == network_policy.TCP_REFUSED:
        return onvif.OnvifFailure(onvif.RESULT_SERVICE_UNREACHABLE, "ONVIF_PORT_REFUSED")
    # Nothing answered on the ONVIF port. If the RTSP port answers at all (open
    # or refused), the host is up and only the ONVIF service is missing.
    if rtsp_port != onvif_port and network_policy.tcp_probe(host, rtsp_port, timeout) in (
        network_policy.TCP_OPEN,
        network_policy.TCP_REFUSED,
    ):
        return onvif.OnvifFailure(onvif.RESULT_SERVICE_UNREACHABLE, "ONVIF_PORT_NO_ANSWER")
    return onvif.OnvifFailure(onvif.RESULT_NETWORK_UNREACHABLE, "HOST_NO_ANSWER")


def _timeout() -> float:
    return max(0.5, min(float(settings.cctv_connect_timeout_seconds), 10.0))


@dataclass
class VerificationOutcome:
    result: str
    reason: str | None
    authentication_enforced: bool | None = None
    information: onvif.DeviceInformation | None = None
    media_service_available: bool = False


def _authenticate_and_identify(client: onvif.OnvifClient, device: CctvDevice) -> VerificationOutcome:
    """Clock, anonymous probe, authenticated identity, Media service. Raises OnvifFailure."""
    client.sync_clock()
    # An operation that requires authentication, sent WITHOUT credentials. A
    # device that answers it proves nothing about the stored credentials.
    anonymous_answered = False
    try:
        client.get_device_information(authenticated=False)
        anonymous_answered = True
    except onvif.OnvifFailure as failure:
        if failure.result != onvif.RESULT_AUTHENTICATION_FAILED:
            raise
    information = client.get_device_information(authenticated=True)
    if device.serial_number and information.serial_number and device.serial_number != information.serial_number:
        return VerificationOutcome(
            onvif.RESULT_DEVICE_IDENTITY_MISMATCH, "SERIAL_NUMBER_DIFFERS", not anonymous_answered, information
        )
    client.locate_media_service()
    result = onvif.RESULT_AUTHENTICATION_NOT_ENFORCED if anonymous_answered else onvif.RESULT_DEVICE_VERIFIED
    return VerificationOutcome(result, None, not anonymous_answered, information, True)


def _apply_outcome(
    database: Session,
    device: CctvDevice,
    credential_row: CctvDeviceCredential,
    outcome: VerificationOutcome,
    checked_at: datetime,
) -> None:
    device.status = STATUS_FOR_RESULT[outcome.result]
    device.status_detail = f"{outcome.result}: {MESSAGE_FOR_RESULT[outcome.result]}"[:255]
    device.last_checked_at = checked_at
    if outcome.result == onvif.RESULT_DEVICE_VERIFIED:
        device.last_online_at = checked_at
        credential_row.last_verified_at = checked_at
    else:
        credential_row.last_verified_at = None
    information = outcome.information
    if information is not None and outcome.result in (
        onvif.RESULT_DEVICE_VERIFIED,
        onvif.RESULT_AUTHENTICATION_NOT_ENFORCED,
    ):
        # Identity is taken from the device itself. The serial number is pinned
        # on first sight; a later mismatch is reported, never overwritten.
        for field_name in ("manufacturer", "model", "firmware_version"):
            value = getattr(information, field_name)
            if value:
                setattr(device, field_name, devices.clean_text(value, field_name, 120, required=False))
        if information.serial_number and not device.serial_number:
            device.serial_number = devices.clean_text(information.serial_number, "serial_number", 120, required=False)


def _client(
    context: ConnectionContext, device: CctvDevice, plain: credential_service.PlainCredentials, transport=None
) -> onvif.OnvifClient:
    return onvif.OnvifClient(
        host=context.host,
        port=device.onvif_port,
        use_tls=device.onvif_use_tls,
        device_service_path=context.service_path,
        credentials=plain,
        connect_timeout=_timeout(),
        transport=transport,
    )


# Tests inject an httpx.MockTransport here; production leaves it None.
_transport_factory = None


def verify_device(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, request: Request
) -> CctvVerifyOut:
    context = _prepare(database, device, user, request, audit.ACTION_DEVICE_VERIFIED)
    checked_at = utc_now()
    outcome = _run_verification(context, device)
    _apply_outcome(database, device, context.credential_row, outcome, checked_at)
    audit.record(
        database,
        action=audit.ACTION_DEVICE_VERIFIED,
        outcome=audit.OUTCOME_SUCCESS if outcome.result == onvif.RESULT_DEVICE_VERIFIED else audit.OUTCOME_FAILED,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={
            "result": outcome.result,
            "reason": outcome.reason,
            "authentication_enforced": outcome.authentication_enforced,
            "identity_recorded": outcome.information is not None,
        },
    )
    devices._commit(database)
    CctvRepository(database).refresh(device)
    return CctvVerifyOut(
        device_id=device.id,
        result=outcome.result,
        reason=outcome.reason,
        device_status=device.status,
        checked_at=checked_at,
        authentication_enforced=outcome.authentication_enforced,
        manufacturer=device.manufacturer,
        model=device.model,
        firmware_version=device.firmware_version,
        media_service_available=outcome.media_service_available,
        channels_verified=False,
        playback_available=False,
        playback_unavailable_code=CODE_GATEWAY_NOT_CONFIGURED,
    )


def _run_verification(context: ConnectionContext, device: CctvDevice) -> VerificationOutcome:
    unreachable = _classify_unreachable(context.host, device.onvif_port, device.rtsp_port, _timeout())
    if unreachable is not None:
        return VerificationOutcome(unreachable.result, unreachable.reason)
    row = context.credential_row
    plain = credential_service.decrypt_for_connection(row.username_ciphertext, row.password_ciphertext, row.key_version)
    try:
        with _client(context, device, plain, _transport_factory() if _transport_factory else None) as client:
            return _authenticate_and_identify(client, device)
    except onvif.OnvifFailure as failure:
        return VerificationOutcome(failure.result, failure.reason)
    finally:
        del plain


# --- discovery ---------------------------------------------------------------


@dataclass
class StreamChoice:
    profile_token: str
    codec: str | None
    width: int | None
    height: int | None
    stream_path: str | None
    issue: str | None


@dataclass
class Candidate:
    candidate_id: uuid.UUID
    video_source_token: str
    label: str | None
    main: StreamChoice | None
    sub: StreamChoice | None
    ignored_profile_count: int


@dataclass
class DiscoveryEntry:
    discovery_id: uuid.UUID
    device_id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    fingerprint: tuple
    expires_monotonic: float
    expires_at: datetime
    candidates: dict[uuid.UUID, Candidate] = field(default_factory=dict)


_discovery_lock = threading.Lock()
_discoveries: dict[uuid.UUID, DiscoveryEntry] = {}


def _fingerprint(device: CctvDevice) -> tuple:
    return (
        device.host,
        device.rtsp_port,
        device.onvif_port,
        device.onvif_use_tls,
        device.onvif_service_path,
        device.connection_method,
    )


def _store_discovery(entry: DiscoveryEntry) -> None:
    now = time.monotonic()
    with _discovery_lock:
        for key in [key for key, value in _discoveries.items() if value.expires_monotonic <= now]:
            _discoveries.pop(key, None)
        mine = sorted(
            (value for value in _discoveries.values() if value.user_id == entry.user_id),
            key=lambda value: value.expires_monotonic,
        )
        for stale in mine[: max(0, len(mine) - MAX_DISCOVERIES_PER_USER + 1)]:
            _discoveries.pop(stale.discovery_id, None)
        if len(_discoveries) >= MAX_DISCOVERIES_TOTAL:
            oldest = min(_discoveries.values(), key=lambda value: value.expires_monotonic)
            _discoveries.pop(oldest.discovery_id, None)
        _discoveries[entry.discovery_id] = entry


def _load_discovery(discovery_id: uuid.UUID, device: CctvDevice, user: User) -> DiscoveryEntry:
    with _discovery_lock:
        entry = _discoveries.get(discovery_id)
    if (
        entry is None
        or entry.expires_monotonic <= time.monotonic()
        or entry.device_id != device.id
        or entry.project_id != device.project_id
        or entry.user_id != user.id
        or entry.fingerprint != _fingerprint(device)
    ):
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_DISCOVERY_EXPIRED",
            "This discovery result is no longer valid. Run discovery again.",
        )
    return entry


CODEC_MAP = {
    "H264": "H264",
    "H.264": "H264",
    "H265": "H265",
    "H.265": "H265",
    "HEVC": "H265",
    "JPEG": "MJPEG",
    "MJPEG": "MJPEG",
    "MPEG4": "MPEG4",
}


def _codec(encoding: str | None) -> str | None:
    if not encoding:
        return None
    return CODEC_MAP.get(encoding.strip().upper(), "OTHER")


def stream_path_from_uri(uri: str | None, device_host: str, device_rtsp_port: int) -> tuple[str | None, str | None]:
    """Reduce a device-reported stream URI to a policy-checked PATH, or refuse it.

    The URI itself is never stored, logged or returned. It is only used if it is
    an rtsp:// URI for the configured device and port with no embedded login.
    """
    if not uri:
        return None, "STREAM_URI_MISSING"
    try:
        parts = urlsplit(uri.strip())
        uri_port = parts.port
    except ValueError:
        return None, "STREAM_URI_INVALID"
    if parts.scheme.lower() not in RTSP_SCHEMES:
        return None, "STREAM_URI_UNSUPPORTED_SCHEME"
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        return None, "STREAM_URI_CONTAINS_CREDENTIALS"
    try:
        uri_host = network_policy.validate_device_host(parts.hostname or "", "stream_host") if parts.hostname else None
    except HTTPException:
        uri_host = None
    if uri_host != device_host:
        return None, "STREAM_HOST_DIFFERS"
    if (uri_port or RTSP_URI_DEFAULT_PORT) != device_rtsp_port:
        return None, "STREAM_PORT_DIFFERS"
    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    try:
        return network_policy.validate_stream_path(path, "stream_path"), None
    except HTTPException:
        return None, "STREAM_PATH_REJECTED"


def _stream_choice(
    client: onvif.OnvifClient, profile: onvif.MediaProfile, device: CctvDevice, host: str
) -> StreamChoice:
    try:
        uri = client.get_stream_uri(profile.token)
    except onvif.OnvifFailure as failure:
        if failure.result in (
            onvif.RESULT_NETWORK_UNREACHABLE,
            onvif.RESULT_SERVICE_UNREACHABLE,
            onvif.RESULT_AUTHENTICATION_FAILED,
        ):
            raise
        return StreamChoice(
            profile.token,
            _codec(profile.encoding),
            profile.width,
            profile.height,
            None,
            f"STREAM_URI_{failure.reason}"[:64],
        )
    path, issue = stream_path_from_uri(uri, host, device.rtsp_port)
    del uri
    return StreamChoice(profile.token, _codec(profile.encoding), profile.width, profile.height, path, issue)


def _build_candidates(
    client: onvif.OnvifClient, device: CctvDevice, host: str, deadline: float
) -> tuple[list[Candidate], int, int]:
    sources = client.get_video_sources()
    profiles = client.get_profiles()
    candidates: list[Candidate] = []
    for source in sources:
        if time.monotonic() > deadline:
            raise onvif.OnvifFailure(onvif.RESULT_DEVICE_PROTOCOL_ERROR, "DISCOVERY_TIMEOUT")
        # A profile carries video if it reports an encoding or at least a video
        # encoder configuration: devices streaming H.265 leave Encoding out of
        # Media1 responses entirely.
        own = [
            profile
            for profile in profiles
            if profile.source_token == source.token and (profile.encoding or profile.encoder_token)
        ]
        # Main = the largest picture the device offers for this source, sub = the
        # next. Ordering uses only what the device reported; ties keep its order.
        ranked = sorted(own, key=lambda profile: -((profile.width or 0) * (profile.height or 0)))
        main = _stream_choice(client, ranked[0], device, host) if ranked else None
        sub = _stream_choice(client, ranked[1], device, host) if len(ranked) > 1 else None
        label = next(
            (
                name
                for name in ([profile.source_name for profile in ranked] + [profile.name for profile in ranked])
                if name
            ),
            None,
        )
        candidates.append(Candidate(uuid.uuid4(), source.token, label, main, sub, max(0, len(ranked) - 2)))
    return candidates, len(sources), len(profiles)


def _stream_out(choice: StreamChoice | None) -> CctvDiscoveredStreamOut | None:
    if choice is None:
        return None
    return CctvDiscoveredStreamOut(
        codec=choice.codec,
        width=choice.width,
        height=choice.height,
        stream_available=choice.stream_path is not None,
        issue=choice.issue,
    )


def discover_channels(
    database: Session, grant: CctvGrant, device: CctvDevice, user: User, request: Request
) -> CctvDiscoveryOut:
    repository = CctvRepository(database)
    context = _prepare(database, device, user, request, audit.ACTION_CHANNELS_DISCOVERED)
    checked_at = utc_now()
    candidates: list[Candidate] = []
    source_count = profile_count = 0
    outcome = None
    unreachable = _classify_unreachable(context.host, device.onvif_port, device.rtsp_port, _timeout())
    if unreachable is not None:
        outcome = VerificationOutcome(unreachable.result, unreachable.reason)
    else:
        row = context.credential_row
        plain = credential_service.decrypt_for_connection(
            row.username_ciphertext, row.password_ciphertext, row.key_version
        )
        try:
            with _client(context, device, plain, _transport_factory() if _transport_factory else None) as client:
                outcome = _authenticate_and_identify(client, device)
                if outcome.result in (onvif.RESULT_DEVICE_VERIFIED, onvif.RESULT_AUTHENTICATION_NOT_ENFORCED):
                    candidates, source_count, profile_count = _build_candidates(
                        client, device, context.host, time.monotonic() + DISCOVERY_DEADLINE_SECONDS
                    )
        except onvif.OnvifFailure as failure:
            outcome = VerificationOutcome(
                failure.result,
                failure.reason,
                outcome.authentication_enforced if outcome else None,
                outcome.information if outcome else None,
                outcome.media_service_available if outcome else False,
            )
            candidates = []
        finally:
            del plain

    _apply_outcome(database, device, context.credential_row, outcome, checked_at)
    discovery_id = expires_at = None
    existing = {}
    if candidates:
        discovery_id = uuid.uuid4()
        expires_at = checked_at + timedelta(seconds=DISCOVERY_TTL_SECONDS)
        _store_discovery(
            DiscoveryEntry(
                discovery_id=discovery_id,
                device_id=device.id,
                project_id=device.project_id,
                user_id=user.id,
                fingerprint=_fingerprint(device),
                expires_monotonic=time.monotonic() + DISCOVERY_TTL_SECONDS,
                expires_at=expires_at,
                candidates={candidate.candidate_id: candidate for candidate in candidates},
            )
        )
        existing = {
            channel.onvif_video_source_token: channel
            for channel in repository.iter_device_channels(device.id)
            if channel.onvif_video_source_token
        }
    streams = [choice for candidate in candidates for choice in (candidate.main, candidate.sub) if choice is not None]
    audit.record(
        database,
        action=audit.ACTION_CHANNELS_DISCOVERED,
        outcome=audit.OUTCOME_SUCCESS if discovery_id else audit.OUTCOME_FAILED,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={
            "result": outcome.result,
            "reason": outcome.reason,
            "authentication_enforced": outcome.authentication_enforced,
            "video_source_count": source_count,
            "profile_count": profile_count,
            "candidate_count": len(candidates),
            "stream_path_count": sum(1 for choice in streams if choice.stream_path),
            "rejected_stream_count": sum(1 for choice in streams if not choice.stream_path),
        },
    )
    devices._commit(database)
    repository.refresh(device)
    return CctvDiscoveryOut(
        device_id=device.id,
        result=outcome.result,
        reason=outcome.reason,
        device_status=device.status,
        checked_at=checked_at,
        authentication_enforced=outcome.authentication_enforced,
        discovery_id=discovery_id,
        expires_at=expires_at,
        video_source_count=source_count,
        profile_count=profile_count,
        candidates=[
            CctvDiscoveredChannelOut(
                candidate_id=candidate.candidate_id,
                label=candidate.label,
                main_stream=_stream_out(candidate.main),
                sub_stream=_stream_out(candidate.sub),
                ignored_profile_count=candidate.ignored_profile_count,
                existing_channel_id=existing[candidate.video_source_token].id
                if candidate.video_source_token in existing
                else None,
                existing_channel_number=existing[candidate.video_source_token].channel_number
                if candidate.video_source_token in existing
                else None,
            )
            for candidate in candidates
        ],
        channels_verified=False,
        playback_available=False,
        playback_unavailable_code=CODE_GATEWAY_NOT_CONFIGURED,
    )


def save_discovered_channels(
    database: Session,
    grant: CctvGrant,
    device: CctvDevice,
    user: User,
    payload: CctvDiscoveredChannelsSave,
    request: Request,
) -> CctvDeviceOut:
    repository = CctvRepository(database)
    entry = _load_discovery(payload.discovery_id, device, user)
    seen_candidates: set[uuid.UUID] = set()
    seen_numbers: set[int] = set()
    existing_channels = repository.lock_device_channels(device.id)
    by_token = {
        channel.onvif_video_source_token: channel for channel in existing_channels if channel.onvif_video_source_token
    }
    by_number = {channel.channel_number: channel for channel in existing_channels}

    planned: list[tuple[CctvChannel | None, dict]] = []
    for index, selection in enumerate(payload.selections):
        prefix = f"selections.{index}."
        candidate = entry.candidates.get(selection.candidate_id)
        if candidate is None:
            raise field_error(f"{prefix}candidate_id", "This candidate is not part of the discovery result.")
        if selection.candidate_id in seen_candidates:
            raise field_error(f"{prefix}candidate_id", "Each discovered channel may be selected only once.")
        if selection.channel_number in seen_numbers:
            raise field_error(f"{prefix}channel_number", "Each channel number may appear only once.")
        seen_candidates.add(selection.candidate_id)
        seen_numbers.add(selection.channel_number)

        target = by_token.get(candidate.video_source_token)
        holder = by_number.get(selection.channel_number)
        if holder is not None and holder is not target:
            raise cctv_error(
                status.HTTP_409_CONFLICT,
                "CCTV_CHANNEL_NUMBER_IN_USE",
                "That channel number is already used by another channel on this device.",
                [{"field": f"{prefix}channel_number", "message": "Already in use on this device."}],
            )

        main_path = (
            network_policy.validate_stream_path(candidate.main.stream_path, "stream_path") if candidate.main else None
        )
        sub_path = (
            network_policy.validate_stream_path(candidate.sub.stream_path, "stream_path") if candidate.sub else None
        )
        values = {
            "channel_number": selection.channel_number,
            "name": devices.clean_text(selection.name or candidate.label, f"{prefix}name", 120, required=True),
            "location_label": devices.clean_text(
                selection.location_label, f"{prefix}location_label", 160, required=False
            ),
            "onvif_video_source_token": candidate.video_source_token,
            "main_profile_token": candidate.main.profile_token if candidate.main else None,
            "sub_profile_token": candidate.sub.profile_token if candidate.sub else None,
            "main_stream_path": main_path,
            "sub_stream_path": sub_path,
            "main_codec": candidate.main.codec if candidate.main else None,
            "sub_codec": candidate.sub.codec if candidate.sub else None,
            "main_width": candidate.main.width if candidate.main else None,
            "main_height": candidate.main.height if candidate.main else None,
            "sub_width": candidate.sub.width if candidate.sub else None,
            "sub_height": candidate.sub.height if candidate.sub else None,
            "preferred_stream": selection.preferred_stream or ("SUB" if sub_path else "MAIN"),
            "is_enabled": selection.is_enabled,
            "display_order": selection.display_order,
        }
        if values["is_enabled"] and not (main_path or sub_path):
            raise field_error(
                f"{prefix}is_enabled", "This discovered channel has no usable stream, so it cannot be enabled."
            )
        devices._check_channel_consistency(values, prefix)
        planned.append((target, values))

    created = updated = 0
    for target, values in planned:
        if target is None:
            repository.add(
                CctvChannel(
                    device_id=device.id,
                    project_id=device.project_id,
                    created_by_user_id=user.id,
                    status="UNKNOWN",
                    **values,
                )
            )
            created += 1
        else:
            for name, value in values.items():
                setattr(target, name, value)
            target.status = "UNKNOWN"
            target.status_detail = None
            target.last_checked_at = None
            target.updated_by_user_id = user.id
            updated += 1
    device.updated_by_user_id = user.id
    audit.record(
        database,
        action=audit.ACTION_CHANNELS_SAVED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"created": created, "updated": updated, "removed": 0, "source": "ONVIF_DISCOVERY"},
    )
    devices._commit(database)
    repository.refresh(device)
    return devices.device_out(database, device)
