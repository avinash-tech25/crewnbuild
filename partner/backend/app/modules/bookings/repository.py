"""Database access of bookings: the booking itself, job execution, ratings, start codes and work bills (the old app/shared/bookings/repositories)."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database.base_repository import BaseRepository
from app.modules.bookings.models import (
    BILL_MEDIA_KINDS,
    DISPATCHING_STATUSES,
    JOB_MEDIA_KINDS,
    OFFER_OFFERED,
    OPEN_STATUSES,
    OTP_ACTIVE,
    STATUS_CANCELLED,
    STATUS_SEARCHING,
    ServiceRequest,
    ServiceRequestAssignment,
    ServiceRequestBill,
    ServiceRequestBillItem,
    ServiceRequestMedia,
    ServiceRequestRating,
    ServiceRequestStartOtp,
    ServiceRequestStep,
)
from app.modules.catalog.models import ServiceStepTemplate
from app.modules.identity.models import Technician


class ServiceRequestRepository(BaseRepository[ServiceRequest]):
    def __init__(self, database: Session):
        super().__init__(database, ServiceRequest)

    def _with_parties(self):
        return self.database.query(ServiceRequest).options(
            joinedload(ServiceRequest.technician).joinedload(Technician.technician_profile),
            joinedload(ServiceRequest.service),
            selectinload(ServiceRequest.assignments),
        )

    def lock(self, request_id, *, skip_locked: bool = False) -> ServiceRequest | None:
        """The booking row, locked for the rest of the transaction.

        Every change to a booking's status or offers happens under this lock, so
        acceptances, cancellations, expiry and re-dispatch of one booking are
        strictly one after another. `skip_locked` is for the sweeper: a booking
        somebody is already working on is simply left for the next sweep.
        """
        return (
            self.database.query(ServiceRequest)
            .filter(ServiceRequest.id == request_id)
            .with_for_update(of=ServiceRequest, skip_locked=skip_locked)
            .populate_existing()
            .first()
        )

    def load(self, request_id) -> ServiceRequest | None:
        return self._with_parties().filter(ServiceRequest.id == request_id).first()

    # -------------------------------------------------------------- requester scope
    # Every requester read filters on requested_by_user_id in SQL, so nobody can
    # load another person's booking by guessing an id.

    def get_for_requester(self, request_id, requester_id) -> ServiceRequest | None:
        return (
            self._with_parties()
            .filter(ServiceRequest.id == request_id, ServiceRequest.requested_by_user_id == requester_id)
            .first()
        )

    def list_for_requester(self, requester_id) -> list[ServiceRequest]:
        return (
            self._with_parties()
            .filter(ServiceRequest.requested_by_user_id == requester_id)
            .order_by(ServiceRequest.created_at.desc())
            .limit(100)
            .all()
        )

    def open_booking_for(self, requester_id, technician_type: str) -> ServiceRequest | None:
        return (
            self.database.query(ServiceRequest)
            .filter(
                ServiceRequest.requested_by_user_id == requester_id,
                ServiceRequest.technician_type == technician_type,
                ServiceRequest.status.in_(OPEN_STATUSES),
            )
            .first()
        )

    # -------------------------------------------------------------- technician scope
    # Every technician read filters on the technician in SQL, the same way.

    def open_offers_for_technician(
        self, technician_id, now: datetime
    ) -> list[tuple[ServiceRequest, ServiceRequestAssignment]]:
        """Live job requests waiting for this technician's answer, nearest first.

        A nearby-dispatched booking is offered to several technicians at once and
        is still SEARCHING while they decide, so it is the offer -- not the
        booking -- that names who was asked. Filtering on the technician in SQL
        means another technician's requests can never be returned here.
        """
        return (
            self.database.query(ServiceRequest, ServiceRequestAssignment)
            .join(ServiceRequestAssignment, ServiceRequestAssignment.service_request_id == ServiceRequest.id)
            .filter(
                ServiceRequestAssignment.technician_id == technician_id,
                ServiceRequestAssignment.status == OFFER_OFFERED,
                ServiceRequestAssignment.expires_at > now,
                ServiceRequest.status.in_(DISPATCHING_STATUSES),
            )
            .order_by(ServiceRequestAssignment.distance_meters.nulls_last(), ServiceRequestAssignment.offered_at)
            .limit(20)
            .all()
        )

    def outstanding_offer_request_ids(self, technician_id) -> list:
        """Bookings this technician still has an unanswered offer for (expired or not)."""
        return [
            row[0]
            for row in (
                self.database.query(ServiceRequestAssignment.service_request_id)
                .filter(
                    ServiceRequestAssignment.technician_id == technician_id,
                    ServiceRequestAssignment.status == OFFER_OFFERED,
                )
                .order_by(ServiceRequestAssignment.service_request_id)
                .all()
            )
        ]

    # ---------------------------------------------------------------- the sweeper

    def with_lapsed_offers(self, now: datetime, limit: int) -> list:
        """Bookings with at least one unanswered offer past its deadline (partial index)."""
        return [
            row[0]
            for row in (
                self.database.query(ServiceRequestAssignment.service_request_id)
                .filter(ServiceRequestAssignment.status == OFFER_OFFERED, ServiceRequestAssignment.expires_at <= now)
                .distinct()
                .limit(limit)
                .all()
            )
        ]

    def stuck_searching(self, cutoff: datetime, limit: int) -> list:
        """SEARCHING bookings nobody has dispatched since `cutoff`: no batch went out,
        or the process died between saving the booking and sending one."""
        return [
            row[0]
            for row in (
                self.database.query(ServiceRequest.id)
                .filter(
                    ServiceRequest.status == STATUS_SEARCHING,
                    or_(ServiceRequest.last_dispatched_at.is_(None), ServiceRequest.last_dispatched_at <= cutoff),
                    ServiceRequest.updated_at <= cutoff,
                )
                .limit(limit)
                .all()
            )
        ]

    def get_held_by_technician(self, request_id, technician_id) -> ServiceRequest | None:
        return (
            self._with_parties()
            .filter(ServiceRequest.id == request_id, ServiceRequest.technician_id == technician_id)
            .first()
        )

    @staticmethod
    def _really_held():
        # A cancelled booking belongs to a technician's history only if they had
        # accepted it; every other status is theirs by `technician_id` alone, as before.
        return or_(ServiceRequest.status != STATUS_CANCELLED, ServiceRequest.accepted_at.isnot(None))

    def list_held_by_technician(self, technician_id, statuses: Iterable[str]) -> list[ServiceRequest]:
        return (
            self._with_parties()
            .filter(
                ServiceRequest.technician_id == technician_id,
                ServiceRequest.status.in_(tuple(statuses)),
                self._really_held(),
            )
            .order_by(ServiceRequest.updated_at.desc())
            .limit(100)
            .all()
        )

    def count_held_by_technician(self, technician_id) -> dict[str, int]:
        rows = (
            self.database.query(ServiceRequest.status, func.count(ServiceRequest.id))
            .filter(ServiceRequest.technician_id == technician_id, self._really_held())
            .group_by(ServiceRequest.status)
            .all()
        )
        return {status: count for status, count in rows}


class JobExecutionRepository(BaseRepository[ServiceRequestStep]):
    """A booking's checklist steps and its job photos (CUSTOMER / BEFORE / AFTER)."""

    def __init__(self, database: Session):
        super().__init__(database, ServiceRequestStep)

    def list_active_step_templates(self, service_id) -> list[ServiceStepTemplate]:
        return (
            self.database.query(ServiceStepTemplate)
            .filter(ServiceStepTemplate.service_id == service_id, ServiceStepTemplate.is_active.is_(True))
            .order_by(ServiceStepTemplate.position)
            .all()
        )

    def list_steps(self, booking_id) -> list[ServiceRequestStep]:
        return (
            self.database.query(ServiceRequestStep)
            .filter(ServiceRequestStep.service_request_id == booking_id)
            .order_by(ServiceRequestStep.position)
            .all()
        )

    def find_step(self, booking_id, step_id) -> ServiceRequestStep | None:
        return (
            self.database.query(ServiceRequestStep)
            .filter(ServiceRequestStep.id == step_id, ServiceRequestStep.service_request_id == booking_id)
            .first()
        )

    def find_job_media(self, booking_id, media_id) -> ServiceRequestMedia | None:
        return (
            self.database.query(ServiceRequestMedia)
            .filter(
                ServiceRequestMedia.id == media_id,
                ServiceRequestMedia.service_request_id == booking_id,
                # Work-bill photos are the work bill's (WorkBillService): these
                # endpoints neither show, serve nor remove them.
                ServiceRequestMedia.kind.in_(JOB_MEDIA_KINDS),
            )
            .first()
        )

    def list_job_media(self, booking_id) -> list[ServiceRequestMedia]:
        return (
            self.database.query(ServiceRequestMedia)
            .filter(ServiceRequestMedia.service_request_id == booking_id, ServiceRequestMedia.kind.in_(JOB_MEDIA_KINDS))
            .order_by(ServiceRequestMedia.created_at, ServiceRequestMedia.id)
            .all()
        )

    def count_media_of_kind(self, booking_id, kind: str) -> int:
        return (
            self.database.query(func.count(ServiceRequestMedia.id))
            .filter(ServiceRequestMedia.service_request_id == booking_id, ServiceRequestMedia.kind == kind)
            .scalar()
        )


