"""The catalog's technician checklist templates and how they reach new bookings.

Seeding runs inside the shared rolled-back transaction (the seed's commit is a
savepoint release there), so nothing written here survives a test. A database
without the catalog -- a fresh test database -- gets it loaded the same way first.
"""

import pytest
from legacy import bearer
from legacy_dispatch import HOME
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.seeds import seed_service_catalog
from app.seeds.seed_service_checklists import CHECKLISTS, MAX_STEPS, MAX_TITLE, MIN_STEPS, seed, validate


@pytest.fixture()
def session(connection):
    database = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
    if connection.execute(text("SELECT count(*) FROM partner.catalog_services")).scalar() < 32:
        seed_service_catalog.seed(database)
    yield database
    database.close()


def templates(connection):
    rows = connection.execute(
        text(
            "SELECT s.trade, s.slug, t.position, t.title, t.is_active FROM partner.catalog_service_checklist_steps t "
            "JOIN partner.catalog_services s ON s.id = t.catalog_service_id ORDER BY s.trade, s.slug, t.position"
        )
    ).all()
    grouped = {}
    for trade, slug, position, title, active in rows:
        grouped.setdefault((trade, slug), []).append((position, title, active))
    return grouped


def service_id(connection, trade, slug):
    return str(
        connection.execute(
            text("SELECT id FROM partner.catalog_services WHERE trade = :t AND slug = :s"), {"t": trade, "s": slug}
        ).scalar_one()
    )


# --------------------------------------------------------------- the data itself


def test_every_catalog_service_has_a_checklist_and_nothing_else_does():
    catalog = {(trade, slug) for trade, entries in seed_service_catalog.CATALOG.items() for slug, *_ in entries}
    assert len(catalog) == 32
    assert set(CHECKLISTS) == catalog
    validate()


@pytest.mark.parametrize("key", sorted(CHECKLISTS), ids=lambda key: "/".join(key))
def test_each_checklist_is_well_formed(key):
    steps = CHECKLISTS[key]
    assert MIN_STEPS <= len(steps) <= MAX_STEPS
    assert all(title.strip() == title and 0 < len(title) <= MAX_TITLE for title in steps)
    assert len({title.casefold() for title in steps}) == len(steps)


# ------------------------------------------------------------------ the seeding


def test_seeding_gives_all_32_services_their_active_sequential_steps(session, connection):
    report = seed(session)
    assert len(report) == 32
    assert {row[2] for row in report} <= {"created", "unchanged"}
    stored = templates(connection)
    assert set(stored) == set(CHECKLISTS)
    for key, rows in stored.items():
        assert [position for position, _title, _active in rows] == list(range(1, len(rows) + 1)), key
        assert all(active for _p, _t, active in rows), key
        assert [title for _p, title, _a in rows] == CHECKLISTS[key], key
    duplicates = connection.execute(
        text(
            "SELECT count(*) FROM (SELECT catalog_service_id, position FROM partner.catalog_service_checklist_steps GROUP BY 1, 2 HAVING count(*) > 1) d"
        )
    ).scalar()
    assert duplicates == 0


def test_seeding_twice_creates_nothing_more(session, connection):
    seed(session)
    count = connection.execute(text("SELECT count(*) FROM partner.catalog_service_checklist_steps")).scalar()
    second = seed(session)
    assert {row[2] for row in second} == {"unchanged"}
    assert connection.execute(text("SELECT count(*) FROM partner.catalog_service_checklist_steps")).scalar() == count


def test_a_checklist_edited_on_the_server_is_never_overwritten(session, connection):
    seed(session)
    sid = service_id(connection, "PLUMBER", "tap-repair")
    connection.execute(
        text(
            "UPDATE partner.catalog_service_checklist_steps SET title = 'Edited on the server' WHERE catalog_service_id = :s AND position = 2"
        ),
        {"s": sid},
    )
    report = {(row[0], row[1]): row[2] for row in seed(session)}
    assert report[("PLUMBER", "tap-repair")] == "kept"
    assert (
        connection.execute(
            text(
                "SELECT title FROM partner.catalog_service_checklist_steps WHERE catalog_service_id = :s AND position = 2"
            ),
            {"s": sid},
        ).scalar()
        == "Edited on the server"
    )


def test_a_dry_run_writes_nothing(session, connection):
    before = connection.execute(text("SELECT count(*) FROM partner.catalog_service_checklist_steps")).scalar()
    seed(session, apply=False)
    assert connection.execute(text("SELECT count(*) FROM partner.catalog_service_checklist_steps")).scalar() == before


def test_seeding_never_touches_bookings_services_or_their_steps(session, connection):
    fingerprint = lambda table: connection.execute(
        text(f"SELECT count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM partner.{table} x")
    ).one()
    before = {
        table: fingerprint(table)
        for table in ("catalog_services", "bookings", "booking_checklist_steps", "booking_media")
    }
    seed(session)
    assert {table: fingerprint(table) for table in before} == before


# ------------------------------------------------------------ reaching bookings


def test_a_new_booking_gets_the_checklist_and_keeps_it(client, session, connection, requester_session):
    seed(session)
    _account, headers = requester_session()
    booking = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PLUMBER",
            "service_id": service_id(connection, "PLUMBER", "pipe-leakage-repair"),
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        },
    )
    assert booking.status_code == 201, booking.text  # booking creation works as before
    assert booking.json()["service_name"] == "Pipe Leakage Repair"
    booking_id = booking.json()["id"]

    view = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    expected = CHECKLISTS[("PLUMBER", "pipe-leakage-repair")]
    assert [step["title"] for step in view["steps"]] == expected
    assert [step["position"] for step in view["steps"]] == list(range(1, len(expected) + 1))
    assert view["steps_completed"] == 0

    # A later edit to the template does not reach the booking's copy.
    connection.execute(
        text(
            "UPDATE partner.catalog_service_checklist_steps SET title = 'Changed later' "
            "WHERE catalog_service_id = :s AND position = 1"
        ),
        {"s": service_id(connection, "PLUMBER", "pipe-leakage-repair")},
    )
    again = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    assert again["steps"][0]["title"] == expected[0]


def test_a_consultation_booking_gets_the_assessment_checklist(client, session, connection, requester_session):
    seed(session)
    _account, headers = requester_session()
    booking = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "ELECTRICIAN",
            "service_id": service_id(connection, "ELECTRICIAN", "consultation"),
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        },
    )
    assert booking.status_code == 201, booking.text
    view = client.get(
        f"/requester/bookings/{booking.json()['id']}/execution", headers=bearer(headers["Authorization"].split()[1])
    )
    assert [step["title"] for step in view.json()["steps"]] == CHECKLISTS[("ELECTRICIAN", "consultation")]
