"""Reading the master catalog, and the one place its payload shape is decided (ported
from the old master_catalog_service.py, catalog_queries.py and catalog_repository.py,
same rules and answers).

Every consumer -- the admin catalog screen, the supplier's cascading selector, the
marketplace -- renders the same canonical product from here. The catalog is read in
the caller's own country, resolved on the server (India is the only market), never
from the request; a product of another country answers 404 like a missing one.
"""

import logging
import re
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select, text
from sqlalchemy.orm import Session, joinedload

from app.core.config import PROFESSIONAL_SCHEMA
from app.modules.admin.scope import LOCALITY_INDIA, locality_code
from app.modules.catalog import supplier_links
from app.modules.catalog.models import (
    CATALOG_INDIA,
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
from app.modules.identity.models import User

logger = logging.getLogger(__name__)

CATALOG_COUNTRIES = (CATALOG_INDIA,)
_LOCALITY_TO_CATALOG = {LOCALITY_INDIA: CATALOG_INDIA}
NOT_IN_CATALOG = "That product is not in the catalog."
# The number of images a product needs before an administrator may publish (activate)
# it. Products already active are not withdrawn for having fewer.
REQUIRED_PRODUCT_IMAGES = 5


# ---- the catalog tables are created by the migrations ----


def catalog_installed(database: Session) -> bool:
    name = f"{PROFESSIONAL_SCHEMA}.catalog_categories"
    return database.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar() is not None


def require_catalog_tables(database: Session) -> None:
    """503 when the catalog tables are missing (an empty catalog is not an error)."""
    if not catalog_installed(database):
        logger.error("The catalog tables are missing from this database; run the Professional migrations.")
        raise HTTPException(status_code=503, detail="The product catalog has not been set up yet.")


# ---- country ----


def catalog_code(value: str | None) -> str | None:
    """ "IN" / "India" -> the catalog's "IN"; None if unknown."""
    return _LOCALITY_TO_CATALOG.get(locality_code(value))


def locality_of(country_code: str | None) -> str:
    return locality_code(country_code)


def viewer_catalog_country(user: User) -> str:
    """The catalog a signed-in account reads. Every account (and a supplier's
    business) is India's, so this is always "IN"."""
    return CATALOG_INDIA


# ---- queries ----


def categories_in(statement: Select[Any], country: str | None) -> Select[Any]:
    """None means every country."""
    if country is None:
        return statement
    return statement.where(CatalogCategory.country_code == country)


def subcategories_in(statement: Select[Any], country: str | None) -> Select[Any]:
    if country is None:
        return statement
    category_ids = select(CatalogCategory.id).where(CatalogCategory.country_code == country)
    return statement.where(CatalogSubcategory.category_id.in_(category_ids))


def products_in(statement: Select[Any], country: str | None) -> Select[Any]:
    if country is None:
        return statement
    return statement.where(CatalogProduct.country_code == country)


def product_query(active_only: bool = True, country: str | None = None) -> Select[Any]:
    """Products with everything the payload needs, loaded in one go."""
    statement = select(CatalogProduct).options(
        joinedload(CatalogProduct.subcategory).joinedload(CatalogSubcategory.category),
        joinedload(CatalogProduct.brand),
        joinedload(CatalogProduct.unit),
        joinedload(CatalogProduct.images),
        joinedload(CatalogProduct.variants).joinedload(CatalogProductVariant.unit),
    )
    if active_only:
        statement = statement.where(CatalogProduct.is_active.is_(True))
    return products_in(statement, country)


def products(database: Session, statement: Select[Any]) -> list[CatalogProduct]:
    return list(database.scalars(statement).unique().all())


def find_product(database: Session, product_id: uuid.UUID, country: str | None) -> CatalogProduct | None:
    return next(
        iter(
            products(database, product_query(active_only=False, country=country).where(CatalogProduct.id == product_id))
        ),
        None,
    )


# ---- payloads ----


def category_payload(category: CatalogCategory) -> dict[str, Any]:
    return {
        "id": category.id,
        "country_code": category.country_code,
        "slug": category.slug,
        "name": category.name,
        "description": category.description,
        "image_url": category.image_url,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
    }


def subcategory_payload(subcategory: CatalogSubcategory) -> dict[str, Any]:
    return {
        "id": subcategory.id,
        "category_id": subcategory.category_id,
        "slug": subcategory.slug,
        "name": subcategory.name,
        "description": subcategory.description,
        "image_url": subcategory.image_url,
        "sort_order": subcategory.sort_order,
        "is_active": subcategory.is_active,
    }


def brand_payload(brand: CatalogBrand) -> dict[str, Any]:
    return {
        "id": brand.id,
        "slug": brand.slug,
        "name": brand.name,
        "manufacturer": brand.manufacturer,
        "description": brand.description,
        "logo_url": brand.logo_url,
        "sort_order": brand.sort_order,
        "is_active": brand.is_active,
    }


def unit_payload(unit: CatalogUnit) -> dict[str, Any]:
    return {"id": unit.id, "code": unit.code, "name": unit.name, "unit_family": unit.unit_family}


def product_images(product: CatalogProduct) -> list[CatalogProductMedia]:
    """The product's pictures only; its video is never shown, counted or chosen as one."""
    return [item for item in product.images or [] if (item.media_type or MEDIA_IMAGE) == MEDIA_IMAGE]


def product_video(product: CatalogProduct) -> CatalogProductMedia | None:
    """The product's one video: the latest VIDEO row, or None."""
    videos = [item for item in product.images or [] if item.media_type == MEDIA_VIDEO]
    return max(videos, key=lambda item: (item.sort_order, item.id)) if videos else None


def ordered_images(product: CatalogProduct) -> list[CatalogProductMedia]:
    """Every image, the primary first, then in the order the administrator set."""
    return sorted(product_images(product), key=lambda image: (not image.is_primary, image.sort_order, image.id))


def primary_image(product: CatalogProduct) -> CatalogProductMedia | None:
    """The picture the administrator marked primary, or None (no fallback)."""
    return next((image for image in product_images(product) if image.is_primary), None)


def variant_payload(variant: CatalogProductVariant, product: CatalogProduct) -> dict[str, Any]:
    """The variant's unit falls back to the product's; its specifications are merged
    over the product's."""
    unit = variant.unit or product.unit
    specifications = {**(product.specifications or {}), **(variant.specifications or {})}
    return {
        "id": variant.id,
        "master_product_id": variant.product_id,
        "slug": variant.slug,
        "name": variant.name,
        "unit": unit_payload(unit) if unit else None,
        "unit_code": unit.code if unit else None,
        "unit_family": unit.unit_family if unit else None,
        "specifications": specifications,
        "sort_order": variant.sort_order,
        "is_active": variant.is_active,
    }


def media_summary(image_count: int, has_video: bool) -> dict[str, Any]:
    return {
        "image_count": image_count,
        "images_required": REQUIRED_PRODUCT_IMAGES,
        "has_video": has_video,
        "complete": image_count >= REQUIRED_PRODUCT_IMAGES,
    }


def product_payload(product: CatalogProduct, include_variants: bool = True) -> dict[str, Any]:
    """The canonical product, as every screen renders it."""
    image = primary_image(product)
    video = product_video(product)
    subcategory = product.subcategory
    category = subcategory.category if subcategory else None
    payload: dict[str, Any] = {
        "id": product.id,
        "country_code": product.country_code,
        "slug": product.slug,
        "name": product.name,
        "short_description": product.short_description,
        "description": product.description,
        "highlights": product.highlights or [],
        "faqs": product.faqs or [],
        "returns_exchange_policy": product.returns_exchange_policy,
        "product_type": product.product_type,
        "search_keywords": product.search_keywords,
        "standard_code": product.standard_code,
        "specifications": product.specifications or {},
        "is_active": product.is_active,
        "category_id": category.id if category else None,
        "category_name": category.name if category else None,
        "subcategory_id": product.subcategory_id,
        "subcategory_name": subcategory.name if subcategory else None,
        "brand_id": product.brand_id,
        "brand_name": product.brand.name if product.brand else None,
        "brand_logo_url": product.brand.logo_url if product.brand else None,
        "unit": unit_payload(product.unit) if product.unit else None,
        "unit_code": product.unit.code if product.unit else None,
        "unit_family": product.unit.unit_family if product.unit else None,
        # The canonical picture, referenced by address ("/files/{id}"), never copied.
        "image_url": image.image_url if image else None,
        "image_alt": image.alt_text if image else None,
        "images": [
            {
                "id": item.id,
                "image_url": item.image_url,
                "alt_text": item.alt_text,
                "is_primary": item.is_primary,
                "variant_id": item.variant_id,
            }
            for item in ordered_images(product)
        ],
        "video_url": video.image_url if video else None,
        "video_id": video.id if video else None,
    }
    payload["media"] = media_summary(len(product_images(product)), bool(payload["video_url"]))
    if include_variants:
        payload["variants"] = [variant_payload(variant, product) for variant in product.variants if variant.is_active]
    return payload


def media_for_viewer(
    payload: dict[str, Any], listed: dict[Any, set[Any]] | None, show_primary: bool = False
) -> dict[str, Any]:
    """A product payload with only the media this viewer may see.

    `listed` is supplier_links.pending_supplier_listed_variants(): None (not a supplier)
    leaves the payload as it was. A supplier gets the images and video only of a product
    it has added; an image tied to one variant only when it lists that variant.
    `show_primary`: in the lists a supplier picks a product from, every product shows
    its primary image."""
    if listed is None:
        return payload
    variants = listed.get(payload["id"])
    if variants is None:
        images: list[dict[str, Any]] = []
        video_url, video_id = None, None
    else:
        images = [
            image
            for image in payload.get("images") or []
            if image.get("variant_id") is None or None in variants or image["variant_id"] in variants
        ]
        video_url, video_id = payload.get("video_url"), payload.get("video_id")
    if show_primary and not any(image["is_primary"] for image in images):
        catalog_primary = next((image for image in payload.get("images") or [] if image["is_primary"]), None)
        if catalog_primary:
            images = [catalog_primary, *images]
    primary = next((image for image in images if image["is_primary"]), None)
    payload = {
        **payload,
        "images": images,
        "image_url": primary["image_url"] if primary else None,
        "image_alt": primary["alt_text"] if primary else None,
        "video_url": video_url,
        "video_id": video_id,
    }
    payload["media"] = media_summary(len(images), bool(video_url))
    return payload


# ---- search ----
# A plain-words search over one country's catalog ("10kg ultratech cement bag"). A word
# scores by the most important field it appears in:
#     product name > brand > variant > category / subcategory / product type
#     > search keywords > unit > specifications > description
# Numbers and unit words only add to a product that already matched a real word.

_WORD = re.compile(r"[a-z]+|\d+(?:\.\d+)?")
_STOP_WORDS = {"a", "an", "and", "the", "of", "for", "in", "with", "to", "per"}
_MEASURE_WORDS = {
    "kg", "g", "gm", "gram", "kilogram", "tonne", "ton", "mt", "mm", "cm", "m", "metre", "meter", "ft",
    "inch", "bag", "piece", "pc", "pcs", "no", "nos", "litre", "liter", "l", "ltr", "pack", "packet",
    "size", "standard", "unit", "box", "bundle", "sqft", "sq",
}  # fmt: skip
_FIELD_WEIGHTS = (
    ("name", 30),
    ("brand", 26),
    ("variant", 22),
    ("category", 16),
    ("keywords", 12),
    ("unit", 10),
    ("specifications", 8),
    ("description", 3),
)


def _singular(word: str) -> str:
    if word in ("kgs", "pcs", "nos", "mts"):
        return word[:-1]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def search_words(value: Any) -> list[str]:
    words: list[str] = []
    for found in _WORD.findall(str(value or "").lower()):
        word = _singular(found)
        if word not in _STOP_WORDS and word not in words:
            words.append(word)
    return words


def _is_measure(word: str) -> bool:
    return word in _MEASURE_WORDS or word[0].isdigit()


def _spec_words(specifications: dict[str, Any] | None) -> set[str]:
    return set(search_words(" ".join(f"{key} {value}" for key, value in (specifications or {}).items())))


def _unit_words(unit: CatalogUnit | None) -> set[str]:
    if not unit:
        return set()
    return set(search_words(f"{unit.code} {unit.name}"))


def search_catalog(database: Session, query_text: str, country: str, limit: int = 20) -> list[dict[str, Any]]:
    """The country's active products that match the words, best first, each with the
    variant that matched best, a score, and `exact` (every word was found)."""
    words = search_words(query_text)
    if not words:
        return []
    real_words = [word for word in words if not _is_measure(word)]
    numbers = [word for word in words if word[0].isdigit()]

    results = []
    for product in products(database, product_query(country=country)):
        subcategory = product.subcategory
        category = subcategory.category if subcategory else None
        fields = {
            "name": set(search_words(product.name)),
            "brand": set(search_words(product.brand.name if product.brand else "")),
            "category": set(
                search_words(
                    f"{category.name if category else ''} {subcategory.name if subcategory else ''} "
                    f"{product.product_type or ''}"
                )
            ),
            "keywords": set(search_words(product.search_keywords)),
            "unit": _unit_words(product.unit),
            "specifications": _spec_words(product.specifications) | set(search_words(product.standard_code)),
            "description": set(search_words(f"{product.short_description or ''} {product.description or ''}")),
        }

        best_variant, best_variant_words = None, set()
        for variant in (item for item in product.variants if item.is_active):
            variant_words = (
                set(search_words(variant.name)) | _spec_words(variant.specifications) | _unit_words(variant.unit)
            )
            hits = {word for word in words if word in variant_words}
            if (
                best_variant is None
                or len(hits) > len(best_variant_words)
                or (
                    len(hits) == len(best_variant_words)
                    and sum(w[0].isdigit() for w in hits) > sum(w[0].isdigit() for w in best_variant_words)
                )
            ):
                best_variant, best_variant_words = variant, hits
        fields["variant"] = best_variant_words

        score, matched, strong = 0, set(), False
        for word in words:
            weight = next((weight for field, weight in _FIELD_WEIGHTS if word in fields[field]), 0)
            if not weight:
                continue
            matched.add(word)
            score += weight if not _is_measure(word) or word in fields["variant"] else weight // 3
            if not _is_measure(word) and weight > 3:
                strong = True

        if real_words:
            if not any(word in matched for word in real_words):
                continue
        elif not matched:
            continue

        if words == search_words(product.name):
            score += 200
        elif real_words and all(word in fields["name"] | fields["brand"] for word in real_words):
            score += 60
        if numbers and best_variant is not None and all(number in best_variant_words for number in numbers):
            score += 40

        payload = product_payload(product)
        payload["matched_variant"] = variant_payload(best_variant, product) if best_variant is not None else None
        payload["score"] = score
        payload["exact"] = len(matched) == len(words)
        payload["_strong"] = strong
        results.append(payload)

    # A product found only through its description shows only when nothing matched better.
    if any(result["_strong"] for result in results):
        results = [result for result in results if result["_strong"]]
    for result in results:
        del result["_strong"]
    results.sort(key=lambda result: (-result["score"], result["name"]))
    return results[:limit]


# ---- the signed-in reader (GET /catalog/...) ----


class CatalogService:
    def __init__(self, database: Session) -> None:
        self.database = database

    def list_categories(self, user: User) -> list[dict[str, Any]]:
        rows = self.database.scalars(
            categories_in(select(CatalogCategory), viewer_catalog_country(user))
            .where(CatalogCategory.is_active.is_(True))
            .order_by(CatalogCategory.sort_order, CatalogCategory.name)
        ).all()
        return [category_payload(row) for row in rows]

    def list_subcategories(self, category_id: uuid.UUID | None, user: User) -> list[dict[str, Any]]:
        statement = subcategories_in(select(CatalogSubcategory), viewer_catalog_country(user)).where(
            CatalogSubcategory.is_active.is_(True)
        )
        if category_id is not None:
            statement = statement.where(CatalogSubcategory.category_id == category_id)
        rows = self.database.scalars(statement.order_by(CatalogSubcategory.sort_order, CatalogSubcategory.name)).all()
        return [subcategory_payload(row) for row in rows]

    def list_brands(
        self, subcategory_id: uuid.UUID | None, category_id: uuid.UUID | None, user: User
    ) -> list[dict[str, Any]]:
        """Only brands an active product of the caller's country uses (in the chosen
        subcategory or category)."""
        used = products_in(select(CatalogProduct.brand_id), viewer_catalog_country(user)).where(
            CatalogProduct.is_active.is_(True), CatalogProduct.brand_id.isnot(None)
        )
        if subcategory_id is not None:
            used = used.where(CatalogProduct.subcategory_id == subcategory_id)
        if category_id is not None:
            used = used.join(CatalogSubcategory, CatalogSubcategory.id == CatalogProduct.subcategory_id).where(
                CatalogSubcategory.category_id == category_id
            )
        rows = self.database.scalars(
            select(CatalogBrand)
            .where(CatalogBrand.is_active.is_(True), CatalogBrand.id.in_(used))
            .order_by(CatalogBrand.sort_order, CatalogBrand.name)
        ).all()
        return [brand_payload(row) for row in rows]

    def list_units(self, user: User) -> list[dict[str, Any]]:
        rows = self.database.scalars(
            select(CatalogUnit)
            .where(CatalogUnit.is_active.is_(True))
            .order_by(CatalogUnit.sort_order, CatalogUnit.name)
        ).all()
        return [unit_payload(row) for row in rows]

    def list_products(
        self,
        category_id: uuid.UUID | None,
        subcategory_id: uuid.UUID | None,
        brand_id: uuid.UUID | None,
        search: str | None,
        limit: int,
        user: User,
    ) -> list[dict[str, Any]]:
        statement = product_query(country=viewer_catalog_country(user))
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
        listed = supplier_links.pending_supplier_listed_variants(self.database, user)
        return [media_for_viewer(product_payload(row), listed, show_primary=True) for row in rows]

    def search_products(self, q: str, limit: int, user: User) -> list[dict[str, Any]]:
        listed = supplier_links.pending_supplier_listed_variants(self.database, user)
        return [
            media_for_viewer(result, listed, show_primary=True)
            for result in search_catalog(self.database, q, viewer_catalog_country(user), limit=limit)
        ]

    def product_or_404(self, product_id: uuid.UUID, user: User) -> CatalogProduct:
        product = find_product(self.database, product_id, viewer_catalog_country(user))
        if not product:
            raise HTTPException(status_code=404, detail=NOT_IN_CATALOG)
        return product

    def fetch_product(self, product_id: uuid.UUID, user: User) -> dict[str, Any]:
        product = self.product_or_404(product_id, user)
        listed = supplier_links.pending_supplier_listed_variants(self.database, user)
        return media_for_viewer(product_payload(product), listed)

    def list_variants(self, product_id: uuid.UUID, user: User) -> list[dict[str, Any]]:
        product = self.product_or_404(product_id, user)
        return [variant_payload(variant, product) for variant in product.variants if variant.is_active]

    def list_offers(self, product_id: uuid.UUID, user: User) -> dict[str, Any]:
        """One canonical product, and every supplier selling it."""
        product = self.product_or_404(product_id, user)
        listed = supplier_links.pending_supplier_listed_variants(self.database, user)
        return {
            "product": media_for_viewer(product_payload(product), listed),
            "offers": supplier_links.pending_offers(self.database, product_id),
        }