class RatingRepository(BaseRepository[ServiceRequestRating]):
    def __init__(self, database: Session):
        super().__init__(database, ServiceRequestRating)

    def list_summary_rows(self, wanted):
        return (
            self.database.query(
                ServiceRequestRating.technician_id,
                func.avg(ServiceRequestRating.stars),
                func.count(ServiceRequestRating.id),
            )
            .filter(ServiceRequestRating.technician_id.in_(wanted))
            .group_by(ServiceRequestRating.technician_id)
            .all()
        )

    def list_rated_booking_ids(self, wanted):
        return {
            row[0]
            for row in self.database.query(ServiceRequestRating.service_request_id)
            .filter(ServiceRequestRating.service_request_id.in_(wanted))
            .all()
        }

    def find_for_booking(self, booking_id) -> ServiceRequestRating | None:
        return (
            self.database.query(ServiceRequestRating)
            .filter(ServiceRequestRating.service_request_id == booking_id)
            .one_or_none()
        )


class StartOtpRepository(BaseRepository[ServiceRequestStartOtp]):
    def __init__(self, database: Session):
        super().__init__(database, ServiceRequestStartOtp)

    def lock_active(self, booking_id) -> ServiceRequestStartOtp | None:
        return (
            self.database.query(ServiceRequestStartOtp)
            .filter(
                ServiceRequestStartOtp.service_request_id == booking_id, ServiceRequestStartOtp.status == OTP_ACTIVE
            )
            .with_for_update()
            .one_or_none()
        )

    def find_latest(self, booking_id) -> ServiceRequestStartOtp | None:
        return (
            self.database.query(ServiceRequestStartOtp)
            .filter(ServiceRequestStartOtp.service_request_id == booking_id)
            .order_by(ServiceRequestStartOtp.created_at.desc())
            .first()
        )

    def count_issued_since(self, booking_id, since: datetime):
        return (
            self.database.query(func.count(ServiceRequestStartOtp.id), func.min(ServiceRequestStartOtp.created_at))
            .filter(ServiceRequestStartOtp.service_request_id == booking_id, ServiceRequestStartOtp.created_at > since)
            .one()
        )


