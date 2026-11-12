"""Times shown to people: stored in UTC, shown in the configured local zone (DB-08)."""

from datetime import UTC, datetime, timedelta, timezone

from app.core.config import Settings


def to_local_iso(value: datetime | None, settings: Settings) -> str | None:
    """A stored UTC timestamp as ISO 8601 in the local zone (+05:30 by default)."""
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    local = timezone(timedelta(minutes=settings.local_utc_offset_minutes), name=settings.local_timezone)
    return value.astimezone(local).isoformat()


def utc_now() -> datetime:
    return datetime.now(UTC)
