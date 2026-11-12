"""Catalog endpoints under /api/v1 (ported from the old catalog_routes.py and
admin_catalog_routes.py; paths and answers unchanged, ids are UUIDs).

    /catalog/...         read only, any signed-in account, the caller's own country
    /admin/catalog/...   Admin > Master Catalog: an administrator role AND catalog.view
                         (reading) or catalog.manage (writing)

Both answer 503 while the catalog tables are missing from the database.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.database.session import get_db
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.dependencies import require_admin
from app.modules.catalog import catalog_service
from app.modules.catalog.admin_service import AdminCatalogService
from app.modules.catalog.catalog_service import CatalogService
from app.modules.catalog.schemas import (
    BrandUpdate,
    BrandWrite,
    CategoryUpdate,
    CategoryWrite,
    ImageOrder,
    ImageWrite,
    ProductUpdate,
    ProductWrite,
    SubcategoryUpdate,
    SubcategoryWrite,
    VariantUpdate,
    VariantWrite,
)
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import User


def require_catalog_tables(database: Session = Depends(get_db)) -> None:
    catalog_service.require_catalog_tables(database)


router = APIRouter(prefix="/catalog", tags=["catalog"], dependencies=[Depends(require_catalog_tables)])
admin_router = APIRouter(
    prefix="/admin/catalog", tags=["admin-catalog"], dependencies=[Depends(require_catalog_tables)]
)


def get_catalog_service(database: Session = Depends(get_db)) -> CatalogService:
    return CatalogService(database)


def get_admin_catalog_service(database: Session = Depends(get_db)) -> AdminCatalogService:
    return AdminCatalogService(database)


# ---- the signed-in reader ----


@router.get("/categories")
def list_categories(
    user: User = Depends(current_user), service: CatalogService = Depends(get_catalog_service)
) -> list[dict[str, Any]]:
    """Step 1 of the cascade."""
    return service.list_categories(user)


@router.get("/subcategories")
def list_subcategories(
    category_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[dict[str, Any]]:
    """Step 2; without a category, all of them."""
    return service.list_subcategories(category_id, user)


@router.get("/brands")
def list_brands(
    subcategory_id: uuid.UUID | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[dict[str, Any]]:
    """Step 3: only brands an active product of the caller's country uses."""
    return service.list_brands(subcategory_id, category_id, user)


@router.get("/units")
def list_units(
    user: User = Depends(current_user), service: CatalogService = Depends(get_catalog_service)
) -> list[dict[str, Any]]:
    return service.list_units(user)


@router.get("/products")
def list_products(
    category_id: uuid.UUID | None = Query(default=None),
    subcategory_id: uuid.UUID | None = Query(default=None),
    brand_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None),
    # Crash fixed: the old route had no lower bound; a negative limit failed in
    # PostgreSQL (500). 0 still answers an empty list.
    limit: int = Query(default=100, ge=0, le=500),
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[dict[str, Any]]:
    """Step 4; brand_id is optional so a generic product (no brand) is reachable."""
    return service.list_products(category_id, subcategory_id, brand_id, search, limit, user)


