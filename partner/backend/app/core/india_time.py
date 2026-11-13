"""India wall-clock time for working hours. No application imports: dispatch's
repository and the preferences service both use it without an import cycle.

Partner is India-only. IST is a fixed UTC+05:30 with no daylight saving (the same
fact earnings_service relies on), so a fixed offset is exact and needs no
time-zone database -- Windows has none without the tzdata package.
"""

from datetime import UTC, datetime, time, timedelta, timezone

INDIA = timezone(timedelta(hours=5, minutes=30), "IST")
INDIA_TIMEZONE_NAME = "Asia/Kolkata"


def india_weekday_and_time(now_utc: datetime) -> tuple[int, time]:
    """(ISO weekday 1 = Monday .. 7 = Sunday, time of day) in India for a naive-UTC moment."""
    local = now_utc.replace(tzinfo=UTC).astimezone(INDIA)
    return local.isoweekday(), local.time().replace(tzinfo=None)


def within_window(start: time, end: time | None, moment: time) -> bool:
    """start <= moment < end; an end of None is the end of the day."""
    return start <= moment and (end is None or moment < end)


def india_day_start_utc(now_utc: datetime) -> datetime:
    """Midnight today in India, as a naive-UTC moment (for "jobs accepted today")."""
    local = now_utc.replace(tzinfo=UTC).astimezone(INDIA)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC).replace(tzinfo=None)
