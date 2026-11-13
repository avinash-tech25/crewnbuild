"""Live camera (CCTV) tables (technical-architecture.md section 10, domain Cameras), ported
from the old models/cctv.py with the same names and the same composite keys.

    cctv_devices, cctv_device_credentials, cctv_channels, cctv_playback_sessions,
    cctv_audit_events, cctv_project_access, cctv_discovery_results   same names, UUID
    cctv_rate_limit_events                                           bigint key -> UUID

Changed from the old tables, as section 10 asks: project_id is the projects' UUID and
has a foreign key to `projects` (the old app avoided any foreign key to its existing
tables), and every *_user_id column has one to `users`. The composite keys still make
`session.project_id = channel.project_id = device.project_id` a database guarantee, so
authorization only ever trusts the project stored on the row, never one from the
browser.

Delete rules (9.3): a project's cameras, channels, sessions, discovery results and
verifications go with the project (CASCADE through the device); the accounts on a row
are kept (RESTRICT; accounts are soft-deleted), an optional editor is SET NULL. The
audit trail has no foreign key at all: an entry outlives what it describes.

Nothing here holds a secret in the clear. Credentials live only in
`cctv_device_credentials`, encrypted with Fernet (CAMERA_CREDENTIALS_KEY), and that
model is never serialized by any API.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, new_uuid7


def utc_now() -> datetime:
    return datetime.now(UTC)


# Vocabularies. One definition, shared by the CHECK constraints below and the
# service layer, so a value the database refuses can never be offered by the API.
DEVICE_TYPES = ("DVR", "NVR", "IP_CAMERA")
CONNECTION_METHODS = ("ONVIF", "MANUAL")
DEVICE_STATUSES = ("UNKNOWN", "ONLINE", "OFFLINE", "UNREACHABLE", "AUTH_FAILED", "ERROR")
CODECS = ("H264", "H265", "MJPEG", "MPEG4", "OTHER")
STREAM_VARIANTS = ("MAIN", "SUB")
CHANNEL_STATUSES = ("UNKNOWN", "ONLINE", "OFFLINE", "NO_SIGNAL", "UNSUPPORTED_CODEC", "ERROR")
VIEWER_ROLES = ("OWNER", "BUILDER", "ENGINEER")
ACCESS_BASES = ("PROJECT_OWNER", "AWARDED_BUILDER", "ASSIGNED_ENGINEER")
TRANSPORTS = ("WEBRTC", "LL_HLS")
SESSION_STATUSES = ("PENDING", "ACTIVE", "ENDED", "EXPIRED", "REVOKED", "FAILED")
SESSION_OPEN_STATUSES = ("PENDING", "ACTIVE")
SESSION_END_REASONS = (
    "USER_STOPPED",
    "EXPIRED",
    "ACCESS_REVOKED",
    "DEVICE_OFFLINE",
    "UNSUPPORTED_CODEC",
    "GATEWAY_ERROR",
    "REPLACED",
    "SERVER_RESTART",
)
AUDIT_OUTCOMES = ("SUCCESS", "DENIED", "FAILED")
ENCRYPTION_SCHEMES = ("FERNET",)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _path_only(column: str) -> str:
    # A stored stream or service location is a path, never a URL: no scheme, no
    # host and no user-info, so a password can never be written into one.
    return (
        f"{column} IS NULL OR (left({column}, 1) = '/' AND strpos({column}, '://') = 0 AND strpos({column}, '@') = 0)"
    )


class CctvDevice(Base):
    """One DVR / NVR / IP camera, attached to one project."""

    __tablename__ = "cctv_devices"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_devices"),
        UniqueConstraint("id", "project_id", name="uq_cctv_devices_id_project_id"),
        UniqueConstraint("project_id", "host", "rtsp_port", name="uq_cctv_devices_project_host_rtsp_port"),
        CheckConstraint("length(btrim(name)) > 0", name="ck_cctv_devices_name_not_blank"),
        CheckConstraint(_in("device_type", DEVICE_TYPES), name="ck_cctv_devices_device_type"),
        CheckConstraint("host ~ '^[a-z0-9.:-]{1,253}$'", name="ck_cctv_devices_host_format"),
        CheckConstraint("rtsp_port BETWEEN 1 AND 65535", name="ck_cctv_devices_rtsp_port_range"),
        CheckConstraint(
            "onvif_port IS NULL OR onvif_port BETWEEN 1 AND 65535", name="ck_cctv_devices_onvif_port_range"
        ),
        CheckConstraint(_path_only("onvif_service_path"), name="ck_cctv_devices_onvif_service_path"),
        CheckConstraint(_in("connection_method", CONNECTION_METHODS), name="ck_cctv_devices_connection_method"),
        CheckConstraint(_in("status", DEVICE_STATUSES), name="ck_cctv_devices_status"),
        Index("ix_cctv_devices_project_id", "project_id"),
        Index("ix_cctv_devices_created_by_user_id", "created_by_user_id"),
        Index("ix_cctv_devices_updated_by_user_id", "updated_by_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    device_type: Mapped[str] = mapped_column(String(16), nullable=False)
    manufacturer: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))
    firmware_version: Mapped[str | None] = mapped_column(String(120))
    serial_number: Mapped[str | None] = mapped_column(String(120))
    onvif_endpoint_reference: Mapped[str | None] = mapped_column(String(255))
    host: Mapped[str] = mapped_column(String(253), nullable=False)
    rtsp_port: Mapped[int] = mapped_column(Integer, nullable=False)
    onvif_port: Mapped[int | None] = mapped_column(Integer)
    onvif_use_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    onvif_service_path: Mapped[str | None] = mapped_column(String(255))
    connection_method: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="UNKNOWN", server_default=text("'UNKNOWN'"))
    status_detail: Mapped[str | None] = mapped_column(String(255))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_online_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now, server_default=text("now()")
    )

    # The database cascades these on delete; passive_deletes lets it.
    credentials = relationship("CctvDeviceCredential", uselist=False, back_populates="device", passive_deletes=True)
    channels = relationship(
        "CctvChannel", back_populates="device", passive_deletes=True, order_by="CctvChannel.display_order"
    )


class CctvDeviceCredential(Base):
    """A device's login, encrypted. Never serialized, never logged."""

    __tablename__ = "cctv_device_credentials"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_device_credentials"),
        UniqueConstraint("device_id", name="uq_cctv_device_credentials_device_id"),
        ForeignKeyConstraint(
            ["device_id"],
            ["cctv_devices.id"],
            name="fk_cctv_device_credentials_device",
            ondelete="CASCADE",
        ),
        CheckConstraint("octet_length(username_ciphertext) > 0", name="ck_cctv_device_credentials_username_present"),
        CheckConstraint("octet_length(password_ciphertext) > 0", name="ck_cctv_device_credentials_password_present"),
        CheckConstraint(
            _in("encryption_scheme", ENCRYPTION_SCHEMES), name="ck_cctv_device_credentials_encryption_scheme"
        ),
        CheckConstraint("key_version >= 1", name="ck_cctv_device_credentials_key_version"),
        Index("ix_cctv_device_credentials_created_by_user_id", "created_by_user_id"),
        Index("ix_cctv_device_credentials_updated_by_user_id", "updated_by_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    username_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    password_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encryption_scheme: Mapped[str] = mapped_column(
        String(16), nullable=False, default="FERNET", server_default=text("'FERNET'")
    )
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, server_default=text("1"))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now, server_default=text("now()")
    )

    device = relationship("CctvDevice", back_populates="credentials")

    def __repr__(self) -> str:
        # The ciphertext is not a secret on its own, but nothing about a
        # credential row belongs in a log line either.
        return f"<CctvDeviceCredential device_id={self.device_id}>"


