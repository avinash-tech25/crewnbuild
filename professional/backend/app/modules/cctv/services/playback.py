"""Live playback sessions (cctv_playback_sessions).

    create_session            POST   /cctv/channels/{channel_id}/playback
    renew_session             POST   /cctv/playback/{session_id}/renew
    end_session               DELETE /cctv/playback/{session_id}
    gateway_authorization     the media gateway's authentication callback

A session gives ONE viewer ONE channel for a short, sliding lifetime:

* Creation re-runs the normal CCTV authorization for the channel, requires an
  enabled channel on an active, ONLINE device, and enforces the per-user and
  per-channel limits on open sessions.
* The camera login is decrypted in memory, placed in the RTSP source URL that
  the gateway needs, handed to the gateway's loopback control API under a
  random per-session path, and dropped. The URL is never stored or returned.
* The browser receives the gateway playback URL for that random path and a
  random playback token. Only SHA-256(token) is stored.
* The gateway asks this backend about every viewer request. A request is
  admitted only with the token of an open, unexpired session for that exact
  path and protocol. Every REAUTHORIZE_INTERVAL the viewer's access to the
  channel is checked again from scratch; on success the session's expiry slides
  forward by the session lifetime, otherwise the session is revoked.
* The gateway authenticates a viewer once per HLS/WebRTC session, not on every
  request, so a viewer already connected is kept honest by RENEWAL: the player
  renews before the session expires, and each renewal re-runs the full CCTV
  authorization and device checks. A renewal that fails closes the session and
  removes its gateway path, which cuts the connected viewer off; a session that
  is not renewed expires.
* Ending, expiring or revoking a session closes it in the database first and
  then removes its gateway path, so a path that cannot be removed still admits
  nobody.

There is no scheduler: expired sessions are closed whenever playback is
created or ended, and when the gateway asks about them.
"""

import hashlib
import logging
import re
import secrets
import types
import uuid
from datetime import UTC, datetime, timedelta
from secrets import compare_digest
from urllib.parse import quote

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.modules.billing import entitlements
from app.modules.billing import plans as catalogue
from app.modules.cctv.models import SESSION_OPEN_STATUSES, CctvPlaybackSession
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.runtime import settings
from app.modules.cctv.schemas import (
    CctvPlaybackRequest,
    CctvPlaybackSessionEnded,
    CctvPlaybackSessionOut,
    CctvPlaybackSessionRenewed,
)
from app.modules.cctv.services import access, audit, cctv_error, devices, media_gateway, network_policy, not_found
from app.modules.cctv.services import credentials as credential_service
from app.modules.identity.models import User

# HD (the MAIN stream) is a Premium feature for builders in India; owners,
# engineers and builders elsewhere keep both qualities (entitlements.builder_feature_allowed).
PLAN_UPGRADE_REQUIRED = entitlements.PLAN_UPGRADE_REQUIRED
HD_UPGRADE_MESSAGE = "HD viewing is included in Premium. Your plan includes SD."


def hd_allowed(database: Session, user: User) -> bool:
    return entitlements.builder_feature_allowed(database, user, catalogue.HD_VIDEO)


logger = logging.getLogger(__name__)

TOKEN_BYTES = 32
GATEWAY_PATH_BYTES = 24
GATEWAY_PATH_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
REAUTHORIZE_INTERVAL = timedelta(seconds=15)
LOOPBACK_CLIENTS = frozenset({"127.0.0.1", "::1"})
DEVICE_ONLINE = "ONLINE"

CODE_DEVICE_NOT_ONLINE = devices.CODE_DEVICE_NOT_ONLINE
CODE_STREAM_NOT_CONFIGURED = devices.CODE_STREAM_NOT_CONFIGURED
CODE_SESSION_LIMIT = "CCTV_PLAYBACK_SESSION_LIMIT"
CODE_GATEWAY_ERROR = "CCTV_MEDIA_GATEWAY_ERROR"
CODE_SESSION_EXPIRED = "CCTV_PLAYBACK_SESSION_EXPIRED"
CODE_SESSION_ENDED = "CCTV_PLAYBACK_SESSION_ENDED"


def utc_now() -> datetime:
    return datetime.now(UTC)


def session_ttl_seconds() -> int:
    return max(30, min(int(settings.cctv_playback_session_ttl_seconds), 3600))


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def rtsp_source_url(host: str, port: int, stream_path: str, plain: credential_service.PlainCredentials) -> str:
    """The gateway's source. Holds the camera login: build, hand over, drop."""
    address = f"[{host}]" if ":" in host else host
    username = quote(plain.username.get_secret_value(), safe="")
    password = quote(plain.password.get_secret_value(), safe="")
    return f"rtsp://{username}:{password}@{address}:{port}{stream_path}"


