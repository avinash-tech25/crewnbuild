"""Weather module settings: the WEATHER_* values of the one Settings class (app/core/config.py),
with the provider and threshold rules on top (ported from the old app/weather/config.py).

The provider is chosen by WEATHER_API_PROVIDER:

    open-meteo       (default) current, 48 h hourly and up to 16 days daily, and
                     a dust forecast. No key on the free endpoint; the free tier
                     is for non-commercial use, so a commercial deployment sets
                     WEATHER_API_KEY and the customer endpoint in
                     WEATHER_API_BASE_URL. No official warnings.
    openweathermap   One Call API 3.0: current, 48 h hourly, 8 days daily, and
                     the national weather services' official warnings where
                     OpenWeather receives them. Needs WEATHER_API_KEY.

Every alert threshold is here, never in the frontend. A country profile (by the
site location's ISO country code) overrides the defaults, and
WEATHER_THRESHOLD_OVERRIDES (JSON) overrides both, e.g.
    {"default": {"wind_warning_kmh": 55}, "IN": {"heat_warning_c": 44}}
"""

import json
import logging
from typing import Any

from pydantic import BaseModel, Field, SecretStr

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

PROVIDERS = ("open-meteo", "openweathermap")
DEFAULT_BASE_URLS = {
    "open-meteo": "https://api.open-meteo.com/v1",
    "openweathermap": "https://api.openweathermap.org",
}

# Rainfall categories follow the India Meteorological Department's 24-hour bands
# (light 2.5-15.5 mm, moderate 15.6-64.4, heavy 64.5-115.5, very heavy
# 115.6-204.4, extremely heavy 204.5+). Hourly bands are for the next few hours.
DEFAULT_THRESHOLDS = {
    # Next few hours, peak rain per hour (mm/h).
    "rain_light_mm_h": 0.5,
    "rain_moderate_mm_h": 2.5,
    "rain_heavy_mm_h": 7.6,
    "rain_very_heavy_mm_h": 20.0,
    # A day's total (mm).
    "rain_heavy_day_mm": 64.5,
    "rain_very_heavy_day_mm": 115.6,
    # Accumulated rain that may waterlog or flood a site (mm in 24 h).
    "flood_risk_24h_mm": 115.6,
    # Probability of rain in the next 3 hours (%).
    "rain_probability_watch_pct": 60,
    # Continuous rain: this many wet hours in a row within 24 h.
    "continuous_rain_hours": 6,
    # Wind gusts (km/h); sustained wind is compared too. Lifting limits are lower
    # and are the site safety procedure's to set.
    "wind_watch_kmh": 50,
    "wind_warning_kmh": 70,
    "wind_severe_kmh": 90,
    # A thunderstorm with gusts at least this strong is severe (km/h).
    "thunderstorm_severe_gust_kmh": 75,
    # Daily maximum air temperature (deg C).
    "heat_watch_c": 38,
    "heat_warning_c": 42,
    "heat_severe_c": 46,
    # Daily minimum air temperature (deg C).
    "cold_watch_c": 4,
    "cold_warning_c": 0,
    # Excessive humidity: at least this humid while at least this warm.
    "humidity_watch_pct": 90,
    "humidity_min_temp_c": 28,
    # Dust near the ground (micrograms per cubic metre); dust storms run well above 1000.
    "dust_watch_ugm3": 500,
    "dust_warning_ugm3": 1000,
    # How far ahead the near-term rules look (hours), and the day rules (days).
    "near_term_hours": 6,
    "storm_lookahead_hours": 24,
    "day_lookahead_days": 3,
}

# Built-in country profiles: Gulf sites work in heat that would be extreme in
# India, so their heat bands start higher.
COUNTRY_THRESHOLDS = {
    "SA": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "AE": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "QA": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "BH": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "OM": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
}


class WeatherSettings(BaseModel):
    weather_api_provider: str = "open-meteo"
    weather_api_key: SecretStr = SecretStr("")
    # Empty means the provider's public endpoint (DEFAULT_BASE_URLS).
    weather_api_base_url: str = ""
    weather_geocoding_base_url: str = "https://geocoding-api.open-meteo.com/v1"
    weather_air_quality_base_url: str = "https://air-quality-api.open-meteo.com/v1"
    # Names a visitor's device position on the public pages (city level); empty turns it off.
    weather_reverse_geocoding_base_url: str = "https://nominatim.openstreetmap.org"
    weather_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    weather_max_retries: int = Field(default=2, ge=0, le=5)
    # A site's weather is fetched at most this often; readers in between get the cache.
    weather_cache_minutes: int = Field(default=25, ge=1, le=1440)
    # Cached weather older than this is no longer shown, only its time.
    weather_max_stale_minutes: int = Field(default=180, ge=5, le=2880)
    weather_forecast_days: int = Field(default=14, ge=1, le=16)
    weather_monitoring_enabled: bool = True
    # Minutes between monitoring passes over every active project site. 0 turns it off.
    weather_monitoring_interval_minutes: int = Field(default=30, ge=0, le=1440)
    # Sites under a WARNING or SEVERE alert are re-checked this often.
    weather_severe_check_interval_minutes: int = Field(default=10, ge=1, le=1440)
    # Alerts at or above this severity are sent as notifications (INFO is shown only).
    weather_notify_min_severity: str = "WATCH"
    # A resolved alert whose event returns within this many hours is reopened
    # rather than sent again (forecasts wobble around a threshold).
    weather_reopen_window_hours: int = Field(default=6, ge=0, le=72)
    # WARNING and SEVERE alerts also by e-mail, through the existing SMTP sender.
    weather_email_alerts_enabled: bool = False
    weather_threshold_overrides: str = ""

    @property
    def provider(self) -> str:
        value = (self.weather_api_provider or "").strip().lower()
        return value if value in PROVIDERS else "open-meteo"

    @property
    def base_url(self) -> str:
        return (self.weather_api_base_url.strip() or DEFAULT_BASE_URLS[self.provider]).rstrip("/")

    def overrides(self) -> dict[str, Any]:
        if not self.weather_threshold_overrides.strip():
            return {}
        try:
            value = json.loads(self.weather_threshold_overrides)
        except ValueError:
            logger.error("WEATHER_THRESHOLD_OVERRIDES is not valid JSON; the built-in thresholds are used.")
            return {}
        return value if isinstance(value, dict) else {}

    def thresholds_for(self, country_code: str | None) -> dict[str, Any]:
        code = (country_code or "").strip().upper()
        overrides = self.overrides()
        merged = {**DEFAULT_THRESHOLDS, **COUNTRY_THRESHOLDS.get(code, {})}
        for scope in ("default", code):
            for key, value in (overrides.get(scope) or {}).items():
                if key in DEFAULT_THRESHOLDS and isinstance(value, (int, float)) and not isinstance(value, bool):
                    merged[key] = value
        return merged


def weather_settings_from(settings: Settings) -> WeatherSettings:
    return WeatherSettings(**{name: getattr(settings, name) for name in WeatherSettings.model_fields})


def get_weather_settings() -> WeatherSettings:
    return weather_settings_from(get_settings())
