"""Catalog tables (technical-architecture.md section 10, domain Catalog).

    catalog_categories        was master_categories
    catalog_subcategories     was master_subcategories
    catalog_brands            was master_brands
    catalog_units             was master_units
    catalog_products          was master_products
    catalog_product_variants  was master_product_variants   master_product_id -> product_id
    catalog_product_media     was master_product_images     master_product_id -> product_id,
                                                            uploaded_file_id -> file_id

Every key is now a UUID. The old tables were never created by a migration, only by
sql_scripts/master_catalog_seed.sql (MG-06); these models follow that script's live
schema, not the old models, including its delete rules:

    subcategory -> category, product -> subcategory / brand / unit,
    variant -> unit                                     RESTRICT
    variant -> product, media -> product / variant      CASCADE
    product.created_by_user_id (was created_by),
    media.file_id (was uploaded_file_id)                SET NULL

The rows are loaded by app/seeds/master_catalog_seed.sql (seed_master_catalog.py).
"""

import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, CreatedAtMixin, TimestampMixin, UuidPrimaryKeyMixin

MEDIA_IMAGE = "IMAGE"
MEDIA_VIDEO = "VIDEO"
UNIT_FAMILIES = ("PACK", "COUNT", "WEIGHT", "LENGTH", "AREA", "VOLUME", "OTHER")
CATALOG_INDIA = "IN"


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class CatalogCategory(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_categories"
    __table_args__ = (
        CheckConstraint("country_code IS NULL OR country_code = 'IN'", name="country"),
        # Slugs are unique per country.
        Index(
            "uq_catalog_categories__country_code_slug",
            "country_code",
            "slug",
            unique=True,
            postgresql_where=text("country_code IS NOT NULL"),
        ),
        Index("ix_catalog_categories__is_active_sort_order", "is_active", "sort_order"),
        Index("ix_catalog_categories__country_code_is_active_sort_order", "country_code", "is_active", "sort_order"),
    )

    country_code: Mapped[str | None] = mapped_column(String(2))
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # The category picture, uploaded in Admin > Master Catalog.
    image_url: Mapped[str | None] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class CatalogSubcategory(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_subcategories"
    __table_args__ = (
        Index("uq_catalog_subcategories__category_id_slug", "category_id", "slug", unique=True),
        Index("ix_catalog_subcategories__category_id_is_active_sort_order", "category_id", "is_active", "sort_order"),
    )

    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    category = relationship("CatalogCategory")


class CatalogBrand(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """Brands are shared by every country; which a country shows follows from its products."""

    __tablename__ = "catalog_brands"

    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    manufacturer: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class CatalogUnit(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "catalog_units"
    __table_args__ = (
        CheckConstraint(f"unit_family IS NULL OR {_in('unit_family', UNIT_FAMILIES)}", name="unit_family"),
    )

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    unit_family: Mapped[str | None] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class CatalogProduct(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_products"
    __table_args__ = (
        CheckConstraint("country_code IS NULL OR country_code = 'IN'", name="country"),
        Index(
            "uq_catalog_products__country_code_slug",
            "country_code",
            "slug",
            unique=True,
            postgresql_where=text("country_code IS NOT NULL"),
        ),
        Index("ix_catalog_products__subcategory_id_is_active", "subcategory_id", "is_active"),
        Index("ix_catalog_products__brand_id_is_active", "brand_id", "is_active"),
        Index("ix_catalog_products__country_code_is_active", "country_code", "is_active"),
        Index("ix_catalog_products__product_type", "product_type"),
        Index("ix_catalog_products__normalized_name", "normalized_name"),
        Index("ix_catalog_products__specifications", "specifications", postgresql_using="gin"),
    )

    country_code: Mapped[str | None] = mapped_column(String(2))
    subcategory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog_subcategories.id", ondelete="RESTRICT"), nullable=False
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog_brands.id", ondelete="RESTRICT"))
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str | None] = mapped_column(String(200))
    short_description: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    product_type: Mapped[str | None] = mapped_column(String(120))
    search_keywords: Mapped[str | None] = mapped_column(Text)
    standard_code: Mapped[str | None] = mapped_column(String(80))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog_units.id", ondelete="RESTRICT"), index=True)
    specifications: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    # Product page content, maintained by the admin.
    highlights: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    faqs: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    returns_exchange_policy: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    subcategory = relationship("CatalogSubcategory")
    brand = relationship("CatalogBrand")
    unit = relationship("CatalogUnit")
    variants = relationship(
        "CatalogProductVariant",
        back_populates="product",
        order_by="CatalogProductVariant.sort_order",
        cascade="all, delete-orphan",
    )
    images = relationship(
        "CatalogProductMedia",
        back_populates="product",
        order_by="CatalogProductMedia.sort_order",
        cascade="all, delete-orphan",
    )


class CatalogProductVariant(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_product_variants"
    __table_args__ = (
        Index("uq_catalog_product_variants__product_id_slug", "product_id", "slug", unique=True),
        Index("ix_catalog_product_variants__product_id_is_active_sort_order", "product_id", "is_active", "sort_order"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog_units.id", ondelete="RESTRICT"), index=True)
    specifications: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    product = relationship("CatalogProduct", back_populates="variants")
    unit = relationship("CatalogUnit")


class CatalogProductMedia(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """A product's pictures and its one video (media_type VIDEO, never primary)."""

    __tablename__ = "catalog_product_media"
    __table_args__ = (
        CheckConstraint(_in("media_type", (MEDIA_IMAGE, MEDIA_VIDEO)), name="media_type"),
        CheckConstraint("media_type = 'IMAGE' OR is_primary = false", name="video_not_primary"),
        # At most one primary picture per product.
        Index(
            "uq_catalog_product_media__product_id_primary",
            "product_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
        Index("ix_catalog_product_media__product_id_sort_order", "product_id", "sort_order"),
        Index("ix_catalog_product_media__product_id_media_type_sort_order", "product_id", "media_type", "sort_order"),
        Index("ix_catalog_product_media__product_id_is_primary_media_type", "product_id", "is_primary", "media_type"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog_products.id", ondelete="CASCADE"), nullable=False)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("catalog_product_variants.id", ondelete="CASCADE"), index=True
    )
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"), index=True)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    alt_text: Mapped[str | None] = mapped_column(String(200))
    media_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default=MEDIA_IMAGE, server_default=text("'IMAGE'")
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    product = relationship("CatalogProduct", back_populates="images")