class CctvChannel(Base):
    """One camera channel on a device. Stores stream paths, never URLs."""

    __tablename__ = "cctv_channels"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_channels"),
        UniqueConstraint("device_id", "channel_number", name="uq_cctv_channels_device_id_channel_number"),
        UniqueConstraint("id", "project_id", name="uq_cctv_channels_id_project_id"),
        ForeignKeyConstraint(
            ["device_id", "project_id"],
            ["cctv_devices.id", "cctv_devices.project_id"],
            name="fk_cctv_channels_device",
            ondelete="CASCADE",
        ),
        CheckConstraint("channel_number >= 1", name="ck_cctv_channels_channel_number"),
        CheckConstraint("length(btrim(name)) > 0", name="ck_cctv_channels_name_not_blank"),
        CheckConstraint(_path_only("main_stream_path"), name="ck_cctv_channels_main_stream_path"),
        CheckConstraint(_path_only("sub_stream_path"), name="ck_cctv_channels_sub_stream_path"),
        CheckConstraint(f"main_codec IS NULL OR {_in('main_codec', CODECS)}", name="ck_cctv_channels_main_codec"),
        CheckConstraint(f"sub_codec IS NULL OR {_in('sub_codec', CODECS)}", name="ck_cctv_channels_sub_codec"),
        CheckConstraint(
            "(main_width IS NULL OR main_width > 0) AND (main_height IS NULL OR main_height > 0) "
            "AND (sub_width IS NULL OR sub_width > 0) AND (sub_height IS NULL OR sub_height > 0)",
            name="ck_cctv_channels_dimensions",
        ),
        CheckConstraint(_in("preferred_stream", STREAM_VARIANTS), name="ck_cctv_channels_preferred_stream"),
        CheckConstraint(_in("status", CHANNEL_STATUSES), name="ck_cctv_channels_status"),
        CheckConstraint("display_order >= 0", name="ck_cctv_channels_display_order"),
        CheckConstraint(
            "NOT is_enabled OR COALESCE(main_stream_path, sub_stream_path, main_profile_token, sub_profile_token) IS NOT NULL",
            name="ck_cctv_channels_enabled_has_source",
        ),
        Index("ix_cctv_channels_project_id", "project_id"),
        Index("ix_cctv_channels_created_by_user_id", "created_by_user_id"),
        Index("ix_cctv_channels_updated_by_user_id", "updated_by_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    # Equal to the device's project_id (composite FK); NOT a foreign key to projects.
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    channel_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location_label: Mapped[str | None] = mapped_column(String(160))
    onvif_video_source_token: Mapped[str | None] = mapped_column(String(128))
    main_profile_token: Mapped[str | None] = mapped_column(String(128))
    sub_profile_token: Mapped[str | None] = mapped_column(String(128))
    main_stream_path: Mapped[str | None] = mapped_column(String(512))
    sub_stream_path: Mapped[str | None] = mapped_column(String(512))
    main_codec: Mapped[str | None] = mapped_column(String(16))
    sub_codec: Mapped[str | None] = mapped_column(String(16))
    main_width: Mapped[int | None] = mapped_column(Integer)
    main_height: Mapped[int | None] = mapped_column(Integer)
    sub_width: Mapped[int | None] = mapped_column(Integer)
    sub_height: Mapped[int | None] = mapped_column(Integer)
    preferred_stream: Mapped[str] = mapped_column(
        String(4), nullable=False, default="SUB", server_default=text("'SUB'")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="UNKNOWN", server_default=text("'UNKNOWN'"))
    status_detail: Mapped[str | None] = mapped_column(String(255))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now, server_default=text("now()")
    )

    device = relationship("CctvDevice", back_populates="channels")


