"""Technician work preferences (0011): chosen services, personal radius, working
hours -- and the dispatch filters and acceptance re-checks that honour them.

Every default is "no restriction", so these tests also prove that an account
that never sets a preference is offered exactly what it was offered before.
Everything runs inside the rolled-back test transaction, except the committed
concurrency test at the end, which only runs on a disposable database.
"""

import os
import threading
import time as clock
import uuid
from datetime import datetime, time

import pytest
from legacy import AREA_OF, bearer, new_password
from legacy_dispatch import AT_HOME, FAR, HOME, MID, NEAR, act, book, offer_ids, working
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.india_time import india_weekday_and_time, within_window
from app.core.runtime import settings
from app.database.types import naive_utc_now
from app.modules.bookings.dependencies import build_dispatch_service
from app.modules.identity.models import Technician
from app.modules.technicians.repository import TechnicianRepository

KM_IN_DEGREES = 1 / 111.195  # one km of latitude


def north(km):
    """A point `km` north of HOME (distance along a meridian is exact enough here)."""
    return (HOME[0] + km * KM_IN_DEGREES, HOME[1])


@pytest.fixture(autouse=True)
def global_rings(monkeypatch):
    """The production rings and batch size, whatever the environment says."""
    monkeypatch.setattr(settings, "technician_search_radius_km", 5.0)
    monkeypatch.setattr(settings, "technician_search_radius_step_km", 5.0)
    monkeypatch.setattr(settings, "technician_max_search_radius_km", 15.0)
    monkeypatch.setattr(settings, "dispatch_batch_size", 4)


@pytest.fixture()
def service(connection):
    """A live catalog service inside the rolled-back transaction."""

    def create(trade="PLUMBER", name=None, active=True):
        return str(
            connection.execute(
                text(
                    "INSERT INTO partner.catalog_services (trade, slug, service_name, service_kind, price, currency, sort_order, is_active) "
                    "VALUES (:trade, :slug, :name, 'SERVICE', 499, 'INR', 900, :active) RETURNING id"
                ),
                {
                    "trade": trade,
                    "slug": f"wp-{uuid.uuid4().hex[:8]}",
                    "name": name or f"WP {trade.title()} service",
                    "active": active,
                },
            ).scalar_one()
        )

    return create


def preferences(**overrides):
    body = {
        "offers_all_services": True,
        "service_ids": [],
        "service_radius_km": None,
        "working_schedule_enabled": False,
        "working_days": [],
    }
    body.update(overrides)
    return body


def save(client, auth, **overrides):
    return client.put(
        "/technicians/me/work-preferences", headers=bearer(auth["access_token"]), json=preferences(**overrides)
    )


def read(client, auth):
    return client.get("/technicians/me/work-preferences", headers=bearer(auth["access_token"]))


def book_service(client, headers, trade, service_id, at=HOME):
    response = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": trade,
            "service_id": service_id,
            "service_latitude": at[0],
            "service_longitude": at[1],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def window_around_now(minutes=60):
    """A same-day India window containing now, clipped to the day."""
    weekday, now = india_weekday_and_time(naive_utc_now())
    current = now.hour * 60 + now.minute
    start, end = max(0, current - minutes), current + minutes
    as_text = lambda total: f"{total // 60:02d}:{total % 60:02d}"
    # Past midnight the window runs to the end of the day (no overnight windows).
    return weekday, as_text(start), (None if end >= 24 * 60 else as_text(end))


def other_weekday(weekday):
    return weekday % 7 + 1


# ============================================================ defaults, legacy


def test_an_account_without_preferences_is_unrestricted(client, onboard):
    technician = working(client, onboard, "PLUMBER")
    body = read(client, technician).json()
    assert body["offers_all_services"] is True
    assert body["service_ids"] == []
    assert body["service_radius_km"] is None
    assert body["working_schedule_enabled"] is False
    assert [day["weekday"] for day in body["working_days"]] == [1, 2, 3, 4, 5, 6, 7]
    assert not any(day["working"] for day in body["working_days"])
    assert body["radius_choices_km"] == [2, 5, 10, 15] and body["timezone"] == "Asia/Kolkata"
    dashboard = client.get("/technicians/me/dashboard", headers=bearer(technician["access_token"])).json()
    assert (
        dashboard["service_radius_km"],
        dashboard["working_schedule_enabled"],
        dashboard["within_working_hours"],
    ) == (None, False, None)


