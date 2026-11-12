"""Admin > Master Catalog: writing the catalog (ported from the old
app/admin/services/catalog_service.py and admin_catalog_repository.py, same rules).

Scoped by country: India's administrators read and change India's catalog only,
decided from their own scope; a Global Super Admin reaches every country and may narrow
with ?country=. A row of another country answers 404, like a missing one. Brands are
shared, so a location administrator may change one only while no other country's
product uses it.

Images and videos go through the shared upload service; what is stored against the
product is the "/files/{id}" address, which every consumer renders.
"""

import uuid
from typing import Any

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import (
    ACTION_CATALOG_IMAGE_ADDED,
    ACTION_CATALOG_PRODUCT_CREATED,
    ACTION_CATALOG_PRODUCT_UPDATED,
    record,
)
from app.modules.admin.scope import refuse_kuwait, viewing
from app.modules.catalog import supplier_links
from app.modules.catalog.catalog_service import (
    CATALOG_COUNTRIES,
    NOT_IN_CATALOG,
    REQUIRED_PRODUCT_IMAGES,
    brand_payload,
    catalog_code,
    categories_in,
    category_payload,
    find_product,
    locality_of,
    product_images,
    product_payload,
    product_query,
    products,
    subcategories_in,
    subcategory_payload,
    unit_payload,
    variant_payload,
)
from app.modules.catalog.models import (
    MEDIA_IMAGE,
    MEDIA_VIDEO,
    CatalogBrand,
    CatalogCategory,
    CatalogProduct,
    CatalogProductMedia,
    CatalogProductVariant,
    CatalogSubcategory,
    CatalogUnit,
)
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
from app.modules.files.models import File
from app.modules.files.upload_service import PRODUCT_VIDEO, SUPPLIER_IMAGE, UploadService

ALLOWED_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
ALLOWED_VIDEO_TYPES = ("video/mp4", "video/quicktime", "video/webm")
UPLOAD_MODULE = "master-catalog"
# Fields an edit may leave out but never empty: the columns are NOT NULL.
NOT_NULL_FIELDS = {"name", "sort_order", "is_active", "subcategory_id", "specifications", "highlights", "faqs"}


def catalog_country(admin: Any) -> str | None:
    """The one country this administrator's lists show; None for every country."""
    return None if admin.is_global else catalog_code(admin.scope)


def owning_country(admin: AdminIdentity, country: str | None) -> str:
    """Where a new category goes: a location administrator's own country, always; a
    Global Super Admin has to name one."""
    refuse_kuwait(country)
    if not admin.is_global:
        return catalog_code(admin.scope) or ""
    wanted = catalog_code(country)
    if wanted not in CATALOG_COUNTRIES:
        raise HTTPException(status_code=400, detail="Choose India before adding to the catalog.")
    return wanted or ""


def ensure_reach(admin: AdminIdentity, country: str | None, detail: str) -> None:
    """404 (not 403) for a row of a country this administrator does not administer."""
    if not admin.may_reach(locality_of(country)):
        raise HTTPException(status_code=404, detail=detail)


def changes(payload: BaseModel) -> dict[str, Any]:
    """The fields an edit sends. Crash fixed: an explicit null for a required field used
    to fail in the database (500); it is now a 422."""
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if value is None and field in NOT_NULL_FIELDS:
            raise HTTPException(status_code=422, detail=f"{field} cannot be empty.")
    return updates


def save_upload(
    file: UploadFile, uploads: UploadService, admin: AdminIdentity, category: str, locality: str | None
) -> str | None:
    return uploads.save_and_address(
        file, owner_id=admin.user.id, module=UPLOAD_MODULE, category=category, locality=locality
    )


def file_id_of(url: str) -> uuid.UUID | None:
    """The files row behind a "/files/{id}" address."""
    try:
        return uuid.UUID(url.rsplit("/", 1)[1]) if url.startswith("/files/") else None
    except ValueError:
        return None