def _finish(row: CctvPlaybackSession, final_status: str, end_reason: str, now: datetime) -> None:
    row.status = final_status
    row.end_reason = end_reason
    row.ended_at = now


def _error_code(error: HTTPException) -> str:
    detail = error.detail if isinstance(error.detail, dict) else {}
    return str(detail.get("code") or f"HTTP_{error.status_code}")


def remove_gateway_path_quietly(gateway_path: str | None) -> None:
    if not gateway_path:
        return
    try:
        media_gateway.remove_path(gateway_path)
    except media_gateway.GatewayError as failure:
        # The session is already closed, so the path admits nobody.
        logger.warning("CCTV playback: gateway path removal failed (%s).", failure.reason)


def _expire_stale_sessions(database: Session) -> list[str]:
    """Close open sessions whose lifetime has passed. Returns their gateway paths,
    to be removed after the caller commits."""
    now = utc_now()
    rows = CctvRepository(database).lock_expired_open_sessions(now)
    paths = []
    for row in rows:
        _finish(row, "EXPIRED", "EXPIRED", now)
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_ENDED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=None,
            request=None,
            project_id=row.project_id,
            channel_id=row.channel_id,
            playback_session_id=row.id,
            detail={"end_reason": "EXPIRED", "transport": row.transport},
        )
        if row.gateway_path:
            paths.append(row.gateway_path)
    return paths


def _open_session_count(database: Session, now: datetime, **criteria) -> int:
    return CctvRepository(database).count_open_sessions(now, criteria)


# --- create ------------------------------------------------------------------