def test_a_legacy_technician_is_offered_service_and_general_bookings(client, onboard, requester_session, service):
    technician = working(client, onboard, "PLUMBER", at=NEAR)
    _account, headers = requester_session()
    first = book_service(client, headers, "PLUMBER", service())
    assert first["id"] in offer_ids(client, technician)
    assert act(client, technician, first["id"], "decline").status_code == 200
    general = book(client, headers, "PLUMBER", at=HOME).json()  # no service_id
    assert general["id"] in offer_ids(client, technician)


# ================================================================ catalog access


def test_the_technician_catalog_is_their_own_trades_live_services(client, onboard, service):
    live = service("ELECTRICIAN", name="WP Fan Fitting")
    retired = service("ELECTRICIAN", name="WP Retired", active=False)
    other = service("PLUMBER")
    technician = working(client, onboard, "ELECTRICIAN")
    headers = bearer(technician["access_token"])
    ids = [item["id"] for item in client.get("/technicians/me/catalog", headers=headers).json()]
    assert live in ids and retired not in ids and other not in ids
    assert client.get("/technicians/me/catalog", headers=headers, params={"trade": "PLUMBER"}).status_code == 403
    assert client.get("/technicians/me/catalog").status_code == 401
    # The requester's catalog still needs a requester session.
    assert client.get("/requester/services", headers=headers, params={"trade": "ELECTRICIAN"}).status_code == 401


def test_a_registration_session_can_read_the_catalog_of_the_trade_being_chosen(client, onboard, service):
    live = service("CARPENTER")
    registration = onboard("CARPENTER", stop_after="aadhaar")
    response = client.get(
        "/technicians/me/catalog", headers=bearer(registration["access_token"]), params={"trade": "CARPENTER"}
    )
    assert response.status_code == 200 and live in [item["id"] for item in response.json()]
    # ...but not the dashboard's preference endpoints.
    assert (
        client.get("/technicians/me/work-preferences", headers=bearer(registration["access_token"])).status_code == 403
    )


# ===================================================================== validation


def test_preferences_are_validated_and_saved_as_a_whole(client, onboard, service):
    mine, also_mine, foreign, retired = (
        service("PLUMBER"),
        service("PLUMBER"),
        service("PAINTER"),
        service("PLUMBER", active=False),
    )
    technician = working(client, onboard, "PLUMBER")
    refused = {
        "radius not a step": dict(service_radius_km=7),
        "no service chosen": dict(offers_all_services=False, service_ids=[]),
        "another trade": dict(offers_all_services=False, service_ids=[mine, foreign]),
        "retired service": dict(offers_all_services=False, service_ids=[retired]),
        "unknown service": dict(offers_all_services=False, service_ids=[str(uuid.uuid4())]),
        "ends before it starts": dict(
            working_days=[{"weekday": 1, "working": True, "start_time": "18:00", "end_time": "09:00"}]
        ),
        "empty window": dict(
            working_days=[{"weekday": 1, "working": True, "start_time": "09:00", "end_time": "09:00"}]
        ),
        "no start": dict(working_days=[{"weekday": 1, "working": True, "start_time": None, "end_time": "18:00"}]),
        "two windows a day": dict(
            working_days=[
                {"weekday": 2, "working": True, "start_time": "09:00", "end_time": "12:00"},
                {"weekday": 2, "working": True, "start_time": "13:00", "end_time": "18:00"},
            ]
        ),
        "schedule with no day": dict(working_schedule_enabled=True, working_days=[{"weekday": 3, "working": False}]),
        "weekday 8": dict(working_days=[{"weekday": 8, "working": True, "start_time": "09:00"}]),
    }
    for label, body in refused.items():
        assert save(client, technician, **body).status_code == 422, label
    # Nothing half-saved by any refusal.
    assert read(client, technician).json()["offers_all_services"] is True

    days = [
        {"weekday": 1, "working": True, "start_time": "09:00", "end_time": "18:00"},
        {"weekday": 6, "working": True, "start_time": "10:00", "end_time": None},
    ]  # Saturday until midnight
    saved = save(
        client,
        technician,
        offers_all_services=False,
        service_ids=[mine, also_mine, mine],
        service_radius_km=10,
        working_schedule_enabled=True,
        working_days=days,
    )
    assert saved.status_code == 200, saved.text
    body = read(client, technician).json()
    assert sorted(body["service_ids"]) == sorted([mine, also_mine])
    assert body["service_radius_km"] == 10 and body["working_schedule_enabled"] is True
    by_day = {day["weekday"]: day for day in body["working_days"]}
    assert by_day[1] == {"weekday": 1, "working": True, "start_time": "09:00:00", "end_time": "18:00:00"}
    assert by_day[6]["end_time"] is None and by_day[7]["working"] is False

    # Back to "all services": the explicit rows go, the schedule stays stored while off.
    assert save(client, technician, working_schedule_enabled=False, working_days=days).status_code == 200
    body = read(client, technician).json()
    assert body["offers_all_services"] is True and body["service_ids"] == []
    assert body["working_schedule_enabled"] is False and body["working_days"][0]["working"] is True


