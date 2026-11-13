"""The service catalog: what can be booked, and what it costs.

The price a booking is made at comes from here and nowhere else. A requester
chooses a service and sends its id; the amount is read back out of the database
at booking time. Nothing accepts an amount from a client, and nothing computes
one, so a tampered request cannot change what a job costs.

Read-only. Catalog rows are written by `app.scripts.seed_service_catalog`, not
by any request.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import Service
from app.modules.catalog.repository import ServiceRepository
from app.modules.catalog.schemas import ServiceOut
from app.modules.identity.auth_service import clean_technician_type


def service_out(service: Service) -> ServiceOut:
    return ServiceOut(
        id=service.id,
        trade=service.trade,
        slug=service.slug,
        service_name=service.service_name,
        service_kind=service.service_kind,
        image_url=service.image_url,
        description=service.description,
        includes=service.includes,
        price=service.price,
        currency=service.currency,
        sort_order=service.sort_order,
    )


class CatalogService:
    def __init__(self, database: Session):
        self.services = ServiceRepository(database)

    def list_for_trade(self, trade: str | None) -> list[ServiceOut]:
        """A trade's live services. An unknown trade is a 422, not an empty list:
        a typo should say so rather than look like a trade with nothing in it."""
        return [service_out(service) for service in self.services.active_for_trade(clean_technician_type(trade))]

    def read(self, trade: str, slug: str) -> ServiceOut:
        service = self.services.active_by_slug(clean_technician_type(trade), (slug or "").strip().lower())
        if not service:
            raise HTTPException(status_code=404, detail="That service is not available.")
        return service_out(service)

    def for_booking(self, service_id: uuid.UUID, technician_type: str) -> Service:
        """The catalog row a booking is being made against.

        Checked here rather than at the edge because this is what decides the
        price: the service has to still be live, and it has to belong to the
        trade the booking is for -- otherwise a Plumber booking could be made at
        an Electrician's price by sending someone else's service id.
        """
        service = self.services.active_by_id(service_id)
        if not service:
            raise HTTPException(status_code=404, detail="That service is not available.")
        if service.trade != technician_type:
            raise HTTPException(status_code=422, detail="That service does not belong to the selected trade.")
        return service
