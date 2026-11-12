"""Marketplace endpoints under /api/v1 (ported from the old marketplace_routes.py,
supplier_product_routes.py, material_request_routes.py and shop_routes.py, in that
order; paths and answers unchanged, ids are UUIDs).

    /contractors/nearby, /suppliers/nearby, /engineers/find      discovery
    /contractors/find-clients, /suppliers/find-clients           find clients
    /contractors|suppliers|engineers/{id}/profile                public profiles
    /supplier-products/...                                       a supplier's own listings
    /supplier/material-requests, /supplier/purchase-requests     the supplier's orders
    /material-requests, /material-requests/mine                  the buyer's orders
    /cart..., /shop/products                                     the buyer's cart and shop
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.identity.models import User
from app.modules.marketplace.discovery_service import MarketplaceService
from app.modules.marketplace.listing_service import SupplierProductService
from app.modules.marketplace.order_service import MaterialRequestService
from app.modules.marketplace.schemas import (
    CartCheckout,
    CartItemCreate,
    CartItemUpdate,
    MaterialRequestCreate,
    MaterialRequestDecision,
    SupplierBulkPricingUpdate,
    SupplierCatalogListingCreate,
    SupplierProductCreate,
    SupplierProductPriceUpdate,
    SupplierProductUpdate,
)
from app.modules.marketplace.shop_service import ShopService

router = APIRouter()


def get_marketplace_service(database: Session = Depends(get_db)) -> MarketplaceService:
    return MarketplaceService(database)


def get_supplier_product_service(database: Session = Depends(get_db)) -> SupplierProductService:
    return SupplierProductService(database)


def get_material_request_service(database: Session = Depends(get_db)) -> MaterialRequestService:
    return MaterialRequestService(database)


def get_shop_service(database: Session = Depends(get_db)) -> ShopService:
    return ShopService(database)


# ---- discovery (old marketplace_routes.py) ----


@router.get("/contractors/nearby", tags=["Contractors"])
def fetch_nearby_contractors(
    pincode: str | None = Query(default=None),
    country: str | None = Query(default=None),
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_nearby_contractors(pincode=pincode, country=country, project_id=project_id, user=user)


@router.get("/contractors/{contractor_id}/profile", tags=["Contractors"])
def fetch_contractor_profile(
    contractor_id: uuid.UUID,
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_contractor_profile(contractor_id=contractor_id, user=user, project_id=project_id)


@router.get("/contractors/find-clients", tags=["Contractors"])
def fetch_nearby_projects(
    country: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_nearby_projects(country=country, user=user)


@router.get("/suppliers/nearby", tags=["Suppliers"])
def fetch_nearby_suppliers(
    pincode: str | None = Query(default=None),
    country: str | None = Query(default=None),
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_nearby_suppliers(pincode=pincode, country=country, project_id=project_id, user=user)


@router.get("/suppliers/{supplier_id}/profile", tags=["Suppliers"])
def fetch_supplier_profile(
    supplier_id: uuid.UUID,
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_supplier_profile(supplier_id=supplier_id, user=user)


@router.get("/suppliers/find-clients", tags=["Suppliers"])
def fetch_supplier_clients(
    country: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_supplier_clients(country=country, user=user)


@router.get("/engineers/find", tags=["Site Engineers"])
def fetch_nearby_engineers(
    pincode: str | None = Query(default=None),
    country: str | None = Query(default=None),
    project_id: uuid.UUID | None = Query(default=None),
    category: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_nearby_engineers(
        pincode=pincode, country=country, project_id=project_id, category=category, user=user
    )


@router.get("/engineers/{engineer_id}/profile", tags=["Site Engineers"])
def fetch_engineer_profile(
    engineer_id: uuid.UUID,
    user: User = Depends(current_user),
    service: MarketplaceService = Depends(get_marketplace_service),
):
    return service.fetch_engineer_profile(engineer_id=engineer_id, user=user)


# ---- a supplier's own listings (old supplier_product_routes.py) ----


@router.get("/supplier-products", tags=["Products"])
def fetch_supplier_products(
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.fetch_supplier_products(user=user)


@router.post("/supplier-products", tags=["Products"])
def save_supplier_product(
    payload: SupplierProductCreate,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.save_supplier_product(payload=payload, user=user)


@router.post("/supplier-products/from-catalog", tags=["Products"])
def add_supplier_product_from_catalog(
    payload: SupplierCatalogListingCreate,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    """Add a Master Catalog product to this supplier's catalog at their price; what the
    product IS is copied from the catalog on the server, never taken from the request."""
    return service.add_supplier_product_from_catalog(payload=payload, user=user)


@router.patch("/supplier-products/{product_id}/price", tags=["Products"])
def update_supplier_product_price(
    product_id: uuid.UUID,
    payload: SupplierProductPriceUpdate,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.update_supplier_product_price(product_id=product_id, payload=payload, user=user)


@router.patch("/supplier-products/{product_id}", tags=["Products"])
def update_supplier_product(
    product_id: uuid.UUID,
    payload: SupplierProductUpdate,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.update_supplier_product(product_id=product_id, payload=payload, user=user)


@router.get("/supplier-products/{product_id}/bulk-pricing", tags=["Products"])
def fetch_supplier_bulk_pricing(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.fetch_supplier_bulk_pricing(product_id=product_id, user=user)


@router.put("/supplier-products/{product_id}/bulk-pricing", tags=["Products"])
def save_supplier_bulk_pricing(
    product_id: uuid.UUID,
    payload: SupplierBulkPricingUpdate,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    """Replace the tiers of the signed-in supplier's own listing (validated first)."""
    return service.save_supplier_bulk_pricing(product_id=product_id, payload=payload, user=user)