def test_the_database_holds_the_same_rules(client, onboard, connection):
    technician = working(client, onboard, "PLUMBER")
    email = client.get("/auth/me", headers=bearer(technician["access_token"])).json()["email"]
    user_id = connection.execute(text("SELECT id FROM partner.technicians WHERE email = :e"), {"e": email}).scalar()
    for statement in (
        "UPDATE partner.technician_profiles SET service_radius_km = 7 WHERE technician_id = :u",
        "INSERT INTO partner.technician_working_hours (technician_id, weekday, start_time, end_time) VALUES (:u, 8, '09:00', '10:00')",
        "INSERT INTO partner.technician_working_hours (technician_id, weekday, start_time, end_time) VALUES (:u, 1, '10:00', '09:00')",
    ):
        savepoint = connection.begin_nested()
        with pytest.raises(Exception):
            connection.execute(text(statement), {"u": user_id})
        savepoint.rollback()
    assert technician  # the account itself is untouched


def test_registration_saves_preferences_on_the_details_step(client, onboard, service):
    mine = service("ELECTRICIAN")
    registration = onboard("ELECTRICIAN", stop_after="aadhaar")
    headers = bearer(registration["access_token"])
    base = {
        "name": "WP Electrician",
        "technician_type": "ELECTRICIAN",
        "address": "Door 4, Market Street",
        "pincode": "000405",
        "area": AREA_OF["000405"],
        "experience_years": 5,
        "is_available": True,
        "password": new_password(),
    }
    bad = client.post(
        "/onboarding/profile", headers=headers, json={**base, "work_preferences": preferences(service_radius_km=3)}
    )
    assert bad.status_code == 422  # the whole step is refused; nothing completed
    good = client.post(
        "/onboarding/profile",
        headers=headers,
        json={
            **base,
            "work_preferences": preferences(
                offers_all_services=False,
                service_ids=[mine],
                service_radius_km=10,
                working_schedule_enabled=True,
                working_days=[
                    {"weekday": day, "working": True, "start_time": "08:00", "end_time": "20:00"} for day in range(1, 8)
                ],
            ),
        },
    )
    assert good.status_code == 200, good.text
    login = client.post("/auth/login", json={"email": good.json()["email"], "password": base["password"]}).json()
    body = read(client, login).json()
    assert (
        body["service_ids"] == [mine] and body["service_radius_km"] == 10 and body["working_schedule_enabled"] is True
    )


def test_registration_without_preferences_keeps_the_defaults(client, onboard):
    technician = working(client, onboard, "PAINTER")  # the existing onboard helper sends none
    body = read(client, technician).json()
    assert (body["offers_all_services"], body["service_radius_km"], body["working_schedule_enabled"]) == (
        True,
        None,
        False,
    )


# ============================================================ service selection


def test_only_technicians_offering_the_service_are_offered_it(client, onboard, requester_session, service):
    wanted, other = service("PLUMBER"), service("PLUMBER")
    chose_it = working(client, onboard, "PLUMBER", at=AT_HOME)
    offers_all = working(client, onboard, "PLUMBER", at=NEAR)
    chose_other = working(client, onboard, "PLUMBER", at=NEAR)
    wrong_trade = working(client, onboard, "PAINTER", at=AT_HOME)
    assert save(client, chose_it, offers_all_services=False, service_ids=[wanted]).status_code == 200
    assert save(client, chose_other, offers_all_services=False, service_ids=[other]).status_code == 200
    _account, headers = requester_session()
    booking = book_service(client, headers, "PLUMBER", wanted)
    assert booking["id"] in offer_ids(client, chose_it)
    assert booking["id"] in offer_ids(client, offers_all)
    assert booking["id"] not in offer_ids(client, chose_other)
    assert booking["id"] not in offer_ids(client, wrong_trade)


