"""Weather for a technician: where, and what the forecast and its alerts say.

Where, in this order:

    JOB      the job the technician holds now (accepted, on the way, arrived or
             in progress) -- its service location
    CHOSEN   a place the technician picked from a search
    DEVICE   the phone's position, which the browser shares only after the
             technician allows it

The page asks without coordinates first, so a current job always wins; CHOSEN
and DEVICE come with the request and are kept only in that technician's
browser. Nothing is stored in the database: Partner's tables are unchanged.

Forecasts are cached in memory by place, rounded to about a kilometre, for
WEATHER_CACHE_MINUTES -- technicians in one area share a fetch, and the provider
is never sent a position more exact than that. When the provider fails, the last
good forecast is shown, marked with its time, for up to
WEATHER_MAX_STALE_MINUTES. Weather is never made up.

Alerts are evaluated on every answer with Professional's rules and thresholds
(weather_rules, weather_thresholds). Partner has no notification table, so they
are shown on the dashboard and the Weather page, not sent. Every answer also
carries the presentation theme (weather_presentation) the pages are styled by.

public() answers the public pages (no sign-in) for coordinates the visitor's
browser sends: general weather and forecast warnings only, from the same cache;
at most PUBLIC_NEW_FETCHES_PER_MINUTE places not already cached are fetched in
any minute, so public traffic cannot run the provider into its rate limit.
"""

import logging
import threading
import time
from collections import deque
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.bookings.models import TECHNICIAN_BUSY_STATUSES, ServiceRequest
from app.modules.identity.models import Technician
from app.modules.weather.weather_config import WeatherSettings, get_weather_settings
from app.modules.weather.weather_presentation import presentation
from app.modules.weather.weather_provider import HttpJson, OpenMeteoProvider, WeatherProviderError, WeatherRateLimited
from app.modules.weather.weather_rules import ALERT_TYPE_LABELS, SEVERITY_RANK, evaluate, recommendations_for
from app.modules.weather.weather_thresholds import thresholds_for

logger = logging.getLogger(__name__)
UTC = UTC
# Partner serves India only.
COUNTRY_CODE = "IN"
PLACE_DECIMALS = 2
SOURCES = ("JOB", "CHOSEN", "DEVICE")
PUBLIC_NEW_FETCHES_PER_MINUTE = 60
_recent_public_fetches: deque = deque()

_cache: dict[tuple[float, float], dict] = {}
_cache_guard = threading.Lock()
_place_locks: dict[tuple[float, float], threading.Lock] = {}


def _place_lock(key: tuple[float, float]) -> threading.Lock:
    with _cache_guard:
        return _place_locks.setdefault(key, threading.Lock())


def clear_cache() -> None:
    with _cache_guard:
        _cache.clear()
        _recent_public_fetches.clear()


def _public_budget_allows() -> bool:
    now = time.monotonic()
    with _cache_guard:
        while _recent_public_fetches and _recent_public_fetches[0] < now - 60:
            _recent_public_fetches.popleft()
        if len(_recent_public_fetches) >= PUBLIC_NEW_FETCHES_PER_MINUTE:
            return False
        _recent_public_fetches.append(now)
        return True


def utcnow() -> datetime:
    return datetime.now(UTC)


