"""Travel-time estimates for dispatch ranking.

The ranking engine asks one question -- "how long would each of these technicians
take to reach this job?" -- through `EtaProvider`, so the source can change
without touching dispatch:

  NoEtaProvider     (DISPATCH_ETA_PROVIDER=none, the default) answers "unknown"
                    for everyone. Ranking then uses straight-line distance and
                    the offer records no ETA. A straight line is NOT presented as
                    a travel time anywhere.
  OsrmEtaProvider   (DISPATCH_ETA_PROVIDER=osrm) one OSRM `table` request per
                    batch: every candidate to the job, by road. A short timeout,
                    because dispatch waits for it; any failure answers "unknown"
                    and ranking falls back to distance for that batch.

A provider must answer for every candidate or for none, so candidates in one
batch are never scored on two different scales.
"""

import logging
from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.logging import log_event
from app.modules.locations.geo import Point

logger = logging.getLogger(__name__)


class EtaProvider(Protocol):
    name: str

    def estimate(self, origins: list[Point], destination: Point) -> list[float] | None:
        """Seconds from each origin to the destination, in order -- or None when unknown."""


class NoEtaProvider:
    name = "none"

    def estimate(self, origins: list[Point], destination: Point) -> list[float] | None:
        return None


class OsrmEtaProvider:
    name = "osrm"

    def __init__(self, settings: Settings) -> None:
        self._base = settings.osrm_base_url.rstrip("/")
        self._timeout = settings.dispatch_eta_timeout_seconds

    def estimate(self, origins: list[Point], destination: Point) -> list[float] | None:
        if not origins:
            return []
        # OSRM wants longitude,latitude. The destination is index 0.
        points = [destination, *origins]
        coordinates = ";".join(f"{lng},{lat}" for lat, lng in points)
        sources = ";".join(str(index) for index in range(1, len(points)))
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.get(
                    f"{self._base}/table/v1/driving/{coordinates}",
                    params={"sources": sources, "destinations": "0", "annotations": "duration"},
                )
                response.raise_for_status()
                payload = response.json()
            if payload.get("code") != "Ok":
                raise ValueError(f"OSRM returned {payload.get('code')}")
            durations = [row[0] for row in payload["durations"]]
            if len(durations) != len(origins) or any(value is None for value in durations):
                raise ValueError("OSRM could not route every candidate")
            return [float(value) for value in durations]
        except Exception as error:
            log_event(
                logger, "dispatch.eta_unavailable", logging.WARNING, provider=self.name, error=type(error).__name__
            )
            return None


def eta_provider_for(settings: Settings) -> EtaProvider:
    return OsrmEtaProvider(settings) if settings.dispatch_eta_provider == "osrm" else NoEtaProvider()
