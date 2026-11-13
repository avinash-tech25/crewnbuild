"""Password sign-in throttle (technical-architecture.md 6.4), shared by every API process.

Failed password sign-ins are counted in rate_limit_events over LOGIN_FAILURE_WINDOW_SECONDS
(15 minutes): at LOGIN_MAX_FAILURES_PER_ACCOUNT (5) per sign-in identifier or
LOGIN_MAX_FAILURES_PER_ADDRESS (20) per client address, further attempts get 429 before the
password is checked. An attempt refused that way is counted too, so the wait keeps growing
while the attempts continue (the "growing delay"). A successful sign-in clears its
identifier's count. The identifier is stored only as a hash.

Before R6 the counts lived in each process at 10 per identifier and 50 per address.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.rate_limits import service as limits

ACCOUNT_BUCKET = "login:account"
ADDRESS_BUCKET = "login:address"
TOO_MANY = "Too many failed sign-in attempts. Please wait 15 minutes and try again."


def _address(address: str | None) -> str:
    return address or "unknown"


def ensure_allowed(database: Session, settings: Settings, identifier: str, address: str | None) -> None:
    window = settings.login_failure_window_seconds
    over_account = limits.blocked(database, ACCOUNT_BUCKET, identifier, settings.login_max_failures_per_account, window)
    over_address = limits.blocked(
        database, ADDRESS_BUCKET, _address(address), settings.login_max_failures_per_address, window
    )
    if not (over_account or over_address):
        return
    record_failure(database, identifier, address)
    wait = max(
        limits.retry_after_seconds(database, ACCOUNT_BUCKET, identifier, window) if over_account else 0,
        limits.retry_after_seconds(database, ADDRESS_BUCKET, _address(address), window) if over_address else 0,
    )
    raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(wait)})


def record_failure(database: Session, identifier: str, address: str | None) -> None:
    limits.record(database, ACCOUNT_BUCKET, identifier)
    limits.record(database, ADDRESS_BUCKET, _address(address))


def record_success(database: Session, identifier: str) -> None:
    limits.clear(database, ACCOUNT_BUCKET, identifier)
