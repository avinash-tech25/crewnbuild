"""Weather: an account's own place, alerts and notifications, the summary, the public
weather and the monitor. The provider is an httpx mock transport (the old tests'
Open-Meteo fixture); nothing leaves the machine. Project weather answers 404 until the
projects module is ported."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import ClientFactory
from fastapi import Depends
from fastapi.testclient import TestClient
from identity.helpers import create_user, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.jobs import weather_alert_monitor
from app.modules.messaging.models import Notification
from app.modules.weather import public_weather_service
from app.modules.weather import weather_provider_service as providers
from app.modules.weather.models import WeatherAlert, WeatherSiteLocation
from app.modules.weather.router import get_public_weather_service, get_weather_service
from app.modules.weather.schemas import SiteLocationUpdate
from app.modules.weather.service import WeatherService
from app.modules.weather.weather_settings import WeatherSettings

HYDERABAD = (17.385, 78.4867)
NOW = datetime(2026, 11, 12, 6, 0)
SETTINGS = WeatherSettings(
    weather_api_provider="open-meteo",
    weather_api_key="",
    weather_api_base_url="https://api.open-meteo.com/v1",
    weather_monitoring_enabled=False,
    weather_cache_minutes=25,
    weather_max_stale_minutes=180,
    weather_email_alerts_enabled=False,
    weather_reopen_window_hours=6,
    weather_max_retries=0,
    weather_threshold_overrides="",
    weather_reverse_geocoding_base_url="",
)


class Provider:
    """The fake Open-Meteo answers, with per-hour overrides (rain={hour: mm})."""

    def __init__(self) -> None:
        self.rain: dict[int, float] = {}
        self.calls = 0

    def payload(self) -> dict[str, Any]:
        base = int(NOW.replace(tzinfo=UTC).timestamp()) // 3600 * 3600
        offset = 19800
        hours = list(range(48))
        days = list(range(14))
        day_epoch = [((base + offset) // 86400 * 86400 - offset) + 86400 * d for d in days]
        rain = [self.rain.get(h, 0.0) for h in hours]
        return {
            "timezone": "Asia/Kolkata",
            "utc_offset_seconds": offset,
            "current": {
                "time": base, "temperature_2m": 30.0, "relative_humidity_2m": 50, "apparent_temperature": 31.0,
                "is_day": 1, "precipitation": rain[0], "weather_code": 61 if rain[0] else 1, "cloud_cover": 20,
                "pressure_msl": 1010, "wind_speed_10m": 10.0, "wind_direction_10m": 90, "wind_gusts_10m": 20.0,
                "visibility": 24000,
            },
            "hourly": {
                "time": [base + 3600 * h for h in hours],
                "temperature_2m": [30.0 for _ in hours],
                "relative_humidity_2m": [50 for _ in hours],
                "apparent_temperature": [31.0 for _ in hours],
                "precipitation_probability": [80 if r else 0 for r in rain],
                "precipitation": rain,
                "weather_code": [61 if r else 1 for r in rain],
                "wind_speed_10m": [10.0 for _ in hours],
                "wind_gusts_10m": [20.0 for _ in hours],
            },
            "daily": {
                "time": day_epoch,
                "weather_code": [1 for _ in days],
                "temperature_2m_max": [32.0 for _ in days],
                "temperature_2m_min": [22.0 for _ in days],
                "precipitation_sum": [0.0 for _ in days],
                "precipitation_hours": [0 for _ in days],
                "precipitation_probability_max": [10 for _ in days],
                "wind_speed_10m_max": [15.0 for _ in days],
                "wind_gusts_10m_max": [30.0 for _ in days],
                "wind_direction_10m_dominant": [90 for _ in days],
                "sunrise": [e + 3600 for e in day_epoch],
                "sunset": [e + 43200 for e in day_epoch],
            },
        }  # fmt: skip

    def handler(self, request: httpx.Request) -> httpx.Response:
        if "geocoding" in request.url.host:
            places = [{"name": "Hyderabad", "latitude": HYDERABAD[0], "longitude": HYDERABAD[1], "country_code": "IN",
                       "admin1": "Telangana", "country": "India", "timezone": "Asia/Kolkata"}]  # fmt: skip
            return httpx.Response(200, json={"results": places})
        if "air-quality" in request.url.path:
            base = int(NOW.replace(tzinfo=UTC).timestamp()) // 3600 * 3600
            return httpx.Response(
                200, json={"hourly": {"time": [base + 3600 * h for h in range(72)], "dust": [10] * 72}}
            )
        self.calls += 1
        return httpx.Response(200, json=self.payload())


@pytest.fixture
def provider() -> Provider:
    return Provider()


def service_for(database: Session, provider: Provider) -> WeatherService:
    transport = httpx.MockTransport(provider.handler)
    return WeatherService(
        database,
        settings=SETTINGS,
        provider=providers.build_provider(SETTINGS, transport=transport, sleep=lambda _: None),
        geocoder=providers.Geocoder(SETTINGS, transport=transport, sleep=lambda _: None),
        clock=lambda: NOW,
    )


@pytest.fixture
def client(make_client: ClientFactory, provider: Provider) -> TestClient:
    def weather_service(database: Session = Depends(get_db)) -> WeatherService:
        return service_for(database, provider)

    def public_service() -> public_weather_service.PublicWeatherService:
        transport = httpx.MockTransport(provider.handler)
        return public_weather_service.PublicWeatherService(
            settings=SETTINGS,
            provider=providers.build_provider(SETTINGS, transport=transport, sleep=lambda _: None),
            clock=lambda: NOW,
        )

    public_weather_service.clear_public_cache()
    return make_client(overrides={get_weather_service: weather_service, get_public_weather_service: public_service})


def signed_in(client: TestClient, database: Session) -> tuple[Any, dict[str, str]]:
    user = create_user(database)
    return user, {"X-CSRF-Token": sign_in(client)}


def place(client: TestClient, headers: dict[str, str]) -> Any:
    location = {"latitude": HYDERABAD[0], "longitude": HYDERABAD[1], "location_name": "Hyderabad",
                "country_code": "IN", "timezone": "Asia/Kolkata", "source": "SEARCH"}  # fmt: skip
    return client.put("/api/v1/weather/me/location", json=location, headers=headers)


def test_my_place_weather(client: TestClient, database: Session, provider: Provider) -> None:
    user, headers = signed_in(client, database)
    saved = place(client, headers)
    assert saved.status_code == 200, saved.text
    stored = database.scalars(select(WeatherSiteLocation)).one()
    assert (stored.user_id, stored.project_id, stored.updated_by_user_id) == (user.id, None, user.id)

    current = client.get("/api/v1/weather/me/current").json()
    assert current["status"]["available"] is True
    assert current["current"]["temperature_c"] == 30.0
    assert current["current"]["observed_at"].endswith("+05:30")
    assert client.get("/api/v1/weather/me/forecast/hourly").status_code == 200
    assert len(client.get("/api/v1/weather/me/forecast/daily").json()["days"]) >= 1
    assert provider.calls == 1  # one fetch, then the cache


def test_a_rain_alert_is_raised_announced_and_acknowledged(
    client: TestClient, database: Session, provider: Provider
) -> None:
    user, headers = signed_in(client, database)
    provider.rain = {0: 9.0, 1: 9.0, 2: 9.0}
    place(client, headers)
    alerts = client.get("/api/v1/weather/me/alerts").json()["alerts"]
    assert alerts, "heavy rain in the next hours raises an alert"
    alert = database.scalars(select(WeatherAlert)).first()
    assert alert is not None and alert.user_id == user.id and alert.status == "ACTIVE"
    assert alert.created_at.tzinfo is None  # read back as naive UTC, as the ported code expects
    assert database.scalars(select(Notification).where(Notification.user_id == user.id)).first() is not None

    acknowledged = client.post(f"/api/v1/weather/alerts/{alert.id}/acknowledge", headers=headers)
    assert acknowledged.status_code == 200, acknowledged.text
    history = client.get("/api/v1/weather/alerts/history").json()
    assert history["total"] >= 1


def test_someone_elses_alert_cannot_be_acknowledged(client: TestClient, database: Session, provider: Provider) -> None:
    owner = create_user(database, email="owner@example.in", phone="9876500001")
    provider.rain = {0: 9.0, 1: 9.0, 2: 9.0}
    location = SiteLocationUpdate(
        latitude=HYDERABAD[0], longitude=HYDERABAD[1], location_name="Hyderabad", country_code="IN", source="SEARCH"
    )
    service_for(database, provider).set_my_location(owner, location)
    service_for(database, provider).my_alerts(owner)
    alert = database.scalars(select(WeatherAlert)).first()
    assert alert is not None
    create_user(database, email="other@example.in", phone="9876500002")
    csrf = sign_in(client, identifier="other@example.in")
    refused = client.post(f"/api/v1/weather/alerts/{alert.id}/acknowledge", headers={"X-CSRF-Token": csrf})
    assert refused.status_code in (403, 404)


def test_summary_and_project_weather_until_projects_are_ported(client: TestClient, database: Session) -> None:
    _, headers = signed_in(client, database)
    place(client, headers)
    summary = client.get("/api/v1/weather/summary", params={"site": "me"})
    assert summary.status_code == 200
    assert client.get("/api/v1/weather/summary", params={"site": "12"}).status_code == 422
    listing = client.get("/api/v1/weather/projects").json()
    assert listing["projects"] == [] and listing["personal"]["location"]["location_name"] == "Hyderabad"
    assert client.get(f"/api/v1/weather/projects/{uuid.uuid4()}/current").status_code == 404


def test_public_weather_needs_no_sign_in(client: TestClient) -> None:
    answer = client.get("/api/v1/weather/public", params={"latitude": HYDERABAD[0], "longitude": HYDERABAD[1]})
    assert answer.status_code == 200, answer.text
    assert answer.json()["current"]["temperature_c"] == 30.0
    places = client.get("/api/v1/weather/public/places", params={"q": "Hyderabad"})
    assert places.status_code == 200
    assert client.get("/api/v1/weather/me/current").status_code == 401


def test_the_monitor_refreshes_personal_sites(
    database: Session, provider: Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = create_user(database)
    database.add(WeatherSiteLocation(user_id=user.id, latitude=HYDERABAD[0], longitude=HYDERABAD[1],
                                     location_name="Hyderabad", country_code="IN", source="SEARCH"))  # fmt: skip
    database.commit()
    provider.rain = {0: 9.0, 1: 9.0, 2: 9.0}
    from app.database.session import SessionLocal

    outcome = weather_alert_monitor.run(
        session_factory=SessionLocal, service_factory=lambda db: service_for(db, provider)
    )
    assert sum(outcome.values()) == 1
    database.expire_all()
    assert database.scalars(select(WeatherAlert).where(WeatherAlert.user_id == user.id)).first() is not None


def test_stored_times_are_timestamptz(database: Session) -> None:
    user = create_user(database)
    database.add(WeatherSiteLocation(user_id=user.id, latitude=1.0, longitude=2.0, source="MANUAL"))
    database.commit()
    raw = database.execute(select(WeatherSiteLocation.__table__.c.created_at)).scalar_one()
    assert raw.tzinfo is None  # the column type converts to naive UTC for the ported code
    assert abs(raw - datetime.now(UTC).replace(tzinfo=None)) < timedelta(minutes=5)
