"""The scheduler unit (technical-architecture.md 15.1, SC-01): one process per service runs
the periodic jobs, never the API processes.

Exactly one copy is active. A scheduler first takes a session-level advisory lock for the
whole service (`scheduler:<service>`) on a connection it keeps open; a second copy cannot
take it, waits as a standby and takes over within STANDBY_RETRY_SECONDS if the first one
stops (its connection closes and PostgreSQL releases the lock). Each job run is also
wrapped in pg_try_advisory_lock(`job:<service>:<name>`), so a job started by hand while the
scheduler runs it is skipped, not run twice.

A failing job is logged and tried again at its next turn; it never stops the others.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger(__name__)

STANDBY_RETRY_SECONDS = 15.0


@dataclass
class Job:
    name: str
    # Seconds between runs; 0 or less turns the job off.
    interval_seconds: float
    run: Callable[[], object]
    next_due: float = field(default=0.0, compare=False)


def lock_key(service: str, name: str) -> str:
    return f"job:{service}:{name}"


def try_lock(connection: Connection, key: str) -> bool:
    return bool(connection.execute(text("SELECT pg_try_advisory_lock(hashtext(:k))"), {"k": key}).scalar())


def unlock(connection: Connection, key: str) -> None:
    connection.execute(text("SELECT pg_advisory_unlock(hashtext(:k))"), {"k": key})


def run_job_once(engine: Engine, service: str, job: Job) -> bool:
    """Run `job` unless another process holds its lock. Returns whether it ran."""
    key = lock_key(service, job.name)
    with engine.connect() as connection:
        if not try_lock(connection, key):
            connection.commit()
            logger.info("scheduler.job_skipped job=%s reason=running_elsewhere", job.name)
            return False
        connection.commit()
        started = time.monotonic()
        try:
            result = job.run()
            logger.info(
                "scheduler.job_done job=%s seconds=%.2f result=%s", job.name, time.monotonic() - started, result
            )
        except Exception:
            logger.exception("scheduler.job_failed job=%s", job.name)
        finally:
            unlock(connection, key)
            connection.commit()
    return True


class Scheduler:
    def __init__(self, engine: Engine, service: str, jobs: list[Job], *, clock: Callable[[], float] = time.monotonic):
        self.engine = engine
        self.service = service
        self.jobs = [job for job in jobs if job.interval_seconds > 0]
        self.clock = clock
        self.stop_event = threading.Event()
        self._leader: Connection | None = None

    @property
    def leader_key(self) -> str:
        return f"scheduler:{self.service}"

    def become_leader(self) -> bool:
        """Take the service-wide lock on a connection kept open while this copy runs."""
        connection = self.engine.connect()
        if try_lock(connection, self.leader_key):
            connection.commit()
            self._leader = connection
            logger.info("scheduler.active service=%s jobs=%s", self.service, [job.name for job in self.jobs])
            return True
        connection.commit()
        connection.close()
        return False

    def release(self) -> None:
        if self._leader is not None:
            try:
                unlock(self._leader, self.leader_key)
                self._leader.commit()
            finally:
                self._leader.close()
                self._leader = None

    def tick(self) -> list[str]:
        """Run every job that is due; returns the names that ran."""
        ran = []
        now = self.clock()
        for job in self.jobs:
            if now >= job.next_due:
                if run_job_once(self.engine, self.service, job):
                    ran.append(job.name)
                job.next_due = self.clock() + job.interval_seconds
        return ran

    def run_forever(self) -> None:
        while not self.stop_event.is_set() and not self.become_leader():
            logger.info("scheduler.standby service=%s: another copy is active", self.service)
            self.stop_event.wait(STANDBY_RETRY_SECONDS)
        try:
            while not self.stop_event.is_set():
                self.tick()
                due = min((job.next_due for job in self.jobs), default=self.clock() + 60)
                self.stop_event.wait(max(0.2, min(due - self.clock(), 60)))
        finally:
            self.release()
