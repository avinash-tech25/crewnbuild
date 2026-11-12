"""The weather providers, behind one normalised shape.

fetch(latitude, longitude) answers, whatever the provider:

    {
      "provider": "open-meteo",
      "timezone": "Asia/Kolkata", "utc_offset_seconds": 19800,
      "current": {observed_at, temperature_c, feels_like_c, humidity_pct,
                  wind_speed_kmh, wind_gust_kmh, wind_direction_deg, pressure_hpa,
                  visibility_km, cloud_cover_pct, precipitation_mm,
                  precipitation_probability_pct, condition, is_day, sunrise, sunset},
      "hourly": [{time, temperature_c, feels_like_c, humidity_pct,
                  precipitation_probability_pct, precipitation_mm, wind_speed_kmh,
                  wind_gust_kmh, condition, dust_ugm3}],          next 48 hours
      "daily":  [{date, temp_min_c, temp_max_c, precipitation_probability_pct,
                  precipitation_mm, precipitation_hours, wind_speed_max_kmh,
                  wind_gust_max_kmh, wind_direction_deg, condition, summary,
                  sunrise, sunset}],
      "official_alerts": [{id, event, sender, description, start, end, tags}],
      "supports_official_alerts": bool,
      "supports_dust": bool,
    }

Times are ISO 8601 in the site's own offset, so a site reads its own local
time whoever looks at it. A value the provider did not send stays None: nothing
is ever filled in. Conditions are one of CONDITIONS.

Network calls time out, are retried with backoff on timeouts, connection errors
and 5xx, and stop for the provider's Retry-After on 429 (every later call fails
fast until then, so a rate limit is never hammered). A response missing what it
must carry is refused as invalid rather than shown.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.modules.weather.weather_settings import WeatherSettings

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
USER_AGENT = "CREWNBUILD-weather/1.0"


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
_postal_lock = threading.Lock()
_last_postal_lookup = {"monotonic": 0.0}


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


def owm_condition(code) -> str | None:
    """OpenWeather condition ids."""
    code = _number(code)
    if code is None:
        return None
    code = int(code)
    if code in (202, 212, 221, 232):
        return "SEVERE_THUNDERSTORM"
    if 200 <= code < 300:
        return "THUNDERSTORM"
    if 300 <= code < 400:
        return "DRIZZLE"
    if code in (502, 503, 504, 522, 531):
        return "HEAVY_RAIN"
    if 500 <= code < 600:
        return "RAIN"
    if 600 <= code < 700:
        return "SNOW"
    if code in (731, 751, 761, 762):
        return "DUST"
    if code == 771:
        return "SQUALL"
    if code == 781:
        return "TORNADO"
    if 700 <= code < 800:
        return "FOG"
    if code == 800:
        return "CLEAR"
    if code in (801, 802):
        return "PARTLY_CLOUDY"
    if code in (803, 804):
        return "CLOUDY"
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


class OpenWeatherMapProvider:
    name = "openweathermap"
    supports_official_alerts = True

    def __init__(self, settings: WeatherSettings, http: HttpJson):
        self.settings = settings
        self.http = http

    def fetch(self, latitude: float, longitude: float) -> dict:
        _check_coordinates(latitude, longitude)
        key = self.settings.weather_api_key.get_secret_value().strip()
        if not key:
            raise WeatherProviderError("Weather provider is not configured (WEATHER_API_KEY).")
        body = self.http.get(
            f"{self.settings.base_url}/data/3.0/onecall",
            {
                "lat": latitude,
                "lon": longitude,
                "appid": key,
                "units": "metric",
                "exclude": "minutely",
            },
            label="openweathermap.onecall",
        )
        current, hourly, daily = body.get("current"), body.get("hourly"), body.get("daily")
        if (
            not isinstance(current, dict)
            or not isinstance(hourly, list)
            or not isinstance(daily, list)
            or _number(current.get("temp")) is None
            or _number(current.get("dt")) is None
        ):
            raise WeatherProviderError("Weather provider sent an incomplete forecast.")
        offset_seconds = int(_number(body.get("timezone_offset")) or 0)
        offset = timezone(timedelta(seconds=offset_seconds))

        def condition(row):
            weather = row.get("weather")
            return (
                owm_condition(weather[0].get("id"))
                if isinstance(weather, list) and weather and isinstance(weather[0], dict)
                else None
            )

        def kmh(value):
            number = _number(value)
            return None if number is None else round(number * 3.6, 1)

        def rain(row, key="1h"):
            total = 0.0
            seen = False
            for kind in ("rain", "snow"):
                value = row.get(kind)
                amount = _number(value.get(key)) if isinstance(value, dict) else _number(value)
                if amount is not None:
                    total += amount
                    seen = True
            return round(total, 2) if seen else 0.0

        def pop(row):
            value = _number(row.get("pop"))
            return None if value is None else round(value * 100)

        hours = [
            {
                "time": _iso(row.get("dt"), offset),
                "temperature_c": _round(row.get("temp")),
                "feels_like_c": _round(row.get("feels_like")),
                "humidity_pct": _round(row.get("humidity"), 0),
                "precipitation_probability_pct": pop(row),
                "precipitation_mm": rain(row),
                "wind_speed_kmh": kmh(row.get("wind_speed")),
                "wind_gust_kmh": kmh(row.get("wind_gust")),
                "condition": condition(row),
                "dust_ugm3": None,
            }
            for row in hourly[:48]
            if isinstance(row, dict)
        ]
        days = []
        for row in daily:
            if not isinstance(row, dict):
                continue
            temps = row.get("temp") if isinstance(row.get("temp"), dict) else {}
            days.append(
                {
                    "date": _date(row.get("dt"), offset),
                    "temp_min_c": _round(temps.get("min")),
                    "temp_max_c": _round(temps.get("max")),
                    "precipitation_probability_pct": pop(row),
                    "precipitation_mm": rain(row, key=None),
                    "precipitation_hours": None,
                    "wind_speed_max_kmh": kmh(row.get("wind_speed")),
                    "wind_gust_max_kmh": kmh(row.get("wind_gust")),
                    "wind_direction_deg": _round(row.get("wind_deg"), 0),
                    "condition": condition(row),
                    "summary": row.get("summary") if isinstance(row.get("summary"), str) else None,
                    "sunrise": _iso(row.get("sunrise"), offset),
                    "sunset": _iso(row.get("sunset"), offset),
                }
            )
        alerts = []
        for row in body.get("alerts") or []:
            if not isinstance(row, dict) or not isinstance(row.get("event"), str):
                continue
            alerts.append(
                {
                    "id": f"{row.get('sender_name', '')}|{row.get('event')}|{row.get('start')}"[:255],
                    "event": row["event"][:200],
                    "sender": row.get("sender_name") if isinstance(row.get("sender_name"), str) else None,
                    "description": (row.get("description") or "")[:4000]
                    if isinstance(row.get("description"), str)
                    else "",
                    "start": _iso(row.get("start"), offset),
                    "end": _iso(row.get("end"), offset),
                    "tags": [tag for tag in row.get("tags") or [] if isinstance(tag, str)],
                }
            )
        visibility_m = _number(current.get("visibility"))
        return {
            "provider": self.name,
            "timezone": body.get("timezone") if isinstance(body.get("timezone"), str) else None,
            "utc_offset_seconds": offset_seconds,
            "current": {
                "observed_at": _iso(current.get("dt"), offset),
                "temperature_c": _round(current.get("temp")),
                "feels_like_c": _round(current.get("feels_like")),
                "humidity_pct": _round(current.get("humidity"), 0),
                "wind_speed_kmh": kmh(current.get("wind_speed")),
                "wind_gust_kmh": kmh(current.get("wind_gust")),
                "wind_direction_deg": _round(current.get("wind_deg"), 0),
                "pressure_hpa": _round(current.get("pressure"), 0),
                "visibility_km": None if visibility_m is None else round(visibility_m / 1000, 1),
                "cloud_cover_pct": _round(current.get("clouds"), 0),
                "precipitation_mm": rain(current),
                "precipitation_probability_pct": hours[0]["precipitation_probability_pct"] if hours else None,
                "condition": condition(current),
                "is_day": None,
                "sunrise": _iso(current.get("sunrise"), offset),
                "sunset": _iso(current.get("sunset"), offset),
            },
            "hourly": hours,
            "daily": days,
            "official_alerts": alerts,
            "supports_official_alerts": True,
            "supports_dust": False,
        }


def build_provider(settings: WeatherSettings, transport: httpx.BaseTransport | None = None, sleep=time.sleep):
    http = HttpJson(settings, transport=transport, sleep=sleep)
    if settings.provider == "openweathermap":
        return OpenWeatherMapProvider(settings, http)
    return OpenMeteoProvider(settings, http)


class Geocoder:
    """Place search (Open-Meteo geocoding: city, town or locality), and postal codes
    through OpenStreetMap Nominatim, which that search does not know."""

    def __init__(self, settings: WeatherSettings, transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.settings = settings
        self.transport = transport
        self.sleep = sleep
        self.http = HttpJson(settings, transport=transport, sleep=sleep)

    def postal_code(self, code: str, country_code: str | None = None) -> list[dict] | None:
        """The place a postal code (an Indian PIN) is at, from Nominatim
        (WEATHER_REVERSE_GEOCODING_BASE_URL; empty turns this off). [] when it is
        not known, None when Nominatim could not be asked -- so a failure is not
        remembered as a miss. At most one request a second, as Nominatim asks."""
        base = (self.settings.weather_reverse_geocoding_base_url or "").strip().rstrip("/")
        if not base or not code:
            return None
        params = {"postalcode": code, "format": "jsonv2", "addressdetails": 1, "limit": 1, "accept-language": "en"}
        if country_code:
            params["countrycodes"] = country_code.lower()
        with _postal_lock:
            wait = 1.05 - (time.monotonic() - _last_postal_lookup["monotonic"])
            if wait > 0:
                self.sleep(wait)
            _last_postal_lookup["monotonic"] = time.monotonic()
            try:
                with httpx.Client(
                    timeout=self.settings.weather_timeout_seconds,
                    transport=self.transport,
                    headers={"User-Agent": USER_AGENT},
                ) as client:
                    response = client.get(f"{base}/search", params=params)
                if response.status_code != 200:
                    logger.warning("weather.postal_lookup_failed status=%s", response.status_code)
                    return None
                body = response.json()
            except (httpx.HTTPError, ValueError):
                logger.warning("weather.postal_lookup_failed")
                return None
        rows = []
        for row in body if isinstance(body, list) else []:
            try:
                latitude, longitude = float(row.get("lat")), float(row.get("lon"))
            except (TypeError, ValueError, AttributeError):
                continue
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                continue
            address = row.get("address") or {}
            town = next(
                (
                    address.get(part)
                    for part in ("city", "town", "village", "suburb", "county", "state_district")
                    if address.get(part)
                ),
                None,
            )
            label = ", ".join(
                dict.fromkeys(
                    part
                    for part in (town, address.get("state"), address.get("country"))
                    if isinstance(part, str) and part
                )
            )
            rows.append(
                {
                    "name": (label or code)[:255],
                    "latitude": round(latitude, 5),
                    "longitude": round(longitude, 5),
                    "country_code": ((address.get("country_code") or country_code or "")[:2].upper()) or None,
                    "timezone": None,
                }
            )
        return rows

    def search(self, query: str, country_code: str | None = None, limit: int = 8) -> list[dict]:
        params = {"name": query, "count": limit, "language": "en", "format": "json"}
        if country_code:
            params["countryCode"] = country_code
        key = self.settings.weather_api_key.get_secret_value().strip()
        if key and self.settings.provider == "open-meteo":
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
