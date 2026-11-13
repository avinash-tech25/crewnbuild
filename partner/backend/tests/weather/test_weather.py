"""Technician weather: where it is for, what it shows, the alerts, and who may ask.

Through the real API, inside the rolled-back transaction the shared fixtures set
up. Open-Meteo is replaced by an httpx.MockTransport and the geocoder by a stub,
so nothing leaves the machine.
"""

from datetime import UTC, datetime

import httpx
import pytest
from legacy import bearer
from legacy_dispatch import HOME, act, book, offer_ids, working

from app.modules.locations import geocoding_service as geocoding
from app.modules.weather import router as weather_routes
from app.modules.weather import weather_service
from app.modules.weather.weather_config import WeatherSettings
from app.modules.weather.weather_provider import HttpJson, OpenMeteoProvider, reset_rate_limit
from app.modules.weather.weather_rules import evaluate
from app.modules.weather.weather_thresholds import DEFAULT_THRESHOLDS, thresholds_for

NOW = datetime(2026, 11, 9, 6, 0, tzinfo=UTC)
CALM, STORMY = "calm", "stormy"
CHOSEN = (16.5062, 80.648)  # Vijayawada
DEVICE = (12.9716, 77.5946)  # Bengaluru


def payload(kind):
    base = int(NOW.timestamp())
    stormy = kind == STORMY
    rain = ([0, 6, 14, 9] if stormy else [0, 0, 0, 0]) + [0] * 44
    codes = ([3, 63, 95, 65] if stormy else [1, 1, 1, 1]) + [1] * 44
    gusts = ([30, 45, 78, 60] if stormy else [12, 12, 12, 12]) + [10] * 44
    days = [base + 86400 * d for d in range(7)]
    return {
        "timezone": "Asia/Kolkata",
        "utc_offset_seconds": 19800,
        "current": {
            "time": base,
            "temperature_2m": 33,
            "relative_humidity_2m": 70,
            "apparent_temperature": 38,
            "is_day": 1,
            "precipitation": 0.4,
            "weather_code": 3,
            "cloud_cover": 95,
            "pressure_msl": 1003,
            "wind_speed_10m": 18,
            "wind_direction_10m": 220,
            "wind_gusts_10m": 34,
            "visibility": 8000,
        },
        "hourly": {
            "time": [base + 3600 * h for h in range(48)],
            "temperature_2m": [33] * 48,
            "relative_humidity_2m": [70] * 48,
            "apparent_temperature": [38] * 48,
            "precipitation_probability": [95 if r else 15 for r in rain],
            "precipitation": rain,
            "weather_code": codes,
            "wind_speed_10m": [18] * 48,
            "wind_gusts_10m": gusts,
        },
        "daily": {
            "time": days,
            "weather_code": [95 if stormy else 1] + [1] * 6,
            "temperature_2m_max": ([36, 43] if stormy else [31, 31]) + [32] * 5,
            "temperature_2m_min": [24] * 7,
            "precipitation_sum": [29 if stormy else 0] + [0] * 6,
            "precipitation_hours": [3 if stormy else 0] + [0] * 6,
            "precipitation_probability_max": [95 if stormy else 5] + [10] * 6,
            "wind_speed_10m_max": [25] * 7,
            "wind_gusts_10m_max": [78 if stormy else 20] + [30] * 6,
            "wind_direction_10m_dominant": [220] * 7,
            "sunrise": [d + 3600 for d in days],
            "sunset": [d + 43200 for d in days],
        },
    }


@pytest.fixture
def forecasts(monkeypatch, client):
    """Open-Meteo answering from `weather[place]` (STORMY at the job, CALM elsewhere),
    counting the forecast calls it receives and the places they were for."""
    state = {"weather": {}, "calls": [], "fail": False}

    def handler(request):
        params = dict(request.url.params)
        place = (float(params["latitude"]), float(params["longitude"]))
        if "air-quality" in request.url.path:
            return httpx.Response(
                200, json={"hourly": {"time": [int(NOW.timestamp()) + 3600 * h for h in range(72)], "dust": [20] * 72}}
            )
        state["calls"].append(place)
        if state["fail"]:
            return httpx.Response(500, json={})
        return httpx.Response(200, json=payload(state["weather"].get(place, CALM)))

    settings = WeatherSettings(weather_max_retries=0)
    provider = OpenMeteoProvider(
        settings, HttpJson(settings, transport=httpx.MockTransport(handler), sleep=lambda _: None)
    )
    clock = {"now": NOW}
    weather_service.clear_cache()
    reset_rate_limit()
    app = client.app  # the app the shared client fixture built

    app.dependency_overrides[weather_routes.get_technician_weather_service] = lambda: (
        weather_service.TechnicianWeatherService(
            _database(app), settings=settings, provider=provider, clock=lambda: clock["now"]
        )
    )
    state["clock"] = clock
    yield state
    app.dependency_overrides.pop(weather_routes.get_technician_weather_service, None)
    weather_service.clear_cache()


def _database(app):
    from app.database.session import get_db

    return next(app.dependency_overrides[get_db]())


