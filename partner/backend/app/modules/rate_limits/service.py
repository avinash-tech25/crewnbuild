"""Shared rate limits (technical-architecture.md 6.4, 14.1): counted in PostgreSQL
(rate_limit_events), so every API process sees the same counts.

    hit(...)      count this attempt if the key is under its limit; False when it is not
    blocked(...)  whether the key has reached its limit (nothing recorded)
    record(...)   count one attempt (a failed sign-in, say)
    clear(...)    forget a key's attempts (a successful sign-in)

Writes go through the caller's session and are committed at once: call these where the
session holds nothing else unfinished. A transaction-scoped advisory lock per bucket and
key makes check-then-record atomic across processes. Keys are stored as a SHA-256 hash.
"""

import hashlib
import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.modules.rate_limits.models import RateLimitEvent

RETENTION = timedelta(days=1)


def key_hash(key: str) -> str:
    return hashlib.sha256((key or "").strip().casefold().encode("utf-8")).hexdigest()


def _lock(database: Session, bucket: str, digest: str) -> None:
    database.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"rate:{bucket}:{digest}"})


def _count(database: Session, bucket: str, digest: str, window_seconds: int) -> int:
    since = datetime.now(UTC) - timedelta(seconds=window_seconds)
    found = database.scalar(
        select(func.count())
        .select_from(RateLimitEvent)
        .where(RateLimitEvent.bucket == bucket, RateLimitEvent.key_hash == digest, RateLimitEvent.occurred_at > since)
    )
    return int(found or 0)


def retry_after_seconds(database: Session, bucket: str, key: str, window_seconds: int) -> int:
    """Seconds until the oldest counted attempt leaves the window (at least 1)."""
    since = datetime.now(UTC) - timedelta(seconds=window_seconds)
    oldest = database.scalar(
        select(func.min(RateLimitEvent.occurred_at)).where(
            RateLimitEvent.bucket == bucket,
            RateLimitEvent.key_hash == key_hash(key),
            RateLimitEvent.occurred_at > since,
        )
    )
    if oldest is None:
        return 1
    left = (oldest + timedelta(seconds=window_seconds) - datetime.now(UTC)).total_seconds()
    return max(1, math.ceil(left))


def blocked(database: Session, bucket: str, key: str, limit: int, window_seconds: int) -> bool:
    return _count(database, bucket, key_hash(key), window_seconds) >= max(1, limit)


def record(database: Session, bucket: str, key: str) -> None:
    database.add(RateLimitEvent(bucket=bucket, key_hash=key_hash(key)))
    database.commit()


def hit(database: Session, bucket: str, key: str, limit: int, window_seconds: int) -> bool:
    """Count this attempt and return True, or return False (nothing counted) when the key
    already has `limit` attempts in the window."""
    digest = key_hash(key)
    _lock(database, bucket, digest)
    if _count(database, bucket, digest, window_seconds) >= max(1, limit):
        database.rollback()
        return False
    database.add(RateLimitEvent(bucket=bucket, key_hash=digest))
    database.commit()
    return True


def clear(database: Session, bucket: str, key: str) -> None:
    database.execute(
        delete(RateLimitEvent).where(RateLimitEvent.bucket == bucket, RateLimitEvent.key_hash == key_hash(key))
    )
    database.commit()


def purge_expired(database: Session) -> int:
    """Remove attempts older than a day (the scheduler's job)."""
    result = database.execute(delete(RateLimitEvent).where(RateLimitEvent.occurred_at < datetime.now(UTC) - RETENTION))
    database.commit()
    return int(result.rowcount or 0)  # type: ignore[attr-defined]
