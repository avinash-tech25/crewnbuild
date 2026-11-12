"""Column types shared by the modules."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


class NaiveUtcTimestamp(TypeDecorator[datetime]):
    """Stored as timestamptz in UTC (DB-08); handed to Python as a naive UTC datetime.

    For code ported unchanged that works in naive UTC throughout (the weather module):
    a naive value is taken as UTC on the way in, and an aware one is converted."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    def process_result_value(self, value: Any, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo is not None else value


def naive_utc_now() -> datetime:
    """The current time as a naive UTC datetime (the replacement for datetime.utcnow())."""
    return datetime.now(UTC).replace(tzinfo=None)
