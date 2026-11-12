"""Weather alert rules, and keeping each project's alerts in step with them.

evaluate() is pure: the normalised weather (weather_provider_service) and the
site's thresholds (WeatherSettings.thresholds_for) in, the alerts that should be
ACTIVE now out. Each one carries an event_key naming the rule and the window it
is about ("RAIN", "HEAT:2026-11-10", "OFFICIAL:<provider id>"), which is what
makes an alert the same event from one check to the next.

WeatherService.reconcile (weather_service.py) then, for one project:
  * an ACTIVE alert whose event is still forecast is updated in place (severity,
    message, times); it is announced again only if its severity went up;
  * an ACTIVE alert whose event is no longer forecast becomes EXPIRED if its
    window has passed, else RESOLVED;
  * a new event reopens the same event's alert if that was resolved within the
    reopen window (a forecast wobbling around a threshold), and otherwise
    becomes a new ACTIVE alert.
The partial unique index uq_weather_alerts_active_event keeps it to one ACTIVE
alert per project and event even if two checks race.

Every alert is a recommendation to people. Nothing here, or anywhere in the
weather module, stops, reschedules or changes any construction work.
"""

import re
from datetime import UTC, datetime, timedelta, timezone

from app.modules.weather.models import SEVERITY_RANK

UTC = UTC

ALERT_TYPES = (
    "RAIN",
    "RAIN_PROBABILITY",
    "CONTINUOUS_RAIN",
    "HEAVY_RAIN_DAY",
    "FLOOD_RISK",
    "THUNDERSTORM",
    "WIND",
    "HEAT",
    "COLD",
    "HUMIDITY",
    "DUST",
    "CYCLONE",
    "OFFICIAL_WARNING",
)
ALERT_TYPE_LABELS = {
    "RAIN": "Rain",
    "RAIN_PROBABILITY": "Rain probability",
    "CONTINUOUS_RAIN": "Continuous rain",
    "HEAVY_RAIN_DAY": "Heavy rainfall",
    "FLOOD_RISK": "Flood risk",
    "THUNDERSTORM": "Thunderstorm",
    "WIND": "Strong wind",
    "HEAT": "High temperature",
    "COLD": "Low temperature",
    "HUMIDITY": "Humidity",
    "DUST": "Dust storm",
    "CYCLONE": "Cyclone",
    "OFFICIAL_WARNING": "Official warning",
}

RAIN_ADVICE = [
    "Review excavation and foundation activities.",
    "Check water drainage arrangements around the site.",
    "Protect cement and other moisture-sensitive materials.",
    "Review outdoor work schedules.",
]
STORM_ADVICE = [
    "Avoid exposed outdoor activities while the storm is near.",
    "Follow site electrical and lightning safety procedures.",
    "Secure temporary structures where necessary.",
]
WIND_ADVICE = [
    "Check scaffolding and temporary structures.",
    "Secure loose construction materials and sheets.",
    "Review crane and lifting operations according to site safety procedures.",
]
HEAT_ADVICE = [
    "Consider appropriate work-rest schedules for outdoor work.",
    "Ensure drinking water and shade are available.",
    "Follow applicable heat-safety guidelines.",
    "Plan concrete pours and curing for the cooler part of the day.",
]
RECOMMENDATIONS = {
    "RAIN": RAIN_ADVICE,
    "RAIN_PROBABILITY": ["Plan outdoor activities around the expected rain.", "Keep materials covered."],
    "CONTINUOUS_RAIN": RAIN_ADVICE,
    "HEAVY_RAIN_DAY": RAIN_ADVICE,
    "FLOOD_RISK": RAIN_ADVICE + ["Move materials and equipment away from low-lying areas."],
    "THUNDERSTORM": STORM_ADVICE,
    "WIND": WIND_ADVICE,
    "HEAT": HEAT_ADVICE,
    "COLD": [
        "Protect fresh concrete and mortar from low temperatures.",
        "Ensure workers have suitable protective clothing.",
    ],
    "HUMIDITY": ["Watch workers for heat stress in humid conditions.", "Allow for slower drying and curing times."],
    "DUST": [
        "Provide dust masks and eye protection.",
        "Cover materials and secure loose items.",
        "Review lifting operations in low visibility.",
    ],
    "CYCLONE": STORM_ADVICE + WIND_ADVICE + ["Follow the official advisories of the national weather service."],
    "OFFICIAL_WARNING": ["Follow the official advisories of the national weather service."],
}
SEVERE_NOTE = "Stop exposed outdoor work where necessary and follow official safety instructions."


