"""General weather for anyone, signed in or not: the public pages' weather.

A place is only coordinates the visitor's browser sent (their device's position,
with their permission, or a place they searched for). The answer carries that
place's current weather, today's outlook, the presentation theme and its
WARNING/SEVERE forecast warnings -- nothing about any project, account, alert
history or acknowledgement, and no weather row is written.

It reuses the module's provider, rules and thresholds. Forecasts are cached in
memory by place rounded to about a kilometre (the provider never gets a more
exact position) for WEATHER_CACHE_MINUTES, and at most
PUBLIC_NEW_FETCHES_PER_MINUTE places not in the cache are fetched in any minute,
so public traffic can never run the provider into its rate limit. Past that, or
when the provider fails, the last good forecast is shown, marked with its time,
for up to WEATHER_MAX_STALE_MINUTES. Weather is never made up.

Device positions are named with a reverse lookup (OpenStreetMap Nominatim, at
city level), cached the same way and asked at most once a second.
"""

import logging
import threading
import time
from datetime import UTC, datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.database.types import naive_utc_now
from app.modules.rate_limits import service as limits
from app.modules.weather.weather_alert_service import ALERT_TYPE_LABELS, SEVERITY_RANK, evaluate, recommendations_for
from app.modules.weather.weather_presentation import presentation
from app.modules.weather.weather_provider_service import USER_AGENT, WeatherProviderError, build_provider
from app.modules.weather.weather_settings import WeatherSettings, get_weather_settings

logger = logging.getLogger(__name__)
UTC = UTC
PLACE_DECIMALS = 2
PUBLIC_NEW_FETCHES_PER_MINUTE = 60
FAILURE_COOLDOWN = timedelta(minutes=2)
NAME_CACHE_LIMIT = 5000

_cache: dict[tuple[float, float], dict] = {}
_names: dict[tuple[float, float], str | None] = {}
_guard = threading.Lock()
_place_locks: dict[tuple[float, float], threading.Lock] = {}
_name_lock = threading.Lock()
_last_name_lookup = {"monotonic": 0.0}


def clear_public_cache() -> None:
    with _guard:
        _cache.clear()
        _names.clear()


def place_key(latitude: float, longitude: float) -> tuple[float, float]:
    return round(latitude, PLACE_DECIMALS), round(longitude, PLACE_DECIMALS)


def _lock_for(key) -> threading.Lock:
    with _guard:
        return _place_locks.setdefault(key, threading.Lock())


def utcnow() -> datetime:
    return naive_utc_now()


PUBLIC_FETCH_BUCKET = "weather:public-new-place"