@router.delete("/supplier-products/{product_id}", tags=["Products"])
def delete_supplier_product(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    service: SupplierProductService = Depends(get_supplier_product_service),
):
    return service.delete_supplier_product(product_id=product_id, user=user)


# ---- purchase orders (old material_request_routes.py) ----


@router.get("/supplier/material-requests", tags=["Suppliers"])
def fetch_supplier_material_requests(
    user: User = Depends(current_user),
    service: MaterialRequestService = Depends(get_material_request_service),
):
    return service.fetch_supplier_material_requests(user=user)


@router.post("/supplier/material-requests/{request_id}/respond", tags=["Suppliers"])
def respond_supplier_material_request(
    request_id: uuid.UUID,
    payload: MaterialRequestDecision,
    user: User = Depends(current_user),
    service: MaterialRequestService = Depends(get_material_request_service),
):
    return service.respond_supplier_material_request(request_id=request_id, payload=payload, user=user)


@router.post("/supplier/purchase-requests/{request_code}/respond", tags=["Suppliers"])
def respond_supplier_purchase_request(
    request_code: str,
    payload: MaterialRequestDecision,
    user: User = Depends(current_user),
    service: MaterialRequestService = Depends(get_material_request_service),
):
    """Accept or reject every line of one order sent to this supplier at once; only a
    wholly PENDING order can be decided (409 otherwise)."""
    return service.respond_supplier_purchase_request(request_code=request_code, payload=payload, user=user)


@router.post("/material-requests", tags=["Site Engineers"])
def create_material_request(
    payload: MaterialRequestCreate,
    user: User = Depends(current_user),
    service: MaterialRequestService = Depends(get_material_request_service),
):
    return service.create_material_request(payload=payload, user=user)


@router.get("/material-requests/mine", tags=["Site Engineers"])
def fetch_my_material_requests(
    user: User = Depends(current_user),
    service: MaterialRequestService = Depends(get_material_request_service),
    project_id: uuid.UUID | None = Query(None),
):
    return service.fetch_my_material_requests(user=user, project_id=project_id)


# ---- cart and shop (old shop_routes.py) ----


@router.get("/cart", tags=["Suppliers"])
def fetch_cart(
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    """One project's basket; a cart is never shared between a buyer's projects."""
    return service.fetch_cart(project_id=project_id, user=user)


@router.delete("/cart", tags=["Suppliers"])
def clear_cart(
    project_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    return service.clear_cart(project_id=project_id, user=user)


@router.post("/cart/items", tags=["Suppliers"])
def add_cart_item(
    payload: CartItemCreate,
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    return service.add_cart_item(payload=payload, user=user)


@router.patch("/cart/items/{item_id}", tags=["Suppliers"])
def update_cart_item(
    item_id: uuid.UUID,
    payload: CartItemUpdate,
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    return service.update_cart_item(item_id=item_id, payload=payload, user=user)


@router.delete("/cart/items/{item_id}", tags=["Suppliers"])
def delete_cart_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    return service.delete_cart_item(item_id=item_id, user=user)


@router.post("/cart/checkout", tags=["Suppliers"])
def checkout_cart(
    payload: CartCheckout,
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    """Turn one supplier's cart lines into a buy request for a chosen project."""
    return service.checkout_cart(payload=payload, user=user)


@router.get("/shop/products", tags=["Suppliers"])
def fetch_shop_products(
    category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user: User = Depends(current_user),
    service: ShopService = Depends(get_shop_service),
):
    """Published listings this buyer may order, with the seller attached."""
    return service.fetch_shop_products(category=category, search=search, user=user)