def test_a_general_booking_ignores_service_selection(client, onboard, requester_session, service):
    technician = working(client, onboard, "PLUMBER", at=NEAR)
    assert save(client, technician, offers_all_services=False, service_ids=[service("PLUMBER")]).status_code == 200
    _account, headers = requester_session()
    general = book(client, headers, "PLUMBER", at=HOME).json()
    assert general["id"] in offer_ids(client, technician)


def test_a_pre_map_booking_is_not_dispatched_by_postal_area_any_more(
    client, onboard, requester_session, service, connection
):
    """There is one dispatch system, and it measures real distance. A booking made
    before the map existed has no point to measure from: retrying it says so
    instead of falling back to the retired PIN-code search."""
    working(client, onboard, "PLUMBER", at=None)
    _account, headers = requester_session()
    response = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PLUMBER",
            "service_id": service("PLUMBER"),
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        },
    )
    booking_id = response.json()["id"]
    connection.execute(
        text(
            "UPDATE partner.bookings SET service_latitude = NULL, service_longitude = NULL, status = 'NO_TECHNICIAN_FOUND' "
            "WHERE id = :b"
        ),
        {"b": booking_id},
    )
    refused = client.post(f"/requester/bookings/{booking_id}/retry", headers=headers)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "INVALID_LOCATION"


# ========================================================================= radius


def test_a_personal_radius_holds_even_when_the_rings_widen(client, onboard, requester_session):
    five_km = working(client, onboard, "CARPENTER", at=north(8))  # 8 km away, travels 5
    no_limit = working(client, onboard, "CARPENTER", at=north(9))  # 9 km away, no personal limit
    assert save(client, five_km, service_radius_km=5).status_code == 200
    _account, headers = requester_session()
    booking = book(client, headers, "CARPENTER", at=HOME).json()  # rings 2, 5 empty -> 10 km ring
    assert booking["id"] in offer_ids(client, no_limit)
    assert booking["id"] not in offer_ids(client, five_km)


@pytest.mark.parametrize("km, offered", [(4.9, True), (5.1, False)])
def test_the_radius_boundary(client, onboard, requester_session, km, offered):
    technician = working(client, onboard, "PAINTER", at=north(km))
    assert save(client, technician, service_radius_km=5).status_code == 200
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert (booking["id"] in offer_ids(client, technician)) is offered


def test_the_radius_is_applied_before_the_nearest_four(client, onboard, requester_session):
    # Four closer technicians who travel only 2 km sit at ~3 km, inside the 5 km
    # ring; one further one with no limit sits at 4 km. Filtering after the batch
    # limit would fill all four places with people who will not go.
    short_range = [working(client, onboard, "ELECTRICIAN", at=north(2.8 + index * 0.05)) for index in range(4)]
    for technician in short_range:
        assert save(client, technician, service_radius_km=2).status_code == 200
    willing = working(client, onboard, "ELECTRICIAN", at=north(4.0))
    _account, headers = requester_session()
    booking = book(client, headers, "ELECTRICIAN", at=HOME).json()
    assert booking["status"] != "NO_TECHNICIAN_FOUND"
    assert booking["id"] in offer_ids(client, willing)
    assert not any(booking["id"] in offer_ids(client, technician) for technician in short_range)


def test_rings_still_prefer_the_closest_ring(client, onboard, requester_session):
    """A full batch (4 here) inside the first (5 km) ring: the 10 km ring is never searched."""
    close = [working(client, onboard, "PAINTER", at=point) for point in (NEAR, MID, FAR, north(4))]
    further = working(client, onboard, "PAINTER", at=north(7))  # only the 10 km ring reaches it
    assert save(client, close[0], service_radius_km=15).status_code == 200
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert all(booking["id"] in offer_ids(client, technician) for technician in close)
    assert booking["id"] not in offer_ids(client, further)  # the wider ring was never needed


def test_the_search_widens_while_the_first_ring_cannot_fill_a_batch(client, onboard, requester_session):
    """Fewer than a batch nearby: the next ring is searched and both are ranked together."""
    close = working(client, onboard, "PAINTER", at=NEAR)
    further = working(client, onboard, "PAINTER", at=north(7))
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert booking["id"] in offer_ids(client, close) and booking["id"] in offer_ids(client, further)


# ================================================================== working hours


