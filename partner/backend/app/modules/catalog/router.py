"""The service catalog the booking pages read (the old Partner shared/catalog/routes)."""

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_catalog_service, get_current_requester
from app.modules.catalog.schemas import ServiceOut
from app.modules.catalog.service import CatalogService

# The same /requester prefix and the same session the rest of the booking flow
# uses. The catalog is not secret, but it is only reached from inside booking,
# and giving it its own public surface would be a second way in to maintain.
router = APIRouter(prefix="/requester", tags=["Service catalog"])


@router.get("/services", response_model=list[ServiceOut])
def list_services(
    trade: str = Query(..., description="PAINTER, PLUMBER, ELECTRICIAN or CARPENTER"),
    _requester=Depends(get_current_requester),
    catalog: CatalogService = Depends(get_catalog_service),
) -> list[ServiceOut]:
    return catalog.list_for_trade(trade)


@router.get("/services/{trade}/{slug}", response_model=ServiceOut)
def read_service(
    trade: str,
    slug: str,
    _requester=Depends(get_current_requester),
    catalog: CatalogService = Depends(get_catalog_service),
) -> ServiceOut:
    """One service. Separate from the list so a link straight to a service
    survives a reload without the list having been fetched first."""
    return catalog.read(trade, slug)
