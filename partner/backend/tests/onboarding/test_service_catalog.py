"""The service catalog, and the price a booking is made at.

The catalog is loaded with the approved seed inside each test's rolled-back
transaction, so these tests need `partner.catalog_services` (migration 0005) but never
leave a row behind. Retiring a service or moving a price is done the same way:
straight SQL inside that transaction, as an operator would on the server.
"""

from decimal import Decimal

import pytest
from legacy_dispatch import HOME
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.seeds.seed_service_catalog import CATALOG, seed

APPROVED_COUNTS = {"PLUMBER": 8, "ELECTRICIAN": 9, "CARPENTER": 8, "PAINTER": 7}


@pytest.fixture()
def catalog(connection):
    session = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
    try:
        created, updated = seed(session)
    finally:
        session.close()
    assert (created, updated) == (32, 0)


def service_id(connection, trade, slug):
    return connection.execute(
        text("SELECT id FROM partner.catalog_services WHERE trade = :trade AND slug = :slug"),
        {"trade": trade, "slug": slug},
    ).scalar_one()


def book(client, headers, trade, **extra):
    return client.post(
        "/requester/bookings",
        headers=headers,
        json={"technician_type": trade, "service_latitude": HOME[0], "service_longitude": HOME[1], **extra},
    )


def booking_count(connection, account_id):
    return connection.execute(
        text("SELECT count(*) FROM partner.bookings WHERE requested_by_user_id = :id"), {"id": account_id}
    ).scalar_one()


# ------------------------------------------------------------------ the catalog


def test_the_approved_catalog_is_exactly_32_services():
    assert {trade: len(entries) for trade, entries in CATALOG.items()} == APPROVED_COUNTS
    assert sum(APPROVED_COUNTS.values()) == 32
    slugs = [slug for entries in CATALOG.values() for slug, *_ in entries]
    assert not any("wall-inspection" in slug for slug in slugs)
    for entries in CATALOG.values():
        # Consultation is last in every trade, at 199.
        assert entries[-1][0] == "consultation" and entries[-1][3] == "199"


def test_seeding_twice_changes_nothing(connection, catalog):
    session = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
    try:
        assert seed(session) == (0, 32)
    finally:
        session.close()
    assert connection.execute(text("SELECT count(*) FROM partner.catalog_services")).scalar_one() == 32


def test_catalog_list_is_the_trades_live_services_in_published_order(client, catalog, requester_session):
    _account, headers = requester_session()
    response = client.get("/requester/services", headers=headers, params={"trade": "PLUMBER"})
    assert response.status_code == 200, response.text
    rows = response.json()

    assert [(row["slug"], row["service_name"], row["service_kind"], Decimal(row["price"])) for row in rows] == [
        (slug, name, kind, Decimal(price)) for slug, name, kind, price in CATALOG["PLUMBER"]
    ]
    assert [row["sort_order"] for row in rows] == list(range(1, 9))
    assert {row["currency"] for row in rows} == {"INR"}
    assert {row["trade"] for row in rows} == {"PLUMBER"}
    # Nothing is invented: artwork and copy stay empty until they are supplied.
    assert all(row["image_url"] is None and row["description"] is None and row["includes"] is None for row in rows)


def test_every_trade_lists_its_approved_count(client, catalog, requester_session):
    _account, headers = requester_session()
    for trade, count in APPROVED_COUNTS.items():
        response = client.get("/requester/services", headers=headers, params={"trade": trade.lower()})
        assert response.status_code == 200, response.text
        assert len(response.json()) == count, trade


def test_catalog_detail(client, catalog, requester_session):
    _account, headers = requester_session()
    response = client.get("/requester/services/PLUMBER/tap-repair", headers=headers)
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["service_name"] == "Tap Repair"
    assert row["trade"] == "PLUMBER"
    assert Decimal(row["price"]) == Decimal("299")
    assert row["service_kind"] == "SERVICE"
    assert row["currency"] == "INR"


def test_catalog_needs_a_requester_session(client, catalog):
    assert client.get("/requester/services", params={"trade": "PLUMBER"}).status_code == 401
    assert client.get("/requester/services/PLUMBER/tap-repair").status_code == 401


def test_an_unknown_trade_is_a_422_not_an_empty_list(client, catalog, requester_session):
    _account, headers = requester_session()
    assert client.get("/requester/services", headers=headers, params={"trade": "WELDER"}).status_code == 422
    assert client.get("/requester/services/WELDER/tap-repair", headers=headers).status_code == 422


def test_an_unknown_slug_is_a_404(client, catalog, requester_session):
    _account, headers = requester_session()
    assert client.get("/requester/services/PLUMBER/wall-inspection", headers=headers).status_code == 404


# ------------------------------------------------------------------- booking