def test_india_time_and_windows():
    assert india_weekday_and_time(datetime(2026, 9, 27, 18, 29, 59)) == (7, time(23, 59, 59))  # Sunday, India
    assert india_weekday_and_time(datetime(2026, 9, 27, 18, 30)) == (1, time(0, 0))  # Monday 00:00, India
    assert india_weekday_and_time(datetime(2026, 9, 28, 3, 30)) == (1, time(9, 0))
    assert within_window(time(9), time(18), time(9)) is True  # start included
    assert within_window(time(9), time(18), time(18)) is False  # end excluded
    assert within_window(time(9), None, time(23, 59, 59)) is True  # until the end of the day
    assert within_window(time(9), time(18), time(8, 59, 59)) is False


def test_the_schedule_filter_in_sql_matches_india_time(client, onboard, connection):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    assert (
        save(
            client,
            technician,
            working_schedule_enabled=True,
            working_days=[
                {"weekday": 1, "working": True, "start_time": "09:00", "end_time": "18:00"},
                {"weekday": 6, "working": True, "start_time": "10:00", "end_time": None},
            ],
        ).status_code
        == 200
    )
    session = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
    repository = TechnicianRepository(session)
    user_id = (
        session.query(Technician.id)
        .filter(Technician.email == client.get("/auth/me", headers=bearer(technician["access_token"])).json()["email"])
        .scalar()
    )

    def offered_at(utc):
        found = repository.eligible_near(
            "PLUMBER",
            latitude=HOME[0],
            longitude=HOME[1],
            radius_meters=2000,
            exclude_ids=(),
            now=utc,
            stale_threshold_seconds=10**9,
            limit=50,
        )
        return any(candidate.technician.id == user_id for candidate in found)

    # Monday 28 Sep 2026 in India; UTC = India - 05:30.
    assert offered_at(datetime(2026, 9, 28, 3, 29, 59)) is False  # 08:59:59 India
    assert offered_at(datetime(2026, 9, 28, 3, 30)) is True  # 09:00 India, start included
    assert offered_at(datetime(2026, 9, 28, 12, 29, 59)) is True  # 17:59:59 India
    assert offered_at(datetime(2026, 9, 28, 12, 30)) is False  # 18:00 India, end excluded
    assert offered_at(datetime(2026, 9, 29, 5, 0)) is False  # Tuesday: a day off
    assert offered_at(datetime(2026, 10, 3, 18, 29, 59)) is True  # Saturday 23:59:59, open-ended
    assert offered_at(datetime(2026, 10, 3, 18, 30)) is False  # Sunday 00:00: a day off
    session.close()


def test_working_hours_decide_who_is_offered_now(client, onboard, requester_session):
    weekday, start, end = window_around_now()
    on_shift = working(client, onboard, "PLUMBER", at=AT_HOME)
    off_today = working(client, onboard, "PLUMBER", at=NEAR)
    no_schedule = working(client, onboard, "PLUMBER", at=NEAR)
    assert (
        save(
            client,
            on_shift,
            working_schedule_enabled=True,
            working_days=[{"weekday": weekday, "working": True, "start_time": start, "end_time": end}],
        ).status_code
        == 200
    )
    assert (
        save(
            client,
            off_today,
            working_schedule_enabled=True,
            working_days=[
                {"weekday": other_weekday(weekday), "working": True, "start_time": "00:00", "end_time": None}
            ],
        ).status_code
        == 200
    )
    dashboard = lambda auth: client.get("/technicians/me/dashboard", headers=bearer(auth["access_token"])).json()[
        "within_working_hours"
    ]
    assert (dashboard(on_shift), dashboard(off_today), dashboard(no_schedule)) == (True, False, None)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HOME).json()
    assert booking["id"] in offer_ids(client, on_shift)
    assert booking["id"] in offer_ids(client, no_schedule)
    assert booking["id"] not in offer_ids(client, off_today)


