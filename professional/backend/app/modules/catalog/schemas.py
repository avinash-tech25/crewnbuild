"""Request bodies for the master catalog (the old schemas/master_catalog.py; same fields,
ids are UUIDs). Answers are the plain dicts built in catalog_service.py."""

import uuid

from pydantic import BaseModel, Field


class CategoryWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class SubcategoryWrite(BaseModel):
    category_id: uuid.UUID
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True


class SubcategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class BrandWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=160)
    description: str | None = None
    logo_url: str | None = Field(default=None, max_length=500)
    sort_order: int = 0
    is_active: bool = True


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=160)
    description: str | None = None
    logo_url: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None
    is_active: bool | None = None


class Faq(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4000)


class ProductWrite(BaseModel):
    subcategory_id: uuid.UUID
    brand_id: uuid.UUID | None = None
    slug: str = Field(min_length=1, max_length=140)
    name: str = Field(min_length=1, max_length=200)
    short_description: str | None = None
    description: str | None = None
    product_type: str | None = Field(default=None, max_length=120)
    search_keywords: str | None = None
    standard_code: str | None = Field(default=None, max_length=80)
    unit_id: uuid.UUID | None = None
    specifications: dict[str, str] = Field(default_factory=dict)
    highlights: list[str] = Field(default_factory=list)
    faqs: list[Faq] = Field(default_factory=list)
    returns_exchange_policy: str | None = None
    is_active: bool = True


class ProductUpdate(BaseModel):
    subcategory_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    name: str | None = Field(default=None, max_length=200)
    short_description: str | None = None
    description: str | None = None
    product_type: str | None = Field(default=None, max_length=120)
    search_keywords: str | None = None
    standard_code: str | None = Field(default=None, max_length=80)
    unit_id: uuid.UUID | None = None
    specifications: dict[str, str] | None = None
    highlights: list[str] | None = None
    faqs: list[Faq] | None = None
    returns_exchange_policy: str | None = None
    is_active: bool | None = None


class VariantWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    unit_id: uuid.UUID | None = None
    specifications: dict[str, str] = Field(default_factory=dict)
    sort_order: int = 0
    is_active: bool = True


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=140)
    unit_id: uuid.UUID | None = None
    specifications: dict[str, str] | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ImageOrder(BaseModel):
    """The product's image ids in the order they should be shown."""

    image_ids: list[uuid.UUID] = Field(min_length=1)


class ImageWrite(BaseModel):
    """Attach an already-uploaded file ("/files/{id}") to a product."""

    image_url: str = Field(min_length=1, max_length=500)
    uploaded_file_id: uuid.UUID | None = None
    variant_id: uuid.UUID | None = None
    alt_text: str | None = Field(default=None, max_length=200)
    is_primary: bool = False
    sort_order: int = 0