def create_session(
    database: Session, user: User, channel_id: uuid.UUID, payload: CctvPlaybackRequest, request: Request
) -> CctvPlaybackSessionOut:
    repository = CctvRepository(database)
    stale_paths = _expire_stale_sessions(database)
    if stale_paths:
        devices._commit(database)
        for path in stale_paths:
            remove_gateway_path_quietly(path)

    try:
        channel, device, grant = access.load_channel(database, user, channel_id, request, for_update=True)
    except HTTPException as refusal:
        if refusal.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND):
            audit.record_denied(
                actor=user,
                request=request,
                reason=_error_code(refusal),
                http_status=refusal.status_code,
                channel_id=channel_id,
                action=audit.ACTION_PLAYBACK_DENIED,
            )
        raise
    ids = {"project_id": channel.project_id, "device_id": device.id, "channel_id": channel.id}

    def refuse(http_status: int, code: str, message: str, reason: str) -> HTTPException:
        audit.record_denied(
            actor=user,
            request=request,
            reason=reason,
            http_status=http_status,
            action=audit.ACTION_PLAYBACK_DENIED,
            **ids,
        )
        return cctv_error(http_status, code, message)

    # Being on the project is not enough: this viewer must have completed the
    # DVR/NVR verification for it. Checked before anything is spent on the
    # device or the gateway.
    access.require_project_access(
        database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id
    )

    if not channel.is_enabled:
        raise refuse(
            status.HTTP_409_CONFLICT, devices.CODE_CHANNEL_DISABLED, "This channel is disabled.", "CHANNEL_DISABLED"
        )
    if not device.is_active:
        raise refuse(
            status.HTTP_409_CONFLICT, devices.CODE_DEVICE_INACTIVE, "This camera device is inactive.", "DEVICE_INACTIVE"
        )
    if device.status != DEVICE_ONLINE:
        raise refuse(
            status.HTTP_409_CONFLICT,
            CODE_DEVICE_NOT_ONLINE,
            "This camera device is not online. Verify it first.",
            "DEVICE_NOT_ONLINE",
        )

    transport = payload.transport
    if not media_gateway.configured(transport):
        raise refuse(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            devices.CODE_GATEWAY_NOT_CONFIGURED,
            "Live playback is not configured on this server.",
            "GATEWAY_NOT_CONFIGURED",
        )
    variant = payload.stream_variant or channel.preferred_stream
    if variant == "MAIN" and not hd_allowed(database, user):
        if payload.stream_variant == "MAIN":
            raise refuse(status.HTTP_403_FORBIDDEN, PLAN_UPGRADE_REQUIRED, HD_UPGRADE_MESSAGE, "HD_NOT_IN_PLAN")
        variant = "SUB"  # the channel's HD default -> SD for this builder
    stream_path = channel.main_stream_path if variant == "MAIN" else channel.sub_stream_path
    if not stream_path:
        raise refuse(
            status.HTTP_409_CONFLICT,
            CODE_STREAM_NOT_CONFIGURED,
            "This channel has no stream for the requested quality.",
            "STREAM_NOT_CONFIGURED",
        )

    now = utc_now()
    if _open_session_count(database, now, viewer_user_id=user.id) >= max(1, settings.cctv_max_open_sessions_per_user):
        raise refuse(
            status.HTTP_429_TOO_MANY_REQUESTS,
            CODE_SESSION_LIMIT,
            "You have too many live views open. Close one first.",
            "SESSION_LIMIT_USER",
        )
    if _open_session_count(database, now, channel_id=channel.id) >= max(1, settings.cctv_max_open_sessions_per_channel):
        raise refuse(
            status.HTTP_429_TOO_MANY_REQUESTS,
            CODE_SESSION_LIMIT,
            "This camera has too many live viewers right now.",
            "SESSION_LIMIT_CHANNEL",
        )

    credential_row = repository.find_device_credential(device.id)
    if credential_row is None:
        raise refuse(
            status.HTTP_409_CONFLICT,
            "CCTV_CREDENTIALS_MISSING",
            "This camera device has no stored credentials.",
            "CREDENTIALS_MISSING",
        )
    try:
        host = network_policy.validate_device_host(device.host, "host")
        port = network_policy.validate_port(device.rtsp_port, "rtsp_port")
        path = network_policy.validate_stream_path(stream_path, "stream_path")
    except HTTPException as policy_error:
        if policy_error.status_code >= 500:
            raise
        raise refuse(
            status.HTTP_409_CONFLICT,
            "CCTV_NETWORK_POLICY_REJECTED",
            "The device address is not permitted by the current network policy.",
            "NETWORK_POLICY_REJECTED",
        ) from None

    # Fails closed (503) while the JWT secret is weak or the key is missing.
    plain = credential_service.decrypt_for_connection(
        credential_row.username_ciphertext, credential_row.password_ciphertext, credential_row.key_version
    )

    token = secrets.token_urlsafe(TOKEN_BYTES)
    gateway_path = "p" + secrets.token_urlsafe(GATEWAY_PATH_BYTES)
    ttl = session_ttl_seconds()
    playback_url = media_gateway.playback_url(transport, gateway_path)
    session_row = CctvPlaybackSession(
        id=uuid.uuid4(),
        channel_id=channel.id,
        project_id=channel.project_id,
        viewer_user_id=user.id,
        viewer_role=user.role,
        access_basis=grant.basis,
        stream_variant=variant,
        transport=transport,
        token_hash=hash_token(token),
        gateway_path=gateway_path,
        status="PENDING",
        client_ip=audit.client_ip(request),
        created_at=now,
        expires_at=now + timedelta(seconds=ttl),
    )
    repository.add(session_row)
    audit.record(
        database,
        action=audit.ACTION_PLAYBACK_REQUESTED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        playback_session_id=session_row.id,
        detail={"transport": transport, "stream_variant": variant},
        **ids,
    )
    repository.flush()

    source_url = None
    try:
        source_url = rtsp_source_url(host, port, path, plain)
        media_gateway.add_path(gateway_path, source_url)
    except media_gateway.GatewayError as failure:
        source_url = plain = None
        _finish(session_row, "FAILED", "GATEWAY_ERROR", utc_now())
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_ENDED,
            outcome=audit.OUTCOME_FAILED,
            actor=user,
            request=request,
            playback_session_id=session_row.id,
            detail={"reason": failure.reason, "end_reason": "GATEWAY_ERROR", "transport": transport},
            **ids,
        )
        devices._commit(database)
        raise cctv_error(
            status.HTTP_502_BAD_GATEWAY, CODE_GATEWAY_ERROR, "The live stream could not be started. Try again shortly."
        ) from None
    finally:
        source_url = plain = None

    try:
        devices._commit(database)
    except HTTPException:
        remove_gateway_path_quietly(gateway_path)
        raise

    codec = channel.main_codec if variant == "MAIN" else channel.sub_codec
    return CctvPlaybackSessionOut(
        session_id=session_row.id,
        channel_id=channel.id,
        project_id=channel.project_id,
        transport=transport,
        stream_variant=variant,
        status=session_row.status,
        playback_url=playback_url,
        playback_token=token,
        expires_at=session_row.expires_at,
        session_ttl_seconds=ttl,
        codec=codec,
        browser_compatible_codec=None if codec is None else codec in devices.BROWSER_COMPATIBLE_CODECS,
    )


# --- recorded playback -------------------------------------------------------