@router.get("/search")
def search_products(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[dict[str, Any]]:
    """Plain-words search over the caller's own country's catalog."""
    return service.search_products(q, limit, user)


@router.get("/products/{product_id}")
def fetch_product(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> dict[str, Any]:
    return service.fetch_product(product_id, user)


@router.get("/products/{product_id}/variants")
def list_variants(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[dict[str, Any]]:
    """Step 5; empty for a product sold in one form."""
    return service.list_variants(product_id, user)


@router.get("/products/{product_id}/offers")
def list_offers(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> dict[str, Any]:
    """One canonical product, and every supplier selling it."""
    return service.list_offers(product_id, user)


# ---- Admin > Master Catalog ----


@admin_router.get("/categories")
def admin_list_categories(
    country: str | None = Query(default=None),
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    return service.list_categories(country, admin)


@admin_router.post("/categories", status_code=201)
def admin_create_category(
    payload: CategoryWrite,
    country: str | None = Query(default=None),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.create_category(payload, country, admin)


@admin_router.patch("/categories/{category_id}")
def admin_update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.update_category(category_id, payload, admin)


@admin_router.get("/subcategories")
def admin_list_subcategories(
    category_id: uuid.UUID | None = Query(default=None),
    country: str | None = Query(default=None),
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    return service.list_subcategories(category_id, country, admin)


@admin_router.post("/subcategories", status_code=201)
def admin_create_subcategory(
    payload: SubcategoryWrite,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.create_subcategory(payload, admin)


@admin_router.patch("/subcategories/{subcategory_id}")
def admin_update_subcategory(
    subcategory_id: uuid.UUID,
    payload: SubcategoryUpdate,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.update_subcategory(subcategory_id, payload, admin)


@admin_router.get("/brands")
def admin_list_brands(
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    """Every brand, shared by both countries: the list a new product's brand is picked from."""
    return service.list_brands()


@admin_router.post("/brands", status_code=201)
def admin_create_brand(
    payload: BrandWrite,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.create_brand(payload)


@admin_router.patch("/brands/{brand_id}")
def admin_update_brand(
    brand_id: uuid.UUID,
    payload: BrandUpdate,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.update_brand(brand_id, payload, admin)


@admin_router.get("/units")
def admin_list_units(
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    return service.list_units()


@admin_router.get("/products")
def admin_list_products(
    category_id: uuid.UUID | None = Query(default=None),
    subcategory_id: uuid.UUID | None = Query(default=None),
    brand_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None),
    # Crash fixed: no lower bound before; a negative limit failed in PostgreSQL (500).
    limit: int = Query(default=200, ge=0, le=500),
    country: str | None = Query(default=None),
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    return service.list_products(
        category_id=category_id,
        subcategory_id=subcategory_id,
        brand_id=brand_id,
        search=search,
        limit=limit,
        country=country,
        admin=admin,
    )


@admin_router.get("/products/{product_id}")
def admin_fetch_product(
    product_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("catalog.view")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.fetch_product(product_id, admin)


@admin_router.post("/products", status_code=201)
def admin_create_product(
    payload: ProductWrite,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.create_product(payload, admin)


@admin_router.patch("/products/{product_id}")
def admin_update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    """Edit canonical data, or activate and deactivate. The slug is not editable."""
    return service.update_product(product_id, payload, admin)


@admin_router.post("/products/{product_id}/variants", status_code=201)
def admin_create_variant(
    product_id: uuid.UUID,
    payload: VariantWrite,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.create_variant(product_id, payload, admin)


@admin_router.patch("/variants/{variant_id}")
def admin_update_variant(
    variant_id: uuid.UUID,
    payload: VariantUpdate,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.update_variant(variant_id, payload, admin)


@admin_router.post("/products/{product_id}/image", status_code=201)
def admin_upload_product_image(
    product_id: uuid.UUID,
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    uploads: UploadService = Depends(get_upload_service),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.upload_product_image(product_id, file, admin, uploads)


@admin_router.post("/categories/{category_id}/image", status_code=201)
def admin_upload_category_image(
    category_id: uuid.UUID,
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    uploads: UploadService = Depends(get_upload_service),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.upload_category_image(category_id, file, admin, uploads)


@admin_router.post("/subcategories/{subcategory_id}/image", status_code=201)
def admin_upload_subcategory_image(
    subcategory_id: uuid.UUID,
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    uploads: UploadService = Depends(get_upload_service),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.upload_subcategory_image(subcategory_id, file, admin, uploads)


@admin_router.post("/brands/{brand_id}/logo", status_code=201)
def admin_upload_brand_logo(
    brand_id: uuid.UUID,
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    uploads: UploadService = Depends(get_upload_service),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.upload_brand_logo(brand_id, file, admin, uploads)


@admin_router.post("/products/{product_id}/video", status_code=201)
def admin_upload_product_video(
    product_id: uuid.UUID,
    file: UploadFile = File(...),
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    uploads: UploadService = Depends(get_upload_service),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.upload_product_video(product_id, file, admin, uploads)


@admin_router.delete("/products/{product_id}/video", status_code=204)
def admin_delete_product_video(
    product_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> Response:
    service.delete_product_video(product_id, admin)
    return Response(status_code=204)


@admin_router.post("/products/{product_id}/images", status_code=201)
def admin_attach_product_image(
    product_id: uuid.UUID,
    payload: ImageWrite,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    """Attach a picture that was uploaded already, by its address."""
    return service.attach_product_image(product_id, payload, admin)


@admin_router.patch("/products/{product_id}/images/order")
def admin_reorder_product_images(
    product_id: uuid.UUID,
    payload: ImageOrder,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> list[dict[str, Any]]:
    return service.reorder_product_images(product_id, payload, admin)


@admin_router.patch("/images/{image_id}/primary")
def admin_set_primary_image(
    image_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> dict[str, Any]:
    return service.set_primary_image(image_id, admin)


@admin_router.delete("/images/{image_id}", status_code=204)
def admin_delete_product_image(
    image_id: uuid.UUID,
    admin: AdminIdentity = Depends(require_admin("catalog.manage")),
    service: AdminCatalogService = Depends(get_admin_catalog_service),
) -> Response:
    service.delete_product_image(image_id, admin)
    return Response(status_code=204)