class TechnicianWeatherService:
    def __init__(self, database: Session, settings: WeatherSettings | None = None, provider=None, clock=utcnow):
        self.database = database
        self.settings = settings or get_weather_settings()
        self._provider = provider
        self.clock = clock

    @property
    def provider(self):
        if self._provider is None:
            self._provider = OpenMeteoProvider(self.settings, HttpJson(self.settings))
        return self._provider

    # ------------------------------------------------------------------ where
    def current_job(self, technician: Technician) -> ServiceRequest | None:
        return (
            self.database.query(ServiceRequest)
            .filter(ServiceRequest.technician_id == technician.id, ServiceRequest.status.in_(TECHNICIAN_BUSY_STATUSES))
            .order_by(ServiceRequest.created_at.desc())
            .first()
        )

    def place(
        self,
        technician: Technician,
        latitude: float | None,
        longitude: float | None,
        source: str | None,
        name: str | None,
    ) -> tuple[dict | None, bool]:
        """(the place to show, whether the current job has a location)."""
        job = self.current_job(technician)
        job_place = None
        if job is not None and job.has_service_point:
            job_place = {
                "source": "JOB",
                "name": job.service_area or (f"PIN {job.pincode}" if job.pincode else "Current job"),
                "latitude": job.service_latitude,
                "longitude": job.service_longitude,
                "job_id": str(job.id),
            }
        if latitude is not None and longitude is not None:
            chosen = "DEVICE" if source == "DEVICE" else "CHOSEN"
            label = (name or "").strip()[:120] or (
                "Your current location" if chosen == "DEVICE" else f"{latitude:.3f}, {longitude:.3f}"
            )
            return {
                "source": chosen,
                "name": label,
                "latitude": latitude,
                "longitude": longitude,
                "job_id": None,
            }, job_place is not None
        return job_place, job_place is not None

    # ------------------------------------------------------------------ forecast
    def forecast(self, latitude: float, longitude: float, *, public: bool = False) -> tuple[dict | None, dict]:
        """(weather data or None, its status) for a place, through the shared cache."""
        key = (round(latitude, PLACE_DECIMALS), round(longitude, PLACE_DECIMALS))
        now = self.clock()
        entry = _cache.get(key)
        if not self._fresh(entry, now):
            with _place_lock(key):
                entry = _cache.get(key)
                if (
                    not self._fresh(entry, now)
                    and not self._cooling_down(entry, now)
                    and (not public or _public_budget_allows())
                ):
                    entry = self._fetch(key, entry, now)
        return self._status(entry, now)

    def _fresh(self, entry: dict | None, now: datetime) -> bool:
        return bool(
            entry
            and entry.get("data")
            and entry["fetched_at"] > now - timedelta(minutes=self.settings.weather_cache_minutes)
        )

    @staticmethod
    def _cooling_down(entry: dict | None, now: datetime) -> bool:
        return bool(entry and entry.get("failed_at") and entry["failed_at"] > now - timedelta(minutes=2))

    def _fetch(self, key, entry: dict | None, now: datetime) -> dict:
        entry = dict(entry or {})
        try:
            entry.update(data=self.provider.fetch(*key), fetched_at=now, error=None, failed_at=None)
        except WeatherProviderError as error:
            logger.warning("partner.weather_fetch_failed place=%s: %s", key, error.reason)
            entry.update(error=error.reason, failed_at=now)
            entry.setdefault("data", None)
            entry.setdefault("fetched_at", None)
        with _cache_guard:
            _cache[key] = entry
        return entry

    def _status(self, entry: dict | None, now: datetime) -> tuple[dict | None, dict]:
        fetched = entry.get("fetched_at") if entry else None
        usable = bool(
            entry
            and entry.get("data")
            and fetched
            and fetched > now - timedelta(minutes=self.settings.weather_max_stale_minutes)
        )
        stale = bool(usable and fetched <= now - timedelta(minutes=self.settings.weather_cache_minutes))
        error = entry.get("error") if entry else None
        if not usable:
            message = "Weather data is unavailable right now." if error else "Weather data is not available yet."
        elif stale:
            message = "Showing the last successful update; the weather service could not be reached."
        else:
            message = None
        return (entry["data"] if usable else None), {
            "available": usable,
            "stale": stale,
            "message": message,
            "last_updated_at": fetched.isoformat() if usable else None,
        }

    # ------------------------------------------------------------------ answer
    def weather(self, technician: Technician, *, latitude=None, longitude=None, source=None, name=None) -> dict:
        place, job_location = self.place(technician, latitude, longitude, source, name)
        answer = {
            "location": None,
            "job_location_available": job_location,
            "location_required": place is None,
            "status": {
                "available": False,
                "stale": False,
                "message": "Choose a location to see its weather.",
                "last_updated_at": None,
            },
            "timezone": None,
            "current": None,
            "hourly": [],
            "daily": [],
            "alerts": [],
            "presentation": presentation(None, thresholds_for(COUNTRY_CODE), []),
        }
        if place is None:
            return answer
        try:
            data, status = self.forecast(place["latitude"], place["longitude"])
        except WeatherRateLimited:
            data, status = (
                None,
                {
                    "available": False,
                    "stale": False,
                    "message": "Weather data is unavailable right now.",
                    "last_updated_at": None,
                },
            )
        shown = {**place, "latitude": round(place["latitude"], 3), "longitude": round(place["longitude"], 3)}
        answer.update(location=shown, status=status)
        if data is None:
            return answer
        now = self.clock()
        hours = self.upcoming_hours(data, now, 24)
        offset = timezone(timedelta(seconds=int(data.get("utc_offset_seconds") or 0)))
        today = now.astimezone(offset).date().isoformat()
        days = [row for row in data.get("daily") or [] if (row.get("date") or "") >= today][:7]
        alerts = self.alerts(data, now, offset)
        answer.update(
            timezone=data.get("timezone"),
            current=data.get("current"),
            hourly=hours,
            daily=days,
            alerts=alerts,
            presentation=presentation({**data, "daily": days[:1]}, thresholds_for(COUNTRY_CODE), alerts),
        )
        return answer

    @staticmethod
    def upcoming_hours(data: dict, now: datetime, limit: int) -> list[dict]:
        """The forecast hours from the current one on, at most `limit`."""
        hours = []
        for row in data.get("hourly") or []:
            try:
                moment = datetime.fromisoformat(row["time"])
            except (KeyError, TypeError, ValueError):
                continue
            if moment + timedelta(hours=1) > now and len(hours) < limit:
                hours.append(row)
        return hours

    def public(self, latitude: float, longitude: float) -> dict:
        """General weather for the public pages: no account, job or history."""
        data, status = self.forecast(latitude, longitude, public=True)
        answer = {
            "location": {"latitude": round(latitude, PLACE_DECIMALS), "longitude": round(longitude, PLACE_DECIMALS)},
            "status": status,
            "timezone": None,
            "current": None,
            "today": None,
            "next_hours": [],
            "warnings": [],
            "presentation": presentation(None, thresholds_for(COUNTRY_CODE), []),
        }
        if data is None:
            return answer
        now = self.clock()
        offset = timezone(timedelta(seconds=int(data.get("utc_offset_seconds") or 0)))
        today_date = now.astimezone(offset).date().isoformat()
        today = next((row for row in data.get("daily") or [] if (row.get("date") or "") >= today_date), None)
        alerts = self.alerts(data, now, offset)
        current = data.get("current") or {}
        answer.update(
            timezone=data.get("timezone"),
            current={
                key: current.get(key)
                for key in (
                    "observed_at",
                    "temperature_c",
                    "feels_like_c",
                    "humidity_pct",
                    "wind_speed_kmh",
                    "wind_gust_kmh",
                    "wind_direction_deg",
                    "precipitation_mm",
                    "precipitation_probability_pct",
                    "condition",
                    "is_day",
                )
            },
            today={
                key: today.get(key)
                for key in (
                    "date",
                    "temp_min_c",
                    "temp_max_c",
                    "precipitation_probability_pct",
                    "precipitation_mm",
                    "condition",
                )
            }
            if today
            else None,
            next_hours=[
                {
                    key: row.get(key)
                    for key in (
                        "time",
                        "temperature_c",
                        "precipitation_probability_pct",
                        "precipitation_mm",
                        "condition",
                    )
                }
                for row in self.upcoming_hours(data, now, 6)
            ],
            warnings=[
                {
                    key: alert[key]
                    for key in (
                        "alert_type",
                        "type_label",
                        "severity",
                        "title",
                        "message",
                        "expected_start",
                        "expected_end",
                        "recommendations",
                    )
                }
                for alert in alerts
                if SEVERITY_RANK.get(alert["severity"], 0) >= SEVERITY_RANK["WARNING"]
            ][:3],
            presentation=presentation(
                {**data, "daily": [today] if today else []}, thresholds_for(COUNTRY_CODE), alerts
            ),
        )
        return answer

    def alerts(self, data: dict, now: datetime, offset: timezone) -> list[dict]:
        candidates = evaluate(data, thresholds_for(COUNTRY_CODE), now)

        def local(value):
            return value.astimezone(offset).isoformat() if isinstance(value, datetime) else None

        rows = [
            {
                "event_key": candidate["event_key"],
                "alert_type": candidate["alert_type"],
                "type_label": ALERT_TYPE_LABELS.get(candidate["alert_type"], candidate["alert_type"]),
                "severity": candidate["severity"],
                "title": candidate["title"],
                "message": candidate["message"],
                "weather_condition": candidate.get("weather_condition"),
                "expected_start": local(candidate.get("expected_start")),
                "expected_end": local(candidate.get("expected_end")),
                "recommendations": recommendations_for(candidate["alert_type"], candidate["severity"]),
            }
            for candidate in candidates
        ]
        return sorted(rows, key=lambda row: (-SEVERITY_RANK.get(row["severity"], 0), row["expected_start"] or ""))
