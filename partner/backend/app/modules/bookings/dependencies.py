"""Service builders for bookings, dispatch, tracking and the technician dashboard (the old
Partner app/dependencies/dependencies.py, services part).

Process-wide, because they outlive any single request: the realtime hub holds every
connected socket, the OSRM cache stops a live position stream turning into a routing
request per fix, and the ETA provider is configured once. They are built on first use with
the running app's settings.
"""

from functools import lru_cache

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.database.session import SessionLocal, engine, get_db
from app.modules.bookings.dispatch_service import DispatchService
from app.modules.bookings.eta_provider import EtaProvider, eta_provider_for
from app.modules.bookings.job_execution_service import JobExecutionService
from app.modules.bookings.rating_service import RatingService
from app.modules.bookings.repository import (
    JobExecutionRepository,
    RatingRepository,
    ServiceRequestRepository,
    StartOtpRepository,
    WorkBillRepository,
)
from app.modules.bookings.requester_location_service import RegisteredLocationService
from app.modules.bookings.start_otp_service import StartOtpService
from app.modules.bookings.work_bill_service import WorkBillService
from app.modules.catalog.repository import ServiceRepository
from app.modules.identity.repository import TechnicianRepository as AccountRepository
from app.modules.locations.geocoding_service import GeocodingService, get_geocoding_service
from app.modules.locations.location_service import PincodeDirectory, get_pincode_directory
from app.modules.realtime.hub import RealtimeHub
from app.modules.technicians.bank_account_service import BankAccountService
from app.modules.technicians.earnings_service import EarningsService
from app.modules.technicians.repository import (
    BankAccountRepository,
    EarningsRepository,
    TechnicianLocationRepository,
    TechnicianRepository,
    WorkPreferencesRepository,
)
from app.modules.technicians.technician_location_service import TechnicianLocationService
from app.modules.technicians.technician_service import TechnicianService
from app.modules.technicians.upload_service import UploadService
from app.modules.technicians.work_preferences_service import WorkPreferencesService
from app.modules.tracking.repository import TrackingRepository
from app.modules.tracking.routing_service import RoutingService
from app.modules.tracking.tracking_service import TrackingService


@lru_cache(maxsize=1)
def get_realtime() -> RealtimeHub:
    return RealtimeHub(engine, cross_process=settings.realtime_cross_process, channel=settings.realtime_channel)


@lru_cache(maxsize=1)
def get_routing_service() -> RoutingService:
    return RoutingService(settings)


@lru_cache(maxsize=1)
def get_eta_provider() -> EtaProvider:
    return eta_provider_for(settings)


def build_dispatch_service(database: Session) -> DispatchService:
    return DispatchService(
        ServiceRequestRepository(database),
        TechnicianRepository(database),
        TechnicianLocationRepository(database),
        TrackingRepository(database),
        get_realtime(),
        settings,
        get_eta_provider(),
    )


def build_tracking_service(database: Session) -> TrackingService:
    return TrackingService(
        ServiceRequestRepository(database),
        TrackingRepository(database),
        TechnicianLocationRepository(database),
        get_routing_service(),
        get_realtime(),
        settings,
    )


def sweep_once() -> dict[str, object]:
    """One sweeper pass on its own session (the scheduler's dispatch_sweep job)."""
    with SessionLocal() as database:
        result: dict[str, object] = build_dispatch_service(database).sweep()
        return result


def get_dispatch_service(database: Session = Depends(get_db)) -> DispatchService:
    return build_dispatch_service(database)


def get_tracking_service(database: Session = Depends(get_db)) -> TrackingService:
    return build_tracking_service(database)


def get_technician_location_service(database: Session = Depends(get_db)) -> TechnicianLocationService:
    return TechnicianLocationService(
        TechnicianLocationRepository(database),
        TechnicianRepository(database),
        build_tracking_service(database),
        build_dispatch_service(database),
        settings,
    )


def get_technician_service(
    database: Session = Depends(get_db),
    dispatch: DispatchService = Depends(get_dispatch_service),
    directory: PincodeDirectory = Depends(get_pincode_directory),
) -> TechnicianService:
    return TechnicianService(
        AccountRepository(database),
        TechnicianRepository(database),
        TechnicianLocationRepository(database),
        dispatch,
        directory,
    )


def get_work_preferences_service(database: Session = Depends(get_db)) -> WorkPreferencesService:
    return WorkPreferencesService(WorkPreferencesRepository(database), ServiceRepository(database))


def get_start_otp_service(database: Session = Depends(get_db)) -> StartOtpService:
    return StartOtpService(StartOtpRepository(database), ServiceRequestRepository(database))


def get_rating_service(database: Session = Depends(get_db)) -> RatingService:
    return RatingService(RatingRepository(database), ServiceRequestRepository(database))


def get_registered_location_service(
    geocoder: GeocodingService = Depends(get_geocoding_service),
    directory: PincodeDirectory = Depends(get_pincode_directory),
) -> RegisteredLocationService:
    return RegisteredLocationService(geocoder, directory)


def get_upload_service() -> UploadService:
    return UploadService()


def get_job_execution_service(database: Session = Depends(get_db)) -> JobExecutionService:
    return JobExecutionService(JobExecutionRepository(database), ServiceRequestRepository(database))


def get_work_bill_service(database: Session = Depends(get_db)) -> WorkBillService:
    return WorkBillService(WorkBillRepository(database), ServiceRequestRepository(database))


def get_bank_account_service(database: Session = Depends(get_db)) -> BankAccountService:
    return BankAccountService(BankAccountRepository(database))


def get_earnings_service(database: Session = Depends(get_db)) -> EarningsService:
    return EarningsService(EarningsRepository(database))
