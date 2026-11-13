"""Request and response shapes for the Live Camera / CCTV API.

Requests forbid unknown fields, so a client cannot slip a `stream_url`, a
`project_id` or an ownership claim into a body. Credentials arrive as SecretStr
and are checked and encrypted in app/modules/cctv/services/credentials.py.

Responses are built field by field in app/modules/cctv/services/devices.py -- never
from an ORM object -- and contain no credential, ciphertext, stream path or URL.
A device's credentials appear only as `has_credentials` and
`credentials_last_verified_at`; a channel's stream locations only as
`has_main_stream` / `has_sub_stream`. The device's host, ports and ONVIF
service path are accepted on input but never returned: they stay backend-only.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

DeviceType = Literal["DVR", "NVR", "IP_CAMERA"]
ConnectionMethod = Literal["MANUAL", "ONVIF"]
VerificationResult = Literal[
    "NETWORK_UNREACHABLE",
    "SERVICE_UNREACHABLE",
    "AUTHENTICATION_FAILED",
    "DEVICE_PROTOCOL_ERROR",
    "DEVICE_VERIFIED",
    "UNSUPPORTED_PROTOCOL",
    "AUTHENTICATION_NOT_ENFORCED",
    "DEVICE_IDENTITY_MISMATCH",
]
Codec = Literal["H264", "H265", "MJPEG", "MPEG4", "OTHER"]
StreamVariant = Literal["MAIN", "SUB"]
PlaybackTransport = Literal["LL_HLS", "WEBRTC"]

MAX_CHANNELS_PER_DEVICE = 256


class CctvRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CctvCredentialsInput(BaseModel):
    # Not whitespace-stripped: a password may legitimately begin or end with a
    # space. Lengths are checked after the secret is read, never by pydantic, so
    # a validation message can never be about the value itself.
    model_config = ConfigDict(extra="forbid")

    username: SecretStr
    password: SecretStr


class CctvChannelInput(CctvRequest):
    channel_number: int = Field(ge=1, le=1024)
    name: str = Field(min_length=1, max_length=120)
    location_label: str | None = Field(default=None, max_length=160)
    main_stream_path: str | None = Field(default=None, max_length=512)
    sub_stream_path: str | None = Field(default=None, max_length=512)
    main_codec: Codec | None = None
    sub_codec: Codec | None = None
    main_width: int | None = Field(default=None, ge=1, le=16384)
    main_height: int | None = Field(default=None, ge=1, le=16384)
    sub_width: int | None = Field(default=None, ge=1, le=16384)
    sub_height: int | None = Field(default=None, ge=1, le=16384)
    preferred_stream: StreamVariant = "SUB"
    is_enabled: bool = True
    display_order: int = Field(default=0, ge=0, le=100000)


class CctvDeviceCreate(CctvRequest):
    name: str = Field(min_length=1, max_length=120)
    device_type: DeviceType
    manufacturer: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    firmware_version: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    host: str = Field(min_length=1, max_length=253)
    rtsp_port: int = Field(ge=1, le=65535)
    onvif_port: int | None = Field(default=None, ge=1, le=65535)
    # ONVIF devices need an ONVIF port; MANUAL devices keep channels entered by hand.
    connection_method: ConnectionMethod = "MANUAL"
    onvif_use_tls: bool = False
    onvif_service_path: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    credentials: CctvCredentialsInput | None = None
    channels: list[CctvChannelInput] = Field(default_factory=list, max_length=MAX_CHANNELS_PER_DEVICE)


class CctvDeviceUpdate(CctvRequest):
    """Every field optional. A field left out is unchanged; an optional field
    sent as null is cleared. Credentials are replaced only through their own
    endpoint."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    device_type: DeviceType | None = None
    manufacturer: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    firmware_version: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    host: str | None = Field(default=None, min_length=1, max_length=253)
    rtsp_port: int | None = Field(default=None, ge=1, le=65535)
    onvif_port: int | None = Field(default=None, ge=1, le=65535)
    connection_method: ConnectionMethod | None = None
    onvif_use_tls: bool | None = None
    onvif_service_path: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class CctvChannelsReplace(CctvRequest):
    """The complete channel set for a device. Channels not listed are removed."""

    channels: list[CctvChannelInput] = Field(max_length=MAX_CHANNELS_PER_DEVICE)


