"""Device-check rate limits, shared by every API worker (cctv_rate_limit_events).

Reconnect, verify, discovery and first-time setup all reach out to a device. Two
limits keep them from being used to sweep a network's ports or to try passwords
in a loop:

    per device  one check every CCTV_RECONNECT_MIN_INTERVAL_SECONDS
    per user    at most CCTV_RECONNECT_MAX_PER_MINUTE checks a minute

They used to be dictionaries in one worker's memory, which production's several
workers each kept separately. A reservation is now a row in PostgreSQL, written
in its OWN short transaction -- committed before anything is sent to the
device, and never rolled back with the request that made it, so a check that
fails afterwards still counts. A transaction-scoped advisory lock per subject
makes check-then-reserve atomic across workers; the device lock is always taken
before the user lock, so two reservations can never wait on each other.
"""

import uuid

from fastapi import status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.cctv.runtime import settings
from app.modules.cctv.services import cctv_error

SCOPE_DEVICE = "DEVICE_CHECK_DEVICE"
SCOPE_USER = "DEVICE_CHECK_USER"
CODE_RATE_LIMITED = "CCTV_RATE_LIMITED"
USER_WINDOW_SECONDS = 60
RETENTION_SECONDS = 3600


def _lock(connection, key: str) -> None:
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})


def _prune(connection, scope: str, subject: str) -> None:
    # Only this subject's own expired rows: bounded, and never another's.
    connection.execute(
        text(
            "DELETE FROM professional.cctv_rate_limit_events "
            "WHERE scope = :scope AND subject = :subject "
            "AND occurred_at < now() - make_interval(secs => :retention)"
        ),
        {"scope": scope, "subject": subject, "retention": RETENTION_SECONDS},
    )


def reserve_device_check(database: Session, device_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    """Reserve one check of `device_id`, or raise 429.

    `user_id` is None for a check the system makes on its own behalf (the stale
    status refresh): only the per-device interval applies to it.
    """
    device_key, user_key = str(device_id), (str(user_id) if user_id else None)
    interval = max(0, int(settings.cctv_reconnect_min_interval_seconds))
    per_minute = max(1, int(settings.cctv_reconnect_max_per_minute))
    # Its own connection and transaction: the reservation must survive whatever
    # happens to the caller's session.
    with database.get_bind().connect() as connection, connection.begin():
        _lock(connection, f"cctv-check-device:{device_key}")
        if user_key:
            _lock(connection, f"cctv-check-user:{user_key}")
        if interval:
            recent = connection.execute(
                text(
                    "SELECT 1 FROM professional.cctv_rate_limit_events "
                    "WHERE scope = :scope AND subject = :subject "
                    "AND occurred_at > now() - make_interval(secs => :interval) LIMIT 1"
                ),
                {"scope": SCOPE_DEVICE, "subject": device_key, "interval": interval},
            ).first()
            if recent is not None:
                raise cctv_error(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    CODE_RATE_LIMITED,
                    "Please wait before checking this device again.",
                )
        if user_key:
            used = connection.execute(
                text(
                    "SELECT count(*) FROM professional.cctv_rate_limit_events "
                    "WHERE scope = :scope AND subject = :subject "
                    "AND occurred_at > now() - make_interval(secs => :window)"
                ),
                {"scope": SCOPE_USER, "subject": user_key, "window": USER_WINDOW_SECONDS},
            ).scalar_one()
            if used >= per_minute:
                raise cctv_error(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    CODE_RATE_LIMITED,
                    "Too many device checks. Please wait a minute.",
                )
        connection.execute(
            text("INSERT INTO professional.cctv_rate_limit_events (scope, subject) VALUES (:scope, :subject)"),
            {"scope": SCOPE_DEVICE, "subject": device_key},
        )
        _prune(connection, SCOPE_DEVICE, device_key)
        if user_key:
            connection.execute(
                text("INSERT INTO professional.cctv_rate_limit_events (scope, subject) VALUES (:scope, :subject)"),
                {"scope": SCOPE_USER, "subject": user_key},
            )
            _prune(connection, SCOPE_USER, user_key)
