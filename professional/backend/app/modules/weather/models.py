"""Weather tables (technical-architecture.md section 10; ported from the old
app/weather/models/weather_models.py). All five keep their names; integer keys -> UUID.

A weather site is a project's site or one account's own place ("My location"); each
per-site row carries exactly one of project_id and user_id.

    weather_site_locations           where a site is
    weather_geocode_cache            what a place search answered
    weather_snapshots                a site's last successful forecast, and its last failure
    weather_alerts                   every alert, ACTIVE until RESOLVED or EXPIRED; one ACTIVE
                                     alert per site and event
    weather_alert_acknowledgements   who acknowledged which alert

Times are timestamptz; the ported code reads them as naive UTC (NaiveUtcTimestamp).
project_id references projects (ON DELETE CASCADE, as before).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, UuidPrimaryKeyMixin
from app.database.types import NaiveUtcTimestamp, naive_utc_now

SEVERITIES = ("INFO", "WATCH", "WARNING", "SEVERE")
SEVERITY_RANK = {name: rank for rank, name in enumerate(SEVERITIES)}
ALERT_STATUSES = ("ACTIVE", "RESOLVED", "EXPIRED")
LOCATION_SOURCES = ("MANUAL", "SEARCH", "AUTO_CITY")

ONE_SITE = "(project_id IS NULL) <> (user_id IS NULL)"


class WeatherSiteLocation(UuidPrimaryKeyMixin, Base):
    __tablename__ = "weather_site_locations"
    __table_args__ = (CheckConstraint(ONE_SITE, name="one_site"),)

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    location_name: Mapped[str | None] = mapped_column(String(255))
    country_code: Mapped[str | None] = mapped_column(String(2))
    timezone: Mapped[str | None] = mapped_column(String(64))
    # MANUAL, SEARCH or AUTO_CITY (found from the project's or account's city; approximate).
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL")
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, onupdate=naive_utc_now, server_default=text("now()")
    )


class WeatherGeocodeCache(UuidPrimaryKeyMixin, Base):
    __tablename__ = "weather_geocode_cache"

    # The normalised search text (lower case, single spaces).
    query_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    # Every candidate the search returned; [] when it found nothing.
    results: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


class WeatherSnapshot(UuidPrimaryKeyMixin, Base):
    __tablename__ = "weather_snapshots"
    __table_args__ = (CheckConstraint(ONE_SITE, name="one_site"),)

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    provider: Mapped[str | None] = mapped_column(String(40))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    weather_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    expires_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    last_attempt_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    last_error: Mapped[str | None] = mapped_column(String(255))
    last_error_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


class WeatherAlert(UuidPrimaryKeyMixin, Base):
    __tablename__ = "weather_alerts"
    __table_args__ = (
        Index(
            "uq_weather_alerts__project_id_event_key_active",
            "project_id",
            "event_key",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
        ),
        Index(
            "uq_weather_alerts__user_id_event_key_active",
            "user_id",
            "event_key",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND user_id IS NOT NULL"),
        ),
        Index("ix_weather_alerts__project_id_created_at", "project_id", "created_at"),
        Index("ix_weather_alerts__user_id_created_at", "user_id", "created_at"),
        CheckConstraint(ONE_SITE, name="one_site"),
    )

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The rule and the window it is about, e.g. "RAIN" or "HEAT:2026-11-10".
    event_key: Mapped[str] = mapped_column(String(120), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    # FORECAST (our thresholds) or OFFICIAL (a national weather service's warning).
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="FORECAST")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    weather_condition: Mapped[str | None] = mapped_column(String(40))
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    expected_start: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    expected_end: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE", index=True)
    provider_alert_id: Mapped[str | None] = mapped_column(String(255))
    # The severity last announced; a later escalation is announced again.
    notified_severity: Mapped[str | None] = mapped_column(String(10))
    notified_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    resolved_at: Mapped[datetime | None] = mapped_column(NaiveUtcTimestamp)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, onupdate=naive_utc_now, server_default=text("now()")
    )


class WeatherAlertAcknowledgement(UuidPrimaryKeyMixin, Base):
    __tablename__ = "weather_alert_acknowledgements"
    __table_args__ = (UniqueConstraint("alert_id", "user_id"),)

    alert_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("weather_alerts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    acknowledged_at: Mapped[datetime] = mapped_column(NaiveUtcTimestamp, nullable=False, default=naive_utc_now)
    created_at: Mapped[datetime] = mapped_column(
        NaiveUtcTimestamp, nullable=False, default=naive_utc_now, server_default=text("now()")
    )


WEATHER_TABLES = frozenset(
    {
        WeatherSiteLocation.__tablename__,
        WeatherGeocodeCache.__tablename__,
        WeatherSnapshot.__tablename__,
        WeatherAlert.__tablename__,
        WeatherAlertAcknowledgement.__tablename__,
    }
)
