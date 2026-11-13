from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_active_technician
from app.database.session import get_db as get_database
from app.modules.identity.models import Technician
from app.modules.locations.geocoding_service import GeocodingService, get_geocoding_service
from app.modules.weather.weather_config import get_weather_settings
from app.modules.weather.weather_provider import Geocoder, WeatherProviderError
from app.modules.weather.weather_service import PLACE_DECIMALS, TechnicianWeatherService

router = APIRouter(prefix="/technicians/me/weather", tags=["Weather"])
# The public pages' weather (landing, sign-in, registration): no session at all.
public_router = APIRouter(prefix="/weather/public", tags=["Weather"])


def get_technician_weather_service(database: Session = Depends(get_database)) -> TechnicianWeatherService:
    return TechnicianWeatherService(database)


@router.get("")
def read_weather(
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    source: Literal["CHOSEN", "DEVICE"] | None = Query(default=None),
    name: str | None = Query(default=None, max_length=300),
    technician: Technician = Depends(get_active_technician),
    weather: TechnicianWeatherService = Depends(get_technician_weather_service),
):
    """Current weather, 24 hours, 7 days and active alerts. Without coordinates:
    the technician's current job; with them: a chosen place or the device's."""
    if (latitude is None) != (longitude is None):
        latitude = longitude = None
    return weather.weather(technician, latitude=latitude, longitude=longitude, source=source, name=name)


@router.get("/places")
def search_weather_places(
    q: str = Query(min_length=3, max_length=200),
    _technician: Technician = Depends(get_active_technician),
    geocoder: GeocodingService = Depends(get_geocoding_service),
):
    """Places for choosing where to see the weather (the booking map's geocoder)."""
    places, matched = geocoder.search_typed(q)
    return {"results": [place.as_dict() for place in places], "matched": matched}


@router.get("/describe")
def describe_weather_place(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    _technician: Technician = Depends(get_active_technician),
    geocoder: GeocodingService = Depends(get_geocoding_service),
):
    """What to call the device's position. Best effort."""
    return {"name": geocoder.describe(lat, lng)}


# ---------------------------------------------------------------- public (no sign-in)


def get_public_geocoder() -> Geocoder:
    return Geocoder(get_weather_settings())


@public_router.get("")
def public_weather(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    weather: TechnicianWeatherService = Depends(get_technician_weather_service),
):
    """General weather and forecast warnings for coordinates the visitor's browser
    sends. Nothing about any account, job or booking is read."""
    return weather.public(latitude, longitude)


@public_router.get("/places")
def public_weather_places(
    q: str = Query(min_length=2, max_length=120), geocoder: Geocoder = Depends(get_public_geocoder)
):
    """Place search for the public pages (Open-Meteo geocoding)."""
    try:
        return {"results": geocoder.search(q.strip(), "IN")}
    except WeatherProviderError:
        return {"results": []}


@public_router.get("/describe")
def public_weather_place_name(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    geocoder: GeocodingService = Depends(get_geocoding_service),
):
    """The town or city at the visitor's device position, or null."""
    return {"name": geocoder.area_name(round(latitude, PLACE_DECIMALS), round(longitude, PLACE_DECIMALS))}
