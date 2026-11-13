"""Rate-limit events shared by every API process (technical-architecture.md 6.4, 14.1).

One row per counted attempt: a bucket (what is limited), a SHA-256 of the key (whom it is
limited for: an account identifier or an address, never stored in clear) and when. Rows
older than a day carry no information; the scheduler removes them.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import CHAR, DateTime, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, new_uuid7


def _utc_now() -> datetime:
    return datetime.now(UTC)


class RateLimitEvent(Base):
    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events__bucket_key_hash_occurred_at", "bucket", "key_hash", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid7, server_default=text("uuidv7()"))
    bucket: Mapped[str] = mapped_column(String(40), nullable=False)
    key_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, server_default=text("now()")
    )
