"""Weather endpoints under /api/v1 (ported from the old weather_routes.py; paths and answers
unchanged, ids are UUIDs). The public ones need no sign-in; everything else does."""

import uuid
from datetime import date

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user as get_current_user
from app.database.session import get_db as get_database
from app.modules.identity.models import User
from app.modules.weather.public_weather_service import PublicWeatherService
from app.modules.weather.schemas import SiteLocationUpdate
from app.modules.weather.service import WeatherService

router = APIRouter(tags=["Weather"])


def get_weather_service(database: Session = Depends(get_database)) -> WeatherService:
    return WeatherService(database)


def get_public_weather_service() -> PublicWeatherService:
    return PublicWeatherService()


# Every signed-in account, whatever its role, has its own place (/weather/me).
# A project's weather is read only by its House Owner, awarded builder and
# actively assigned Site Engineers, plus -- forecasts and active alerts only --
# Store Managers and Suppliers with open requests or orders for it and
# administrators whose scope and permissions cover it (WeatherService).
@router.get("/weather/projects")
def list_projects(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.list_projects(user)


@router.get("/weather/projects/{project_id}/current")
def current_weather(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.current(project_id, user)


@router.get("/weather/projects/{project_id}/forecast/hourly")
def hourly_forecast(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.hourly(project_id, user)


@router.get("/weather/projects/{project_id}/forecast/daily")
def daily_forecast(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.daily(project_id, user)


@router.get("/weather/projects/{project_id}/alerts")
def active_alerts(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.alerts(project_id, user)


# History of the account's own place and its member projects; project_id
# narrows it to one project, site=personal to the own place.
@router.get("/weather/alerts/history")
def alert_history(
    project_id: uuid.UUID | None = Query(default=None),
    site: str | None = Query(default=None, max_length=20),
    alert_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    acknowledged: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.history(
        user,
        project_id=project_id,
        site=site,
        alert_type=alert_type,
        severity=severity,
        status=status,
        date_from=date_from,
        date_to=date_to,
        acknowledged=acknowledged,
        page=page,
        page_size=page_size,
    )


@router.post("/weather/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: uuid.UUID, user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)
):
    return service.acknowledge(alert_id, user)


@router.get("/weather/projects/{project_id}/location")
def site_location(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.get_location(project_id, user)


@router.put("/weather/projects/{project_id}/location")
def set_site_location(
    project_id: uuid.UUID,
    payload: SiteLocationUpdate = Body(...),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.set_location(project_id, user, payload)


# Place search for choosing the site: the project's city when q is empty.
@router.get("/weather/projects/{project_id}/location/search")
def search_site_location(
    project_id: uuid.UUID,
    q: str | None = Query(default=None, max_length=120),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.search_places(project_id, user, q)


# ---------------------------------------------------------------- my location
# The signed-in account's own place: any role, with or without projects.
@router.get("/weather/me/current")
def my_current_weather(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.my_current(user)


@router.get("/weather/me/forecast/hourly")
def my_hourly_forecast(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.my_hourly(user)


@router.get("/weather/me/forecast/daily")
def my_daily_forecast(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.my_daily(user)


@router.get("/weather/me/alerts")
def my_active_alerts(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.my_alerts(user)


@router.get("/weather/me/location")
def my_location(user: User = Depends(get_current_user), service: WeatherService = Depends(get_weather_service)):
    return service.get_my_location(user)


@router.put("/weather/me/location")
def set_my_location(
    payload: SiteLocationUpdate = Body(...),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.set_my_location(user, payload)


# Place search for the own place: the account's registered area when q is empty.
@router.get("/weather/me/location/search")
def search_my_location(
    q: str | None = Query(default=None, max_length=120),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.search_my_places(user, q)


# ---------------------------------------------------------------- the header weather indicator
# One place's weather (?site=me or a project id the account may read; a sensible default
# without it) and the most serious active alerts across the sites it may read.
@router.get("/weather/summary")
def weather_summary(
    site: str | None = Query(
        default=None, pattern=r"^(me|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
    ),
    user: User = Depends(get_current_user),
    service: WeatherService = Depends(get_weather_service),
):
    return service.summary(user, site)


# ---------------------------------------------------------------- public (no sign-in)
# General weather for coordinates the visitor's browser sends: no project, account,
# history or acknowledgement is ever read, and nothing is stored.
@router.get("/weather/public")
def public_weather(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
    public: PublicWeatherService = Depends(get_public_weather_service),
):
    return public.weather(latitude, longitude, country_code)


@router.get("/weather/public/places")
def public_weather_places(
    q: str = Query(min_length=2, max_length=120),
    service: WeatherService = Depends(get_weather_service),
):
    """Place search for the public pages (the module's own geocoder and cache)."""
    return service.search(q, "", None)


@router.get("/weather/public/describe")
def public_weather_place_name(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    public: PublicWeatherService = Depends(get_public_weather_service),
):
    """The town or city at the visitor's device position, or null."""
    return {"name": public.describe(latitude, longitude)}