class AdminCatalogService:
    def __init__(self, database: Session) -> None:
        self.database = database

    # ---- loading what this administrator may change ----

    def load_category(self, admin: AdminIdentity, category_id: uuid.UUID, detail: str) -> CatalogCategory:
        row = self.database.get(CatalogCategory, category_id)
        if not row:
            raise HTTPException(status_code=404, detail=detail)
        ensure_reach(admin, row.country_code, detail)
        return row

    def load_subcategory(self, admin: AdminIdentity, subcategory_id: uuid.UUID, detail: str) -> CatalogSubcategory:
        row = self.database.get(CatalogSubcategory, subcategory_id)
        if not row:
            raise HTTPException(status_code=404, detail=detail)
        ensure_reach(admin, row.category.country_code if row.category else None, detail)
        return row

    def load_brand(self, admin: AdminIdentity, brand_id: uuid.UUID, detail: str) -> CatalogBrand:
        row = self.database.get(CatalogBrand, brand_id)
        if not row:
            raise HTTPException(status_code=404, detail=detail)
        if not admin.is_global:
            used_elsewhere = self.database.scalars(
                select(CatalogProduct.id).where(
                    CatalogProduct.brand_id == row.id,
                    CatalogProduct.country_code.isnot(None),
                    CatalogProduct.country_code != catalog_code(admin.scope),
                )
            ).first()
            if used_elsewhere:
                raise HTTPException(
                    status_code=403,
                    detail="Another country's products use this brand. Ask the Global Super Admin to change it.",
                )
        return row

    def load_product(self, admin: AdminIdentity, product_id: uuid.UUID) -> CatalogProduct:
        product = find_product(self.database, product_id, None)
        if not product:
            raise HTTPException(status_code=404, detail=NOT_IN_CATALOG)
        ensure_reach(admin, product.country_code, NOT_IN_CATALOG)
        return product

    def reload_product(self, admin: AdminIdentity, product_id: uuid.UUID) -> CatalogProduct:
        self.database.expire_all()
        return self.load_product(admin, product_id)

    def ensure_brand_exists(self, brand_id: uuid.UUID | None) -> None:
        if brand_id is not None and not self.database.get(CatalogBrand, brand_id):
            raise HTTPException(status_code=400, detail="That brand does not exist.")

    def ensure_unit_exists(self, unit_id: uuid.UUID | None) -> None:
        if unit_id is not None and not self.database.get(CatalogUnit, unit_id):
            raise HTTPException(status_code=400, detail="That unit does not exist.")

    # ---- categories, subcategories, brands, units ----

    def list_categories(self, country: str | None, admin: AdminIdentity) -> list[dict[str, Any]]:
        """Deactivated ones too: switching one off has to be visible and reversible."""
        rows = self.database.scalars(
            categories_in(select(CatalogCategory), catalog_country(viewing(admin, country))).order_by(
                CatalogCategory.sort_order, CatalogCategory.name
            )
        ).all()
        return [category_payload(row) for row in rows]

    def create_category(self, payload: CategoryWrite, country: str | None, admin: AdminIdentity) -> dict[str, Any]:
        country_code = owning_country(admin, country)
        slug = payload.slug.strip().lower()
        clash = self.database.scalars(
            select(CatalogCategory).where(CatalogCategory.country_code == country_code, CatalogCategory.slug == slug)
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="A category with that key already exists.")
        row = CatalogCategory(**{**payload.model_dump(), "slug": slug, "country_code": country_code})
        self.database.add(row)
        self.database.commit()
        self.database.refresh(row)
        return category_payload(row)

    def update_category(self, category_id: uuid.UUID, payload: CategoryUpdate, admin: AdminIdentity) -> dict[str, Any]:
        row = self.load_category(admin, category_id, "Category not found.")
        for field, value in changes(payload).items():
            setattr(row, field, value)
        self.database.commit()
        self.database.refresh(row)
        return category_payload(row)

    def list_subcategories(
        self, category_id: uuid.UUID | None, country: str | None, admin: AdminIdentity
    ) -> list[dict[str, Any]]:
        statement = subcategories_in(select(CatalogSubcategory), catalog_country(viewing(admin, country)))
        if category_id is not None:
            statement = statement.where(CatalogSubcategory.category_id == category_id)
        rows = self.database.scalars(statement.order_by(CatalogSubcategory.sort_order, CatalogSubcategory.name)).all()
        return [subcategory_payload(row) for row in rows]

    def create_subcategory(self, payload: SubcategoryWrite, admin: AdminIdentity) -> dict[str, Any]:
        self.load_category(admin, payload.category_id, "That category does not exist.")
        slug = payload.slug.strip().lower()
        clash = self.database.scalars(
            select(CatalogSubcategory).where(
                CatalogSubcategory.category_id == payload.category_id, CatalogSubcategory.slug == slug
            )
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="That category already has a subcategory with that key.")
        row = CatalogSubcategory(**{**payload.model_dump(), "slug": slug})
        self.database.add(row)
        self.database.commit()
        self.database.refresh(row)
        return subcategory_payload(row)

    def update_subcategory(
        self, subcategory_id: uuid.UUID, payload: SubcategoryUpdate, admin: AdminIdentity
    ) -> dict[str, Any]:
        row = self.load_subcategory(admin, subcategory_id, "Subcategory not found.")
        for field, value in changes(payload).items():
            setattr(row, field, value)
        self.database.commit()
        self.database.refresh(row)
        return subcategory_payload(row)

    def list_brands(self) -> list[dict[str, Any]]:
        rows = self.database.scalars(select(CatalogBrand).order_by(CatalogBrand.sort_order, CatalogBrand.name)).all()
        return [brand_payload(row) for row in rows]

    def create_brand(self, payload: BrandWrite) -> dict[str, Any]:
        slug = payload.slug.strip().lower()
        if self.database.scalars(select(CatalogBrand).where(CatalogBrand.slug == slug)).first():
            raise HTTPException(status_code=409, detail="A brand with that key already exists.")
        row = CatalogBrand(**{**payload.model_dump(), "slug": slug})
        self.database.add(row)
        self.database.commit()
        self.database.refresh(row)
        return brand_payload(row)

    def update_brand(self, brand_id: uuid.UUID, payload: BrandUpdate, admin: AdminIdentity) -> dict[str, Any]:
        row = self.load_brand(admin, brand_id, "Brand not found.")
        for field, value in changes(payload).items():
            setattr(row, field, value)
        self.database.commit()
        self.database.refresh(row)
        return brand_payload(row)

    def list_units(self) -> list[dict[str, Any]]:
        rows = self.database.scalars(select(CatalogUnit).order_by(CatalogUnit.sort_order, CatalogUnit.name)).all()
        return [unit_payload(row) for row in rows]

    # ---- products ----

    def list_products(
        self,
        *,
        category_id: uuid.UUID | None,
        subcategory_id: uuid.UUID | None,
        brand_id: uuid.UUID | None,
        search: str | None,
        limit: int,
        country: str | None,
        admin: AdminIdentity,
    ) -> list[dict[str, Any]]:
        """Deactivated products included: withdrawing one has to be visible."""
        statement = product_query(active_only=False, country=catalog_country(viewing(admin, country)))
        if subcategory_id is not None:
            statement = statement.where(CatalogProduct.subcategory_id == subcategory_id)
        if category_id is not None:
            statement = statement.join(
                CatalogSubcategory, CatalogSubcategory.id == CatalogProduct.subcategory_id
            ).where(CatalogSubcategory.category_id == category_id)
        if brand_id is not None:
            statement = statement.where(CatalogProduct.brand_id == brand_id)
        if search and search.strip():
            statement = statement.where(func.lower(CatalogProduct.name).like(f"%{search.strip().lower()}%"))
        rows = products(self.database, statement.order_by(CatalogProduct.name).limit(limit))
        return [product_payload(row) for row in rows]

    def fetch_product(self, product_id: uuid.UUID, admin: AdminIdentity) -> dict[str, Any]:
        product = self.load_product(admin, product_id)
        payload = product_payload(product)
        # Every picture, in gallery order: this screen is where the primary is chosen.
        payload["images"] = [
            {
                "id": image.id,
                "image_url": image.image_url,
                "alt_text": image.alt_text,
                "is_primary": image.is_primary,
                "sort_order": image.sort_order,
                "variant_id": image.variant_id,
            }
            for image in sorted(product_images(product), key=lambda item: (item.sort_order, item.id))
        ]
        # How many suppliers already sell it: whether deactivating is harmless.
        payload["listing_count"] = supplier_links.pending_listing_count(self.database, product_id)
        return payload

    def create_product(self, payload: ProductWrite, admin: AdminIdentity) -> dict[str, Any]:
        # The subcategory decides the product's country, and must be one this
        # administrator administers.
        subcategory = self.load_subcategory(admin, payload.subcategory_id, "That subcategory does not exist.")
        country_code = subcategory.category.country_code
        self.ensure_brand_exists(payload.brand_id)
        self.ensure_unit_exists(payload.unit_id)
        slug = payload.slug.strip().lower()
        clash = self.database.scalars(
            select(CatalogProduct).where(CatalogProduct.country_code == country_code, CatalogProduct.slug == slug)
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="A product with that key already exists.")
        product = CatalogProduct(
            **{
                **payload.model_dump(),
                "slug": slug,
                "normalized_name": payload.name.strip().lower(),
                "country_code": country_code,
                "created_by_user_id": admin.user.id,
            }
        )
        self.database.add(product)
        self.database.flush()
        record(
            self.database,
            admin,
            ACTION_CATALOG_PRODUCT_CREATED,
            target_type="master_product",
            target_id=product.id,
            summary=f"Added {product.name} to the master catalog",
        )
        self.database.commit()
        return product_payload(self.reload_product(admin, product.id))

    def update_product(self, product_id: uuid.UUID, payload: ProductUpdate, admin: AdminIdentity) -> dict[str, Any]:
        product = self.load_product(admin, product_id)
        country = product.country_code
        updates = changes(payload)
        # Publishing (activating) needs the full set of images; products already active
        # stay active whatever their count.
        if updates.get("is_active") is True and not product.is_active:
            image_count = len(product_images(product))
            if image_count < REQUIRED_PRODUCT_IMAGES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Upload {REQUIRED_PRODUCT_IMAGES} images before activating this product "
                    f"({image_count} uploaded).",
                )
        if updates.get("subcategory_id") is not None and updates["subcategory_id"] != product.subcategory_id:
            # A product never changes country.
            subcategory = self.load_subcategory(admin, updates["subcategory_id"], "That subcategory does not exist.")
            if subcategory.category.country_code != country:
                raise HTTPException(status_code=400, detail="That subcategory does not exist.")
        if "brand_id" in updates:
            self.ensure_brand_exists(updates["brand_id"])
        # Crash fixed: an unknown unit used to fail on the foreign key (500).
        if "unit_id" in updates:
            self.ensure_unit_exists(updates["unit_id"])
        for field, value in updates.items():
            setattr(product, field, value)
        if updates.get("name"):
            product.normalized_name = updates["name"].strip().lower()
        record(
            self.database,
            admin,
            ACTION_CATALOG_PRODUCT_UPDATED,
            target_type="master_product",
            target_id=product.id,
            summary=f"Updated master product {product.name}",
        )
        self.database.commit()
        return product_payload(self.reload_product(admin, product_id))

    # ---- variants ----

    def create_variant(self, product_id: uuid.UUID, payload: VariantWrite, admin: AdminIdentity) -> dict[str, Any]:
        self.load_product(admin, product_id)
        slug = payload.slug.strip().lower()
        clash = self.database.scalars(
            select(CatalogProductVariant).where(
                CatalogProductVariant.product_id == product_id, CatalogProductVariant.slug == slug
            )
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="That product already has a variant with that key.")
        # Crash fixed: an unknown unit used to fail on the foreign key (500).
        self.ensure_unit_exists(payload.unit_id)
        variant = CatalogProductVariant(**{**payload.model_dump(), "slug": slug, "product_id": product_id})
        self.database.add(variant)
        self.database.commit()
        variant_id = variant.id
        product = self.reload_product(admin, product_id)
        return variant_payload(self.database.get(CatalogProductVariant, variant_id), product)  # type: ignore[arg-type]

    def update_variant(self, variant_id: uuid.UUID, payload: VariantUpdate, admin: AdminIdentity) -> dict[str, Any]:
        variant = self.database.get(CatalogProductVariant, variant_id)
        if not variant:
            raise HTTPException(status_code=404, detail="Variant not found.")
        self.load_product(admin, variant.product_id)
        updates = changes(payload)
        if "unit_id" in updates:
            self.ensure_unit_exists(updates["unit_id"])
        for field, value in updates.items():
            setattr(variant, field, value)
        self.database.commit()
        product = self.reload_product(admin, variant.product_id)
        return variant_payload(self.database.get(CatalogProductVariant, variant_id), product)  # type: ignore[arg-type]

    # ---- pictures and the video ----

    def upload_product_image(
        self, product_id: uuid.UUID, file: UploadFile, admin: AdminIdentity, uploads: UploadService
    ) -> dict[str, Any]:
        """The first picture a product gets becomes its primary one. Filed under the
        product's country, not the uploader's."""
        product = self.load_product(admin, product_id)
        if (file.content_type or "") not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=415, detail="A product image must be a PNG, JPEG or WebP.")
        url = save_upload(file, uploads, admin, SUPPLIER_IMAGE, locality_of(product.country_code))
        if not url:
            raise HTTPException(status_code=400, detail="That image could not be saved.")
        images = product_images(product)
        image = CatalogProductMedia(
            product_id=product_id,
            image_url=url,
            file_id=file_id_of(url),
            alt_text=product.name,
            media_type=MEDIA_IMAGE,
            is_primary=not any(item.is_primary for item in images),
            sort_order=max((item.sort_order for item in images), default=0) + 10 if images else 0,
        )
        self.database.add(image)
        record(
            self.database,
            admin,
            ACTION_CATALOG_IMAGE_ADDED,
            target_type="master_product",
            target_id=product_id,
            summary=f"Added an image to master product {product.name}",
        )
        self.database.commit()
        self.database.refresh(image)
        return {"id": image.id, "image_url": image.image_url, "is_primary": image.is_primary}

    def save_picture(self, file: UploadFile, uploads: UploadService, admin: AdminIdentity, locality: str | None) -> str:
        if (file.content_type or "") not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=415, detail="The image must be a PNG, JPEG or WebP.")
        url = save_upload(file, uploads, admin, SUPPLIER_IMAGE, locality)
        if not url:
            raise HTTPException(status_code=400, detail="That image could not be saved.")
        return url

    def upload_category_image(
        self, category_id: uuid.UUID, file: UploadFile, admin: AdminIdentity, uploads: UploadService
    ) -> dict[str, Any]:
        """Replaces the picture it had (the old file stays in storage)."""
        row = self.load_category(admin, category_id, "Category not found.")
        row.image_url = self.save_picture(file, uploads, admin, locality_of(row.country_code))
        self.database.commit()
        self.database.refresh(row)
        return category_payload(row)

    def upload_subcategory_image(
        self, subcategory_id: uuid.UUID, file: UploadFile, admin: AdminIdentity, uploads: UploadService
    ) -> dict[str, Any]:
        row = self.load_subcategory(admin, subcategory_id, "Subcategory not found.")
        locality = locality_of(row.category.country_code if row.category else None)
        row.image_url = self.save_picture(file, uploads, admin, locality)
        self.database.commit()
        self.database.refresh(row)
        return subcategory_payload(row)

    def upload_brand_logo(
        self, brand_id: uuid.UUID, file: UploadFile, admin: AdminIdentity, uploads: UploadService
    ) -> dict[str, Any]:
        row = self.load_brand(admin, brand_id, "Brand not found.")
        row.logo_url = self.save_picture(file, uploads, admin, None if admin.is_global else admin.scope)
        self.database.commit()
        self.database.refresh(row)
        return brand_payload(row)

    def remove_product_videos(self, product_id: uuid.UUID) -> None:
        self.database.execute(
            delete(CatalogProductMedia).where(
                CatalogProductMedia.product_id == product_id, CatalogProductMedia.media_type == MEDIA_VIDEO
            )
        )
        self.database.flush()

    def upload_product_video(
        self, product_id: uuid.UUID, file: UploadFile, admin: AdminIdentity, uploads: UploadService
    ) -> dict[str, Any]:
        """One video per product (a VIDEO row, never primary); the replaced row is
        removed, its file stays in storage."""
        product = self.load_product(admin, product_id)
        if (file.content_type or "") not in ALLOWED_VIDEO_TYPES:
            raise HTTPException(status_code=415, detail="A product video must be an MP4, MOV or WebM file.")
        url = save_upload(file, uploads, admin, PRODUCT_VIDEO, locality_of(product.country_code))
        if not url:
            raise HTTPException(status_code=400, detail="That video could not be saved.")
        self.remove_product_videos(product_id)
        self.database.add(
            CatalogProductMedia(
                product_id=product_id,
                image_url=url,
                file_id=file_id_of(url),
                alt_text=product.name,
                media_type=MEDIA_VIDEO,
                is_primary=False,
                sort_order=1000,
            )
        )
        self.database.commit()
        return {"video_url": url}

    def delete_product_video(self, product_id: uuid.UUID, admin: AdminIdentity) -> None:
        self.load_product(admin, product_id)
        self.remove_product_videos(product_id)
        self.database.commit()

    def clear_primary(self, product_id: uuid.UUID) -> None:
        """Unset the current primary first: the database allows one per product."""
        self.database.execute(
            update(CatalogProductMedia)
            .where(CatalogProductMedia.product_id == product_id, CatalogProductMedia.is_primary.is_(True))
            .values(is_primary=False)
        )
        self.database.flush()

    def attach_product_image(self, product_id: uuid.UUID, payload: ImageWrite, admin: AdminIdentity) -> dict[str, Any]:
        self.load_product(admin, product_id)
        # Crash fixed: an unknown file or variant used to fail on the foreign key (500).
        if payload.uploaded_file_id is not None and not self.database.get(File, payload.uploaded_file_id):
            raise HTTPException(status_code=400, detail="That file does not exist.")
        if payload.variant_id is not None and not self.database.get(CatalogProductVariant, payload.variant_id):
            raise HTTPException(status_code=400, detail="That variant does not exist.")
        if payload.is_primary:
            self.clear_primary(product_id)
        values = payload.model_dump()
        values["file_id"] = values.pop("uploaded_file_id")
        image = CatalogProductMedia(**values, product_id=product_id)
        self.database.add(image)
        self.database.commit()
        self.database.refresh(image)
        return {"id": image.id, "image_url": image.image_url, "is_primary": image.is_primary}

    def reorder_product_images(
        self, product_id: uuid.UUID, payload: ImageOrder, admin: AdminIdentity
    ) -> list[dict[str, Any]]:
        """The list must name exactly the product's current images; the primary stays."""
        product = self.load_product(admin, product_id)
        images = {image.id: image for image in product_images(product)}
        if sorted(payload.image_ids) != sorted(images):
            raise HTTPException(status_code=400, detail="Send every image of this product exactly once.")
        for position, image_id in enumerate(payload.image_ids):
            images[image_id].sort_order = (position + 1) * 10
        self.database.commit()
        return [{"id": image_id, "sort_order": images[image_id].sort_order} for image_id in payload.image_ids]

    def set_primary_image(self, image_id: uuid.UUID, admin: AdminIdentity) -> dict[str, Any]:
        image = self.database.get(CatalogProductMedia, image_id)
        if not image:
            raise HTTPException(status_code=404, detail="Image not found.")
        if image.media_type != MEDIA_IMAGE:
            raise HTTPException(status_code=400, detail="A video cannot be the primary image.")
        self.load_product(admin, image.product_id)
        self.clear_primary(image.product_id)
        image.is_primary = True
        self.database.commit()
        return {"id": image.id, "is_primary": True}

    def delete_product_image(self, image_id: uuid.UUID, admin: AdminIdentity) -> None:
        """Detach the picture; the uploaded file is left in place."""
        image = self.database.get(CatalogProductMedia, image_id)
        if not image:
            raise HTTPException(status_code=404, detail="Image not found.")
        self.load_product(admin, image.product_id)
        self.database.delete(image)
        self.database.commit()