class CctvPlaybackSession(Base):
    """One viewer's short-lived, re-authorized session on one channel."""

    __tablename__ = "cctv_playback_sessions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_playback_sessions"),
        UniqueConstraint("token_hash", name="uq_cctv_playback_sessions_token_hash"),
        ForeignKeyConstraint(
            ["channel_id", "project_id"],
            ["cctv_channels.id", "cctv_channels.project_id"],
            name="fk_cctv_playback_sessions_channel",
            ondelete="CASCADE",
        ),
        CheckConstraint(_in("viewer_role", VIEWER_ROLES), name="ck_cctv_playback_sessions_viewer_role"),
        CheckConstraint(_in("access_basis", ACCESS_BASES), name="ck_cctv_playback_sessions_access_basis"),
        CheckConstraint(_in("stream_variant", STREAM_VARIANTS), name="ck_cctv_playback_sessions_stream_variant"),
        CheckConstraint(_in("transport", TRANSPORTS), name="ck_cctv_playback_sessions_transport"),
        CheckConstraint("octet_length(token_hash) = 32", name="ck_cctv_playback_sessions_token_hash_length"),
        CheckConstraint(
            "gateway_path IS NULL OR gateway_path ~ '^[A-Za-z0-9_-]+$'", name="ck_cctv_playback_sessions_gateway_path"
        ),
        CheckConstraint(_in("status", SESSION_STATUSES), name="ck_cctv_playback_sessions_status"),
        CheckConstraint(
            f"end_reason IS NULL OR {_in('end_reason', SESSION_END_REASONS)}",
            name="ck_cctv_playback_sessions_end_reason",
        ),
        CheckConstraint("expires_at > created_at", name="ck_cctv_playback_sessions_expires_after_created"),
        CheckConstraint(
            "status IN ('PENDING', 'ACTIVE') OR ended_at IS NOT NULL",
            name="ck_cctv_playback_sessions_terminal_has_ended_at",
        ),
        Index("ix_cctv_playback_sessions_channel_id_status", "channel_id", "status"),
        Index("ix_cctv_playback_sessions_viewer_user_id", "viewer_user_id"),
        Index("ix_cctv_playback_sessions_project_id", "project_id"),
        Index(
            "ix_cctv_playback_sessions_open_expires_at",
            "expires_at",
            postgresql_where=text("status IN ('PENDING', 'ACTIVE')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    channel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    # Equal to the channel's project_id (composite FK); NOT a foreign key to projects.
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    viewer_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    viewer_role: Mapped[str] = mapped_column(String(16), nullable=False)
    access_basis: Mapped[str] = mapped_column(String(20), nullable=False)
    stream_variant: Mapped[str] = mapped_column(String(4), nullable=False)
    transport: Mapped[str] = mapped_column(
        String(16), nullable=False, default="WEBRTC", server_default=text("'WEBRTC'")
    )
    # SHA-256 of the one-time session token. The token itself is never stored.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    gateway_path: Mapped[str | None] = mapped_column(String(128))
    gateway_session_ref: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING", server_default=text("'PENDING'"))
    end_reason: Mapped[str | None] = mapped_column(String(24))
    client_ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CctvAuditEvent(Base):
    """Append-only CCTV audit trail.

    No foreign keys at all -- not even to the CCTV tables -- because an audit
    entry must outlive the device, channel or session it describes. Append-only
    is enforced by the application: nothing in the CCTV service updates or
    deletes a row here.
    """

    __tablename__ = "cctv_audit_events"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_audit_events"),
        CheckConstraint(r"action ~ '^[a-z]+(\.[a-z_]+)+$'", name="ck_cctv_audit_events_action_format"),
        CheckConstraint(_in("outcome", AUDIT_OUTCOMES), name="ck_cctv_audit_events_outcome"),
        CheckConstraint("jsonb_typeof(detail) = 'object'", name="ck_cctv_audit_events_detail_is_object"),
        Index("ix_cctv_audit_events_occurred_at", "occurred_at"),
        Index("ix_cctv_audit_events_project_id_occurred_at", "project_id", "occurred_at"),
        Index("ix_cctv_audit_events_device_id", "device_id"),
        Index("ix_cctv_audit_events_channel_id", "channel_id"),
        Index("ix_cctv_audit_events_actor_user_id", "actor_user_id"),
        Index("ix_cctv_audit_events_action", "action"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    actor_role: Mapped[str | None] = mapped_column(String(30))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    outcome: Mapped[str] = mapped_column(String(8), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)  # no foreign key: the audit outlives it
    device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    playback_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    client_ip: Mapped[str | None] = mapped_column(INET)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))


class CctvProjectAccess(Base):
    """One user's completed DVR/NVR verification for one project's camera.

    The device stays project-scoped and shared. This row says *who has proved
    they hold the recorder's credentials*, never who owns the camera: the House
    Owner, the Builder and the Site Engineer each hold their own row against the
    SAME `device_id`, so a project has one DVR and one channel set however many
    people can view it.

    Being assigned to a project is therefore necessary but not sufficient. The
    CCTV service checks project authorization first (access.py) and then looks
    for a live row here; both must pass before any camera content is served.

    Same rule as every other CCTV table: no foreign key to `projects` or
    `users`, because PostgreSQL implements a foreign key with triggers on the
    referenced table and those existing tables must stay untouched. Only
    `device_id` points at a CCTV table.
    """

    __tablename__ = "cctv_project_access"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_project_access"),
        # One grant per person per project. Re-verifying updates that row rather
        # than stacking a second one.
        UniqueConstraint("project_id", "user_id", name="uq_cctv_project_access_project_user"),
        ForeignKeyConstraint(
            ["device_id"],
            ["cctv_devices.id"],
            name="fk_cctv_project_access_device",
            ondelete="CASCADE",
        ),
        Index("ix_cctv_project_access_project_id", "project_id"),
        Index("ix_cctv_project_access_user_id", "user_id"),
        Index("ix_cctv_project_access_device_id", "device_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    # Set to withdraw access without losing the record that it was once granted.
    # A row is live only while this is NULL.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


RATE_LIMIT_SCOPES = ("DEVICE_CHECK_DEVICE", "DEVICE_CHECK_USER")


class CctvDiscoveryResult(Base):
    """One ONVIF discovery result, held until the user saves a selection from it.

    It used to live in the memory of the worker that ran the discovery, so with
    more than one worker the save request could land on a process that had never
    seen it. Here every worker reads the same row.

    `candidates` holds what the device reported for each video source --
    profile tokens, codecs, sizes and the policy-checked stream PATHS. Those
    paths are the same values `cctv_channels` stores; like them they never leave
    the server. No credential, host, port or URI is ever written here.
    """

    __tablename__ = "cctv_discovery_results"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_discovery_results"),
        CheckConstraint("jsonb_typeof(candidates) = 'array'", name="ck_cctv_discovery_results_candidates_is_array"),
        CheckConstraint("expires_at > created_at", name="ck_cctv_discovery_results_expires_after_created"),
        ForeignKeyConstraint(
            ["device_id"],
            ["cctv_devices.id"],
            name="fk_cctv_discovery_results_device",
            ondelete="CASCADE",
        ),
        Index("ix_cctv_discovery_results_device_id", "device_id"),
        Index("ix_cctv_discovery_results_user_id", "user_id"),
        Index("ix_cctv_discovery_results_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # SHA-256 of the device's connection settings at discovery time: a result is
    # refused once the device it describes has been re-pointed.
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    candidates: Mapped[list] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CctvRateLimitEvent(Base):
    """One reserved device check (reconnect, verify, discovery, setup).

    Shared by every worker process, so the per-device interval and the per-user
    budget hold however many workers serve the API. A reservation is written in
    its own committed transaction before anything is sent to the device, so a
    request that later fails still counts. Rows older than an hour carry no
    information and are removed as new ones are written.
    """

    __tablename__ = "cctv_rate_limit_events"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_cctv_rate_limit_events"),
        CheckConstraint(_in("scope", RATE_LIMIT_SCOPES), name="ck_cctv_rate_limit_events_scope"),
        Index("ix_cctv_rate_limit_events_lookup", "scope", "subject", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, default=new_uuid7, server_default=text("uuidv7()"))
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    # A device id or a user id, as text.
    subject: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=text("now()")
    )