class WorkBillRepository(BaseRepository[ServiceRequestBill]):
    """A booking's work bill, its lines and the bill's photos (MATERIAL / BILL)."""

    def __init__(self, database: Session):
        super().__init__(database, ServiceRequestBill)

    def query_media_count(self, booking_id):
        """A count of the booking's photos; the caller narrows it to one item or the attachments."""
        return self.database.query(func.count(ServiceRequestMedia.id)).filter(
            ServiceRequestMedia.service_request_id == booking_id
        )

    def find_bill(self, booking_id) -> ServiceRequestBill | None:
        return (
            self.database.query(ServiceRequestBill).filter(ServiceRequestBill.service_request_id == booking_id).first()
        )

    def list_items(self, bill_id) -> list[ServiceRequestBillItem]:
        return (
            self.database.query(ServiceRequestBillItem)
            .filter(ServiceRequestBillItem.bill_id == bill_id)
            .order_by(ServiceRequestBillItem.created_at, ServiceRequestBillItem.id)
            .all()
        )

    def find_item(self, bill_id, item_id) -> ServiceRequestBillItem | None:
        return (
            self.database.query(ServiceRequestBillItem)
            .filter(ServiceRequestBillItem.id == item_id, ServiceRequestBillItem.bill_id == bill_id)
            .first()
        )

    def count_items(self, bill_id) -> int:
        return (
            self.database.query(func.count(ServiceRequestBillItem.id))
            .filter(ServiceRequestBillItem.bill_id == bill_id)
            .scalar()
        )

    def find_bill_media(self, booking_id, media_id) -> ServiceRequestMedia | None:
        return (
            self.database.query(ServiceRequestMedia)
            .filter(
                ServiceRequestMedia.id == media_id,
                ServiceRequestMedia.service_request_id == booking_id,
                ServiceRequestMedia.kind.in_(BILL_MEDIA_KINDS),
            )
            .first()
        )

    def list_bill_media(self, booking_id) -> list[ServiceRequestMedia]:
        return (
            self.database.query(ServiceRequestMedia)
            .filter(
                ServiceRequestMedia.service_request_id == booking_id, ServiceRequestMedia.kind.in_(BILL_MEDIA_KINDS)
            )
            .order_by(ServiceRequestMedia.created_at, ServiceRequestMedia.id)
            .all()
        )

    def list_item_photos(self, item_id) -> list[ServiceRequestMedia]:
        return self.database.query(ServiceRequestMedia).filter(ServiceRequestMedia.bill_item_id == item_id).all()