def create_recorded_session(
    database: Session, user: User, channel_id: uuid.UUID, payload, request: Request
) -> CctvPlaybackSessionOut:
    """Open a recorded-playback session over the existing secure architecture.

    Identical lifecycle to a live session (one cctv_playback_sessions row, the
    same token/gateway/audit mechanism), but the media-gateway source is the
    DVR's own replay stream for an explicit [start, end] window, and the speed
    is applied by the gateway as an RTSP Scale (true DVR-side 1.5x/2x/3x). The
    recording window and speed are held only in this call and the gateway path;
    they are never written to the database."""
    repository = CctvRepository(database)
    from app.modules.cctv.services import recordings

    stale_paths = _expire_stale_sessions(database)
    if stale_paths:
        devices._commit(database)
        for path in stale_paths:
            remove_gateway_path_quietly(path)

    try:
        channel, device, grant = access.load_channel(database, user, channel_id, request, for_update=True)
    except HTTPException as refusal:
        if refusal.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND):
            audit.record_denied(
                actor=user,
                request=request,
                reason=_error_code(refusal),
                http_status=refusal.status_code,
                channel_id=channel_id,
                action=audit.ACTION_PLAYBACK_DENIED,
            )
        raise
    ids = {"project_id": channel.project_id, "device_id": device.id, "channel_id": channel.id}

    def refuse(http_status: int, code: str, message: str, reason: str) -> HTTPException:
        audit.record_denied(
            actor=user,
            request=request,
            reason=reason,
            http_status=http_status,
            action=audit.ACTION_PLAYBACK_DENIED,
            **ids,
        )
        return cctv_error(http_status, code, message)

    # Recorded playback is camera content like any other, so it is behind the
    # same per-user verification as the live view.
    access.require_project_access(
        database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id
    )

    if not channel.is_enabled:
        raise refuse(
            status.HTTP_409_CONFLICT, devices.CODE_CHANNEL_DISABLED, "This channel is disabled.", "CHANNEL_DISABLED"
        )
    if not device.is_active:
        raise refuse(
            status.HTTP_409_CONFLICT, devices.CODE_DEVICE_INACTIVE, "This camera device is inactive.", "DEVICE_INACTIVE"
        )
    if device.status != DEVICE_ONLINE:
        raise refuse(
            status.HTTP_409_CONFLICT,
            CODE_DEVICE_NOT_ONLINE,
            "This camera device is not online. Verify it first.",
            "DEVICE_NOT_ONLINE",
        )

    transport = payload.transport
    if not media_gateway.configured(transport):
        raise refuse(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            devices.CODE_GATEWAY_NOT_CONFIGURED,
            "Recorded playback is not configured on this server.",
            "GATEWAY_NOT_CONFIGURED",
        )

    variant = payload.stream_variant or "MAIN"
    if variant == "MAIN" and not hd_allowed(database, user):
        variant = "SUB"  # recordings replay in SD without HD in the plan
    start_local, end_local = recordings._validate_window(payload.start, payload.end)
    scale = None if payload.speed == "1" else payload.speed

    now = utc_now()
    if _open_session_count(database, now, viewer_user_id=user.id) >= max(1, settings.cctv_max_open_sessions_per_user):
        raise refuse(
            status.HTTP_429_TOO_MANY_REQUESTS,
            CODE_SESSION_LIMIT,
            "You have too many views open. Close one first.",
            "SESSION_LIMIT_USER",
        )
    if _open_session_count(database, now, channel_id=channel.id) >= max(1, settings.cctv_max_open_sessions_per_channel):
        raise refuse(
            status.HTTP_429_TOO_MANY_REQUESTS,
            CODE_SESSION_LIMIT,
            "This camera has too many viewers right now.",
            "SESSION_LIMIT_CHANNEL",
        )

    credential_row = repository.find_device_credential(device.id)
    if credential_row is None:
        raise refuse(
            status.HTTP_409_CONFLICT,
            "CCTV_CREDENTIALS_MISSING",
            "This camera device has no stored credentials.",
            "CREDENTIALS_MISSING",
        )
    try:
        network_policy.validate_device_host(device.host, "host")
        network_policy.validate_port(device.rtsp_port, "rtsp_port")
    except HTTPException as policy_error:
        if policy_error.status_code >= 500:
            raise
        raise refuse(
            status.HTTP_409_CONFLICT,
            "CCTV_NETWORK_POLICY_REJECTED",
            "The device address is not permitted by the current network policy.",
            "NETWORK_POLICY_REJECTED",
        ) from None

    plain = credential_service.decrypt_for_connection(
        credential_row.username_ciphertext, credential_row.password_ciphertext, credential_row.key_version
    )

    token = secrets.token_urlsafe(TOKEN_BYTES)
    gateway_path = "p" + secrets.token_urlsafe(GATEWAY_PATH_BYTES)
    ttl = session_ttl_seconds()
    playback_url = media_gateway.playback_url(transport, gateway_path)
    session_row = CctvPlaybackSession(
        id=uuid.uuid4(),
        channel_id=channel.id,
        project_id=channel.project_id,
        viewer_user_id=user.id,
        viewer_role=user.role,
        access_basis=grant.basis,
        stream_variant=variant,
        transport=transport,
        token_hash=hash_token(token),
        gateway_path=gateway_path,
        status="PENDING",
        client_ip=audit.client_ip(request),
        created_at=now,
        expires_at=now + timedelta(seconds=ttl),
    )
    repository.add(session_row)
    audit.record(
        database,
        action=audit.ACTION_PLAYBACK_REQUESTED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        playback_session_id=session_row.id,
        detail={"transport": transport, "stream_variant": variant},
        **ids,
    )
    repository.flush()

    source_url = None
    try:
        source_url = recordings.build_replay_source(device, channel, plain, start_local, end_local, variant)
        media_gateway.add_path(gateway_path, source_url, rtsp_scale=scale)
    except media_gateway.GatewayError as failure:
        source_url = plain = None
        _finish(session_row, "FAILED", "GATEWAY_ERROR", utc_now())
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_ENDED,
            outcome=audit.OUTCOME_FAILED,
            actor=user,
            request=request,
            playback_session_id=session_row.id,
            detail={"reason": failure.reason, "end_reason": "GATEWAY_ERROR", "transport": transport},
            **ids,
        )
        devices._commit(database)
        raise cctv_error(
            status.HTTP_502_BAD_GATEWAY, CODE_GATEWAY_ERROR, "The recording could not be started. Try again shortly."
        ) from None
    finally:
        source_url = plain = None

    try:
        devices._commit(database)
    except HTTPException:
        remove_gateway_path_quietly(gateway_path)
        raise

    codec = channel.main_codec if variant == "MAIN" else channel.sub_codec
    return CctvPlaybackSessionOut(
        session_id=session_row.id,
        channel_id=channel.id,
        project_id=channel.project_id,
        transport=transport,
        stream_variant=variant,
        status=session_row.status,
        playback_url=playback_url,
        playback_token=token,
        expires_at=session_row.expires_at,
        session_ttl_seconds=ttl,
        codec=codec,
        browser_compatible_codec=None if codec is None else codec in devices.BROWSER_COMPATIBLE_CODECS,
    )