class PublicWeatherService:
    def __init__(
        self, database: Session, settings: WeatherSettings | None = None, provider=None, clock=utcnow, transport=None
    ):
        self.database = database
        self.settings = settings or get_weather_settings()
        self._provider = provider
        self.clock = clock
        self.transport = transport

    @property
    def provider(self):
        if self._provider is None:
            self._provider = build_provider(self.settings)
        return self._provider

    # ------------------------------------------------------------------ weather
    def _budget_allows(self) -> bool:
        """At most PUBLIC_NEW_FETCHES_PER_MINUTE places not already cached are fetched for
        the public pages each minute, counted across every process (rate_limit_events)."""
        return limits.hit(self.database, PUBLIC_FETCH_BUCKET, "all", PUBLIC_NEW_FETCHES_PER_MINUTE, 60)

    def forecast(self, key) -> dict | None:
        now = self.clock()
        entry = _cache.get(key)
        if self._fresh(entry, now):
            return entry
        with _lock_for(key):
            entry = _cache.get(key)
            if self._fresh(entry, now) or self._cooling_down(entry, now):
                return entry
            if not self._budget_allows():
                logger.warning("weather.public_budget_reached place=%s", key)
                return entry
            entry = dict(entry or {})
            try:
                entry.update(data=self.provider.fetch(*key), fetched_at=now, error=None, failed_at=None)
            except WeatherProviderError as error:
                logger.warning("weather.public_fetch_failed place=%s: %s", key, error.reason)
                entry.update(error=error.reason, failed_at=now)
                entry.setdefault("data", None)
                entry.setdefault("fetched_at", None)
            with _guard:
                _cache[key] = entry
            return entry

    def _fresh(self, entry, now) -> bool:
        return bool(
            entry
            and entry.get("data")
            and entry["fetched_at"] > now - timedelta(minutes=self.settings.weather_cache_minutes)
        )

    @staticmethod
    def _cooling_down(entry, now) -> bool:
        return bool(entry and entry.get("failed_at") and entry["failed_at"] > now - FAILURE_COOLDOWN)

    def weather(self, latitude: float, longitude: float, country_code: str | None = None) -> dict:
        key = place_key(latitude, longitude)
        entry = self.forecast(key)
        now = self.clock()
        fetched = entry.get("fetched_at") if entry else None
        usable = bool(
            entry
            and entry.get("data")
            and fetched
            and fetched > now - timedelta(minutes=self.settings.weather_max_stale_minutes)
        )
        stale = bool(usable and fetched <= now - timedelta(minutes=self.settings.weather_cache_minutes))
        answer = {
            "location": {"latitude": key[0], "longitude": key[1]},
            "status": {
                "available": usable,
                "stale": stale,
                "last_updated_at": fetched.replace(tzinfo=UTC).isoformat() if usable else None,
                "message": None
                if usable and not stale
                else (
                    "Showing the last successful update; the weather service could not be reached."
                    if usable
                    else "Weather data is unavailable right now."
                ),
            },
            "timezone": None,
            "current": None,
            "today": None,
            "next_hours": [],
            "warnings": [],
            "presentation": presentation(None, self.settings.thresholds_for(country_code), []),
        }
        if not usable:
            return answer
        data = entry["data"]
        thresholds = self.settings.thresholds_for(country_code)
        candidates = evaluate(data, thresholds, now.replace(tzinfo=UTC))
        offset = timezone(timedelta(seconds=int(data.get("utc_offset_seconds") or 0)))
        today_date = now.replace(tzinfo=UTC).astimezone(offset).date().isoformat()
        today = next((row for row in data.get("daily") or [] if (row.get("date") or "") >= today_date), None)
        hours = []
        for row in data.get("hourly") or []:
            try:
                moment = datetime.fromisoformat(row["time"])
            except (KeyError, TypeError, ValueError):
                continue
            if moment + timedelta(hours=1) > now.replace(tzinfo=UTC) and len(hours) < 6:
                hours.append(
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
                )
        serious = sorted(
            (
                candidate
                for candidate in candidates
                if SEVERITY_RANK.get(candidate["severity"], 0) >= SEVERITY_RANK["WARNING"]
            ),
            key=lambda candidate: -SEVERITY_RANK[candidate["severity"]],
        )[:3]

        def local(value):
            return value.astimezone(offset).isoformat() if isinstance(value, datetime) else None

        weather = {**data, "daily": [today] if today else []}
        answer.update(
            timezone=data.get("timezone"),
            current={
                key: data["current"].get(key)
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
            next_hours=hours,
            warnings=[
                {
                    "alert_type": candidate["alert_type"],
                    "type_label": ALERT_TYPE_LABELS.get(candidate["alert_type"], candidate["alert_type"]),
                    "severity": candidate["severity"],
                    "title": candidate["title"],
                    "message": candidate["message"],
                    "expected_start": local(candidate.get("expected_start")),
                    "expected_end": local(candidate.get("expected_end")),
                    "recommendations": recommendations_for(candidate["alert_type"], candidate["severity"]),
                }
                for candidate in serious
            ],
            presentation=presentation(weather, thresholds, candidates),
        )
        return answer

    # ------------------------------------------------------------------ names
    def describe(self, latitude: float, longitude: float) -> str | None:
        """The town or city at a position, or None. Best effort; never raises."""
        key = place_key(latitude, longitude)
        if key in _names:
            return _names[key]
        base = (self.settings.weather_reverse_geocoding_base_url or "").strip().rstrip("/")
        if not base:
            return None
        with _name_lock:
            if key in _names:
                return _names[key]
            wait = 1.05 - (time.monotonic() - _last_name_lookup["monotonic"])
            if wait > 0:
                time.sleep(wait)  # Nominatim's policy: at most one request a second
            _last_name_lookup["monotonic"] = time.monotonic()
            name = None
            try:
                with httpx.Client(
                    timeout=self.settings.weather_timeout_seconds,
                    transport=self.transport,
                    headers={"User-Agent": USER_AGENT},
                ) as client:
                    response = client.get(
                        f"{base}/reverse",
                        params={
                            "lat": key[0],
                            "lon": key[1],
                            "format": "jsonv2",
                            "zoom": 10,
                            "accept-language": "en",
                        },
                    )
                if response.status_code == 200:
                    body = response.json()
                    address = body.get("address") or {}
                    name = next(
                        (
                            address.get(part)
                            for part in ("city", "town", "village", "county", "state_district", "state")
                            if address.get(part)
                        ),
                        None,
                    )
                    if name and address.get("state") and address["state"] != name:
                        name = f"{name}, {address['state']}"
            except (httpx.HTTPError, ValueError):
                logger.warning("weather.public_describe_failed place=%s", key)
            with _guard:
                if len(_names) >= NAME_CACHE_LIMIT:
                    _names.clear()
                _names[key] = name
            return name
