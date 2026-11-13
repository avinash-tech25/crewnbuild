"""Load the approved Partner service catalog -- server access only, no API.

  python -m app.seeds.seed_service_catalog

These are this application's own approved catalog prices. They are NOT an
external company's or provider's verified rates, and nothing in the code or the
UI presents them as such.

Idempotent: a row is matched on (trade, slug) and updated in place, so running
this twice leaves the same number of rows. It never deletes, so a service that
has been retired or edited on the server is not silently resurrected or wiped --
re-running only brings the approved name, kind, price, currency and order back
into line.

`image_url`, `description` and `includes` are deliberately left alone. They are
not part of the approved data, and inventing them would put made-up claims about
work scope in front of customers. They stay NULL until real content is supplied,
and the UI renders without them.

Prices are written as Decimal from a string, never a float: `float("0.1")` is
not 0.1, and money must be exact.
"""

import sys
from decimal import Decimal

from app.database.session import SessionLocal
from app.modules.catalog.models import CURRENCY_INR, KIND_CONSULTATION, KIND_SERVICE, Service
from app.modules.registry import import_all_models

import_all_models()

# (slug, service_name, service_kind, price). Order is the published order; the
# list position becomes sort_order, so Consultation stays last within its trade.
CATALOG: dict[str, list[tuple[str, str, str, str]]] = {
    "PLUMBER": [
        ("tap-repair", "Tap Repair", KIND_SERVICE, "299"),
        ("tap-installation", "Tap Installation", KIND_SERVICE, "399"),
        ("pipe-leakage-repair", "Pipe Leakage Repair", KIND_SERVICE, "499"),
        ("sink-repair", "Sink Repair", KIND_SERVICE, "399"),
        ("toilet-repair", "Toilet Repair", KIND_SERVICE, "499"),
        ("shower-installation", "Shower Installation", KIND_SERVICE, "449"),
        ("water-tank-pipe-inspection", "Water Tank/Pipe Inspection", KIND_SERVICE, "299"),
        ("consultation", "Consultation", KIND_CONSULTATION, "199"),
    ],
    "ELECTRICIAN": [
        ("switch-socket-repair", "Switch/Socket Repair", KIND_SERVICE, "249"),
        ("switch-socket-installation", "Switch/Socket Installation", KIND_SERVICE, "299"),
        ("fan-installation", "Fan Installation", KIND_SERVICE, "499"),
        ("fan-repair", "Fan Repair", KIND_SERVICE, "399"),
        ("light-installation", "Light Installation", KIND_SERVICE, "299"),
        ("light-repair", "Light Repair", KIND_SERVICE, "249"),
        ("wiring-repair", "Wiring Repair", KIND_SERVICE, "499"),
        ("electrical-inspection", "Electrical Inspection", KIND_SERVICE, "299"),
        ("consultation", "Consultation", KIND_CONSULTATION, "199"),
    ],
    "CARPENTER": [
        ("door-repair", "Door Repair", KIND_SERVICE, "499"),
        ("door-handle-lock-installation", "Door Handle/Lock Installation", KIND_SERVICE, "349"),
        ("furniture-repair", "Furniture Repair", KIND_SERVICE, "599"),
        ("cabinet-repair", "Cabinet Repair", KIND_SERVICE, "499"),
        ("shelf-installation", "Shelf Installation", KIND_SERVICE, "499"),
        ("curtain-rod-installation", "Curtain Rod Installation", KIND_SERVICE, "299"),
        ("minor-woodwork", "Minor Woodwork", KIND_SERVICE, "599"),
        ("consultation", "Consultation", KIND_CONSULTATION, "199"),
    ],
    "PAINTER": [
        ("wall-touch-up", "Wall Touch-up", KIND_SERVICE, "499"),
        ("single-wall-painting", "Single Wall Painting", KIND_SERVICE, "999"),
        ("room-painting", "Room Painting", KIND_SERVICE, "1999"),
        ("door-painting", "Door Painting", KIND_SERVICE, "699"),
        ("window-painting", "Window Painting", KIND_SERVICE, "499"),
        ("exterior-touch-up", "Exterior Touch-up", KIND_SERVICE, "1499"),
        ("consultation", "Consultation", KIND_CONSULTATION, "199"),
    ],
}


def seed(session) -> tuple[int, int]:
    """(created, updated). Existing rows are matched on (trade, slug)."""
    created = updated = 0
    for trade, entries in CATALOG.items():
        for position, (slug, service_name, service_kind, price) in enumerate(entries, start=1):
            values = {
                "service_name": service_name,
                "service_kind": service_kind,
                "price": Decimal(price),
                "currency": CURRENCY_INR,
                "is_active": True,
                "sort_order": position,
            }
            existing = session.query(Service).filter(Service.trade == trade, Service.slug == slug).one_or_none()
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                session.add(Service(trade=trade, slug=slug, **values))
                created += 1
    session.commit()
    return created, updated


def main() -> None:
    session = SessionLocal()
    try:
        created, updated = seed(session)
        total = session.query(Service).count()
    finally:
        session.close()
    approved = sum(len(entries) for entries in CATALOG.values())
    print(
        f"catalog: {created} created, {updated} updated, {total} rows in partner.catalog_services ({approved} approved)"
    )


if __name__ == "__main__":
    sys.exit(main())