def test_a_service_booking_carries_the_catalog_snapshot(client, connection, catalog, requester_session):
    _account, headers = requester_session()
    tap_repair = service_id(connection, "PLUMBER", "tap-repair")

    response = book(client, headers, "PLUMBER", service_id=str(tap_repair))
    assert response.status_code == 201, response.text
    booking = response.json()
    assert booking["service_id"] == str(tap_repair)
    assert booking["service_name"] == "Tap Repair"
    assert booking["service_kind"] == "SERVICE"
    assert Decimal(booking["quoted_amount"]) == Decimal("299")
    assert booking["currency"] == "INR"

    stored = connection.execute(
        text("SELECT catalog_service_id, service_kind, quoted_amount, currency FROM partner.bookings WHERE id = :id"),
        {"id": booking["id"]},
    ).one()
    assert stored == (tap_repair, "SERVICE", Decimal("299.00"), "INR")


def test_a_consultation_booking_is_marked_as_one(client, connection, catalog, requester_session):
    _account, headers = requester_session()
    response = book(client, headers, "PAINTER", service_id=str(service_id(connection, "PAINTER", "consultation")))
    assert response.status_code == 201, response.text
    assert response.json()["service_kind"] == "CONSULTATION"
    assert Decimal(response.json()["quoted_amount"]) == Decimal("199")


def test_a_client_cannot_set_the_price(client, connection, catalog, requester_session):
    _account, headers = requester_session()
    response = book(
        client,
        headers,
        "PLUMBER",
        service_id=str(service_id(connection, "PLUMBER", "tap-repair")),
        quoted_amount=1,
        price=1,
        currency="USD",
        service_kind="CONSULTATION",
    )
    assert response.status_code == 201, response.text
    booking = response.json()
    assert Decimal(booking["quoted_amount"]) == Decimal("299")
    assert booking["currency"] == "INR"
    assert booking["service_kind"] == "SERVICE"
    stored = connection.execute(
        text("SELECT quoted_amount, currency FROM partner.bookings WHERE id = :id"), {"id": booking["id"]}
    ).one()
    assert stored == (Decimal("299.00"), "INR")


def test_a_service_from_another_trade_is_refused(client, connection, catalog, requester_session):
    account_id, headers = requester_session()
    response = book(client, headers, "ELECTRICIAN", service_id=str(service_id(connection, "PLUMBER", "tap-repair")))
    assert response.status_code == 422, response.text
    assert booking_count(connection, account_id) == 0


def test_a_service_that_does_not_exist_is_refused(client, connection, catalog, requester_session):
    account_id, headers = requester_session()
    response = book(client, headers, "PLUMBER", service_id="00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404, response.text
    assert booking_count(connection, account_id) == 0


def test_a_retired_service_cannot_be_found_or_booked(client, connection, catalog, requester_session):
    account_id, headers = requester_session()
    tap_repair = service_id(connection, "PLUMBER", "tap-repair")
    connection.execute(text("UPDATE partner.catalog_services SET is_active = false WHERE id = :id"), {"id": tap_repair})

    listed = client.get("/requester/services", headers=headers, params={"trade": "PLUMBER"})
    assert listed.status_code == 200, listed.text
    assert "tap-repair" not in [row["slug"] for row in listed.json()]
    assert len(listed.json()) == 7

    assert client.get("/requester/services/PLUMBER/tap-repair", headers=headers).status_code == 404

    response = book(client, headers, "PLUMBER", service_id=str(tap_repair))
    assert response.status_code == 404, response.text
    assert booking_count(connection, account_id) == 0


def test_a_booking_keeps_the_price_it_was_made_at(client, connection, catalog, requester_session):
    _account, headers = requester_session()
    tap_repair = service_id(connection, "PLUMBER", "tap-repair")
    booking = book(client, headers, "PLUMBER", service_id=str(tap_repair)).json()

    connection.execute(text("UPDATE partner.catalog_services SET price = 999 WHERE id = :id"), {"id": tap_repair})
    current = client.get("/requester/services/PLUMBER/tap-repair", headers=headers).json()
    assert Decimal(current["price"]) == Decimal("999")

    reread = client.get(f"/requester/bookings/{booking['id']}", headers=headers)
    assert reread.status_code == 200, reread.text
    assert Decimal(reread.json()["quoted_amount"]) == Decimal("299")
    listed = client.get("/requester/bookings", headers=headers).json()
    assert [Decimal(row["quoted_amount"]) for row in listed if row["id"] == booking["id"]] == [Decimal("299")]


def test_a_booking_without_a_service_still_works(client, connection, catalog, requester_session):
    _account, headers = requester_session()
    response = book(client, headers, "PLUMBER", description="Kitchen")
    assert response.status_code == 201, response.text
    booking = response.json()
    assert booking["technician_type"] == "PLUMBER"
    assert booking["description"] == "Kitchen"
    for field in ("service_id", "service_name", "service_kind", "quoted_amount", "currency"):
        assert booking[field] is None, field
    stored = connection.execute(
        text("SELECT catalog_service_id, service_kind, quoted_amount, currency FROM partner.bookings WHERE id = :id"),
        {"id": booking["id"]},
    ).one()
    assert stored == (None, None, None, None)
