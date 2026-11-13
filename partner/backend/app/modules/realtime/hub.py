"""Realtime delivery to websockets: job offers to technicians, live positions to customers.

    any thread (a request, the sweeper)                 event loop (one per process)
    ------------------------------------                ----------------------------
    hub.publish(topic, room, message)
        |  REALTIME_CROSS_PROCESS=true:
        |    SELECT pg_notify(channel, payload)  -->  listener thread in EVERY process
        |                                              LISTEN channel
        |  otherwise: this process only                    |
        +--------------------------------------------> loop.call_soon_threadsafe(_fanout)
                                                            |
                                              one bounded queue per connected socket
                                                            |
                                              that socket's own sender task -> send_json

Why it is built this way:
  * Uvicorn runs several worker processes in production. A room kept only in one
    process's memory means a customer connected to worker B never sees a position
    posted to worker A. PostgreSQL is already there, and LISTEN/NOTIFY relays a
    message to every process without adding Redis. (Redis pub/sub would replace
    `_notify` and `_listen` and nothing else.)
  * A message is never sent by the code that published it. Each socket has its own
    queue and sender task, so one slow phone cannot hold up anybody else's
    messages, messages to one socket stay in order, and two coroutines never write
    to the same socket at once. A queue that fills (a client that stopped reading)
    drops its oldest message: for live positions the newest is the one that matters.
  * Requests run in a threadpool; the sockets live on the event loop. Everything
    that touches rooms runs on the loop, reached with `call_soon_threadsafe`.

A NOTIFY payload is limited to 8000 bytes. A message that does not fit (a long
road route) is replaced by `{"type": "resync"}`, and the page reloads the snapshot.
If the listener is down, messages are still delivered inside this process.

Rooms are only ever joined after the router has authorised the subscriber from
their session, so a room can never deliver one person's data to somebody else.
"""

import asyncio
import json
import logging
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

import psycopg
from psycopg import sql
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.logging import log_event

logger = logging.getLogger(__name__)

TOPIC_TECHNICIAN = "technician"  # a technician's own job requests and job events
TOPIC_BOOKING = "booking"  # the customer watching one booking

# PostgreSQL refuses NOTIFY payloads of 8000 bytes or more.
MAX_NOTIFY_BYTES = 7900
SUBSCRIBER_QUEUE_SIZE = 64
LISTENER_RECONNECT_SECONDS = 2.0


@dataclass(eq=False)
class Subscription:
    topic: str
    room: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE))

    def offer(self, message: dict) -> None:
        """Queue a message; a full queue drops its oldest rather than blocking anyone."""
        if self.queue.full():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover - raced to empty
                pass
        self.queue.put_nowait(message)


def _room_key(room) -> str:
    return str(room)