def recommendations_for(alert_type: str, severity: str) -> list[str]:
    advice = list(RECOMMENDATIONS.get(alert_type, []))
    if severity == "SEVERE" and SEVERE_NOTE not in advice:
        advice.insert(0, SEVERE_NOTE)
    return advice


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _num(value) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def _mm(value: float) -> str:
    return f"{value:.0f} mm" if value >= 10 else f"{value:.1f} mm"


def _local_clock(moment: datetime, offset: timezone) -> str:
    return moment.astimezone(offset).strftime("%d %b %H:%M")


def _hours_until(start: datetime, now: datetime) -> int:
    return max(1, round((start - now).total_seconds() / 3600))


def _when(start: datetime, now: datetime) -> str:
    if start <= now + timedelta(minutes=30):
        return "now or within the next hour"
    hours = _hours_until(start, now)
    return f"within the next {hours} hour{'s' if hours != 1 else ''}"


def _candidate(
    key,
    alert_type,
    severity,
    title,
    message,
    *,
    condition=None,
    start=None,
    end=None,
    metrics=None,
    source="FORECAST",
    provider_alert_id=None,
):
    return {
        "event_key": key,
        "alert_type": alert_type,
        "severity": severity,
        "source": source,
        "title": title,
        "message": message,
        "weather_condition": condition,
        "metrics": metrics or {},
        "expected_start": start,
        "expected_end": end,
        "provider_alert_id": provider_alert_id,
    }


