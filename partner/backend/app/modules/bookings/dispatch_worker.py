"""The background sweeper: keeps dispatch moving when nobody is reading a booking.

Every DISPATCH_SWEEP_INTERVAL_SECONDS, in a worker thread (the database calls are
synchronous and must never block the event loop):

  * offers past their deadline are EXPIRED and, once a whole batch has lapsed,
    the next batch is offered (or the round ends as EXPIRED / NO_TECHNICIAN_FOUND);
  * a SEARCHING booking nobody dispatched (the process died between saving the
    booking and sending a batch) is dispatched;
  * positions nobody has refreshed for LOCATION_PURGE_AFTER_SECONDS are deleted.

One sweeper runs in every worker process. Each booking is taken with
SELECT ... FOR UPDATE SKIP LOCKED, so two processes never handle the same one and
a sweep never waits behind a request that is answering an offer.
"""

import asyncio
import logging
from collections.abc import Callable

from app.core.logging import log_event

logger = logging.getLogger(__name__)


class DispatchWorker:
    def __init__(self, sweep_once: Callable[[], dict], interval_seconds: float) -> None:
        self._sweep_once = sweep_once
        self._interval = max(interval_seconds, 0.5)
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run(), name="dispatch-sweeper")
            log_event(logger, "dispatch.worker_started", interval_s=self._interval)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                counts = await asyncio.to_thread(self._sweep_once)
                if any(counts.values()):
                    log_event(logger, "dispatch.sweep", **counts)
            except asyncio.CancelledError:
                raise
            except Exception:
                # A sweep that fails (the database restarting) is logged and retried
                # on the next tick; it never stops the loop.
                logger.exception("dispatch.sweep_crashed")
            await asyncio.sleep(self._interval)