def test_unavailable_always_wins_over_the_schedule(client, onboard, requester_session):
    weekday, start, end = window_around_now()
    technician = working(client, onboard, "PAINTER", at=NEAR)
    assert (
        save(
            client,
            technician,
            working_schedule_enabled=True,
            working_days=[{"weekday": weekday, "working": True, "start_time": start, "end_time": end}],
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert booking["id"] not in offer_ids(client, technician)
    # And a shift never switches availability by itself.
    assert client.get("/auth/me", headers=bearer(technician["access_token"])).json()["is_available"] is False


# ====================================================== acceptance re-validation


def _offered(client, onboard, requester_session, trade="PLUMBER", service_id=None, second=False):
    first = working(client, onboard, trade, at=AT_HOME)
    other = working(client, onboard, trade, at=NEAR) if second else None
    _account, headers = requester_session()
    booking = (
        book_service(client, headers, trade, service_id) if service_id else book(client, headers, trade, at=HOME).json()
    )
    assert booking["id"] in offer_ids(client, first)
    return first, other, booking["id"], headers


def _offer_status(connection, booking_id, auth, client):
    email = client.get("/auth/me", headers=bearer(auth["access_token"])).json()["email"]
    return connection.execute(
        text(
            "SELECT a.status FROM partner.booking_offers a JOIN partner.technicians u ON u.id = a.technician_id "
            "WHERE a.booking_id = :b AND u.email = :e"
        ),
        {"b": booking_id, "e": email},
    ).scalar()


def _holder(connection, booking_id):
    return connection.execute(
        text("SELECT status, technician_id FROM partner.bookings WHERE id = :b"), {"b": booking_id}
    ).one()


def test_going_unavailable_after_the_offer_blocks_accepting_it(client, onboard, requester_session, connection):
    """The change lands between the offer and the tap (another device, a race the
    API's own withdrawal did not see): the acceptance re-check still refuses."""
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    email = client.get("/auth/me", headers=bearer(technician["access_token"])).json()["email"]
    connection.execute(
        text(
            "UPDATE partner.technician_profiles SET work_status = 'OFFLINE' "
            "WHERE technician_id = (SELECT id FROM partner.technicians WHERE email = :e)"
        ),
        {"e": email},
    )
    refused = act(client, technician, booking_id, "accept")
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "NOT_ELIGIBLE"
    assert "unavailable" in refused.json()["detail"]["message"]
    assert _offer_status(connection, booking_id, technician, client) == "CANCELLED"
    status, holder = _holder(connection, booking_id)
    assert holder is None and status in ("OFFERED", "NO_TECHNICIAN_FOUND")


def test_going_offline_withdraws_pending_offers_at_once(client, onboard, requester_session, connection):
    """No booking waits out a 30 second timeout on somebody who just stepped away."""
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    assert _offer_status(connection, booking_id, technician, client) == "CANCELLED"
    assert (
        connection.execute(
            text("SELECT status_reason FROM partner.booking_offers WHERE booking_id = :b"), {"b": booking_id}
        ).scalar()
        == "TECHNICIAN_UNAVAILABLE"
    )
    assert _holder(connection, booking_id)[0] == "NO_TECHNICIAN_FOUND"  # nobody else nearby
    refused = act(client, technician, booking_id, "accept")
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "OFFER_NO_LONGER_AVAILABLE"


def test_dropping_the_service_after_the_offer_blocks_accepting_it(
    client, onboard, requester_session, service, connection
):
    wanted = service("PLUMBER")
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session, service_id=wanted)
    assert save(client, technician, offers_all_services=False, service_ids=[service("PLUMBER")]).status_code == 200
    refused = act(client, technician, booking_id, "accept")
    assert refused.status_code == 409 and "no longer offer this service" in refused.json()["detail"]["message"]
    assert _holder(connection, booking_id)[1] is None


def test_identity_rejected_after_the_offer_blocks_accepting_it(client, onboard, requester_session, connection):
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    email = client.get("/auth/me", headers=bearer(technician["access_token"])).json()["email"]
    connection.execute(
        text(
            "UPDATE partner.technician_identity_verifications SET face_status = 'FAILED' "
            "WHERE technician_id = (SELECT id FROM partner.technicians WHERE email = :e)"
        ),
        {"e": email},
    )
    # A failed face check already sends the account back through registration, so
    # the route itself refuses (403) before the re-check; either way nobody is assigned.
    assert act(client, technician, booking_id, "accept").status_code in (403, 409)
    assert _holder(connection, booking_id)[1] is None


def test_identity_rules_tightened_after_the_offer_block_accepting_it(
    client, onboard, requester_session, connection, monkeypatch
):
    # Offered while PENDING review was allowed; then only VERIFIED identities may work.
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    monkeypatch.setattr(settings, "require_verified_identity_for_jobs", True)
    refused = act(client, technician, booking_id, "accept")
    assert refused.status_code == 409 and "Face verification is required" in refused.json()["detail"]["message"]
    assert _offer_status(connection, booking_id, technician, client) == "CANCELLED"
    assert _holder(connection, booking_id)[1] is None


def test_a_suspended_technician_cannot_accept(client, onboard, requester_session, connection):
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    email = client.get("/auth/me", headers=bearer(technician["access_token"])).json()["email"]
    connection.execute(text("UPDATE partner.technicians SET status = 'SUSPENDED' WHERE email = :e"), {"e": email})
    assert act(client, technician, booking_id, "accept").status_code in (401, 403)
    assert _holder(connection, booking_id)[1] is None


def test_the_next_technician_gets_the_job_after_a_refused_acceptance(client, onboard, requester_session, connection):
    technician, other, booking_id, _headers = _offered(client, onboard, requester_session, second=True)
    assert booking_id in offer_ids(client, other)  # both were offered at once
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    assert act(client, technician, booking_id, "accept").status_code == 409
    won = act(client, other, booking_id, "accept")
    assert won.status_code == 200, won.text
    assert _holder(connection, booking_id)[0] == "ACCEPTED"
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.booking_offers WHERE booking_id = :b AND status = 'ACCEPTED'"),
            {"b": booking_id},
        ).scalar()
        == 1
    )