# --- renew -------------------------------------------------------------------


def renew_session(database: Session, user: User, session_id: uuid.UUID, request: Request) -> CctvPlaybackSessionRenewed:
    """Extend the viewer's own open session by the session lifetime, after
    re-running the CCTV authorization and the channel/device checks. A failed
    check closes the session and removes its gateway path."""
    repository = CctvRepository(database)
    try:
        access.require_cctv_role(user, request)
    except HTTPException as refusal:
        audit.record_denied(
            actor=user,
            request=request,
            reason=_error_code(refusal),
            http_status=refusal.status_code,
            playback_session_id=session_id,
            action=audit.ACTION_PLAYBACK_DENIED,
        )
        raise

    stale_paths = _expire_stale_sessions(database)
    if stale_paths:
        devices._commit(database)
        for path in stale_paths:
            remove_gateway_path_quietly(path)

    row = repository.lock_session_refreshed(session_id)
    if row is None or row.viewer_user_id != user.id:
        repository.rollback()
        audit.record_denied(
            actor=user,
            request=request,
            reason="SESSION_NOT_FOUND",
            http_status=status.HTTP_404_NOT_FOUND,
            playback_session_id=session_id,
            action=audit.ACTION_PLAYBACK_DENIED,
        )
        raise not_found()
    ids = {"project_id": row.project_id, "channel_id": row.channel_id, "playback_session_id": row.id}
    transport, variant, gateway_path = row.transport, row.stream_variant, row.gateway_path

    def deny(http_status: int, code: str, message: str, reason: str) -> HTTPException:
        audit.record_denied(
            actor=user,
            request=request,
            reason=reason,
            http_status=http_status,
            action=audit.ACTION_PLAYBACK_DENIED,
            **ids,
        )
        return cctv_error(http_status, code, message)

    def close_and_deny(
        final_status: str, end_reason: str, action: str, reason: str, http_status: int, code: str, message: str
    ) -> HTTPException:
        _finish(row, final_status, end_reason, utc_now())
        outcome = audit.OUTCOME_SUCCESS if end_reason == "EXPIRED" else audit.OUTCOME_DENIED
        audit.record(
            database,
            action=action,
            outcome=outcome,
            actor=user,
            request=request,
            detail={"reason": reason, "end_reason": end_reason, "transport": transport},
            **ids,
        )
        devices._commit(database)
        remove_gateway_path_quietly(gateway_path)
        return deny(http_status, code, message, reason)

    if row.status not in SESSION_OPEN_STATUSES:
        final_status = row.status
        repository.rollback()
        if final_status == "EXPIRED":
            raise deny(
                status.HTTP_409_CONFLICT,
                CODE_SESSION_EXPIRED,
                "This live view has expired. Start a new one.",
                "SESSION_EXPIRED",
            )
        raise deny(
            status.HTTP_409_CONFLICT,
            CODE_SESSION_ENDED,
            "This live view has ended. Start a new one.",
            f"SESSION_{final_status}",
        )

    if row.expires_at <= utc_now():
        raise close_and_deny(
            "EXPIRED",
            "EXPIRED",
            audit.ACTION_PLAYBACK_ENDED,
            "SESSION_EXPIRED",
            status.HTTP_409_CONFLICT,
            CODE_SESSION_EXPIRED,
            "This live view has expired. Start a new one.",
        )

    # The same authorization a new session would need, from scratch.
    if user.role != row.viewer_role:
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            "VIEWER_ROLE_CHANGED",
            status.HTTP_404_NOT_FOUND,
            "CCTV_NOT_FOUND",
            "Not found.",
        )
    try:
        channel, device, _grant = access.load_channel(database, user, row.channel_id, request)
    except HTTPException as refusal:
        if refusal.status_code >= 500:
            raise
        detail = refusal.detail if isinstance(refusal.detail, dict) else {}
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            _error_code(refusal),
            refusal.status_code,
            detail.get("code", "CCTV_NOT_FOUND"),
            detail.get("message", "Not found."),
        ) from None
    if channel.project_id != row.project_id:
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            "CHANNEL_PROJECT_CHANGED",
            status.HTTP_404_NOT_FOUND,
            "CCTV_NOT_FOUND",
            "Not found.",
        )
    # The per-user verification is re-checked on every renewal, so withdrawing
    # it closes the view the viewer already has open rather than only stopping
    # the next one.
    if not access.project_access_active(database, user.id, row.project_id, device.id):
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            "CCTV_SETUP_NOT_COMPLETED",
            status.HTTP_409_CONFLICT,
            access.CODE_SETUP_REQUIRED,
            "Connect and verify this project's DVR/NVR to use its cameras.",
        )
    if not channel.is_enabled:
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            "CHANNEL_DISABLED",
            status.HTTP_409_CONFLICT,
            devices.CODE_CHANNEL_DISABLED,
            "This channel is disabled.",
        )
    if not device.is_active:
        raise close_and_deny(
            "ENDED",
            "DEVICE_OFFLINE",
            audit.ACTION_PLAYBACK_ENDED,
            "DEVICE_INACTIVE",
            status.HTTP_409_CONFLICT,
            devices.CODE_DEVICE_INACTIVE,
            "This camera device is inactive.",
        )
    if device.status != DEVICE_ONLINE:
        raise close_and_deny(
            "ENDED",
            "DEVICE_OFFLINE",
            audit.ACTION_PLAYBACK_ENDED,
            "DEVICE_NOT_ONLINE",
            status.HTTP_409_CONFLICT,
            CODE_DEVICE_NOT_ONLINE,
            "This camera device is not online.",
        )
    # HD is re-checked too, so a builder whose Premium lapses mid-view loses the
    # open HD view at its next renewal, not only the next new one.
    if variant == "MAIN" and not hd_allowed(database, user):
        raise close_and_deny(
            "REVOKED",
            "ACCESS_REVOKED",
            audit.ACTION_PLAYBACK_REVOKED,
            "HD_NOT_IN_PLAN",
            status.HTTP_403_FORBIDDEN,
            PLAN_UPGRADE_REQUIRED,
            HD_UPGRADE_MESSAGE,
        )

    now = utc_now()
    ttl = session_ttl_seconds()
    # Renewal slides the expiry to now + lifetime; it never accumulates beyond that.
    row.last_authorized_at = now
    row.expires_at = now + timedelta(seconds=ttl)
    audit.record(
        database,
        action=audit.ACTION_PLAYBACK_RENEWED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        detail={"transport": transport, "stream_variant": variant},
        **ids,
    )
    result = CctvPlaybackSessionRenewed(
        session_id=row.id,
        channel_id=row.channel_id,
        project_id=row.project_id,
        transport=transport,
        stream_variant=variant,
        status=row.status,
        expires_at=row.expires_at,
        last_authorized_at=now,
        session_ttl_seconds=ttl,
    )
    devices._commit(database)
    return result


