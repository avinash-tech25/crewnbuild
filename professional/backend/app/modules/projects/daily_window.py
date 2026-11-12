"""When a Site Engineer's daily record (and its timeline entries and site photos) is open
for writing (the old daily_cost_service.daily_record_is_open / ensure_daily_record_open,
same rule): today only, before DAILY_WORK_CUTOFF local time, never on a Sunday. The rest
of the daily record comes with the site_operations module.
"""

from datetime import date, time

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.local_time import local_workflow_now

SUNDAY_WEEKDAY = 6


def daily_cutoff_time() -> time:
    try:
        hour, minute = (int(part) for part in get_settings().daily_work_cutoff.split(":", 1))
        if hour == 24 and minute == 0:
            return time.max
        return time(hour=hour, minute=minute)
    except (TypeError, ValueError):
        return time(hour=12)


def daily_record_is_open(work_date: date) -> bool:
    now = local_workflow_now()
    if work_date.weekday() == SUNDAY_WEEKDAY:
        return False
    if work_date > now.date():
        return False
    if work_date < now.date():
        return False
    return now.time().replace(tzinfo=None) < daily_cutoff_time()


def ensure_daily_record_open(work_date: date) -> None:
    settings = get_settings()
    if work_date.weekday() == SUNDAY_WEEKDAY:
        raise HTTPException(
            status_code=409, detail="Sunday is a site holiday. No daily record can be saved for a Sunday."
        )
    if not daily_record_is_open(work_date):
        raise HTTPException(
            status_code=409,
            detail=f"Daily record is closed after {settings.daily_work_cutoff} {settings.local_timezone}.",
        )
