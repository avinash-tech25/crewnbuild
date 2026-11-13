from app.modules.bookings.models import (
    OFFER_OFFERED,
    REQUESTER_CANCELLABLE,
    RETRYABLE_STATUSES,
    STATUS_ACCEPTED,
    STATUS_ARRIVED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_EN_ROUTE,
    STATUS_EXPIRED,
    STATUS_IN_PROGRESS,
    STATUS_NO_TECHNICIAN_FOUND,
    STATUS_OFFERED,
    STATUS_SEARCHING,
    TECHNICIAN_CANCELLABLE,
    TECHNICIAN_PROGRESS,
    ServiceRequest,
    ServiceRequestAssignment,
)
from app.modules.bookings.schemas import AssignedTechnician, BookingResponse, JobOffer, TechnicianJobResponse
from app.modules.requesters.repository import REQUESTER_ROLE_LABELS
from app.modules.technicians.earnings_service import (
    CommissionConfigurationError,
    configured_commission_rate,
    split_amount,
)

REQUESTER_STATUS_LABELS = {
    STATUS_SEARCHING: "Searching for technician",
    STATUS_OFFERED: "Waiting for a technician to accept",
    STATUS_ACCEPTED: "Technician assigned",
    STATUS_EN_ROUTE: "On the way",
    STATUS_ARRIVED: "Arrived",
    STATUS_IN_PROGRESS: "Work in progress",
    STATUS_COMPLETED: "Completed",
    STATUS_CANCELLED: "Cancelled",
    STATUS_NO_TECHNICIAN_FOUND: "No technician found",
    STATUS_EXPIRED: "No technician accepted",
}


CONTACT_VISIBLE_STATUSES = (STATUS_ACCEPTED, STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS, STATUS_COMPLETED)


# Statuses in which nobody holds the booking, so no technician is shown to the customer.
UNASSIGNED_STATUSES = (STATUS_SEARCHING, STATUS_OFFERED, STATUS_NO_TECHNICIAN_FOUND, STATUS_EXPIRED, STATUS_CANCELLED)


NEXT_TECHNICIAN_ACTIONS = {from_status: [action] for action, (from_status, _to, _column) in TECHNICIAN_PROGRESS.items()}
for _status in TECHNICIAN_CANCELLABLE:
    NEXT_TECHNICIAN_ACTIONS[_status] = [*NEXT_TECHNICIAN_ACTIONS.get(_status, []), "cancel"]


# Filled with the trade's plural ("painters"). The same words whatever the reason, so the
# requester never learns who is registered nearby or why they were not offered the job.
NO_TECHNICIANS_MESSAGE = "No available {plural} were found in your locality."


EXPIRED_MESSAGE = "No {plural} accepted your request in time. You can search again."


def first_name(value: str | None) -> str:
    return (value or "").strip().split(" ")[0] or "Technician"


def offer_of(booking: ServiceRequest, technician_id) -> ServiceRequestAssignment | None:
    """This technician's current offer for the booking: the outstanding one, else
    the one from the latest round they were asked in."""
    mine = [offer for offer in booking.assignments if offer.technician_id == technician_id]
    if not mine:
        return None
    outstanding = [offer for offer in mine if offer.status == OFFER_OFFERED]
    if outstanding:
        return outstanding[0]
    return max(mine, key=lambda offer: (offer.dispatch_round, offer.offered_at))


def format_distance(meters: float | None) -> str | None:
    if meters is None:
        return None
    if meters < 950:
        return f"{round(meters / 10) * 10} m away"
    return f"{meters / 1000:.1f} km away"


def match_label_of(offer: ServiceRequestAssignment | None) -> str | None:
    """How far away the technician was when the job was offered."""
    return format_distance(offer.distance_meters) if offer is not None else None


def trade_plural(booking: ServiceRequest) -> str:
    return f"{booking.technician_type.lower()}s"


