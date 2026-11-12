"""What the marketplace reads from modules not ported yet.

NOT PORTED YET: each `pending_*` function answers "nothing found" until its module
replaces it (docs/porting-todo.md).

    store    Store Manager payment records (store_payment_records) whose checkout
             snapshot names a listing: none, so only order lines keep a listing from
             being deleted
"""

import uuid

from sqlalchemy.orm import Session


def pending_store_payment_count_for_listing(database: Session, listing_id: uuid.UUID) -> int:
    """STUB (store): Store Manager payments whose checkout snapshot lists this listing."""
    return 0