# --- end ---------------------------------------------------------------------


def end_session(database: Session, user: User, session_id: uuid.UUID, request: Request) -> CctvPlaybackSessionEnded:
    access.require_cctv_role(user, request)
    paths = _expire_stale_sessions(database)
    row = CctvRepository(database).lock_session(session_id)
    if row is None or row.viewer_user_id != user.id:
        devices._commit(database)
        for path in paths:
            remove_gateway_path_quietly(path)
        audit.record_denied(
            actor=user,
            request=request,
            reason="SESSION_NOT_FOUND",
            http_status=status.HTTP_404_NOT_FOUND,
            action=audit.ACTION_PLAYBACK_DENIED,
        )
        raise not_found()

    if row.status in SESSION_OPEN_STATUSES:
        _finish(row, "ENDED", "USER_STOPPED", utc_now())
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_ENDED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=user,
            request=request,
            project_id=row.project_id,
            channel_id=row.channel_id,
            playback_session_id=row.id,
            detail={"end_reason": "USER_STOPPED", "transport": row.transport},
        )
    if row.gateway_path and row.gateway_path not in paths:
        # Also retried for a session that is already closed, in case an earlier removal failed.
        paths.append(row.gateway_path)
    result = CctvPlaybackSessionEnded(
        session_id=row.id, status=row.status, end_reason=row.end_reason, ended_at=row.ended_at
    )
    devices._commit(database)
    for path in paths:
        remove_gateway_path_quietly(path)
    return result


