"""Request bodies of the marketplace (the old schemas/supplier_product.py; same fields,
ids are UUIDs)."""

import uuid
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

# A real number: NaN or Infinity would slip past every comparison (stock, price > 0).
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class SupplierProductCreate(BaseModel):
    name: str
    brand: str | None = None
    size: str | None = None
    category: str
    unit: str
    price: FiniteFloat
    quantity: FiniteFloat
    low_stock_threshold: FiniteFloat = 0
    image_url: str | None = None
    features: str | None = None
    description: str | None = None
    product_type: str | None = None
    grade: str | None = None
    usage: str | None = None
    is_published: bool = True


class SupplierCatalogListingCreate(BaseModel):
    """A Master Catalog product added to a supplier's catalog: only the commercial
    values; anything else is refused (422)."""

    model_config = ConfigDict(extra="forbid")

    master_product_id: uuid.UUID
    master_variant_id: uuid.UUID | None = None
    price: FiniteFloat
    quantity: FiniteFloat = 0
    low_stock_threshold: FiniteFloat = 0
    is_published: bool = True
    discount_percentage: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)


class SupplierProductPriceUpdate(BaseModel):
    price: FiniteFloat


class SupplierProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    brand: str | None = None
    size: str | None = None
    category: str | None = None
    unit: str | None = None
    price: FiniteFloat | None = None
    quantity: FiniteFloat | None = None
    low_stock_threshold: FiniteFloat | None = None
    image_url: str | None = None
    features: str | None = None
    description: str | None = None
    product_type: str | None = None
    grade: str | None = None
    usage: str | None = None
    is_published: bool | None = None
    discount_percentage: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)


class MaterialRequestItemCreate(BaseModel):
    product_id: uuid.UUID
    quantity: FiniteFloat


class MaterialRequestCreate(BaseModel):
    project_id: uuid.UUID
    supplier_id: uuid.UUID
    items: list[MaterialRequestItemCreate]


class MaterialRequestDecision(BaseModel):
    action: str


class CartItemCreate(BaseModel):
    project_id: uuid.UUID
    product_id: uuid.UUID
    quantity: FiniteFloat


class CartItemUpdate(BaseModel):
    quantity: FiniteFloat


class CartCheckout(BaseModel):
    project_id: uuid.UUID
    supplier_id: uuid.UUID


class SupplierBulkPricingUpdate(BaseModel):
    """A listing's complete set of bulk tiers; [] turns bulk pricing off."""

    tiers: list[dict[str, Any]] = []
