"""Database access of the technicians module (the old identity and work-preference repositories)."""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import cos, degrees, radians

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.orm import Query, Session, contains_eager

from app.core.india_time import india_weekday_and_time
from app.database.base_repository import BaseRepository
from app.modules.bookings.models import (
    OFFER_ACCEPTED,
    OFFER_EXPIRED,
    OFFER_OFFERED,
    OFFER_REJECTED,
    OFFER_TECHNICIAN_CANCELLED,
    STATUS_COMPLETED,
    TECHNICIAN_BUSY_STATUSES,
    ServiceRequest,
    ServiceRequestAssignment,
)
from app.modules.identity.models import ACCOUNT_STATUS_ACTIVE, Technician
from app.modules.technicians.eligibility import allowed_aadhaar_statuses, allowed_face_statuses
from app.modules.technicians.models import (
    WORK_STATUS_AVAILABLE,
    IdentityVerification,
    TechnicianBankAccount,
    TechnicianEarning,
    TechnicianLocation,
    TechnicianProfile,
    TechnicianService,
    TechnicianWorkingHours,
)


class IdentityRepository(BaseRepository[IdentityVerification]):
    def __init__(self, database: Session):
        super().__init__(database, IdentityVerification)

    def list_expired_face_captures(self, now: datetime) -> list[IdentityVerification]:
        return (
            self.database.query(IdentityVerification)
            .filter(
                IdentityVerification.face_provider_reference.isnot(None),
                IdentityVerification.face_capture_expires_at < now,
            )
            .all()
        )

    def find_other_with_aadhaar_fingerprint(self, fingerprint: str, user_id):
        """The id row of another account's record holding this fingerprint, or None."""
        return (
            self.database.query(IdentityVerification.id)
            .filter(IdentityVerification.aadhaar_fingerprint == fingerprint, IdentityVerification.user_id != user_id)
            .first()
        )


class WorkPreferencesRepository(BaseRepository[TechnicianService]):
    """A technician's chosen services and weekly working hours."""

    def __init__(self, database: Session):
        super().__init__(database, TechnicianService)

    def list_services_of(self, technician_id) -> list[TechnicianService]:
        return self.database.query(TechnicianService).filter(TechnicianService.technician_id == technician_id).all()

    def list_working_hours_of(self, technician_id) -> list[TechnicianWorkingHours]:
        return (
            self.database.query(TechnicianWorkingHours)
            .filter(TechnicianWorkingHours.technician_id == technician_id)
            .all()
        )

    def delete_services_of(self, technician_id) -> None:
        self.database.query(TechnicianService).filter(TechnicianService.technician_id == technician_id).delete()

    def delete_working_hours_of(self, technician_id) -> None:
        self.database.query(TechnicianWorkingHours).filter(
            TechnicianWorkingHours.technician_id == technician_id
        ).delete()

    def get_working_hours(self, technician_id, weekday: int) -> TechnicianWorkingHours | None:
        return self.database.get(TechnicianWorkingHours, (technician_id, weekday))


EARTH_RADIUS_M = 6371008.8


# Offers the technician actually answered, one way or another. LOST_RACE and
# CANCELLED are not their doing, so they count for nothing.
ANSWERED_OFFER_STATUSES = (OFFER_ACCEPTED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_TECHNICIAN_CANCELLED)


TAKEN_OFFER_STATUSES = (OFFER_ACCEPTED, OFFER_TECHNICIAN_CANCELLED)


@dataclass(frozen=True)
class NearbyTechnician:
    technician: Technician
    distance_meters: float
    latitude: float
    longitude: float
    last_location_at: datetime
    accuracy: float | None


@dataclass(frozen=True)
class TechnicianDispatchStats:
    offers_answered: int = 0
    offers_accepted: int = 0
    jobs_handed_back: int = 0
    jobs_today: int = 0
    jobs_completed: int = 0