# --- gateway authorization callback ------------------------------------------


def _text(body: dict, key: str) -> str:
    value = body.get(key)
    return value if isinstance(value, str) else ""


def _as_request(ip: str):
    """The viewer's address, as audit.client_ip expects it."""
    return types.SimpleNamespace(client=types.SimpleNamespace(host=ip or None))


def _access_problem(database: Session, row: CctvPlaybackSession) -> tuple[str, str, str, str] | None:
    """(reason, end_reason, final status, audit action) if the viewer may no longer watch."""
    repository = CctvRepository(database)
    revoked = ("REVOKED", audit.ACTION_PLAYBACK_REVOKED)
    viewer = repository.get_user(row.viewer_user_id)
    if viewer is None or (getattr(viewer, "status", "ACTIVE") or "ACTIVE").upper() != "ACTIVE":
        return ("VIEWER_NOT_ACTIVE", "ACCESS_REVOKED", *revoked)
    if viewer.role != row.viewer_role or viewer.role not in access.CCTV_ROLES:
        return ("VIEWER_ROLE_CHANGED", "ACCESS_REVOKED", *revoked)
    channel = repository.get_channel(row.channel_id)
    if channel is None or channel.project_id != row.project_id:
        return ("CHANNEL_NOT_FOUND", "ACCESS_REVOKED", *revoked)
    if not channel.is_enabled:
        return ("CHANNEL_DISABLED", "ACCESS_REVOKED", *revoked)
    project = access.load_project_access_row(database, row.project_id)
    if project is None or access.access_basis(database, viewer, project) is None:
        return ("NO_PROJECT_ACCESS", "ACCESS_REVOKED", *revoked)
    # The gateway asks about every viewer request, so re-checking the per-user
    # verification here is what makes a withdrawn grant stop a stream that is
    # already playing, not merely block the next one.
    if not access.project_access_active(database, row.viewer_user_id, row.project_id, channel.device_id):
        return ("CCTV_SETUP_NOT_COMPLETED", "ACCESS_REVOKED", *revoked)
    device = repository.get(channel.device_id)
    if device is None or not device.is_active:
        return ("DEVICE_INACTIVE", "DEVICE_OFFLINE", "ENDED", audit.ACTION_PLAYBACK_ENDED)
    if device.status != DEVICE_ONLINE:
        return ("DEVICE_NOT_ONLINE", "DEVICE_OFFLINE", "ENDED", audit.ACTION_PLAYBACK_ENDED)
    return None


