"""What the catalog reads from supplier listings (supplier_products -> supplier_listings).

NOT PORTED YET: the marketplace module owns the listings. Each `pending_*` function
answers "nothing found" until that module replaces it (docs/porting-todo.md):

    a supplier has listed nothing, so it sees only each product's primary image
    GET /catalog/products/{id}/offers     no offers
    GET /admin/catalog/products/{id}      listing_count 0
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_SUPPLIER, User


def pending_supplier_listed_variants(database: Session, user: User) -> dict[Any, set[Any]] | None:
    """STUB (marketplace): {product_id: {variant_id or None, ...}} of the catalog products
    this supplier lists; None for any other account."""
    if (user.role or "").upper() != ROLE_SUPPLIER:
        return None
    return {}


def pending_offers(database: Session, product_id: uuid.UUID) -> list[dict[str, Any]]:
    """STUB (marketplace): the published listings of this product, cheapest first, as
    the old offers view answered them."""
    return []


def pending_listing_count(database: Session, product_id: uuid.UUID) -> int:
    """STUB (marketplace): how many supplier listings sell this product."""
    return 0
