"""Partner's scheduler unit (technical-architecture.md 15.1, SC-01):

    python -m app.jobs.run_scheduler

Runs, in one active copy across every server (app/jobs/scheduler.py):

    dispatch_sweep        every DISPATCH_SWEEP_INTERVAL_SECONDS (3): lapsed offers, the next
                          batch, stuck searches, abandoned positions (off with
                          DISPATCH_WORKER_ENABLED=false)
    face_capture_purge    hourly: face captures past FACE_CAPTURE_RETENTION_DAYS
    rate_limit_purge      hourly: rate-limit rows older than a day

The sweeper ran in every API process before R6 (porting-todo #71). Its messages to open
sockets (offers, cancellations) go to the API processes with PostgreSQL NOTIFY, so
REALTIME_CROSS_PROCESS must be true wherever the scheduler runs apart from the API.
"""

import logging
import signal

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.runtime import use_settings
from app.database.session import SessionLocal, engine
from app.jobs.scheduler import Job, Scheduler
from app.modules.bookings.dependencies import get_realtime, sweep_once
from app.modules.rate_limits.service import purge_expired
from app.modules.technicians.identity_service import purge_expired_face_captures

logger = logging.getLogger(__name__)
SERVICE = "partner"


def purge_rate_limits() -> int:
    with SessionLocal() as database:
        return purge_expired(database)


def purge_face_captures() -> int:
    with SessionLocal() as database:
        return purge_expired_face_captures(database)


def build_jobs() -> list[Job]:
    settings = get_settings()
    return [
        Job(
            "dispatch_sweep",
            settings.dispatch_sweep_interval_seconds if settings.dispatch_worker_enabled else 0,
            sweep_once,
        ),
        Job("face_capture_purge", 3600, purge_face_captures),
        Job("rate_limit_purge", 3600, purge_rate_limits),
    ]


def main() -> None:
    settings = get_settings()
    configure_logging(settings.debug)
    use_settings(settings)
    if not settings.realtime_cross_process:
        logger.warning("REALTIME_CROSS_PROCESS=false: sweeper messages reach no socket outside this process.")
    get_realtime().publish_from_outside()
    scheduler = Scheduler(engine, SERVICE, build_jobs())
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: scheduler.stop_event.set())
    scheduler.run_forever()


if __name__ == "__main__":
    main()