def read(client, auth, **params):
    response = client.get("/technicians/me/weather", headers=bearer(auth["access_token"]), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def holding_a_job(client, onboard, requester_session, trade="PAINTER"):
    technician = working(client, onboard, trade=trade)
    _, headers = requester_session()
    booking = book(client, headers, trade)
    assert booking.status_code in (200, 201), booking.text
    booking_id = booking.json()["id"]
    assert booking_id in offer_ids(client, technician)
    assert act(client, technician, booking_id, "accept").status_code == 200
    return technician, booking_id


@pytest.mark.parametrize("trade", ["PAINTER", "PLUMBER", "ELECTRICIAN", "CARPENTER"])
def test_every_trade_without_a_job_is_asked_to_choose_a_place(client, onboard, forecasts, trade):
    technician = working(client, onboard, trade=trade)
    answer = read(client, technician)
    assert answer["location_required"] is True
    assert answer["location"] is None and answer["current"] is None and answer["alerts"] == []
    assert answer["status"]["message"] == "Choose a location to see its weather."
    assert forecasts["calls"] == []


@pytest.mark.parametrize("trade", ["PAINTER", "PLUMBER", "ELECTRICIAN", "CARPENTER"])
def test_every_trade_sees_a_chosen_place(client, onboard, forecasts, trade):
    technician = working(client, onboard, trade=trade)
    answer = read(client, technician, latitude=CHOSEN[0], longitude=CHOSEN[1], source="CHOSEN", name="Vijayawada")
    assert answer["location"]["source"] == "CHOSEN" and answer["location"]["name"] == "Vijayawada"
    assert answer["status"]["available"] is True
    assert answer["current"]["temperature_c"] == 33
    assert len(answer["hourly"]) == 24 and len(answer["daily"]) == 7


def test_the_current_job_is_the_place_and_its_storm_raises_the_alerts(client, onboard, requester_session, forecasts):
    technician, _ = holding_a_job(client, onboard, requester_session)
    forecasts["weather"][(round(HOME[0], 2), round(HOME[1], 2))] = STORMY
    answer = read(client, technician)
    assert answer["location"]["source"] == "JOB" and answer["job_location_available"] is True
    alerts = {alert["alert_type"]: alert["severity"] for alert in answer["alerts"]}
    assert alerts == {"RAIN": "WARNING", "THUNDERSTORM": "SEVERE", "WIND": "WARNING", "HEAT": "WARNING"}
    assert answer["alerts"][0]["severity"] == "SEVERE"  # most serious first
    assert any(
        "lightning" in alert["message"].lower() for alert in answer["alerts"] if alert["alert_type"] == "THUNDERSTORM"
    )
    assert all(alert["recommendations"] for alert in answer["alerts"])


def test_the_job_wins_until_another_place_is_asked_for(client, onboard, requester_session, forecasts):
    technician, _ = holding_a_job(client, onboard, requester_session)
    assert read(client, technician)["location"]["source"] == "JOB"
    device = read(client, technician, latitude=DEVICE[0], longitude=DEVICE[1], source="DEVICE")
    assert device["location"]["source"] == "DEVICE" and device["job_location_available"] is True


def test_the_provider_only_ever_gets_a_rounded_position_and_places_share_a_fetch(client, onboard, forecasts):
    first = working(client, onboard)
    second = working(client, onboard, trade="PLUMBER")
    read(client, first, latitude=17.448312, longitude=78.391544, source="DEVICE")
    read(client, second, latitude=17.449101, longitude=78.392207, source="DEVICE")
    assert forecasts["calls"] == [(17.45, 78.39)]


def test_a_failed_provider_shows_the_last_good_forecast_marked_stale(client, onboard, forecasts):
    technician = working(client, onboard)
    read(client, technician, latitude=CHOSEN[0], longitude=CHOSEN[1])
    forecasts["fail"] = True
    forecasts["clock"]["now"] = datetime(2026, 11, 9, 6, 40, tzinfo=UTC)
    answer = read(client, technician, latitude=CHOSEN[0], longitude=CHOSEN[1])
    assert answer["status"]["available"] is True and answer["status"]["stale"] is True
    forecasts["clock"]["now"] = datetime(2026, 11, 9, 11, 0, tzinfo=UTC)
    later = read(client, technician, latitude=CHOSEN[0], longitude=CHOSEN[1])
    assert later["status"]["available"] is False and later["current"] is None  # never made up


def test_weather_is_for_signed_in_technicians_only(client, onboard, requester_session, forecasts):
    assert client.get("/technicians/me/weather").status_code == 401
    _, headers = requester_session()
    assert client.get("/technicians/me/weather", headers=headers).status_code in (401, 403)
    registering = onboard("PAINTER", "000405", stop_after="email")
    assert client.get("/technicians/me/weather", headers=bearer(registering["access_token"])).status_code in (401, 403)


def test_place_search_uses_the_partner_geocoder(client, onboard, monkeypatch):
    technician = working(client, onboard)
    monkeypatch.setattr(
        geocoding.geocoding_service,
        "search_typed",
        lambda q: ([geocoding.Place("Guntur, Andhra Pradesh", 16.3, 80.44)], None),
    )
    response = client.get(
        "/technicians/me/weather/places", headers=bearer(technician["access_token"]), params={"q": "Guntur"}
    )
    assert response.status_code == 200
    assert response.json()["results"] == [{"name": "Guntur, Andhra Pradesh", "latitude": 16.3, "longitude": 80.44}]


def test_thresholds_and_rules_match_octabuilds_values():
    # The copy's values, as Professional's app/weather/config.py states them.
    assert DEFAULT_THRESHOLDS["rain_heavy_mm_h"] == 7.6 and DEFAULT_THRESHOLDS["rain_heavy_day_mm"] == 64.5
    assert (
        DEFAULT_THRESHOLDS["wind_watch_kmh"],
        DEFAULT_THRESHOLDS["wind_warning_kmh"],
        DEFAULT_THRESHOLDS["wind_severe_kmh"],
    ) == (50, 70, 90)
    assert (
        DEFAULT_THRESHOLDS["heat_watch_c"],
        DEFAULT_THRESHOLDS["heat_warning_c"],
        DEFAULT_THRESHOLDS["heat_severe_c"],
    ) == (38, 42, 46)
    assert thresholds_for("IN") == DEFAULT_THRESHOLDS
    assert evaluate({"hourly": [], "daily": [], "utc_offset_seconds": 19800}, DEFAULT_THRESHOLDS, NOW) == []


# ---------------------------------------------------------------- weather-aware pages


def test_the_technician_answer_carries_the_presentation_theme(client, onboard, requester_session, forecasts):
    technician, _ = holding_a_job(client, onboard, requester_session)
    forecasts["weather"][(round(HOME[0], 2), round(HOME[1], 2))] = STORMY
    answer = read(client, technician)
    assert answer["presentation"]["theme"] == "STORM"
    assert answer["presentation"]["warning"]["severity"] == "SEVERE"
    calm = read(client, technician, latitude=CHOSEN[0], longitude=CHOSEN[1])
    assert (
        calm["presentation"]["theme"] in ("SUNNY", "PARTLY_CLOUDY", "CLOUDY", "HOT")
        and calm["presentation"]["warning"] is None
    )


def test_public_weather_needs_no_session_and_carries_nothing_private(client, onboard, requester_session, forecasts):
    holding_a_job(client, onboard, requester_session)  # a job exists; it must not show
    forecasts["weather"][(round(HOME[0], 2), round(HOME[1], 2))] = STORMY
    response = client.get("/weather/public", params={"latitude": HOME[0], "longitude": HOME[1]})
    assert response.status_code == 200
    body = response.json()
    assert body["location"] == {"latitude": round(HOME[0], 2), "longitude": round(HOME[1], 2)}
    assert body["presentation"]["theme"] == "STORM" and body["warnings"][0]["severity"] == "SEVERE"
    assert set(body) == {"location", "status", "timezone", "current", "today", "next_hours", "warnings", "presentation"}
    assert 0 < len(body["next_hours"]) <= 6 and set(body["next_hours"][0]) == {
        "time",
        "temperature_c",
        "precipitation_probability_pct",
        "precipitation_mm",
        "condition",
    }
    text = str(body)
    assert "job_id" not in text and "service_address" not in text and "event_key" not in text and "JOB" not in text


def test_public_weather_shares_the_cache_and_stops_at_the_minute_budget(client, forecasts, monkeypatch):
    client.get("/weather/public", params={"latitude": 17.3861, "longitude": 78.4812})
    client.get("/weather/public", params={"latitude": 17.3881, "longitude": 78.4792})
    assert forecasts["calls"] == [(17.39, 78.48)]
    monkeypatch.setattr(weather_service, "PUBLIC_NEW_FETCHES_PER_MINUTE", 1)
    capped = client.get("/weather/public", params={"latitude": 12.0, "longitude": 77.0}).json()
    assert capped["status"]["available"] is False and forecasts["calls"] == [(17.39, 78.48)]
    assert client.get("/weather/public", params={"latitude": 95, "longitude": 1}).status_code == 422


def test_public_place_search_and_naming(client, monkeypatch):
    monkeypatch.setattr(
        weather_routes.Geocoder,
        "search",
        lambda self, q, country=None: [{"name": "Guntur, Andhra Pradesh, India", "latitude": 16.3, "longitude": 80.44}],
    )
    places = client.get("/weather/public/places", params={"q": "Guntur"})
    assert places.status_code == 200 and places.json()["results"][0]["name"].startswith("Guntur")
    asked = []
    monkeypatch.setattr(
        geocoding.geocoding_service, "area_name", lambda lat, lng: asked.append((lat, lng)) or "Hyderabad, Telangana"
    )
    named = client.get("/weather/public/describe", params={"latitude": 17.448312, "longitude": 78.391544})
    assert named.json() == {"name": "Hyderabad, Telangana"} and asked == [(17.45, 78.39)]  # never the exact position