def test_a_refused_acceptance_with_nobody_left_redispatches(client, onboard, requester_session, connection):
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    newcomer = working(client, onboard, "PLUMBER", at=NEAR)  # appears after the first batch
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    assert act(client, technician, booking_id, "accept").status_code == 409
    assert booking_id in offer_ids(client, newcomer)  # moved on, exactly like a decline


def test_radius_schedule_and_location_are_not_rechecked_in_the_offer_window(
    client, onboard, requester_session, connection
):
    technician, _other, booking_id, _headers = _offered(client, onboard, requester_session)
    weekday, _start, _end = window_around_now()
    assert (
        save(
            client,
            technician,
            service_radius_km=2,
            working_schedule_enabled=True,
            working_days=[
                {"weekday": other_weekday(weekday), "working": True, "start_time": "00:00", "end_time": None}
            ],
        ).status_code
        == 200
    )
    connection.execute(
        text(
            "UPDATE partner.technician_locations SET last_location_at = last_location_at - interval '1 day' WHERE technician_id = "
            "(SELECT technician_id FROM partner.booking_offers WHERE booking_id = :b LIMIT 1)"
        ),
        {"b": booking_id},
    )
    accepted = act(client, technician, booking_id, "accept")
    assert accepted.status_code == 200, accepted.text
    assert _holder(connection, booking_id)[0] == "ACCEPTED"


def test_losing_the_race_is_still_reported_as_taken(client, onboard, requester_session):
    technician, other, booking_id, _headers = _offered(client, onboard, requester_session, second=True)
    assert act(client, other, booking_id, "accept").status_code == 200
    # The loser is told it was taken -- the re-check never runs for a booking already held.
    lost = act(client, technician, booking_id, "accept")
    assert lost.status_code == 409 and "already" in lost.json()["detail"]["message"].lower()


# ============================================= committed concurrency (disposable DB)


