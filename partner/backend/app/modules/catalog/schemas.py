"""Catalog answer shapes (the old app/schemas/service.py)."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class ServiceOut(BaseModel):
    """One catalog entry as the booking pages read it.

    `price` is a Decimal rather than a float so the amount that leaves the
    server is the amount that was stored. The requester never sends a price
    back: a booking carries `service_id`, and the server looks the amount up
    again.
    """

    id: UUID
    trade: str
    slug: str
    service_name: str
    service_kind: str
    image_url: str | None = None
    description: str | None = None
    includes: str | None = None
    price: Decimal
    currency: str
    sort_order: int