def booking_response(booking: ServiceRequest, ratings: dict | None = None, rated: set | None = None) -> BookingResponse:
    """`ratings` ({technician_id: (average, count)}) and `rated` (booking ids with a
    rating) are worked out for a whole page at once by DispatchService._responses,
    so a list costs two grouped queries, not two per booking."""
    technician = None
    if booking.technician and booking.status not in UNASSIGNED_STATUSES:
        profile = booking.technician.technician_profile
        offer = offer_of(booking, booking.technician_id)
        average_rating, rating_count = (ratings or {}).get(booking.technician_id, (None, 0))
        technician = AssignedTechnician(
            average_rating=average_rating,
            rating_count=rating_count,
            name=first_name(booking.technician.name),
            technician_type=booking.technician_type,
            experience_years=profile.experience_years if profile else 0,
            area=booking.technician.area,
            match_label=match_label_of(offer),
            phone=booking.technician.phone if booking.status in CONTACT_VISIBLE_STATUSES else None,
        )
    message = None
    if booking.status == STATUS_NO_TECHNICIAN_FOUND:
        message = NO_TECHNICIANS_MESSAGE.format(plural=trade_plural(booking))
    elif booking.status == STATUS_EXPIRED:
        message = EXPIRED_MESSAGE.format(plural=trade_plural(booking))
    return BookingResponse(
        id=booking.id,
        reference=booking.reference,
        status=booking.status,
        status_label=REQUESTER_STATUS_LABELS.get(booking.status, booking.status),
        technician_type=booking.technician_type,
        service_address=booking.service_address,
        service_area=booking.service_area,
        pincode=booking.pincode,
        service_latitude=booking.service_latitude,
        service_longitude=booking.service_longitude,
        description=booking.description,
        service_id=booking.service_id,
        service_name=booking.service.service_name if booking.service else None,
        service_kind=booking.service_kind,
        quoted_amount=booking.quoted_amount,
        currency=booking.currency,
        message=message,
        technician=technician,
        can_cancel=booking.status in REQUESTER_CANCELLABLE,
        can_retry=booking.status in RETRYABLE_STATUSES,
        dispatch_attempts=booking.dispatch_attempts,
        can_rate=(
            booking.status == STATUS_COMPLETED
            and booking.technician_id is not None
            and rated is not None
            and booking.id not in rated
        ),
        created_at=booking.created_at,
        updated_at=booking.updated_at,
        assigned_at=booking.assigned_at,
        accepted_at=booking.accepted_at,
        en_route_at=booking.en_route_at,
        arrived_at=booking.arrived_at,
        started_at=booking.started_at,
        completed_at=booking.completed_at,
        cancelled_at=booking.cancelled_at,
    )


def job_response(booking: ServiceRequest) -> TechnicianJobResponse:
    """A job this technician holds. Only ever built for a booking they have
    accepted, so the address and the requester's details belong in it."""
    offer = offer_of(booking, booking.technician_id)
    contact_visible = booking.status in CONTACT_VISIBLE_STATUSES and booking.requester is not None
    return TechnicianJobResponse(
        id=booking.id,
        reference=booking.reference,
        status=booking.status,
        technician_type=booking.technician_type,
        requester_type=booking.requested_by_role,
        requester_type_label=REQUESTER_ROLE_LABELS.get(booking.requested_by_role, booking.requested_by_role),
        service_area=booking.service_area,
        pincode=booking.pincode,
        service_address=booking.service_address,
        service_latitude=booking.service_latitude,
        service_longitude=booking.service_longitude,
        description=booking.description,
        service_name=booking.service.service_name if booking.service else None,
        service_kind=booking.service_kind,
        quoted_amount=booking.quoted_amount,
        currency=booking.currency,
        requested_at=booking.created_at,
        offer_expires_at=offer.expires_at if offer and offer.status == OFFER_OFFERED else None,
        match_label=match_label_of(offer),
        requester_name=first_name(booking.requester.name) if contact_visible else None,
        requester_phone=(booking.requester.phone or None) if contact_visible else None,
        next_actions=NEXT_TECHNICIAN_ACTIONS.get(booking.status, []),
        accepted_at=booking.accepted_at,
        en_route_at=booking.en_route_at,
        arrived_at=booking.arrived_at,
        started_at=booking.started_at,
        completed_at=booking.completed_at,
        cancelled_at=booking.cancelled_at,
    )


def estimated_net_amount(quoted_amount):
    """What a job at this price would earn at the commission configured now.
    Display only, for the offer card; the earning itself is made at completion."""
    if quoted_amount is None:
        return None
    try:
        return split_amount(quoted_amount, configured_commission_rate())[1]
    except CommissionConfigurationError:
        return None


def job_offer(booking: ServiceRequest, offer: ServiceRequestAssignment) -> JobOffer:
    """A booking offered to a technician who has NOT accepted it.

    Built field by field from a model that has nowhere to put a name, a phone
    number, an address, a PIN code or a coordinate -- so none of those can leak
    into it by accident later.
    """
    return JobOffer(
        booking_id=booking.id,
        reference=booking.reference,
        technician_type=booking.technician_type,
        work_area=booking.description,
        distance_meters=round(offer.distance_meters) if offer.distance_meters is not None else None,
        service_name=booking.service.service_name if booking.service else None,
        service_kind=booking.service_kind,
        quoted_amount=booking.quoted_amount,
        currency=booking.currency,
        estimated_net_amount=estimated_net_amount(booking.quoted_amount),
        offered_at=offer.offered_at,
        expires_at=offer.expires_at,
    )
