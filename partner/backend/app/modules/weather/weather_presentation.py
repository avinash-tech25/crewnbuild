"""How the weather should look -- a copy of Professional's
app/weather/services/weather_presentation.py (Partner may not import Professional
code), so a theme means the same in both apps: one theme for a place from its
real weather, the alert thresholds and its alerts. See Professional's docstring.
"""

from app.modules.weather.weather_rules import SEVERITY_RANK

THEMES = (
    "STORM",
    "HEAVY_RAIN",
    "DUST",
    "WIND",
    "RAIN",
    "LIGHT_RAIN",
    "HOT",
    "SUNNY",
    "CLEAR_NIGHT",
    "PARTLY_CLOUDY",
    "CLOUDY",
    "FOG",
    "SNOW",
    "UNKNOWN",
)
WARNING_RANK = SEVERITY_RANK["WARNING"]


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _serious(alerts, *types) -> bool:
    return any(
        alert.get("alert_type") in types and SEVERITY_RANK.get(alert.get("severity"), 0) >= WARNING_RANK
        for alert in alerts
    )


def presentation(weather: dict | None, thresholds: dict, alerts: list[dict] | None = None) -> dict:
    """{"theme", "condition", "rain_expected_today", "warning"}; warning is the most
    serious WARNING/SEVERE alert ({alert_type, severity, title, message}) or None."""
    alerts = list(alerts or [])
    current = (weather or {}).get("current") or {}
    hours = (weather or {}).get("hourly") or []
    today = ((weather or {}).get("daily") or [{}])[0] or {}
    condition = current.get("condition")
    rain_now = max(
        [
            value
            for value in (
                _number(current.get("precipitation_mm")),
                _number((hours[0] if hours else {}).get("precipitation_mm")),
            )
            if value is not None
        ],
        default=None,
    )
    gust = max(
        [
            value
            for value in (_number(current.get("wind_gust_kmh")), _number(current.get("wind_speed_kmh")))
            if value is not None
        ],
        default=None,
    )
    temperature = _number(current.get("temperature_c"))

    if condition in ("THUNDERSTORM", "SEVERE_THUNDERSTORM", "TORNADO") or _serious(alerts, "THUNDERSTORM", "CYCLONE"):
        theme = "STORM"
    elif (
        (rain_now is not None and rain_now >= thresholds["rain_heavy_mm_h"])
        or condition == "HEAVY_RAIN"
        or _serious(alerts, "RAIN", "HEAVY_RAIN_DAY", "CONTINUOUS_RAIN", "FLOOD_RISK")
    ):
        theme = "HEAVY_RAIN"
    elif condition == "DUST" or any(alert.get("alert_type") == "DUST" for alert in alerts):
        theme = "DUST"
    elif (
        (gust is not None and gust >= thresholds["wind_watch_kmh"]) or condition == "SQUALL" or _serious(alerts, "WIND")
    ):
        theme = "WIND"
    elif rain_now is not None and rain_now >= thresholds["rain_moderate_mm_h"]:
        theme = "RAIN"
    elif condition in ("DRIZZLE", "RAIN") or (rain_now is not None and rain_now >= thresholds["rain_light_mm_h"]):
        theme = "LIGHT_RAIN"
    elif temperature is not None and temperature >= thresholds["heat_watch_c"]:
        theme = "HOT"
    elif condition == "CLEAR":
        theme = "CLEAR_NIGHT" if current.get("is_day") is False else "SUNNY"
    elif condition in ("PARTLY_CLOUDY", "CLOUDY", "FOG", "SNOW"):
        theme = condition
    else:
        theme = "UNKNOWN"

    probability = _number(today.get("precipitation_probability_pct"))
    total = _number(today.get("precipitation_mm"))
    rain_expected_today = bool(
        (probability is not None and probability >= thresholds["rain_probability_watch_pct"])
        or (total is not None and total >= thresholds["rain_light_mm_h"] * 2)
    )
    serious = sorted(
        (alert for alert in alerts if SEVERITY_RANK.get(alert.get("severity"), 0) >= WARNING_RANK),
        key=lambda alert: -SEVERITY_RANK.get(alert.get("severity"), 0),
    )
    warning = None
    if serious:
        top = serious[0]
        warning = {key: top.get(key) for key in ("alert_type", "severity", "title", "message")}
    return {"theme": theme, "condition": condition, "rain_expected_today": rain_expected_today, "warning": warning}
