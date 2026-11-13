"""Automatic weather monitoring of every active project site, and of every active
account's own place ("My location") once it has one (ported from the old
app/weather/monitor.py, same rules).

Run by the scheduler unit (app/jobs/run_scheduler.py, section 15.1), not by the API processes; the old backend
started it in a daemon thread at startup. A pass runs every
WEATHER_SEVERE_CHECK_INTERVAL_MINUTES (or the monitoring interval, if shorter) and
refreshes each site when it is due: WEATHER_MONITORING_INTERVAL_MINUTES since its last
fetch, or the severe-check interval while the site has a WARNING or SEVERE alert. Every
refresh re-evaluates the site's alerts and announces new or escalated ones.
WEATHER_MONITORING_ENABLED=false or an interval of 0 turns it off.

One pass by hand or from cron:

    .venv/Scripts/python.exe -m app.jobs.weather_alert_monitor
"""

import logging
from collections import Counter

from app.database.session import SessionLocal
from app.modules.weather.repository import WeatherRepository, weather_installed
from app.modules.weather.weather_provider_service import WeatherProviderError, WeatherRateLimited


def _check(service, site, outcomes: Counter, label) -> bool:
    """One site's check; False when the provider asks everyone to wait."""
    database = service.database
    try:
        outcomes[service.monitor_site(site)] += 1
    except WeatherRateLimited:
        database.rollback()
        outcomes["rate-limited"] += 1
        logger.warning("weather.monitor_paused: provider rate limit; the rest wait for the next pass.")
        return False
    except WeatherProviderError as error:
        database.rollback()
        outcomes["failed"] += 1
        logger.warning("weather.monitor_failed %s: %s", label, error.reason)
    except Exception:
        database.rollback()
        outcomes["error"] += 1
        logger.exception("weather.monitor_error %s", label)
    return True


logger = logging.getLogger(__name__)


def run(session_factory=SessionLocal, service_factory=None) -> dict:
    from app.modules.weather.service import Site, WeatherService

    service_factory = service_factory or (lambda database: WeatherService(database))
    database = session_factory()
    outcomes: Counter = Counter()
    try:
        if not weather_installed(database):
            logger.error("weather.monitor_skipped: tables missing; run alembic upgrade head.")
            return {"skipped": 1}
        repository = WeatherRepository(database)
        project_ids = repository.monitored_project_ids()
        user_ids = repository.monitored_personal_user_ids()
        service = service_factory(database)
        sites = [("project", project_id) for project_id in project_ids] + [("user", user_id) for user_id in user_ids]
        for kind, key in sites:
            if kind == "project":
                project = service.repository.project(key)
                site = Site(project=project) if project is not None else None
            else:
                account = service.repository.user(key)
                site = Site(user=account) if account is not None else None
            if site is None:
                continue
            if not _check(service, site, outcomes, f"{kind}={key}"):
                break
    finally:
        database.close()
    return dict(outcomes)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(f"Weather monitoring pass: {run()}")  # noqa: T201 command-line output