def evaluate(weather: dict, thresholds: dict, now: datetime | None = None) -> list[dict]:
    now = (now or datetime.now(UTC)).astimezone(UTC)
    offset = timezone(timedelta(seconds=int(weather.get("utc_offset_seconds") or 0)))
    hours = []
    for row in weather.get("hourly") or []:
        moment = _parse(row.get("time"))
        if moment is not None and moment + timedelta(hours=1) > now:
            hours.append((moment, row))
    hours.sort(key=lambda pair: pair[0])
    near = [pair for pair in hours if pair[0] < now + timedelta(hours=thresholds["near_term_hours"])]
    storm_window = [pair for pair in hours if pair[0] < now + timedelta(hours=thresholds["storm_lookahead_hours"])]
    day_one = [pair for pair in hours if pair[0] < now + timedelta(hours=24)]
    today = now.astimezone(offset).date()
    days = []
    for row in weather.get("daily") or []:
        try:
            day = datetime.fromisoformat(row.get("date") or "").date()
        except ValueError:
            continue
        if today <= day < today + timedelta(days=thresholds["day_lookahead_days"]):
            days.append((day, row))
    current = weather.get("current") or {}
    alerts: list[dict] = []

    # --- A. Rain in the next few hours, by its heaviest hour.
    wet = [(moment, row) for moment, row in near if _num(row.get("precipitation_mm")) >= thresholds["rain_light_mm_h"]]
    rain_severity = None
    if wet:
        peak = max(_num(row.get("precipitation_mm")) for _, row in wet)
        total = sum(_num(row.get("precipitation_mm")) for _, row in near)
        start, end = wet[0][0], wet[-1][0] + timedelta(hours=1)
        if peak >= thresholds["rain_very_heavy_mm_h"]:
            rain_severity, label = "SEVERE", "Very heavy rainfall"
        elif peak >= thresholds["rain_heavy_mm_h"]:
            rain_severity, label = "WARNING", "Heavy rainfall"
        elif peak >= thresholds["rain_moderate_mm_h"]:
            rain_severity, label = "WATCH", "Moderate rain"
        else:
            rain_severity, label = "INFO", "Light rain"
        tail = {
            "SEVERE": " Outdoor construction activities are likely to be disrupted.",
            "WARNING": " Outdoor construction activities may be affected.",
            "WATCH": " Consider planning outdoor activities accordingly.",
            "INFO": "",
        }[rain_severity]
        alerts.append(
            _candidate(
                "RAIN",
                "RAIN",
                rain_severity,
                f"{label} expected",
                f"{label} is expected at the project site {_when(start, now)}. Expected rainfall: {_mm(total)} "
                f"(up to {_mm(peak)} per hour).{tail}",
                condition="HEAVY_RAIN" if rain_severity in ("WARNING", "SEVERE") else "RAIN",
                start=start,
                end=end,
                metrics={"expected_rain_mm": round(total, 1), "peak_rain_mm_h": round(peak, 1)},
            )
        )

    # --- A. High probability of rain in the next 3 hours (when the amount alone says less).
    soon = [(moment, row) for moment, row in hours if moment < now + timedelta(hours=3)]
    if soon and SEVERITY_RANK.get(rain_severity, -1) < SEVERITY_RANK["WATCH"]:
        top = max(soon, key=lambda pair: _num(pair[1].get("precipitation_probability_pct")))
        probability = _num(top[1].get("precipitation_probability_pct"))
        if probability >= thresholds["rain_probability_watch_pct"]:
            alerts.append(
                _candidate(
                    "RAIN_PROBABILITY",
                    "RAIN_PROBABILITY",
                    "WATCH",
                    "High chance of rain",
                    f"Rain probability is {probability:.0f}% within the next 3 hours. Consider planning outdoor activities accordingly.",
                    condition="RAIN",
                    start=top[0],
                    end=soon[-1][0] + timedelta(hours=1),
                    metrics={"rain_probability_pct": probability},
                )
            )

    # --- A. Continuous rain: the longest wet run within 24 hours.
    run, best = [], []
    for moment, row in day_one:
        if _num(row.get("precipitation_mm")) >= thresholds["rain_light_mm_h"]:
            run.append((moment, row))
            if len(run) > len(best):
                best = list(run)
        else:
            run = []
    if len(best) >= thresholds["continuous_rain_hours"]:
        total = sum(_num(row.get("precipitation_mm")) for _, row in best)
        severity = "WARNING" if total >= thresholds["rain_heavy_day_mm"] else "WATCH"
        alerts.append(
            _candidate(
                "CONTINUOUS_RAIN",
                "CONTINUOUS_RAIN",
                severity,
                "Continuous rainfall expected",
                f"About {len(best)} hours of continuous rain are expected from {_local_clock(best[0][0], offset)} (site time), "
                f"with {_mm(total)} in total. Plan outdoor work and material protection accordingly.",
                condition="RAIN",
                start=best[0][0],
                end=best[-1][0] + timedelta(hours=1),
                metrics={"wet_hours": len(best), "expected_rain_mm": round(total, 1)},
            )
        )

    # --- A. Heavy and very heavy rainfall days.
    for day, row in days:
        amount = _num(row.get("precipitation_mm"))
        if amount < thresholds["rain_heavy_day_mm"]:
            continue
        severe = amount >= thresholds["rain_very_heavy_day_mm"]
        label = "Very heavy rainfall" if severe else "Heavy rainfall"
        start = datetime.combine(day, datetime.min.time(), tzinfo=offset)
        alerts.append(
            _candidate(
                f"HEAVY_RAIN_DAY:{day.isoformat()}",
                "HEAVY_RAIN_DAY",
                "SEVERE" if severe else "WARNING",
                f"{label} expected on {day.strftime('%a %d %b')}",
                f"{label} of about {_mm(amount)} is forecast at the project site on {day.strftime('%A %d %B')}. "
                "Outdoor construction activities may be affected.",
                condition="HEAVY_RAIN",
                start=start,
                end=start + timedelta(days=1),
                metrics={
                    "expected_rain_mm": round(amount, 1),
                    "rain_probability_pct": row.get("precipitation_probability_pct"),
                },
            )
        )

    # --- C. Flood risk from rain accumulated over 24 hours (rainfall-based, not a river forecast).
    accumulated = sum(_num(row.get("precipitation_mm")) for _, row in day_one)
    if accumulated >= thresholds["flood_risk_24h_mm"]:
        alerts.append(
            _candidate(
                "FLOOD_RISK",
                "FLOOD_RISK",
                "WARNING",
                "Waterlogging and flood risk",
                f"About {_mm(accumulated)} of rain is forecast in the next 24 hours, which can waterlog or flood the site "
                "and low-lying access roads.",
                condition="HEAVY_RAIN",
                start=day_one[0][0] if day_one else now,
                end=now + timedelta(hours=24),
                metrics={"expected_rain_mm": round(accumulated, 1)},
            )
        )

    # --- B. Thunderstorms and lightning.
    storms = [
        (moment, row) for moment, row in storm_window if row.get("condition") in ("THUNDERSTORM", "SEVERE_THUNDERSTORM")
    ]
    if current.get("condition") in ("THUNDERSTORM", "SEVERE_THUNDERSTORM") and not any(
        moment <= now for moment, _ in storms
    ):
        storms.insert(0, (now, {"condition": current["condition"], "wind_gust_kmh": current.get("wind_gust_kmh")}))
    if storms:
        gust = max(_num(row.get("wind_gust_kmh")) for _, row in storms)
        severe = (
            any(row.get("condition") == "SEVERE_THUNDERSTORM" for _, row in storms)
            or gust >= thresholds["thunderstorm_severe_gust_kmh"]
        )
        start, end = storms[0][0], storms[-1][0] + timedelta(hours=1)
        if severe:
            message = (
                f"Severe thunderstorm conditions are forecast near the project site {_when(start, now)}, with lightning"
                f"{' and hail' if any(row.get('condition') == 'SEVERE_THUNDERSTORM' for _, row in storms) else ''}"
                f"{f' and gusts up to {gust:.0f} km/h' if gust else ''}. {SEVERE_NOTE}"
            )
        else:
            message = (
                f"Thunderstorms with lightning risk are expected at the project site {_when(start, now)}. "
                "Avoid exposed outdoor activities while the storm is near."
            )
        alerts.append(
            _candidate(
                "THUNDERSTORM",
                "THUNDERSTORM",
                "SEVERE" if severe else "WARNING",
                "Severe thunderstorm warning" if severe else "Thunderstorm and lightning risk",
                message,
                condition="SEVERE_THUNDERSTORM" if severe else "THUNDERSTORM",
                start=start,
                end=end,
                metrics={"peak_gust_kmh": round(gust, 0), "storm_hours": len(storms)},
            )
        )
    else:
        for day, row in days[1:]:
            if row.get("condition") in ("THUNDERSTORM", "SEVERE_THUNDERSTORM"):
                start = datetime.combine(day, datetime.min.time(), tzinfo=offset)
                alerts.append(
                    _candidate(
                        f"THUNDERSTORM_DAY:{day.isoformat()}",
                        "THUNDERSTORM",
                        "WATCH",
                        f"Thunderstorms possible on {day.strftime('%a %d %b')}",
                        f"Thunderstorms are forecast at the project site on {day.strftime('%A %d %B')}. Plan exposed work accordingly.",
                        condition=row.get("condition"),
                        start=start,
                        end=start + timedelta(days=1),
                    )
                )

    # --- B/C. Strong wind (gusts, else sustained wind), now and over the storm window.
    windy = [(moment, row) for moment, row in storm_window]
    candidates = [(now, current)] + windy

    def wind_of(row):
        return max(_num(row.get("wind_gust_kmh")), _num(row.get("wind_speed_kmh")))

    if candidates:
        moment, row = max(candidates, key=lambda pair: wind_of(pair[1]))
        peak = wind_of(row)
        severity = None
        if peak >= thresholds["wind_severe_kmh"]:
            severity, title = "SEVERE", "Storm-force wind warning"
        elif peak >= thresholds["wind_warning_kmh"]:
            severity, title = "WARNING", "Strong wind warning"
        elif peak >= thresholds["wind_watch_kmh"]:
            severity, title = "WATCH", "Strong wind expected"
        if severity:
            strong = [m for m, r in candidates if wind_of(r) >= thresholds["wind_watch_kmh"]]
            alerts.append(
                _candidate(
                    "WIND",
                    "WIND",
                    severity,
                    title,
                    f"Wind gusts up to {peak:.0f} km/h are expected at the project site {_when(min(strong), now)}. "
                    "Check scaffolding and temporary structures, and review crane and lifting operations."
                    + (f" {SEVERE_NOTE}" if severity == "SEVERE" else ""),
                    condition=row.get("condition") or "SQUALL",
                    start=min(strong),
                    end=max(strong) + timedelta(hours=1),
                    metrics={"peak_gust_kmh": round(peak, 0)},
                )
            )

    # --- C. Heat and cold, by day.
    for day, row in days:
        start = datetime.combine(day, datetime.min.time(), tzinfo=offset)
        high, low = row.get("temp_max_c"), row.get("temp_min_c")
        if isinstance(high, (int, float)):
            severity = None
            if high >= thresholds["heat_severe_c"]:
                severity, title = "SEVERE", "Extreme heat warning"
            elif high >= thresholds["heat_warning_c"]:
                severity, title = "WARNING", "Extreme heat expected"
            elif high >= thresholds["heat_watch_c"]:
                severity, title = "WATCH", "High temperature expected"
            if severity:
                alerts.append(
                    _candidate(
                        f"HEAT:{day.isoformat()}",
                        "HEAT",
                        severity,
                        f"{title} on {day.strftime('%a %d %b')}",
                        f"A maximum of {high:.0f} °C is forecast at the project site on {day.strftime('%A %d %B')}. "
                        "Consider work-rest schedules and ensure drinking water is available."
                        + (f" {SEVERE_NOTE}" if severity == "SEVERE" else ""),
                        condition="CLEAR",
                        start=start,
                        end=start + timedelta(days=1),
                        metrics={"max_temp_c": high},
                    )
                )
        if isinstance(low, (int, float)) and low <= thresholds["cold_watch_c"]:
            severity = "WARNING" if low <= thresholds["cold_warning_c"] else "WATCH"
            alerts.append(
                _candidate(
                    f"COLD:{day.isoformat()}",
                    "COLD",
                    severity,
                    f"Low temperature on {day.strftime('%a %d %b')}",
                    f"A minimum of {low:.0f} °C is forecast at the project site on {day.strftime('%A %d %B')}. "
                    "Protect fresh concrete and mortar.",
                    condition=row.get("condition"),
                    start=start,
                    end=start + timedelta(days=1),
                    metrics={"min_temp_c": low},
                )
            )

    # --- C. Excessive humidity while warm, over the next 12 hours.
    humid = [
        (moment, row)
        for moment, row in hours
        if moment < now + timedelta(hours=12)
        and _num(row.get("humidity_pct")) >= thresholds["humidity_watch_pct"]
        and _num(row.get("temperature_c")) >= thresholds["humidity_min_temp_c"]
    ]
    if humid:
        top = max(_num(row.get("humidity_pct")) for _, row in humid)
        alerts.append(
            _candidate(
                "HUMIDITY",
                "HUMIDITY",
                "WATCH",
                "Excessive humidity",
                f"Humidity up to {top:.0f}% with temperatures above {thresholds['humidity_min_temp_c']:.0f} °C is expected. "
                "Watch for heat stress and allow for slower curing.",
                condition=humid[0][1].get("condition"),
                start=humid[0][0],
                end=humid[-1][0] + timedelta(hours=1),
                metrics={"max_humidity_pct": top},
            )
        )

    # --- C. Dust storms: the dust forecast, or a dust condition reported now.
    dusty = [
        (moment, row) for moment, row in storm_window if _num(row.get("dust_ugm3")) >= thresholds["dust_watch_ugm3"]
    ]
    if current.get("condition") == "DUST" or any(row.get("condition") == "DUST" for _, row in storm_window) or dusty:
        peak = max([_num(row.get("dust_ugm3")) for _, row in dusty] or [0])
        severity = (
            "WARNING" if peak >= thresholds["dust_warning_ugm3"] or current.get("condition") == "DUST" else "WATCH"
        )
        start = dusty[0][0] if dusty else now
        alerts.append(
            _candidate(
                "DUST",
                "DUST",
                severity,
                "Dust storm warning" if severity == "WARNING" else "Dusty conditions expected",
                f"Dusty conditions{f' (dust up to {peak:.0f} µg/m³)' if peak else ''} are expected at the project site "
                f"{_when(start, now)}. Visibility and air quality may be poor.",
                condition="DUST",
                start=start,
                end=(dusty[-1][0] + timedelta(hours=1)) if dusty else now + timedelta(hours=3),
                metrics={"peak_dust_ugm3": peak} if peak else {},
            )
        )

    # --- B/C. Official warnings from national weather services, as relayed by the provider.
    for warning in weather.get("official_alerts") or []:
        end = _parse(warning.get("end"))
        if end is not None and end <= now:
            continue
        alert_type, severity = classify_official(warning)
        alerts.append(
            _candidate(
                f"OFFICIAL:{warning.get('id')}"[:120],
                alert_type,
                severity,
                f"Official warning: {warning.get('event')}"[:200],
                (
                    f"{warning.get('sender') or 'The national weather service'} has issued: {warning.get('event')}. "
                    f"{(warning.get('description') or '').strip()}"
                ).strip()[:4000],
                condition="SEVERE_THUNDERSTORM" if alert_type == "THUNDERSTORM" and severity == "SEVERE" else None,
                start=_parse(warning.get("start")),
                end=end,
                source="OFFICIAL",
                provider_alert_id=warning.get("id"),
                metrics={"sender": warning.get("sender")},
            )
        )
    return alerts


def classify_official(warning: dict) -> tuple[str, str]:
    text = f"{warning.get('event', '')} {' '.join(warning.get('tags') or [])}".lower()

    def has(*words):
        return re.search(r"\b(" + "|".join(words) + r")", text) is not None

    if has("cyclone", "hurricane", "typhoon"):
        alert_type = "CYCLONE"
    elif has("flood"):
        alert_type = "FLOOD_RISK"
    elif has("thunder", "lightning"):
        alert_type = "THUNDERSTORM"
    elif has("dust", "sand"):
        alert_type = "DUST"
    elif has("wind", "gale", "storm", "tornado", "squall"):
        alert_type = "WIND"
    elif has("heat", "high temperature"):
        alert_type = "HEAT"
    elif has("rain"):
        alert_type = "RAIN"
    else:
        alert_type = "OFFICIAL_WARNING"
    if alert_type == "CYCLONE" or re.search(r"\b(extreme|severe|red|tornado|emergency)\b", text):
        severity = "SEVERE"
    elif re.search(r"\b(watch|advisory|yellow|statement)\b", text):
        severity = "WATCH"
    else:
        severity = "WARNING"
    return alert_type, severity


def to_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value
