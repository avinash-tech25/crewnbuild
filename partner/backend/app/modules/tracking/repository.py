"""A booking's destination for live tracking. One row per booking.

Only the destination lives here. The technician's position is read from
`technician_locations`, the one place it is kept.
"""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.database.base_repository import BaseRepository
from app.modules.bookings.models import ServiceRequestTracking


class TrackingRepository(BaseRepository[ServiceRequestTracking]):
    def __init__(self, database: Session):
        super().__init__(database, ServiceRequestTracking)

    def get(self, booking_id: uuid.UUID) -> ServiceRequestTracking | None:
        return self.database.get(ServiceRequestTracking, booking_id)

    def get_or_create(self, booking_id: uuid.UUID) -> ServiceRequestTracking:
        tracking = self.get(booking_id)
        if tracking is None:
            tracking = ServiceRequestTracking(service_request_id=booking_id)
            self.database.add(tracking)
            self.database.flush()
        return tracking

    def set_destination(
        self,
        booking_id: uuid.UUID,
        *,
        latitude: float,
        longitude: float,
        accuracy: float | None,
        now: datetime,
    ) -> ServiceRequestTracking:
        tracking = self.get_or_create(booking_id)
        tracking.destination_latitude = latitude
        tracking.destination_longitude = longitude
        tracking.destination_accuracy = accuracy
        tracking.destination_set_at = now
        self.database.flush()
        return tracking
