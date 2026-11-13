import uuid

from sqlalchemy.orm import Session

from app.database.base_repository import BaseRepository
from app.modules.catalog.models import Service


class ServiceRepository(BaseRepository[Service]):
    """Reads of the service catalog.

    Every method here returns only live rows. A retired service
    (`is_active = False`) stays in the table because bookings point at it, but
    it is not something a requester can find or book, so the filter belongs
    here rather than in each caller.
    """

    def __init__(self, database: Session):
        super().__init__(database, Service)

    def active_for_trade(self, trade: str) -> list[Service]:
        """A trade's live services, in the order they are published in."""
        return (
            self.database.query(Service)
            .filter(Service.trade == trade, Service.is_active.is_(True))
            .order_by(Service.sort_order, Service.service_name)
            .all()
        )

    def active_by_slug(self, trade: str, slug: str) -> Service | None:
        return (
            self.database.query(Service)
            .filter(Service.trade == trade, Service.slug == slug, Service.is_active.is_(True))
            .one_or_none()
        )

    def active_by_id(self, service_id: uuid.UUID) -> Service | None:
        """Used when a booking names a service, so a retired one cannot be booked."""
        return self.database.query(Service).filter(Service.id == service_id, Service.is_active.is_(True)).one_or_none()