def authorize_gateway_request(database: Session, body: dict, client_host: str | None) -> tuple[bool, list[str]]:
    """Decide one gateway authentication request. Returns (allowed, gateway paths
    to remove once the response has been sent)."""
    repository = CctvRepository(database)
    if client_host not in LOOPBACK_CLIENTS:
        return False, []
    action = _text(body, "action")
    if action == "api":
        return media_gateway.api_credentials_valid(_text(body, "user"), _text(body, "password")), []
    if action != "read":
        return False, []

    viewer_request = _as_request(_text(body, "ip"))
    protocol, path, token = _text(body, "protocol"), _text(body, "path"), _text(body, "token")
    if (
        not token
        or protocol not in media_gateway.PROTOCOL_FOR_TRANSPORT.values()
        or not GATEWAY_PATH_PATTERN.fullmatch(path)
    ):
        audit.record_denied(
            actor=None,
            request=viewer_request,
            reason="PLAYBACK_TOKEN_MISSING_OR_INVALID_REQUEST",
            http_status=status.HTTP_401_UNAUTHORIZED,
            action=audit.ACTION_PLAYBACK_DENIED,
        )
        return False, []

    row = repository.find_session_by_token_hash(hash_token(token))
    if row is None or not compare_digest((row.gateway_path or "").encode("utf-8"), path.encode("utf-8")):
        audit.record_denied(
            actor=None,
            request=viewer_request,
            reason="PLAYBACK_SESSION_NOT_FOUND",
            http_status=status.HTTP_401_UNAUTHORIZED,
            action=audit.ACTION_PLAYBACK_DENIED,
        )
        return False, []

    viewer = types.SimpleNamespace(id=row.viewer_user_id, role=row.viewer_role)
    ids = {"project_id": row.project_id, "channel_id": row.channel_id, "playback_session_id": row.id}
    if media_gateway.PROTOCOL_FOR_TRANSPORT.get(row.transport) != protocol:
        audit.record_denied(
            actor=viewer,
            request=viewer_request,
            reason="PLAYBACK_TRANSPORT_MISMATCH",
            http_status=status.HTTP_401_UNAUTHORIZED,
            action=audit.ACTION_PLAYBACK_DENIED,
            **ids,
        )
        return False, []
    if row.status not in SESSION_OPEN_STATUSES:
        audit.record_denied(
            actor=viewer,
            request=viewer_request,
            reason=f"PLAYBACK_SESSION_{row.status}",
            http_status=status.HTTP_401_UNAUTHORIZED,
            action=audit.ACTION_PLAYBACK_DENIED,
            **ids,
        )
        return False, []

    now = utc_now()
    reauthorize_due = row.last_authorized_at is None or now - row.last_authorized_at >= REAUTHORIZE_INTERVAL
    if row.status == "ACTIVE" and row.expires_at > now and not reauthorize_due:
        return True, []

    # A state change is needed: lock the row and decide again on fresh values.
    row = repository.lock_existing_session_refreshed(row.id)
    now = utc_now()
    if row.status not in SESSION_OPEN_STATUSES:
        repository.rollback()
        return False, []
    if row.expires_at <= now:
        _finish(row, "EXPIRED", "EXPIRED", now)
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_ENDED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=viewer,
            request=viewer_request,
            detail={"end_reason": "EXPIRED", "transport": row.transport},
            **ids,
        )
        devices._commit(database)
        return False, [row.gateway_path]

    if row.last_authorized_at is None or now - row.last_authorized_at >= REAUTHORIZE_INTERVAL:
        problem = _access_problem(database, row)
        if problem is not None:
            reason, end_reason, final_status, action = problem
            _finish(row, final_status, end_reason, now)
            audit.record(
                database,
                action=action,
                outcome=audit.OUTCOME_DENIED,
                actor=viewer,
                request=viewer_request,
                detail={"reason": reason, "end_reason": end_reason, "transport": row.transport},
                **ids,
            )
            devices._commit(database)
            return False, [row.gateway_path]
        row.last_authorized_at = now
        row.expires_at = now + timedelta(seconds=session_ttl_seconds())

    if row.status == "PENDING":
        row.status = "ACTIVE"
        row.started_at = now
        audit.record(
            database,
            action=audit.ACTION_PLAYBACK_STARTED,
            outcome=audit.OUTCOME_SUCCESS,
            actor=viewer,
            request=viewer_request,
            detail={"transport": row.transport, "stream_variant": row.stream_variant},
            **ids,
        )
    devices._commit(database)
    return True, []


def gateway_authorization(body: object, client_host: str | None) -> tuple[bool, list[str]]:
    """Run authorize_gateway_request in its own session. Any failure denies."""
    if not isinstance(body, dict):
        return False, []
    database = SessionLocal()
    try:
        return authorize_gateway_request(database, body, client_host)
    except Exception:
        CctvRepository(database).rollback()
        logger.warning("CCTV playback: gateway authorization failed with an internal error; request denied.")
        return False, []
    finally:
        database.close()
