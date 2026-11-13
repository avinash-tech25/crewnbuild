"""Open-Meteo forecasts, normalised -- a copy of the Open-Meteo part of Professional's
weather provider (app/weather/services/weather_provider_service.py); Partner may
not import Professional code.

fetch(latitude, longitude) answers:

    {
      "provider": "open-meteo",
      "timezone": "Asia/Kolkata", "utc_offset_seconds": 19800,
      "current": {observed_at, temperature_c, feels_like_c, humidity_pct,
                  wind_speed_kmh, wind_gust_kmh, wind_direction_deg, pressure_hpa,
                  visibility_km, cloud_cover_pct, precipitation_mm,
                  precipitation_probability_pct, condition, is_day, sunrise, sunset},
      "hourly": [...next 48 hours...],
      "daily":  [...WEATHER_FORECAST_DAYS days...],
      "official_alerts": [], "supports_official_alerts": false, "supports_dust": bool,
    }

Times are ISO 8601 in the place's own offset. A value the provider did not send
stays None: nothing is ever filled in. Network calls time out, are retried with
backoff on timeouts, connection errors and 5xx, and stop for the provider's
Retry-After on 429. A response missing what it must carry is refused.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.modules.weather.weather_config import WeatherSettings

logger = logging.getLogger(__name__)

CONDITIONS = (
    "CLEAR",
    "PARTLY_CLOUDY",
    "CLOUDY",
    "FOG",
    "DRIZZLE",
    "RAIN",
    "HEAVY_RAIN",
    "SNOW",
    "THUNDERSTORM",
    "SEVERE_THUNDERSTORM",
    "DUST",
    "SQUALL",
    "TORNADO",
)
USER_AGENT = "CREWNBUILD-Partner-weather/1.0"


class WeatherProviderError(Exception):
    """The provider could not answer. `reason` is safe to store and show."""

    def __init__(self, reason: str, *, retry_after: float | None = None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after = retry_after


class WeatherRateLimited(WeatherProviderError):
    pass


# Shared by every request in this process: while the provider has asked us to
# wait, nobody calls it.
_backoff_lock = threading.Lock()
_backoff_until = {"monotonic": 0.0}


def rate_limited_for() -> float:
    with _backoff_lock:
        return max(0.0, _backoff_until["monotonic"] - time.monotonic())


def _back_off(seconds: float) -> None:
    with _backoff_lock:
        _backoff_until["monotonic"] = max(_backoff_until["monotonic"], time.monotonic() + seconds)


def reset_rate_limit() -> None:
    with _backoff_lock:
        _backoff_until["monotonic"] = 0.0


class HttpJson:
    """GET a JSON document with timeouts, retries and rate-limit handling."""

    def __init__(self, settings: WeatherSettings, transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.settings = settings
        self.transport = transport
        self.sleep = sleep

    def get(self, url: str, params: dict, *, label: str) -> dict:
        waiting = rate_limited_for()
        if waiting > 0:
            raise WeatherRateLimited("Weather provider rate limit reached; retrying later.", retry_after=waiting)
        attempts = self.settings.weather_max_retries + 1
        last: WeatherProviderError | None = None
        with httpx.Client(
            timeout=self.settings.weather_timeout_seconds, transport=self.transport, headers={"User-Agent": USER_AGENT}
        ) as client:
            for attempt in range(attempts):
                if attempt:
                    self.sleep(min(4.0, 0.5 * (2 ** (attempt - 1))))
                try:
                    response = client.get(url, params=params)
                except httpx.TimeoutException:
                    last = WeatherProviderError("Weather provider timed out.")
                    logger.warning("weather.provider_timeout %s attempt=%s", label, attempt + 1)
                    continue
                except httpx.HTTPError as error:
                    last = WeatherProviderError("Weather provider could not be reached.")
                    logger.warning(
                        "weather.provider_unreachable %s attempt=%s: %s", label, attempt + 1, type(error).__name__
                    )
                    continue
                if response.status_code == 429:
                    retry_after = _retry_after(response)
                    _back_off(retry_after)
                    logger.error("weather.provider_rate_limited %s retry_after=%ss", label, retry_after)
                    raise WeatherRateLimited(
                        "Weather provider rate limit reached; retrying later.", retry_after=retry_after
                    )
                if response.status_code >= 500:
                    last = WeatherProviderError(f"Weather provider error ({response.status_code}).")
                    logger.warning(
                        "weather.provider_5xx %s status=%s attempt=%s", label, response.status_code, attempt + 1
                    )
                    continue
                if response.status_code in (401, 403):
                    logger.error(
                        "weather.provider_auth_failed %s status=%s (check WEATHER_API_KEY)", label, response.status_code
                    )
                    raise WeatherProviderError("Weather provider refused the API key.")
                if response.status_code >= 400:
                    logger.error("weather.provider_refused %s status=%s", label, response.status_code)
                    raise WeatherProviderError(f"Weather provider refused the request ({response.status_code}).")
                try:
                    body = response.json()
                except ValueError:
                    raise WeatherProviderError("Weather provider sent an unreadable response.") from None
                if not isinstance(body, dict):
                    raise WeatherProviderError("Weather provider sent an unexpected response.")
                return body
        raise last or WeatherProviderError("Weather provider could not be reached.")


def _retry_after(response: httpx.Response) -> float:
    try:
        return min(3600.0, max(30.0, float(response.headers.get("Retry-After", "60"))))
    except ValueError:
        return 60.0


# ------------------------------------------------------------------ helpers


def _number(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _round(value, digits=1):
    number = _number(value)
    return None if number is None else round(number, digits)


def _iso(epoch, offset: timezone) -> str | None:
    number = _number(epoch)
    if number is None:
        return None
    return datetime.fromtimestamp(number, tz=offset).isoformat()


def _date(epoch, offset: timezone) -> str | None:
    number = _number(epoch)
    if number is None:
        return None
    return datetime.fromtimestamp(number, tz=offset).date().isoformat()


def _at(values, index):
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def wmo_condition(code) -> str | None:
    """WMO weather interpretation codes, as Open-Meteo sends them."""
    code = _number(code)
    if code is None:
        return None
    code = int(code)
    if code in (0, 1):
        return "CLEAR"
    if code == 2:
        return "PARTLY_CLOUDY"
    if code == 3:
        return "CLOUDY"
    if code in (45, 48):
        return "FOG"
    if 51 <= code <= 57:
        return "DRIZZLE"
    if code in (65, 67, 82):
        return "HEAVY_RAIN"
    if 61 <= code <= 67 or code in (80, 81):
        return "RAIN"
    if 71 <= code <= 77 or code in (85, 86):
        return "SNOW"
    if code == 95:
        return "THUNDERSTORM"
    if code in (96, 99):
        return "SEVERE_THUNDERSTORM"  # thunderstorm with hail
    return None


def _check_coordinates(latitude: float, longitude: float) -> None:
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise WeatherProviderError("Invalid site coordinates.")


# ------------------------------------------------------------------ providers


class OpenMeteoProvider:
    name = "open-meteo"
    supports_official_alerts = False

    CURRENT = (
        "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,"
        "cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility"
    )
    HOURLY = (
        "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,"
        "weather_code,wind_speed_10m,wind_gusts_10m"
    )
    DAILY = (
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,"
        "precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset"
    )

    def __init__(self, settings: WeatherSettings, http: HttpJson):
        self.settings = settings
        self.http = http

    def _key_params(self) -> dict:
        key = self.settings.weather_api_key.get_secret_value().strip()
        return {"apikey": key} if key else {}

    def fetch(self, latitude: float, longitude: float) -> dict:
        _check_coordinates(latitude, longitude)
        body = self.http.get(
            f"{self.settings.base_url}/forecast",
            {
                "latitude": latitude,
                "longitude": longitude,
                "current": self.CURRENT,
                "hourly": self.HOURLY,
                "daily": self.DAILY,
                "timezone": "auto",
                "timeformat": "unixtime",
                "wind_speed_unit": "kmh",
                "forecast_days": self.settings.weather_forecast_days,
                **self._key_params(),
            },
            label="open-meteo.forecast",
        )
        current, hourly, daily = body.get("current"), body.get("hourly"), body.get("daily")
        if (
            not isinstance(current, dict)
            or not isinstance(hourly, dict)
            or not isinstance(daily, dict)
            or not isinstance(hourly.get("time"), list)
            or not isinstance(daily.get("time"), list)
            or _number(current.get("temperature_2m")) is None
            or _number(current.get("time")) is None
        ):
            raise WeatherProviderError("Weather provider sent an incomplete forecast.")
        offset_seconds = int(_number(body.get("utc_offset_seconds")) or 0)
        offset = timezone(timedelta(seconds=offset_seconds))
        dust = self._dust(latitude, longitude)

        now = _number(current.get("time"))
        hours = []
        for index, epoch in enumerate(hourly["time"]):
            if _number(epoch) is None or epoch + 3600 <= now:
                continue
            if len(hours) >= 48:
                break
            hours.append(
                {
                    "time": _iso(epoch, offset),
                    "temperature_c": _round(_at(hourly.get("temperature_2m"), index)),
                    "feels_like_c": _round(_at(hourly.get("apparent_temperature"), index)),
                    "humidity_pct": _round(_at(hourly.get("relative_humidity_2m"), index), 0),
                    "precipitation_probability_pct": _round(_at(hourly.get("precipitation_probability"), index), 0),
                    "precipitation_mm": _round(_at(hourly.get("precipitation"), index), 2),
                    "wind_speed_kmh": _round(_at(hourly.get("wind_speed_10m"), index)),
                    "wind_gust_kmh": _round(_at(hourly.get("wind_gusts_10m"), index)),
                    "condition": wmo_condition(_at(hourly.get("weather_code"), index)),
                    "dust_ugm3": dust.get(int(epoch)) if dust else None,
                }
            )
        days = []
        for index, epoch in enumerate(daily["time"]):
            days.append(
                {
                    "date": _date(epoch, offset),
                    "temp_min_c": _round(_at(daily.get("temperature_2m_min"), index)),
                    "temp_max_c": _round(_at(daily.get("temperature_2m_max"), index)),
                    "precipitation_probability_pct": _round(_at(daily.get("precipitation_probability_max"), index), 0),
                    "precipitation_mm": _round(_at(daily.get("precipitation_sum"), index), 1),
                    "precipitation_hours": _round(_at(daily.get("precipitation_hours"), index), 0),
                    "wind_speed_max_kmh": _round(_at(daily.get("wind_speed_10m_max"), index)),
                    "wind_gust_max_kmh": _round(_at(daily.get("wind_gusts_10m_max"), index)),
                    "wind_direction_deg": _round(_at(daily.get("wind_direction_10m_dominant"), index), 0),
                    "condition": wmo_condition(_at(daily.get("weather_code"), index)),
                    "summary": None,
                    "sunrise": _iso(_at(daily.get("sunrise"), index), offset),
                    "sunset": _iso(_at(daily.get("sunset"), index), offset),
                }
            )
        visibility_m = _number(current.get("visibility"))
        today = days[0] if days else {}
        return {
            "provider": self.name,
            "timezone": body.get("timezone") if isinstance(body.get("timezone"), str) else None,
            "utc_offset_seconds": offset_seconds,
            "current": {
                "observed_at": _iso(now, offset),
                "temperature_c": _round(current.get("temperature_2m")),
                "feels_like_c": _round(current.get("apparent_temperature")),
                "humidity_pct": _round(current.get("relative_humidity_2m"), 0),
                "wind_speed_kmh": _round(current.get("wind_speed_10m")),
                "wind_gust_kmh": _round(current.get("wind_gusts_10m")),
                "wind_direction_deg": _round(current.get("wind_direction_10m"), 0),
                "pressure_hpa": _round(current.get("pressure_msl"), 0),
                "visibility_km": None if visibility_m is None else round(visibility_m / 1000, 1),
                "cloud_cover_pct": _round(current.get("cloud_cover"), 0),
                "precipitation_mm": _round(current.get("precipitation"), 2),
                "precipitation_probability_pct": hours[0]["precipitation_probability_pct"] if hours else None,
                "condition": wmo_condition(current.get("weather_code")),
                "is_day": bool(current.get("is_day")) if current.get("is_day") is not None else None,
                "sunrise": today.get("sunrise"),
                "sunset": today.get("sunset"),
            },
            "hourly": hours,
            "daily": days,
            "official_alerts": [],
            "supports_official_alerts": False,
            "supports_dust": dust is not None,
        }

    def _dust(self, latitude: float, longitude: float) -> dict | None:
        """Dust forecast (ug/m3) by hour, from the air-quality endpoint. Optional:
        a failure here never fails the forecast, the dust rule just stays silent."""
        if not self.settings.weather_air_quality_base_url.strip():
            return None
        try:
            body = self.http.get(
                f"{self.settings.weather_air_quality_base_url.rstrip('/')}/air-quality",
                {
                    "latitude": latitude,
                    "longitude": longitude,
                    "hourly": "dust",
                    "timeformat": "unixtime",
                    "forecast_days": 3,
                    **self._key_params(),
                },
                label="open-meteo.air-quality",
            )
        except WeatherRateLimited:
            raise
        except WeatherProviderError as error:
            logger.warning("weather.dust_unavailable: %s", error.reason)
            return None
        hourly = body.get("hourly")
        if not isinstance(hourly, dict) or not isinstance(hourly.get("time"), list):
            return None
        return {
            int(epoch): _round(_at(hourly.get("dust"), index), 0)
            for index, epoch in enumerate(hourly["time"])
            if _number(epoch) is not None
        }


# ------------------------------------------------------------------ place search


class Geocoder:
    """Place search (Open-Meteo geocoding: city, town, locality or postal code)."""

    def __init__(self, settings: WeatherSettings, transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.settings = settings
        self.http = HttpJson(settings, transport=transport, sleep=sleep)

    def search(self, query: str, country_code: str | None = None, limit: int = 8) -> list[dict]:
        params = {"name": query, "count": limit, "language": "en", "format": "json"}
        if country_code:
            params["countryCode"] = country_code
        key = self.settings.weather_api_key.get_secret_value().strip()
        if key:
            params["apikey"] = key
        body = self.http.get(
            f"{self.settings.weather_geocoding_base_url.rstrip('/')}/search", params, label="geocoding.search"
        )
        results = []
        for row in body.get("results") or []:
            if not isinstance(row, dict):
                continue
            latitude, longitude = _number(row.get("latitude")), _number(row.get("longitude"))
            if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                continue
            parts = [row.get("name"), row.get("admin2"), row.get("admin1"), row.get("country")]
            label = ", ".join(dict.fromkeys(part for part in parts if isinstance(part, str) and part))
            results.append(
                {
                    "name": label[:255] or f"{latitude:.4f}, {longitude:.4f}",
                    "latitude": round(latitude, 5),
                    "longitude": round(longitude, 5),
                    "country_code": (row.get("country_code") or "")[:2].upper() or None,
                    "timezone": row.get("timezone") if isinstance(row.get("timezone"), str) else None,
                }
            )
        return results
