"""Weather alert thresholds -- the same values as Professional's weather module
(Professional/backend/app/weather/config.py), kept as a copy because Partner may
not import Professional code (tests/test_schema_boundary.py). Change both together.
"""

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
    "KW": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "SA": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "AE": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "QA": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "BH": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
    "OM": {"heat_watch_c": 45, "heat_warning_c": 48, "heat_severe_c": 50},
}


def thresholds_for(country_code: str | None) -> dict:
    """The thresholds for a place's ISO country code: the defaults, with that
    country's profile on top."""
    return {**DEFAULT_THRESHOLDS, **COUNTRY_THRESHOLDS.get((country_code or "").strip().upper(), {})}
