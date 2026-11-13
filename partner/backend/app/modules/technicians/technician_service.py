import logging

from fastapi import HTTPException

from app.core.logging import log_event
from app.core.runtime import settings
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.rating_service import rating_summary
from app.modules.catalog.repository import ServiceRepository
from app.modules.identity.auth_service import (
    clean_address,
    clean_name,
    clean_phone,
    technician_response,
)
from app.modules.identity.models import Technician
from app.modules.identity.repository import TechnicianRepository as UserRepository
from app.modules.identity.schemas import TechnicianResponse
from app.modules.locations.location_service import PincodeDirectory
from app.modules.technicians.eligibility import job_eligibility
from app.modules.technicians.models import WORK_STATUS_AVAILABLE, WORK_STATUS_OFFLINE
from app.modules.technicians.onboarding_service import location_fields
from app.modules.technicians.repository import (
    TechnicianLocationRepository,
    TechnicianRepository,
    WorkPreferencesRepository,
)
from app.modules.technicians.schemas import DashboardSummary, ProfileUpdateRequest
from app.modules.technicians.work_preferences_service import WorkPreferencesService

logger = logging.getLogger(__name__)


class TechnicianService:
    """A signed-in technician's own profile, availability and dashboard.

    Every method takes the technician resolved from the access token; nothing
    accepts a technician id from the request.
    """

    def __init__(
        self,
        users: UserRepository,
        technicians: TechnicianRepository,
        locations: TechnicianLocationRepository,
        dispatch: DispatchService,
        directory: PincodeDirectory,
    ):
        self.users = users
        self.technicians = technicians
        self.locations = locations
        # Only for rating_summary(), the bookings domain's helper that takes a session.
        self.database = users.database
        self.dispatch = dispatch
        self.directory = directory

    def _fresh(self, user: Technician) -> TechnicianResponse:
        self.users.expire_all()
        return technician_response(self.users.get_with_profile(user.id), settings)

    def update_profile(self, user: Technician, payload: ProfileUpdateRequest) -> TechnicianResponse:
        changes = payload.model_dump(exclude_unset=True)
        values: dict = {}
        if "name" in changes:
            values["name"] = clean_name(changes["name"])
        if "phone" in changes:
            values["phone"] = clean_phone(changes["phone"])
        if "address" in changes:
            values["address"] = clean_address(changes["address"])
        if "pincode" in changes or "area" in changes:
            if not user.pincode and "pincode" not in changes:
                raise HTTPException(status_code=422, detail="Enter your PIN code.")
            # A new pincode means a new area, and the area must belong to the pincode.
            values.update(
                location_fields(self.directory, changes.get("pincode", user.pincode), changes.get("area", user.area))
            )
        if values:
            self.users.update(user, values)
        if changes.get("experience_years") is not None:
            user.technician_profile.experience_years = changes["experience_years"]
        self.users.commit()
        return self._fresh(user)

    def set_availability(self, user: Technician, work_status: str) -> TechnicianResponse:
        """AVAILABLE, PAUSED or OFFLINE, as the technician says.

        Anything but AVAILABLE withdraws the offers they were still deciding on, so
        no booking waits out a timeout on somebody who stepped away. OFFLINE with no
        job in hand also forgets where they are: Partner keeps no note of the
        whereabouts of somebody who is not working. A job already held carries on.
        """
        previous = user.technician_profile.work_status
        user.technician_profile.work_status = work_status
        self.users.commit()
        if work_status != WORK_STATUS_AVAILABLE:
            self.dispatch.withdraw_offers_of(user)
        if work_status == WORK_STATUS_OFFLINE and self.technicians.active_job_of(user.id) is None:
            self.locations.forget(user.id)
            self.locations.commit()
        log_event(logger, "technician.work_status", technician=user.id, previous=previous, status=work_status)
        return self._fresh(user)

    def set_profile_image(self, user: Technician, image_url: str) -> TechnicianResponse:
        user.technician_profile.profile_image_url = image_url
        self.users.commit()
        return self._fresh(user)

    def dashboard(self, user: Technician) -> DashboardSummary:
        counts = self.dispatch.job_counts(user)
        eligible, reasons = job_eligibility(user)
        # Only the aggregate: never a rating, a tag or who gave it.
        average_rating, rating_count = rating_summary(self.database, user.id)
        return DashboardSummary(
            **counts,
            is_available=user.technician_profile.is_available,
            work_status=user.technician_profile.work_status,
            technician_type=user.technician_profile.technician_type,
            can_receive_jobs=eligible,
            pending_requirements=reasons,
            service_radius_km=user.technician_profile.service_radius_km,
            working_schedule_enabled=user.technician_profile.working_schedule_enabled,
            within_working_hours=WorkPreferencesService(
                WorkPreferencesRepository(self.database), ServiceRepository(self.database)
            ).within_working_hours(user),
            average_rating=average_rating,
            rating_count=rating_count,
        )
