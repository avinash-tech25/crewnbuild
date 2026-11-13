"""Professional's scheduler unit (technical-architecture.md 15.1, SC-01):

    python -m app.jobs.run_scheduler

Runs, in one active copy across every server (app/jobs/scheduler.py):

    subscription_renewal_sweep  every SUBSCRIPTION_SWEEP_INTERVAL_MINUTES (60)
    weather_alert_monitor       every WEATHER_SEVERE_CHECK_INTERVAL_MINUTES or the monitoring
                                interval, whichever is shorter (off with
                                WEATHER_MONITORING_ENABLED=false)
    rate_limit_purge            hourly: rate-limit rows older than a day

The API processes run none of these (R6; porting-todo #39, #64).
"""

import logging
import signal

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.database.session import SessionLocal, engine
from app.jobs import subscription_renewal_sweep, weather_alert_monitor
from app.jobs.scheduler import Job, Scheduler
from app.modules.rate_limits.service import purge_expired
from app.modules.weather.weather_settings import get_weather_settings

logger = logging.getLogger(__name__)
SERVICE = "professional"


def purge_rate_limits() -> int:
    with SessionLocal() as database:
        return purge_expired(database)


def build_jobs() -> list[Job]:
    settings = get_settings()
    weather = get_weather_settings()
    weather_minutes = (
        min(weather.weather_monitoring_interval_minutes, weather.weather_severe_check_interval_minutes)
        if weather.weather_monitoring_enabled and weather.weather_monitoring_interval_minutes > 0
        else 0
    )
    return [
        Job(
            "subscription_renewal_sweep",
            settings.subscription_sweep_interval_minutes * 60,
            subscription_renewal_sweep.run,
        ),
        Job("weather_alert_monitor", weather_minutes * 60, weather_alert_monitor.run),
        Job("rate_limit_purge", 3600, purge_rate_limits),
    ]


def main() -> None:
    configure_logging(get_settings().debug)
    scheduler = Scheduler(engine, SERVICE, build_jobs())
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: scheduler.stop_event.set())
    scheduler.run_forever()


if __name__ == "__main__":
    main()