@pytest.mark.skipif(
    os.environ.get("PARTNER_TEST_COMMITTED_CONCURRENCY") != "1",
    reason="needs committed rows on a disposable test database (PARTNER_TEST_COMMITTED_CONCURRENCY=1)",
)
def test_an_availability_change_racing_an_acceptance_is_never_bypassed():
    """Real transactions on separate connections. One connection turns the
    technician unavailable and holds that change uncommitted; the acceptance,
    which takes the booking lock and then the profile lock, must wait for it and
    then refuse. Two eligible rivals racing still produce exactly one winner."""
    from app.database.session import engine

    marker = uuid.uuid4().hex[:10]
    ids = {"technicians": []}

    def technician_row(c, suffix, latitude):
        user = c.execute(
            text(
                "INSERT INTO partner.technicians (email, phone, status, onboarding_completed_at, pincode, area, district, state) "
                "VALUES (:e, '9876543210', 'ACTIVE', now(), '000405', 'Alpha Main', 'Alpha District', 'Test State') RETURNING id"
            ),
            {"e": f"wp-race-{suffix}-{marker}@example.com"},
        ).scalar_one()
        c.execute(
            text(
                "INSERT INTO partner.technician_profiles (technician_id, technician_type, work_status) VALUES (:u, 'PLUMBER', 'AVAILABLE')"
            ),
            {"u": user},
        )
        c.execute(
            text(
                "INSERT INTO partner.technician_identity_verifications (technician_id, face_status, aadhaar_status) VALUES (:u, 'VERIFIED', 'VERIFIED')"
            ),
            {"u": user},
        )
        ids["technicians"].append(user)
        return user

    with engine.begin() as c:
        ids["owner"] = c.execute(
            text(
                "INSERT INTO partner.v_partner_requesters (name, email, phone, password_hash, role, status, address, pincode, location, "
                "country_of_residence, rating, created_at) VALUES ('WP Race Owner', :e, :p, 'x', 'OWNER', 'ACTIVE', '1 Road', '000405', "
                "'Alpha Main', 'India', 0, now()) RETURNING id"
            ),
            {"e": f"wp-race-{marker}@example.com", "p": "6" + marker[:9].translate(str.maketrans("abcdef", "123456"))},
        ).scalar_one()
        racer, rival_a, rival_b = (
            technician_row(c, "racer", 17.45),
            technician_row(c, "a", 17.45),
            technician_row(c, "b", 17.45),
        )

        def booking_with_offers(technicians):
            booking = c.execute(
                text(
                    "INSERT INTO partner.bookings (requested_by_user_id, requested_by_role, technician_type, service_address, "
                    "pincode, status, service_latitude, service_longitude, assigned_at, dispatch_attempts) "
                    "VALUES (:o, 'OWNER', 'PLUMBER', '1 Road', '000405', 'OFFERED', 17.4483, 78.3915, now(), 1) RETURNING id"
                ),
                {"o": ids["owner"]},
            ).scalar_one()
            for technician in technicians:
                c.execute(
                    text(
                        "INSERT INTO partner.booking_offers (booking_id, technician_id, status, match_type, "
                        "distance_meters, offered_at, expires_at) VALUES (:b, :t, 'OFFERED', 'NEARBY', 100, "
                        "now(), now() + interval '5 minutes')"
                    ),
                    {"b": booking, "t": technician},
                )
            return booking

        ids["solo"] = booking_with_offers([racer])
        ids["contest"] = booking_with_offers([rival_a, rival_b])

    def accept(technician_id, booking_id, outcomes, barrier=None):
        with Session(engine) as session:
            service = build_dispatch_service(session)
            user = session.get(Technician, technician_id)
            if barrier:
                barrier.wait()
            try:
                service.answer_offer(user, booking_id, True)
                outcomes.append(("accepted", technician_id))
            except Exception as error:  # HTTPException
                session.rollback()
                outcomes.append((getattr(error, "status_code", repr(error)), technician_id))

    try:
        # 1. An uncommitted "go unavailable" holds the profile row; the acceptance waits, then refuses.
        outcomes = []
        with engine.connect() as holder:
            transaction = holder.begin()
            holder.execute(
                text("UPDATE partner.technician_profiles SET work_status = 'OFFLINE' WHERE technician_id = :u"),
                {"u": racer},
            )
            thread = threading.Thread(target=accept, args=(racer, ids["solo"], outcomes))
            thread.start()
            clock.sleep(1.0)
            assert thread.is_alive(), "the acceptance must wait for the profile change in flight"
            transaction.commit()
            thread.join(timeout=30)
        assert outcomes == [(409, racer)]
        with engine.connect() as c:
            assert (
                c.execute(text("SELECT technician_id FROM partner.bookings WHERE id = :b"), {"b": ids["solo"]}).scalar()
                is None
            )

        # 2. Two eligible rivals at once: exactly one wins.
        outcomes = []
        barrier = threading.Barrier(2)
        threads = [
            threading.Thread(target=accept, args=(rival, ids["contest"], outcomes, barrier))
            for rival in (rival_a, rival_b)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert sorted(str(outcome[0]) for outcome in outcomes) == ["409", "accepted"]
        with engine.connect() as c:
            assert (
                c.execute(
                    text("SELECT count(*) FROM partner.booking_offers WHERE booking_id = :b AND status = 'ACCEPTED'"),
                    {"b": ids["contest"]},
                ).scalar()
                == 1
            )
    finally:
        with engine.begin() as c:  # exactly what this test created, children first
            for booking in (ids.get("solo"), ids.get("contest")):
                if booking:
                    c.execute(text("DELETE FROM partner.booking_offers WHERE booking_id = :b"), {"b": booking})
                    c.execute(text("DELETE FROM partner.bookings WHERE id = :b"), {"b": booking})
            for technician in ids["technicians"]:
                c.execute(
                    text("DELETE FROM partner.technician_identity_verifications WHERE technician_id = :u"),
                    {"u": technician},
                )
                c.execute(text("DELETE FROM partner.technician_profiles WHERE technician_id = :u"), {"u": technician})
                c.execute(text("DELETE FROM partner.technicians WHERE id = :u"), {"u": technician})
            if ids.get("owner"):
                c.execute(text("DELETE FROM partner.v_partner_requesters WHERE id = :o"), {"o": ids["owner"]})