class TechnicianRepository(BaseRepository[TechnicianProfile]):
    def __init__(self, database: Session):
        super().__init__(database, TechnicianProfile)

    def _eligible(self, technician_type: str, exclude_ids: Iterable, now: datetime, service_id=None) -> Query:
        """Technicians who may be offered a job right now, as one SQL filter.

        The same rules as `services.eligibility.job_eligibility` (ACTIVE account,
        finished registration, identity, trade, service location) plus the live
        conditions: work status AVAILABLE, not holding an accepted/active job, and
        not sitting on an unexpired offer for another booking.

        And the technician's own work preferences (0011), each a no-op at its default:
          * a booking for a catalog service goes only to technicians who offer
            every service of the trade, or who chose that one;
          * with a working schedule enabled, only inside today's window in India
            time (start <= now < end; no end = end of the day).
        Position, freshness and the personal radius are distances, applied in
        `eligible_near`.
        """
        busy = exists().where(
            ServiceRequest.technician_id == Technician.id,
            ServiceRequest.status.in_(TECHNICIAN_BUSY_STATUSES),
        )
        holding_offer = exists().where(
            ServiceRequestAssignment.technician_id == Technician.id,
            ServiceRequestAssignment.status == OFFER_OFFERED,
            ServiceRequestAssignment.expires_at > now,
        )
        query = (
            self.database.query(Technician)
            .join(TechnicianProfile, TechnicianProfile.user_id == Technician.id)
            .join(IdentityVerification, IdentityVerification.user_id == Technician.id)
            .options(contains_eager(Technician.technician_profile), contains_eager(Technician.identity))
            .filter(
                TechnicianProfile.technician_type == technician_type,
                TechnicianProfile.work_status == WORK_STATUS_AVAILABLE,
                Technician.status == ACCOUNT_STATUS_ACTIVE,
                Technician.onboarding_completed_at.isnot(None),
                Technician.pincode.isnot(None),
                IdentityVerification.face_status.in_(allowed_face_statuses()),
                IdentityVerification.aadhaar_status.in_(allowed_aadhaar_statuses()),
                ~busy,
                ~holding_offer,
            )
        )
        if service_id is not None:
            chose_it = exists().where(
                TechnicianService.technician_id == Technician.id,
                TechnicianService.service_id == service_id,
            )
            query = query.filter(or_(TechnicianProfile.offers_all_services.is_(True), chose_it))
        weekday, moment = india_weekday_and_time(now)
        on_shift = exists().where(
            TechnicianWorkingHours.technician_id == Technician.id,
            TechnicianWorkingHours.weekday == weekday,
            TechnicianWorkingHours.start_time <= moment,
            or_(TechnicianWorkingHours.end_time.is_(None), TechnicianWorkingHours.end_time > moment),
        )
        query = query.filter(or_(TechnicianProfile.working_schedule_enabled.is_(False), on_shift))
        excluded = [value for value in exclude_ids if value]
        if excluded:
            query = query.filter(Technician.id.notin_(excluded))
        return query

    def eligible_near(
        self,
        technician_type: str,
        *,
        latitude: float,
        longitude: float,
        radius_meters: float,
        exclude_ids: Iterable,
        now: datetime,
        stale_threshold_seconds: int,
        limit: int,
        service_id=None,
    ) -> list[NearbyTechnician]:
        """The nearest eligible technicians to a point, nearest first, at most `limit`.

        Filtered entirely in PostgreSQL. This database has no PostGIS (and the
        build in use cannot load it), so distance is the haversine formula in SQL:

          1. a bounding box first, which the (latitude, longitude) index uses and
             which throws away everyone in another part of the country;
          2. haversine on what survives, to cut the box down to the true circle and
             to order the result.

        Accurate to metres at city range. The candidate set is also small by
        construction: `technician_locations` only holds technicians who are
        working right now. Moving to PostGIS later changes this query only.

        A technician whose position is older than the stale threshold is not
        returned: a position from a minute ago is not evidence of where somebody
        is now. A personal service radius is applied in the same query, before
        `limit`, so somebody who travels only 5 km never takes a place in the pool
        from somebody who would go.
        """
        latitude_span = degrees(radius_meters / EARTH_RADIUS_M)
        longitude_span = latitude_span / max(cos(radians(latitude)), 0.01)

        half_latitude_delta = func.sin(func.radians(TechnicianLocation.latitude - latitude) / 2)
        half_longitude_delta = func.sin(func.radians(TechnicianLocation.longitude - longitude) / 2)
        chord = (
            half_latitude_delta * half_latitude_delta
            + func.cos(func.radians(float(latitude)))
            * func.cos(func.radians(TechnicianLocation.latitude))
            * half_longitude_delta
            * half_longitude_delta
        )
        distance = 2 * EARTH_RADIUS_M * func.asin(func.least(1.0, func.sqrt(chord)))

        rows = (
            self._eligible(technician_type, exclude_ids, now, service_id)
            .join(TechnicianLocation, TechnicianLocation.technician_id == Technician.id)
            .add_columns(
                distance.label("distance_meters"),
                TechnicianLocation.latitude,
                TechnicianLocation.longitude,
                TechnicianLocation.last_location_at,
                TechnicianLocation.accuracy,
            )
            .filter(
                TechnicianLocation.last_location_at >= now - timedelta(seconds=stale_threshold_seconds),
                TechnicianLocation.latitude.between(latitude - latitude_span, latitude + latitude_span),
                TechnicianLocation.longitude.between(longitude - longitude_span, longitude + longitude_span),
                distance <= radius_meters,
                or_(
                    TechnicianProfile.service_radius_km.is_(None),
                    distance <= TechnicianProfile.service_radius_km * 1000.0,
                ),
            )
            .order_by(distance, Technician.id)
            .limit(limit)
            .all()
        )
        return [
            NearbyTechnician(
                technician=technician,
                distance_meters=float(meters),
                latitude=lat,
                longitude=lng,
                last_location_at=located_at,
                accuracy=accuracy,
            )
            for technician, meters, lat, lng, located_at, accuracy in rows
        ]

    def dispatch_stats(self, technician_ids: list, *, since: datetime, day_start: datetime) -> dict:
        """Ranking statistics for a candidate pool: two grouped queries, never one per technician."""
        wanted = [technician_id for technician_id in technician_ids if technician_id]
        if not wanted:
            return {}
        offers = ServiceRequestAssignment
        rows = (
            self.database.query(
                offers.technician_id,
                func.count(offers.id).filter(offers.status.in_(ANSWERED_OFFER_STATUSES)),
                func.count(offers.id).filter(offers.status.in_(TAKEN_OFFER_STATUSES)),
                func.count(offers.id).filter(offers.status == OFFER_TECHNICIAN_CANCELLED),
                func.count(offers.id).filter(
                    offers.status.in_(TAKEN_OFFER_STATUSES),
                    offers.responded_at >= day_start,
                ),
            )
            .filter(offers.technician_id.in_(wanted), offers.offered_at >= since)
            .group_by(offers.technician_id)
            .all()
        )
        completed = dict(
            self.database.query(ServiceRequest.technician_id, func.count(ServiceRequest.id))
            .filter(
                ServiceRequest.technician_id.in_(wanted),
                ServiceRequest.status == STATUS_COMPLETED,
                ServiceRequest.completed_at >= since,
            )
            .group_by(ServiceRequest.technician_id)
            .all()
        )
        stats = {
            technician_id: TechnicianDispatchStats(
                offers_answered=answered,
                offers_accepted=accepted,
                jobs_handed_back=handed_back,
                jobs_today=today,
                jobs_completed=int(completed.get(technician_id, 0)),
            )
            for technician_id, answered, accepted, handed_back, today in rows
        }
        for technician_id in wanted:
            stats.setdefault(
                technician_id, TechnicianDispatchStats(jobs_completed=int(completed.get(technician_id, 0)))
            )
        return stats

    def lock_technician(self, technician_id) -> bool:
        """Row-lock the technician's profile for this transaction; False if another
        transaction is offering them a job right now (SKIP LOCKED)."""
        row = self.database.execute(
            select(TechnicianProfile.id)
            .where(TechnicianProfile.user_id == technician_id)
            .with_for_update(skip_locked=True)
        ).first()
        return row is not None

    def profile_for_acceptance(self, technician_id) -> TechnicianProfile | None:
        """The technician's profile, re-read and row-locked for the accepting transaction.

        Blocking (not SKIP LOCKED): an availability or preferences change being
        saved at this moment finishes first, and the acceptance then sees it.
        Taken after the booking lock, as offering takes a booking lock before
        any profile lock -- the same order, so the two cannot deadlock.
        """
        return self.database.execute(
            select(TechnicianProfile)
            .where(TechnicianProfile.user_id == technician_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()

    def has_selected_service(self, technician_id, service_id) -> bool:
        return (
            self.database.query(TechnicianService.service_id)
            .filter(TechnicianService.technician_id == technician_id, TechnicianService.service_id == service_id)
            .first()
            is not None
        )

    def is_free(self, technician_id, now: datetime) -> bool:
        """Re-checked under the profile lock, because the search ran before it was taken."""
        busy = (
            self.database.query(ServiceRequest.id)
            .filter(ServiceRequest.technician_id == technician_id, ServiceRequest.status.in_(TECHNICIAN_BUSY_STATUSES))
            .first()
        )
        offer = (
            self.database.query(ServiceRequestAssignment.id)
            .filter(
                ServiceRequestAssignment.technician_id == technician_id,
                ServiceRequestAssignment.status == OFFER_OFFERED,
                ServiceRequestAssignment.expires_at > now,
            )
            .first()
        )
        return busy is None and offer is None

    def active_job_of(self, technician_id) -> ServiceRequest | None:
        """The one job this technician holds (the database allows at most one)."""
        return (
            self.database.query(ServiceRequest)
            .filter(ServiceRequest.technician_id == technician_id, ServiceRequest.status.in_(TECHNICIAN_BUSY_STATUSES))
            .first()
        )

    def holds_live_offer(self, technician_id, now: datetime) -> bool:
        return self.database.query(
            exists().where(
                ServiceRequestAssignment.technician_id == technician_id,
                ServiceRequestAssignment.status == OFFER_OFFERED,
                ServiceRequestAssignment.expires_at > now,
            )
        ).scalar()


__all__ = ["NearbyTechnician", "TechnicianDispatchStats", "TechnicianRepository"]


class TechnicianLocationRepository(BaseRepository[TechnicianLocation]):
    def __init__(self, database: Session):
        super().__init__(database, TechnicianLocation)

    def get(self, technician_id: uuid.UUID) -> TechnicianLocation | None:
        return self.database.get(TechnicianLocation, technician_id)

    def write(
        self,
        location: TechnicianLocation | None,
        technician_id: uuid.UUID,
        *,
        latitude: float,
        longitude: float,
        accuracy: float | None,
        heading: float | None,
        speed: float | None,
        altitude: float | None,
        device_timestamp: datetime | None,
        now: datetime,
    ) -> TechnicianLocation:
        """Insert or overwrite the technician's row. `now` is server time, always."""
        if location is None:
            location = TechnicianLocation(technician_id=technician_id)
            self.database.add(location)
        location.latitude = latitude
        location.longitude = longitude
        location.accuracy = accuracy
        location.heading = heading
        location.speed = speed
        location.altitude = altitude
        location.device_timestamp = device_timestamp
        # Written explicitly: a stationary technician sends the same coordinates,
        # and freshness depends on this moving anyway.
        location.last_location_at = now
        self.database.flush()
        return location

    def is_fresh(self, location: TechnicianLocation | None, now: datetime, stale_threshold_seconds: int) -> bool:
        return location is not None and location.last_location_at >= now - timedelta(seconds=stale_threshold_seconds)

    def forget(self, technician_id: uuid.UUID) -> None:
        """Drop the stored position: the technician signed out or went offline, and
        Partner keeps no note of where somebody who is not working is."""
        self.database.execute(delete(TechnicianLocation).where(TechnicianLocation.technician_id == technician_id))
        self.database.flush()

    def purge_older_than(self, cutoff: datetime) -> int:
        """Positions nobody has refreshed since `cutoff` (the app was closed without
        signing out). One statement; returns how many went."""
        result = self.database.execute(delete(TechnicianLocation).where(TechnicianLocation.last_location_at < cutoff))
        return result.rowcount or 0


class EarningsRepository(BaseRepository[TechnicianEarning]):
    def __init__(self, database: Session):
        super().__init__(database, TechnicianEarning)

    def query_by_technician(self, technician_id) -> Query:
        """The technician's earnings as a query, for the caller to order and page."""
        return self.database.query(TechnicianEarning).filter(TechnicianEarning.technician_id == technician_id)

    def get_summary_totals(self, net_since, starts: dict, technician_id):
        """One row: net since each of starts' today/week/month, then total net, gross,
        commission and count. `net_since(start)` builds the per-period sum."""
        return (
            self.database.query(
                net_since(starts["today"]),
                net_since(starts["week"]),
                net_since(starts["month"]),
                func.coalesce(func.sum(TechnicianEarning.net_amount), 0),
                func.coalesce(func.sum(TechnicianEarning.gross_amount), 0),
                func.coalesce(func.sum(TechnicianEarning.commission_amount), 0),
                func.count(TechnicianEarning.id),
            )
            .filter(TechnicianEarning.technician_id == technician_id)
            .one()
        )


class BankAccountRepository(BaseRepository[TechnicianBankAccount]):
    def __init__(self, database: Session):
        super().__init__(database, TechnicianBankAccount)

    def find_by_technician(self, technician_id, *, lock: bool = False) -> TechnicianBankAccount | None:
        query = self.database.query(TechnicianBankAccount).filter(TechnicianBankAccount.technician_id == technician_id)
        return (query.with_for_update() if lock else query).one_or_none()
