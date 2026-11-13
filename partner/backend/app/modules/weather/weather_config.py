"""Weather settings, read from Partner/backend/.env. Every one has a working default.

Partner uses Open-Meteo, the provider Professional uses by default. Its keyless
endpoint is for non-commercial use; a commercial deployment sets WEATHER_API_KEY
and the customer endpoint in WEATHER_API_BASE_URL.
"""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import BACKEND_ROOT


class WeatherSettings(BaseSettings):
    weather_api_key: SecretStr = SecretStr("")
    weather_api_base_url: str = "https://api.open-meteo.com/v1"
    weather_air_quality_base_url: str = "https://air-quality-api.open-meteo.com/v1"
    # Place search for the public pages (Open-Meteo geocoding, as Professional uses).
    weather_geocoding_base_url: str = "https://geocoding-api.open-meteo.com/v1"
    weather_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    weather_max_retries: int = Field(default=2, ge=0, le=5)
    # A place's weather is fetched at most this often; readers in between share it.
    weather_cache_minutes: int = Field(default=25, ge=1, le=1440)
    # Cached weather older than this is no longer shown.
    weather_max_stale_minutes: int = Field(default=180, ge=5, le=2880)
    weather_forecast_days: int = Field(default=7, ge=1, le=16)

    model_config = SettingsConfigDict(env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def base_url(self) -> str:
        return (self.weather_api_base_url.strip() or "https://api.open-meteo.com/v1").rstrip("/")


@lru_cache
def get_weather_settings() -> WeatherSettings:
    return WeatherSettings()
