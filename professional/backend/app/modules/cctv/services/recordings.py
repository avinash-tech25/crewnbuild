"""Recorded playback: search the DVR's own recordings and build a replay source.

    search_recordings     read-only ONVIF Replay/Search: which real recorded
                          segments exist for a channel inside a time window.
    build_replay_source   the RTSP replay URL handed to the media gateway (held
                          in memory only; never stored, returned or logged).

The DVR is the source of truth for recording availability -- nothing here is
persisted. Search performs NO database write. Timestamps from the device are
UTC; the office/device wall clock is local (settings.local_utc_offset_minutes),
so the window the user gives is treated as local time and the segments returned
are local too. Every device address is re-checked against the network policy
before a packet is sent, exactly as verification/discovery do.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, quote, urlsplit

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.modules.cctv.models import CctvChannel, CctvDevice
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.runtime import settings
from app.modules.cctv.services import cctv_error, connectivity, field_error, network_policy
from app.modules.cctv.services import credentials as credential_service
from app.modules.cctv.services import onvif_client as onvif
from app.modules.cctv.services.access import load_channel, require_project_access
from app.modules.identity.models import User

# The device records continuously, but a window is still bounded so an
# open-ended replay (which this DVR refuses) is never requested.
MAX_WINDOW_SECONDS = 24 * 3600
MIN_WINDOW_SECONDS = 5
REPLAY_ENDPOINT = "/cam/playback"
LIVE_ENDPOINT = "/cam/realmonitor"
SUBTYPE_FOR_VARIANT = {"MAIN": 0, "SUB": 1}


def _offset() -> timedelta:
    return timedelta(minutes=settings.local_utc_offset_minutes)


def local_to_utc(local_naive: datetime) -> datetime:
    return (local_naive - _offset()).replace(tzinfo=UTC)


def utc_to_local_naive(utc_aware: datetime) -> datetime:
    return (utc_aware.astimezone(UTC) + _offset()).replace(tzinfo=None)


@dataclass(frozen=True)
class RecordingSegment:
    start_local: datetime
    end_local: datetime

    @property
    def duration_seconds(self) -> int:
        return max(0, int((self.end_local - self.start_local).total_seconds()))


def _validate_window(start_local: datetime, end_local: datetime) -> tuple[datetime, datetime]:
    start = start_local.replace(microsecond=0, tzinfo=None)
    end = end_local.replace(microsecond=0, tzinfo=None)
    seconds = (end - start).total_seconds()
    if seconds < MIN_WINDOW_SECONDS:
        raise field_error("end", "The end time must be after the start time.")
    if seconds > MAX_WINDOW_SECONDS:
        raise field_error("end", "Choose a window of at most 24 hours.")
    return start, end


def _channel_dvr_index(channel: CctvChannel) -> str | None:
    """The DVR channel index, read from the stored live path's `channel=` query --
    never a hardcoded or user-supplied number."""
    path = channel.main_stream_path or channel.sub_stream_path or ""
    query = parse_qs(urlsplit(path).query)
    values = query.get("channel")
    if not values:
        return None
    index = values[0].strip()
    return index if index.isdigit() and 0 < len(index) <= 4 else None


def _connect(database: Session, device: CctvDevice, channel: CctvChannel) -> onvif.OnvifClient:
    """Read-only preflight + an authenticated ONVIF client. Writes nothing."""
    credential_service.ensure_credentials_may_be_used()
    if not device.is_active:
        raise cctv_error(status.HTTP_409_CONFLICT, "CCTV_DEVICE_INACTIVE", "This camera device is inactive.")
    if device.connection_method != "ONVIF" or device.onvif_port is None:
        raise cctv_error(status.HTTP_409_CONFLICT, "CCTV_ONVIF_NOT_CONFIGURED", "This device is not set up for ONVIF.")

    credential_row = CctvRepository(database).find_device_credential(device.id)
    if credential_row is None:
        raise cctv_error(
            status.HTTP_409_CONFLICT, "CCTV_CREDENTIALS_MISSING", "This camera device has no stored credentials."
        )
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
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_NETWORK_POLICY_REJECTED",
            "The device address is not permitted by the current network policy.",
        ) from None

    timeout = connectivity._timeout()
    unreachable = connectivity._classify_unreachable(host, device.onvif_port, device.rtsp_port, timeout)
    if unreachable is not None:
        raise cctv_error(
            status.HTTP_409_CONFLICT, "CCTV_DEVICE_NOT_ONLINE", "This camera device is not reachable. Verify it first."
        )
    plain = credential_service.decrypt_for_connection(
        credential_row.username_ciphertext, credential_row.password_ciphertext, credential_row.key_version
    )
    client = onvif.OnvifClient(
        host=host,
        port=device.onvif_port,
        use_tls=device.onvif_use_tls,
        device_service_path=service_path,
        credentials=plain,
        connect_timeout=timeout,
        read_timeout=15.0,
    )
    del plain
    return client


def search_recordings(
    database: Session, user: User, channel_id, start_local: datetime, end_local: datetime, request: Request
):
    """Real recorded segments for one channel inside a local-time window. READ-ONLY."""
    start, end = _validate_window(start_local, end_local)
    channel, device, grant = load_channel(database, user, channel_id, request)  # authorization; read-only
    # Searching a recorder is reaching the camera, so it sits behind the same
    # per-user verification as live and recorded playback.
    require_project_access(database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id)
    window_start_utc, window_end_utc = local_to_utc(start), local_to_utc(end)

    client = _connect(database, device, channel)
    try:
        client.sync_clock()
        client.get_device_information(authenticated=True)  # prove the stored login before trusting anything
        client.locate_services()
        spans = client.recording_spans()
    except onvif.OnvifFailure:
        raise cctv_error(
            status.HTTP_502_BAD_GATEWAY,
            "CCTV_RECORDING_SEARCH_FAILED",
            "The recorder could not be searched for recordings right now.",
        ) from None
    finally:
        client.close()

    # Recorded footage lives on the MAIN recording; on this recorder the
    # recording token embeds the channel's profile token (e.g. recording
    # "RecordMediaProfile00000" belongs to main profile "MediaProfile00000").
    # Match on that so a recording is tied to the saved channel, never a guessed
    # channel number. Fall back to the sub profile / video-source token.
    channel_tokens = [
        t for t in (channel.main_profile_token, channel.sub_profile_token, channel.onvif_video_source_token) if t
    ]

    def _belongs(span) -> bool:
        token = span.recording_token or ""
        if channel.main_profile_token and channel.main_profile_token in token:
            return True
        if not channel.main_profile_token:
            return any(t in token for t in channel_tokens) or (span.source_token in channel_tokens)
        return False

    segments: list[RecordingSegment] = []
    for span in spans:
        if channel_tokens and not _belongs(span):
            continue
        if span.earliest is None or span.latest is None:
            continue
        seg_start = max(span.earliest, window_start_utc)
        seg_end = min(span.latest, window_end_utc)
        if (seg_end - seg_start).total_seconds() >= MIN_WINDOW_SECONDS:
            segments.append(RecordingSegment(utc_to_local_naive(seg_start), utc_to_local_naive(seg_end)))
    segments.sort(key=lambda s: s.start_local)
    return channel, device, grant, segments


def build_replay_source(
    device: CctvDevice,
    channel: CctvChannel,
    plain: credential_service.PlainCredentials,
    start_local: datetime,
    end_local: datetime,
    variant: str,
) -> str:
    """The vendor replay RTSP URL for the media gateway. Holds the camera login:
    build, hand over, drop. Never stored, returned or logged."""
    index = _channel_dvr_index(channel)
    if index is None:
        raise cctv_error(
            status.HTTP_409_CONFLICT, "CCTV_STREAM_NOT_CONFIGURED", "This channel has no recorded stream configured."
        )
    subtype = SUBTYPE_FOR_VARIANT.get(variant, 0)
    fmt = "%Y_%m_%d_%H_%M_%S"
    path = (
        f"{REPLAY_ENDPOINT}?channel={index}&subtype={subtype}"
        f"&starttime={start_local.strftime(fmt)}&endtime={end_local.strftime(fmt)}"
    )
    # Re-run the same path policy the live paths pass through (no scheme/host/creds).
    network_policy.validate_stream_path(path, "recording_stream_path")
    host = f"[{device.host}]" if ":" in device.host else device.host
    username = quote(plain.username.get_secret_value(), safe="")
    password = quote(plain.password.get_secret_value(), safe="")
    return f"rtsp://{username}:{password}@{host}:{device.rtsp_port}{path}"