class CctvChannelUpdate(CctvRequest):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location_label: str | None = Field(default=None, max_length=160)
    main_stream_path: str | None = Field(default=None, max_length=512)
    sub_stream_path: str | None = Field(default=None, max_length=512)
    main_codec: Codec | None = None
    sub_codec: Codec | None = None
    main_width: int | None = Field(default=None, ge=1, le=16384)
    main_height: int | None = Field(default=None, ge=1, le=16384)
    sub_width: int | None = Field(default=None, ge=1, le=16384)
    sub_height: int | None = Field(default=None, ge=1, le=16384)
    preferred_stream: StreamVariant | None = None
    is_enabled: bool | None = None
    display_order: int | None = Field(default=None, ge=0, le=100000)


# --- responses ---------------------------------------------------------------


class CctvProjectOut(BaseModel):
    project_id: uuid.UUID
    title: str
    construction_type: str | None
    access_basis: str
    device_count: int
    channel_count: int
    enabled_channel_count: int


class CctvChannelOut(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    project_id: uuid.UUID
    channel_number: int
    name: str
    location_label: str | None
    has_main_stream: bool
    has_sub_stream: bool
    main_codec: str | None
    sub_codec: str | None
    main_width: int | None
    main_height: int | None
    sub_width: int | None
    sub_height: int | None
    preferred_stream: str
    status: str
    status_detail: str | None
    last_checked_at: datetime | None
    is_enabled: bool
    display_order: int
    created_at: datetime
    updated_at: datetime


class CctvDeviceOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    device_type: str
    manufacturer: str | None
    model: str | None
    firmware_version: str | None
    serial_number: str | None
    connection_method: str
    # True when the device is set up for ONVIF (method ONVIF and a port stored).
    # The port itself, like the host, is not returned.
    onvif_configured: bool
    status: str
    status_detail: str | None
    # The explicit result code of the last ONVIF verification or discovery, if any.
    last_verification_result: str | None
    last_checked_at: datetime | None
    last_online_at: datetime | None
    is_active: bool
    has_credentials: bool
    credentials_last_verified_at: datetime | None
    channel_count: int
    channels: list[CctvChannelOut]
    created_at: datetime
    updated_at: datetime


class CctvDeviceDeleted(BaseModel):
    deleted: bool
    device_id: uuid.UUID


class CctvChannelStatusOut(BaseModel):
    channel_id: uuid.UUID
    device_id: uuid.UUID
    project_id: uuid.UUID
    channel_status: str
    channel_status_detail: str | None
    channel_last_checked_at: datetime | None
    channel_enabled: bool
    device_status: str
    device_status_detail: str | None
    device_last_checked_at: datetime | None
    device_active: bool
    preferred_stream: str
    preferred_stream_configured: bool
    preferred_codec: str | None
    # None means the codec is not known yet; only H.264 is treated as playable
    # in a browser over WebRTC.
    browser_compatible_codec: bool | None
    playback_available: bool
    playback_unavailable_code: str | None


class CctvReconnectOut(BaseModel):
    device_id: uuid.UUID
    check: Literal["TCP_PORT_REACHABILITY"]
    # Always false in this version: a TCP connection proves a port is open, not
    # that a camera answered or that the stored credentials work.
    camera_verified: bool
    rtsp_port_reachable: bool
    onvif_port_reachable: bool | None
    device_status: str
    status_detail: str | None
    checked_at: datetime
    playback_available: bool
    playback_unavailable_code: str | None


# --- ONVIF verification and channel discovery --------------------------------


class CctvVerifyOut(BaseModel):
    device_id: uuid.UUID
    result: VerificationResult
    # A fixed reason code (e.g. HTTP_401, SOAP_FAULT, CONNECTION_REFUSED). Never a
    # message, URL or response body from the device.
    reason: str | None
    device_status: str
    checked_at: datetime
    # True: the device refused an unauthenticated request and accepted the
    # stored credentials. False: it answered without credentials too. None: the
    # check did not get that far.
    authentication_enforced: bool | None
    manufacturer: str | None
    model: str | None
    firmware_version: str | None
    media_service_available: bool
    # Verification speaks to the device only. No channel or video stream has
    # been verified, and there is no playback in this version.
    channels_verified: bool
    playback_available: bool
    playback_unavailable_code: str | None


class CctvDiscoveredStreamOut(BaseModel):
    codec: str | None
    width: int | None
    height: int | None
    # Whether a usable stream location was obtained and kept server-side. The
    # location itself is never returned.
    stream_available: bool
    issue: str | None


class CctvDiscoveredChannelOut(BaseModel):
    # Opaque, short-lived, server-side handle. Device tokens are not returned.
    candidate_id: uuid.UUID
    label: str | None
    main_stream: CctvDiscoveredStreamOut | None
    sub_stream: CctvDiscoveredStreamOut | None
    ignored_profile_count: int
    existing_channel_id: uuid.UUID | None
    existing_channel_number: int | None


class CctvDiscoveryOut(BaseModel):
    device_id: uuid.UUID
    result: VerificationResult
    reason: str | None
    device_status: str
    checked_at: datetime
    authentication_enforced: bool | None
    # Present only when the device was reached and read successfully.
    discovery_id: uuid.UUID | None
    expires_at: datetime | None
    video_source_count: int
    profile_count: int
    candidates: list[CctvDiscoveredChannelOut]
    channels_verified: bool
    playback_available: bool
    playback_unavailable_code: str | None


class CctvDiscoveredChannelSelection(CctvRequest):
    candidate_id: uuid.UUID
    # Chosen by the user. Channel numbers are never inferred from the device.
    channel_number: int = Field(ge=1, le=1024)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location_label: str | None = Field(default=None, max_length=160)
    is_enabled: bool = True
    preferred_stream: StreamVariant | None = None
    display_order: int = Field(default=0, ge=0, le=100000)


class CctvPlaybackRequest(CctvRequest):
    # LL_HLS is the transport proven with the real recorder. WEBRTC is accepted
    # for the same session design once its browser URL is configured.
    transport: PlaybackTransport = "LL_HLS"
    # Defaults to the channel's preferred stream.
    stream_variant: StreamVariant | None = None


RecordedSpeed = Literal["1", "1.5", "2", "3"]


class CctvRecordingSearchRequest(CctvRequest):
    """A local-time window to search the recorder for. Times are the office/device
    local time; the backend converts to UTC for the ONVIF query."""

    start: datetime
    end: datetime


class CctvRecordingSegmentOut(BaseModel):
    # Local (office/device) time; the browser shows these directly.
    start_local: datetime
    end_local: datetime
    duration_seconds: int


class CctvRecordingSearchOut(BaseModel):
    channel_id: uuid.UUID
    device_id: uuid.UUID
    project_id: uuid.UUID
    device_status: str
    searched_start: datetime
    searched_end: datetime
    segments: list[CctvRecordingSegmentOut]


class CctvRecordedPlaybackRequest(CctvRequest):
    transport: PlaybackTransport = "LL_HLS"
    # Recordings hold the full-quality footage on MAIN.
    stream_variant: StreamVariant = "MAIN"
    start: datetime
    end: datetime
    # Applied as a DVR-side RTSP Scale; only these values are accepted.
    speed: RecordedSpeed = "1"


class CctvPlaybackSessionOut(BaseModel):
    """What a browser needs to play one channel, and nothing more.

    `playback_url` points at the local media gateway under a random per-session
    path; it contains no camera address, stream path or credential. The gateway
    admits a request only with `Authorization: Bearer <playback_token>` while the
    session is open. The token is returned once, here, and stored only as a hash.
    """

    session_id: uuid.UUID
    channel_id: uuid.UUID
    project_id: uuid.UUID
    transport: str
    stream_variant: str
    status: str
    playback_url: str
    playback_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_at: datetime
    session_ttl_seconds: int
    codec: str | None
    browser_compatible_codec: bool | None


class CctvPlaybackSessionRenewed(BaseModel):
    """A renewed session. The playback URL and token are unchanged and are not
    repeated here."""

    session_id: uuid.UUID
    channel_id: uuid.UUID
    project_id: uuid.UUID
    transport: str
    stream_variant: str
    status: str
    expires_at: datetime
    last_authorized_at: datetime
    session_ttl_seconds: int


class CctvPlaybackSessionEnded(BaseModel):
    session_id: uuid.UUID
    status: str
    end_reason: str | None
    ended_at: datetime | None


class CctvDiscoveredChannelsSave(CctvRequest):
    """Save channels picked from a discovery result. Only candidates the device
    actually reported can be saved; existing channels not selected are kept."""

    discovery_id: uuid.UUID
    selections: list[CctvDiscoveredChannelSelection] = Field(min_length=1, max_length=MAX_CHANNELS_PER_DEVICE)


# --- first-time camera setup -------------------------------------------------
#
# The whole form a user fills in: device type, address, port, username,
# password. Deliberately nothing else. RTSP ports, stream paths, ONVIF profile
# tokens, gateway URLs and channel numbers are all resolved by the backend from
# the device itself, so none of them appears here or in any response below.

# Used when a project's first recorder is registered. Recorders serve RTSP on
# 554 unless told otherwise, and discovery reports a mismatch if this is wrong,
# so it is a default rather than a question put to the user.
DEFAULT_RTSP_PORT = 554


class CctvCameraSetupRequest(CctvRequest):
    device_type: DeviceType = "DVR"
    # The recorder's address. Validated against the CCTV network policy in the
    # service, which is what refuses a public or loopback address.
    host: str = Field(min_length=1, max_length=253)
    # The ONVIF port -- the one verification and channel discovery speak to.
    port: int = Field(ge=1, le=65535)
    onvif_use_tls: bool = False
    # Only for a recorder that does not serve RTSP on 554. The setup screen does
    # not ask for it; it exists so an unusual deployment is still reachable.
    rtsp_port: int = Field(default=DEFAULT_RTSP_PORT, ge=1, le=65535)


class CctvCameraSetupCredentials(BaseModel):
    """Kept apart from the request body above so the secrets have their own
    model with no whitespace stripping, exactly as CctvCredentialsInput does."""

    model_config = ConfigDict(extra="forbid")

    username: SecretStr
    password: SecretStr


class CctvCameraSetupSubmit(CctvRequest):
    device: CctvCameraSetupRequest
    credentials: CctvCameraSetupCredentials


class CctvCameraSetupStatusOut(BaseModel):
    """What the Live Camera entry point needs to decide which screen to show.

    Carries no device address, port, credential or stream location -- only
    whether this project has a recorder at all and whether the signed-in user
    has finished verifying it.
    """

    project_id: uuid.UUID
    project_title: str
    # Whether the project has a recorder registered by anyone.
    has_device: bool
    # Whether the signed-in user has completed verification for it.
    access_granted: bool
    verified_at: datetime | None = None
    # How many cameras are configured on the project recorder, so the setup
    # screen can say whether discovery still has work to do.
    channel_count: int = 0
    enabled_channel_count: int = 0


class CctvCameraSetupOut(BaseModel):
    """The result of one setup attempt."""

    project_id: uuid.UUID
    device_id: uuid.UUID | None = None
    # The ONVIF verification result, as the existing verification reports it.
    result: VerificationResult | None = None
    reason: str | None = None
    # True only when the recorder accepted the supplied credentials.
    verified: bool = False
    access_granted: bool = False
    # Whether this attempt registered the project's first recorder.
    device_created: bool = False
    channels_discovered: int = 0
    channel_count: int = 0
    enabled_channel_count: int = 0