class RealtimeHub:
    def __init__(self, engine: Engine, *, cross_process: bool, channel: str) -> None:
        self._engine = engine
        self._cross_process = cross_process
        self._channel = channel
        self._rooms: dict[tuple[str, str], set[Subscription]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop = threading.Event()
        self._listener: threading.Thread | None = None
        self._listening = threading.Event()
        self._publisher_only = False

    # ------------------------------------------------------------- lifecycle

    def publish_from_outside(self) -> None:
        """For a process with no sockets of its own (the scheduler): every message is
        sent with NOTIFY for the API processes to deliver, without listening here."""
        self._cross_process = True
        self._publisher_only = True

    def attach(self, loop: asyncio.AbstractEventLoop, *, cross_process: bool | None = None) -> None:
        """Bind to the process's event loop (app startup) and start listening."""
        if cross_process is not None:
            self._cross_process = cross_process
        self._loop = loop
        self._stop.clear()
        if self._cross_process and (self._listener is None or not self._listener.is_alive()):
            self._listener = threading.Thread(target=self._listen, name="realtime-listener", daemon=True)
            self._listener.start()

    def detach(self) -> None:
        self._stop.set()
        if self._listener is not None:
            self._listener.join(timeout=5)
        self._listener = None
        self._listening.clear()
        self._loop = None
        self._rooms.clear()

    @property
    def relaying(self) -> bool:
        return self._cross_process and (self._listening.is_set() or self._publisher_only)

    # --------------------------------------------- subscribers (loop thread)

    def subscribe(self, topic: str, room) -> Subscription:
        subscription = Subscription(topic=topic, room=_room_key(room))
        self._rooms[(topic, subscription.room)].add(subscription)
        return subscription

    def unsubscribe(self, subscription: Subscription) -> None:
        key = (subscription.topic, subscription.room)
        room = self._rooms.get(key)
        if room is None:
            return
        room.discard(subscription)
        if not room:
            self._rooms.pop(key, None)

    def subscriber_count(self, topic: str, room) -> int:
        return len(self._rooms.get((topic, _room_key(room)), ()))

    def _fanout(self, topic: str, room: str, message: dict) -> None:
        for subscription in list(self._rooms.get((topic, room), ())):
            subscription.offer(message)

    # ---------------------------------------------- publishing (any thread)

    def publish(self, topic: str, room, message: dict) -> None:
        """Deliver to every subscriber of the room, in every process. Never raises."""
        room_key = _room_key(room)
        if self.relaying:
            try:
                self._notify(topic, room_key, message)
                return
            except Exception as error:  # the relay failed: this process still delivers
                log_event(logger, "realtime.notify_failed", logging.WARNING, topic=topic, error=type(error).__name__)
        self._deliver_local(topic, room_key, message)

    def _deliver_local(self, topic: str, room: str, message: dict) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._fanout, topic, room, message)
        except RuntimeError:  # pragma: no cover - the loop closed between the check and the call
            pass

    def _notify(self, topic: str, room: str, message: dict) -> None:
        payload = json.dumps({"t": topic, "r": room, "m": message}, separators=(",", ":"), default=str)
        if len(payload.encode("utf-8")) > MAX_NOTIFY_BYTES:
            resync = {"type": "resync", "reason": "message_too_large"}
            for key in ("booking_id",):
                if key in message:
                    resync[key] = message[key]
            payload = json.dumps({"t": topic, "r": room, "m": resync}, separators=(",", ":"))
        with self._engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(
                text("SELECT pg_notify(:channel, :payload)"), {"channel": self._channel, "payload": payload}
            )

    # ------------------------------------------------ listening (own thread)

    def _listen(self) -> None:
        """LISTEN on a dedicated connection; hand every notification to the loop."""
        while not self._stop.is_set():
            connection = None
            try:
                # A connection of its own, outside the pool: it is held for the life
                # of the process and must never be handed to a request.
                connection = psycopg.connect(
                    self._engine.url.set(drivername="postgresql").render_as_string(hide_password=False),
                    autocommit=True,
                )
                connection.execute(sql.SQL("LISTEN {}").format(sql.Identifier(self._channel)))
                self._listening.set()
                log_event(logger, "realtime.listening", channel=self._channel)
                while not self._stop.is_set():
                    # Returns after a second without a notification, so a stop is noticed.
                    for notification in connection.notifies(timeout=1.0):
                        self._on_notification(notification.payload)
            except Exception as error:
                self._listening.clear()
                if not self._stop.is_set():
                    log_event(logger, "realtime.listener_down", logging.WARNING, error=type(error).__name__)
                    time.sleep(LISTENER_RECONNECT_SECONDS)
            finally:
                self._listening.clear()
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:  # pragma: no cover
                        pass

    def _on_notification(self, payload: str) -> None:
        try:
            envelope = json.loads(payload)
            self._deliver_local(envelope["t"], envelope["r"], envelope["m"])
        except (ValueError, KeyError, TypeError):
            log_event(logger, "realtime.bad_payload", logging.WARNING)


async def pump(subscription: Subscription, websocket) -> None:
    """A socket's sender task: the only code that writes to that socket."""
    while True:
        message = await subscription.queue.get()
        await websocket.send_json(message)


# Policy violation: the same close code a refused handshake gets.
WS_SESSION_ENDED = 1008


async def guard_session(websocket, still_valid, interval_seconds: float) -> None:
    """Close an open socket once its session no longer passes `still_valid`.

    A socket is authorized at its handshake and then lives for a whole shift or
    journey; this re-runs the session check every `interval_seconds` (off the
    event loop) so a sign-out, revocation, expiry or suspension also ends sockets
    that are already open. A check that cannot be completed counts as failed: the
    client reconnects and is checked afresh at its handshake.
    """
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            valid = await asyncio.to_thread(still_valid)
        except Exception:
            logger.exception("Could not re-check a websocket session")
            valid = False
        if not valid:
            try:
                await websocket.close(code=WS_SESSION_ENDED)
            except Exception:
                pass
            return


def room_of(identifier: uuid.UUID | str) -> str:
    return _room_key(identifier)
