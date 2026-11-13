"""The CCTV audit trail (cctv_audit_events).

Append-only by construction: this module only ever INSERTs. `detail` passes
through an allow-list, so a credential, token, stream location, ciphertext or
request body can never be written into it, whatever a caller hands over.
"""

import ipaddress
import logging
import re
import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request
from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.modules.cctv.models import CctvAuditEvent
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.runtime import settings
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

ACTION_DEVICE_CREATED = "device.created"
ACTION_DEVICE_UPDATED = "device.updated"
ACTION_DEVICE_DELETED = "device.deleted"
ACTION_CREDENTIALS_UPDATED = "device.credentials_updated"
ACTION_RECONNECT_CHECKED = "device.reconnect_checked"
ACTION_DEVICE_VERIFIED = "device.onvif_verified"
ACTION_CHANNELS_DISCOVERED = "channels.onvif_discovered"
ACTION_CHANNELS_SAVED = "channels.saved"
ACTION_CHANNEL_UPDATED = "channel.updated"
ACTION_ACCESS_DENIED = "access.denied"
ACTION_PLAYBACK_REQUESTED = "playback.requested"
ACTION_PLAYBACK_STARTED = "playback.started"
ACTION_PLAYBACK_RENEWED = "playback.renewed"
ACTION_PLAYBACK_ENDED = "playback.ended"
ACTION_PLAYBACK_REVOKED = "playback.revoked"
ACTION_PLAYBACK_DENIED = "playback.denied"

OUTCOME_SUCCESS = "SUCCESS"
OUTCOME_DENIED = "DENIED"
OUTCOME_FAILED = "FAILED"

# The only keys `detail` may carry. Anything else is dropped.
ALLOWED_DETAIL_KEYS = frozenset(
    {
        "reason",
        "http_status",
        "changed_fields",
        "channel_count",
        "created",
        "updated",
        "removed",
        "replaced",
        "check",
        "camera_verified",
        "rtsp_port_reachable",
        "onvif_port_reachable",
        # ONVIF verification and discovery: fixed result/reason codes and counts only.
        "result",
        "source",
        "authentication_enforced",
        "identity_recorded",
        "video_source_count",
        "profile_count",
        "candidate_count",
        "stream_path_count",
        "rejected_stream_count",
        # Playback sessions: fixed codes only.
        "transport",
        "stream_variant",
        "end_reason",
        "gateway_path_removed",
    }
)
# A string value may be a code or a field name: no '/', '@', spaces or quotes,
# so no URL, path, address with user-info or free text can get through.
_SAFE_STRING = re.compile(r"^[A-Za-z0-9_.:-]{0,64}$")
_MAX_LIST_ITEMS = 40


def _safe_value(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return value if _SAFE_STRING.fullmatch(value) else None
    if isinstance(value, (list, tuple)):
        items = [
            item
            for item in (_safe_value(entry) for entry in list(value)[:_MAX_LIST_ITEMS])
            if isinstance(item, (str, int, bool))
        ]
        return items
    return None


def sanitize_detail(detail: dict | None) -> dict:
    clean: dict = {}
    for key, value in (detail or {}).items():
        if key in ALLOWED_DETAIL_KEYS:
            clean[key] = _safe_value(value)
    return clean


def client_ip(request: Request | None) -> str | None:
    host = getattr(getattr(request, "client", None), "host", None)
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:
        return None


def record(
    database: Session,
    *,
    action: str,
    outcome: str,
    actor: User | None,
    request: Request | None = None,
    project_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
    playback_session_id: uuid.UUID | None = None,
    detail: dict | None = None,
) -> CctvAuditEvent:
    """Add one entry to the caller's session. The caller commits it together
    with the change it describes, so neither can be saved without the other."""
    event = CctvAuditEvent(
        actor_user_id=actor.id if actor else None,
        actor_role=actor.role if actor else None,
        action=action,
        outcome=outcome,
        project_id=project_id,
        device_id=device_id,
        channel_id=channel_id,
        playback_session_id=playback_session_id,
        client_ip=client_ip(request),
        detail=sanitize_detail(detail),
    )
    CctvRepository(database).add(event)
    return event


_denied_lock = threading.Lock()
_denied_history: dict[str, deque] = defaultdict(deque)


def _denied_allowed(actor: User | None) -> bool:
    """Cap access-denied rows per actor per minute, so a client hammering ids it
    cannot see cannot fill the audit table."""
    key = str(actor.id) if actor else "anonymous"
    now = time.monotonic()
    limit = max(1, settings.cctv_denied_audit_max_per_minute)
    with _denied_lock:
        history = _denied_history[key]
        while history and now - history[0] > 60:
            history.popleft()
        if len(history) >= limit:
            return False
        history.append(now)
        return True


def record_denied(
    *,
    actor: User | None,
    request: Request | None,
    reason: str,
    http_status: int,
    project_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
    playback_session_id: uuid.UUID | None = None,
    action: str = ACTION_ACCESS_DENIED,
) -> None:
    """Write an access-denied entry in its own short transaction.

    The request that was denied is about to fail and roll back; recording the
    denial on that same session would roll the record back with it. A failure to
    write the record must never turn the denial into a different response, so it
    is logged -- without detail -- and swallowed.
    """
    if not _denied_allowed(actor):
        return
    audit_session = SessionLocal()
    try:
        record(
            audit_session,
            action=action,
            outcome=OUTCOME_DENIED,
            actor=actor,
            request=request,
            project_id=project_id,
            device_id=device_id,
            channel_id=channel_id,
            playback_session_id=playback_session_id,
            detail={"reason": reason, "http_status": http_status},
        )
        audit_session.commit()
    except Exception:  # pragma: no cover - depends on the database
        audit_session.rollback()
        logger.warning("CCTV access-denied audit entry could not be written.")
    finally:
        audit_session.close()
