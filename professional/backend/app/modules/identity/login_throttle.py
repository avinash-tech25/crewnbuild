"""Password sign-in throttle, as before: failed password sign-ins are counted in a
15-minute sliding window, per login identifier (10) and per client address (50), and
further attempts get 429 once either limit is reached. A successful sign-in clears the
identifier's count.

The counts live in this process, as they did, so with several workers each keeps its
own. Moving them to a store shared by every process (and the tighter limits of section
6.4) is part of the security step R6.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException

WINDOW_SECONDS = 15 * 60
MAX_FAILURES_PER_IDENTIFIER = 10
MAX_FAILURES_PER_ADDRESS = 50
TOO_MANY = "Too many failed sign-in attempts. Please wait 15 minutes and try again."

_lock = threading.Lock()
_failures: dict[str, deque[float]] = defaultdict(deque)


def _keys(identifier: str, address: str | None) -> tuple[str, str]:
    return f"id:{(identifier or '').strip().casefold()}", f"ip:{address or 'unknown'}"


def _recent(key: str, now: float) -> int:
    events = _failures[key]
    while events and now - events[0] > WINDOW_SECONDS:
        events.popleft()
    return len(events)


def ensure_allowed(identifier: str, address: str | None) -> None:
    id_key, ip_key = _keys(identifier, address)
    now = time.monotonic()
    with _lock:
        if _recent(id_key, now) >= MAX_FAILURES_PER_IDENTIFIER or _recent(ip_key, now) >= MAX_FAILURES_PER_ADDRESS:
            raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(WINDOW_SECONDS)})


def record_failure(identifier: str, address: str | None) -> None:
    id_key, ip_key = _keys(identifier, address)
    now = time.monotonic()
    with _lock:
        _failures[id_key].append(now)
        _failures[ip_key].append(now)


def record_success(identifier: str) -> None:
    id_key, _ = _keys(identifier, None)
    with _lock:
        _failures.pop(id_key, None)


def reset() -> None:
    """Tests only."""
    with _lock:
        _failures.clear()
