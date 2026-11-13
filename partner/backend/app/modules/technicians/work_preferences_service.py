"""Reading and saving a technician's work preferences, and India time for dispatch.

Validation lives here, once, for both places the preferences are set: the last
registration step and the Profile screen.
"""

from datetime import datetime

from fastapi import HTTPException

from app.core.india_time import INDIA_TIMEZONE_NAME, india_weekday_and_time, within_window
from app.database.types import naive_utc_now
from app.modules.catalog.models import Service
from app.modules.catalog.repository import ServiceRepository
from app.modules.catalog.schemas import ServiceOut
from app.modules.identity.auth_service import clean_technician_type
from app.modules.identity.models import Technician
from app.modules.technicians.models import (
    SERVICE_RADIUS_CHOICES_KM,
    WEEKDAYS,
    TechnicianService,
    TechnicianWorkingHours,
)
from app.modules.technicians.repository import WorkPreferencesRepository
from app.modules.technicians.schemas import WorkingDay, WorkPreferences, WorkPreferencesUpdate


def _refuse(message: str) -> None:
    raise HTTPException(status_code=422, detail=message)


class WorkPreferencesService:
    def __init__(self, repository: WorkPreferencesRepository, services: ServiceRepository):
        self.repository = repository
        self.services = services

    # ------------------------------------------------------------------ catalog

    def catalog(self, trade: str | None) -> list[Service]:
        """A trade's live services, in published order -- what a technician may pick from."""
        return self.services.active_for_trade(clean_technician_type(trade))

    def catalog_for(self, user: Technician, trade: str | None) -> list[ServiceOut]:
        from app.modules.catalog.service import service_out

        own = user.technician_profile.technician_type if user.technician_profile else None
        wanted = clean_technician_type(trade or own)
        # A technician whose trade is set sees only that trade's services.
        if own and wanted != own:
            raise HTTPException(status_code=403, detail="You can only choose services of your own trade.")
        return [service_out(service) for service in self.catalog(wanted)]

    # --------------------------------------------------------------------- read

    def read(self, user: Technician) -> WorkPreferences:
        profile = user.technician_profile
        selected = [row.service_id for row in self.repository.list_services_of(user.id)]
        stored = {row.weekday: row for row in self.repository.list_working_hours_of(user.id)}
        days = [
            WorkingDay(weekday=day, working=True, start_time=stored[day].start_time, end_time=stored[day].end_time)
            if day in stored
            else WorkingDay(weekday=day, working=False)
            for day in WEEKDAYS
        ]
        return WorkPreferences(
            technician_type=profile.technician_type,
            offers_all_services=profile.offers_all_services,
            service_ids=selected,
            service_radius_km=profile.service_radius_km,
            working_schedule_enabled=profile.working_schedule_enabled,
            working_days=days,
            radius_choices_km=list(SERVICE_RADIUS_CHOICES_KM),
            timezone=INDIA_TIMEZONE_NAME,
        )

    # -------------------------------------------------------------------- write

    def apply(self, user: Technician, payload: WorkPreferencesUpdate) -> None:
        """Validate and stage the whole set in the current transaction; the caller commits."""
        profile = user.technician_profile
        trade = profile.technician_type
        if not trade:
            _refuse("Choose your trade before your services.")

        # Radius: the same steps as the dispatch rings, or no personal limit.
        if payload.service_radius_km is not None and payload.service_radius_km not in SERVICE_RADIUS_CHOICES_KM:
            _refuse("Choose a service radius of 2, 5, 10 or 15 km.")

        # Services: live ones of the technician's own trade only.
        service_ids = list(dict.fromkeys(payload.service_ids))
        if not payload.offers_all_services:
            if not service_ids:
                _refuse("Select at least one service you provide.")
            allowed = {service.id for service in self.catalog(trade)}
            if any(service_id not in allowed for service_id in service_ids):
                _refuse("Choose only available services of your own trade.")

        # Working hours: one same-day window per day, never overnight.
        days: dict[int, WorkingDay] = {}
        for day in payload.working_days:
            if day.weekday in days:
                _refuse("Each weekday can have only one working window.")
            days[day.weekday] = day
        working = {weekday: day for weekday, day in days.items() if day.working}
        for day in working.values():
            if day.start_time is None:
                _refuse("Choose a start time for every working day.")
            if day.end_time is not None and day.start_time >= day.end_time:
                _refuse("A working day must end after it starts, on the same day (no overnight hours).")
        if payload.working_schedule_enabled and not working:
            _refuse("Choose at least one working day, or turn working hours off.")

        profile.service_radius_km = payload.service_radius_km
        profile.offers_all_services = payload.offers_all_services
        profile.working_schedule_enabled = payload.working_schedule_enabled

        self.repository.delete_services_of(user.id)
        if not payload.offers_all_services:
            self.repository.add_all(
                TechnicianService(technician_id=user.id, service_id=service_id) for service_id in service_ids
            )

        # Kept even while the schedule is off, so turning it back on restores it.
        self.repository.delete_working_hours_of(user.id)
        self.repository.add_all(
            TechnicianWorkingHours(
                technician_id=user.id, weekday=day.weekday, start_time=day.start_time, end_time=day.end_time
            )
            for day in working.values()
        )
        self.repository.flush()

    def update(self, user: Technician, payload: WorkPreferencesUpdate) -> WorkPreferences:
        self.apply(user, payload)
        self.repository.commit()
        return self.read(user)

    # ------------------------------------------------------------- dashboard

    def within_working_hours(self, user: Technician, now_utc: datetime | None = None) -> bool | None:
        """None when no schedule is enabled; otherwise whether now is inside today's window."""
        profile = user.technician_profile
        if not profile or not profile.working_schedule_enabled:
            return None
        weekday, moment = india_weekday_and_time(now_utc or naive_utc_now())
        row = self.repository.get_working_hours(user.id, weekday)
        return row is not None and within_window(row.start_time, row.end_time, moment)
