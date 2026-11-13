"""Production dispatch: eligibility, ranking, batches, first-valid-acceptance, recovery,
live location rules, the sweeper and cross-process realtime.

The ten scenarios the dispatch requirements name are marked "Scenario n". Everything
runs through the real API against the real `partner` schema inside the rolled-back
transaction from conftest; the committed multi-connection race at the end needs a
disposable database (PARTNER_TEST_COMMITTED_CONCURRENCY=1).
"""

import logging
import os
import threading
import time
import uuid
from datetime import timedelta

import pytest
from conftest import REQUESTERS_STAND_IN
from legacy import bearer, technician_cookie
from legacy_dispatch import (
    AT_HOME,
    FAR,
    HOME,
    MID,
    NEAR,
    act,
    arrive,
    book,
    code_of,
    lapse_offers,
    north_of,
    offer_ids,
    working,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.database.types import naive_utc_now
from app.modules.bookings.models import STATUS_ARRIVED, STATUS_COMPLETED, InvalidTransition, ServiceRequest


def offers_of(connection, booking_id):
    return (
        connection.execute(
            text(
                "SELECT technician_id::text AS technician, status, status_reason, rank, score, score_breakdown, batch_number, "
                "dispatch_round, distance_meters FROM partner.booking_offers WHERE booking_id = :b "
                "ORDER BY batch_number, rank"
            ),
            {"b": booking_id},
        )
        .mappings()
        .all()
    )


def booking_row(connection, booking_id):
    return (
        connection.execute(
            text(
                "SELECT status, technician_id::text AS technician, dispatch_round, dispatch_attempts "
                "FROM partner.bookings WHERE id = :b"
            ),
            {"b": booking_id},
        )
        .mappings()
        .one()
    )


def user_id(auth):
    return auth["user"]["id"]


def locate(client, auth, point, **extra):
    return client.post(
        "/technicians/me/location",
        headers=bearer(auth["access_token"]),
        json={"latitude": point[0], "longitude": point[1], "accuracy": 8, **extra},
    )


def make_stale(connection, auth, seconds=60):
    connection.execute(
        text("UPDATE partner.technician_locations SET last_location_at = :at WHERE technician_id = :t"),
        {"at": naive_utc_now() - timedelta(seconds=seconds), "t": user_id(auth)},
    )


# ===================================================================== eligibility


def test_scenario_1_only_eligible_plumbers_are_considered_out_of_twenty(
    client, connection, onboard, requester_session, caplog
):
    """Twenty technicians around one customer. Twelve are eligible plumbers; the
    rest are offline, paused, stale, suspended or the wrong trade."""
    caplog.set_level(logging.INFO, logger="app.modules.bookings.dispatch_service")
    # Registering twenty accounts takes longer than the stale threshold, so each
    # one is placed afterwards -- the way every working phone keeps reporting.
    spots = {}
    eligible = [onboard("PLUMBER") for _ in range(12)]
    for index, technician in enumerate(eligible):
        spots[user_id(technician)] = north_of(HOME, 0.3 + index * 0.35)
    offline = [onboard("PLUMBER", available=False) for _ in range(2)]
    stale = [onboard("PLUMBER") for _ in range(2)]
    wrong_trade = [onboard("PAINTER") for _ in range(2)]
    paused, suspended = onboard("PLUMBER"), onboard("PLUMBER")
    excluded = [*offline, *stale, *wrong_trade, paused, suspended]
    assert len(eligible) + len(excluded) == 20
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(paused["access_token"]), json={"status": "PAUSED"}
        ).json()["work_status"]
        == "PAUSED"
    )
    connection.execute(
        text("UPDATE partner.technicians SET status = 'SUSPENDED' WHERE id = :u"), {"u": user_id(suspended)}
    )
    for technician in [*eligible, *offline, *stale, *wrong_trade, paused]:
        assert locate(client, technician, spots.get(user_id(technician), north_of(HOME, 0.1))).status_code == 200
    for technician in stale:
        make_stale(connection, technician)
    # The suspended account's phone can no longer report at all; give it a fresh
    # position directly, so only the suspension can be what excludes it.
    connection.execute(
        text(
            "INSERT INTO partner.technician_locations (technician_id, latitude, longitude, accuracy, "
            "last_location_at) VALUES (:t, :lat, :lng, 8, :now)"
        ),
        {"t": user_id(suspended), "lat": HOME[0] + 0.001, "lng": HOME[1], "now": naive_utc_now()},
    )

    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", description="Kitchen").json()
    assert booking["status"] == "OFFERED"

    offered = offers_of(connection, booking["id"])
    assert len(offered) == settings.dispatch_batch_size == 3, "controlled dispatch: never all twenty"
    eligible_ids = {user_id(technician) for technician in eligible}
    assert {offer["technician"] for offer in offered} <= eligible_ids
    assert not {offer["technician"] for offer in offered} & {user_id(technician) for technician in excluded}
    assert [offer["rank"] for offer in offered] == [1, 2, 3]
    # The pool the ranking saw was exactly the twelve eligible plumbers.
    candidates = [
        record.getMessage() for record in caplog.records if record.getMessage().startswith("dispatch.candidates")
    ]
    assert candidates and "count=12" in candidates[0]


def test_scenario_2_the_nearest_plumber_offline_is_excluded(client, connection, onboard, requester_session):
    nearest = working(client, onboard, "PLUMBER", at=north_of(HOME, 0.1))
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(nearest["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    next_one = working(client, onboard, "PLUMBER", at=MID)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert offer_ids(client, nearest) == []
    assert offer_ids(client, next_one) == [booking["id"]]
    # Going OFFLINE with no job also forgot where they were.
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.technician_locations WHERE technician_id = :t"), {"t": user_id(nearest)}
        ).scalar()
        == 0
    )


def test_scenario_3_the_nearest_plumber_with_a_stale_location_is_excluded(
    client, connection, onboard, requester_session
):
    nearest = working(client, onboard, "PLUMBER", at=north_of(HOME, 0.1))
    make_stale(connection, nearest, seconds=settings.location_stale_threshold_seconds + 5)
    fresh = working(client, onboard, "PLUMBER", at=FAR)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert offer_ids(client, nearest) == [] and offer_ids(client, fresh) == [booking["id"]]

    presence = client.get("/technicians/me/presence", headers=bearer(nearest["access_token"])).json()
    assert presence["dispatch_status"] == "LOCATION_STALE" and presence["location_fresh"] is False
    assert presence["ready_for_nearby_jobs"] is False


def test_the_stale_threshold_is_configuration(client, connection, onboard, requester_session, monkeypatch):
    technician = working(client, onboard, "PLUMBER", at=NEAR)
    make_stale(connection, technician, seconds=40)
    monkeypatch.setattr(settings, "location_stale_threshold_seconds", 60)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert offer_ids(client, technician) == [booking["id"]]


def test_a_technician_on_a_job_or_holding_an_offer_is_not_offered_another(client, onboard, requester_session):
    technician = working(client, onboard, "CARPENTER", at=NEAR)
    _a, first_headers = requester_session()
    _b, second_headers = requester_session()
    first = book(client, first_headers, "CARPENTER").json()
    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert presence["dispatch_status"] == "OFFERED"
    assert book(client, second_headers, "CARPENTER").json()["status"] == "NO_TECHNICIAN_FOUND"

    assert act(client, technician, first["id"], "accept").status_code == 200
    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert presence["dispatch_status"] == "ON_JOB" and presence["tracking_required"] is True
    _c, third_headers = requester_session()
    assert book(client, third_headers, "CARPENTER").json()["status"] == "NO_TECHNICIAN_FOUND"


# ======================================================================== ranking


def test_the_nearest_technician_does_not_simply_win(client, connection, onboard, requester_session, monkeypatch):
    """0.8 km with no experience against 1.0 km with fifteen years: 200 m is worth
    less than the experience gap, so the further technician ranks first."""
    monkeypatch.setattr(settings, "dispatch_batch_size", 1)
    nearest = working(client, onboard, "ELECTRICIAN", at=NEAR, experience_years=0)
    veteran = working(client, onboard, "ELECTRICIAN", at=north_of(HOME, 1.0), experience_years=15)
    _account, headers = requester_session()
    booking = book(client, headers, "ELECTRICIAN").json()
    assert offer_ids(client, veteran) == [booking["id"]] and offer_ids(client, nearest) == []

    offer = offers_of(connection, booking["id"])[0]
    breakdown = offer["score_breakdown"]
    assert (
        breakdown["scores"]["experience"] == 1.0 and breakdown["inputs"]["proximity_basis"] == "straight_line_distance"
    )
    assert set(breakdown["weights"]) == {
        "distance",
        "rating",
        "availability",
        "acceptance",
        "completion",
        "cancellation",
        "experience",
        "fairness",
    }
    assert offer["score"] == pytest.approx(
        sum(breakdown["scores"][k] * breakdown["weights"][k] for k in breakdown["scores"]), abs=1e-3
    )


def test_every_offer_records_why_it_was_made(client, connection, onboard, requester_session):
    working(client, onboard, "PAINTER", at=NEAR)
    working(client, onboard, "PAINTER", at=MID)
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()
    for offer in offers_of(connection, booking["id"]):
        assert offer["rank"] >= 1 and 0 <= offer["score"] <= 1
        assert offer["batch_number"] == 1 and offer["dispatch_round"] == 1
        assert offer["distance_meters"] > 0 and offer["score_breakdown"]["inputs"]["distance_meters"] > 0


# ============================================================ one winner, enforced


def test_scenario_4_simultaneous_acceptances_produce_exactly_one_assignment(
    client, connection, onboard, requester_session
):
    racers = [working(client, onboard, "PAINTER", at=point) for point in (AT_HOME, NEAR, MID)]
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()
    answers = [act(client, racer, booking["id"], "accept") for racer in racers]
    assert sorted(answer.status_code for answer in answers) == [200, 409, 409]
    assert {code_of(answer) for answer in answers if answer.status_code == 409} == {"REQUEST_ALREADY_ASSIGNED"}
    statuses = sorted(offer["status"] for offer in offers_of(connection, booking["id"]))
    assert statuses == ["ACCEPTED", "LOST_RACE", "LOST_RACE"]
    assert booking_row(connection, booking["id"])["status"] == "ACCEPTED"


def test_the_database_itself_refuses_a_second_winner(client, connection, onboard, requester_session):
    """Whatever the application does, PostgreSQL will not hold two accepted offers
    for one booking, nor two active jobs for one technician."""
    first = working(client, onboard, "PAINTER", at=NEAR)
    second = working(client, onboard, "PAINTER", at=MID)
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()
    assert act(client, first, booking["id"], "accept").status_code == 200

    savepoint = connection.begin_nested()
    with pytest.raises(IntegrityError):
        connection.execute(
            text("UPDATE partner.booking_offers SET status = 'ACCEPTED' WHERE booking_id = :b AND technician_id = :t"),
            {"b": booking["id"], "t": user_id(second)},
        )
    savepoint.rollback()

    _other, other_headers = requester_session()
    other = book(client, other_headers, "PAINTER").json()  # goes to `second`, who is free
    savepoint = connection.begin_nested()
    with pytest.raises(IntegrityError):
        connection.execute(
            text("UPDATE partner.bookings SET status = 'ACCEPTED', technician_id = :t WHERE id = :b"),
            {"b": other["id"], "t": user_id(first)},
        )
    savepoint.rollback()


def test_the_state_machine_refuses_impossible_steps():
    booking = ServiceRequest(status=STATUS_ARRIVED)
    with pytest.raises(InvalidTransition):
        booking.transition(STATUS_COMPLETED)  # ARRIVED -> COMPLETED skips the work
    booking.transition("IN_PROGRESS")
    assert booking.status == "IN_PROGRESS"
    for terminal in ("COMPLETED", "CANCELLED"):
        with pytest.raises(InvalidTransition):
            ServiceRequest(status=terminal).transition("SEARCHING")


# =========================================================== rejection and timeout


def test_scenario_5_a_rejection_sends_the_offer_to_the_next_candidate(
    client, connection, onboard, requester_session, monkeypatch
):
    monkeypatch.setattr(settings, "dispatch_batch_size", 1)
    first = working(client, onboard, "PLUMBER", at=NEAR, experience_years=10)
    second = working(client, onboard, "PLUMBER", at=MID, experience_years=0)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert offer_ids(client, first) == [booking["id"]] and offer_ids(client, second) == []

    assert act(client, first, booking["id"], "decline").json()["outcome"] == "DECLINED"
    assert offer_ids(client, second) == [booking["id"]]
    offers = offers_of(connection, booking["id"])
    assert [(offer["status"], offer["batch_number"]) for offer in offers] == [("REJECTED", 1), ("OFFERED", 2)]
    assert booking_row(connection, booking["id"])["dispatch_attempts"] == 2


def test_scenario_6_an_unanswered_offer_expires_and_the_next_batch_goes(
    client, connection, onboard, requester_session, sweep, monkeypatch
):
    monkeypatch.setattr(settings, "dispatch_batch_size", 1)
    slow = working(client, onboard, "PLUMBER", at=NEAR, experience_years=10)
    backup = working(client, onboard, "PLUMBER", at=MID, experience_years=0)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert offer_ids(client, slow) == [booking["id"]]

    lapse_offers(connection, booking["id"])
    counts = sweep()
    assert counts["expired_offers"] == 1
    assert offer_ids(client, slow) == [] and offer_ids(client, backup) == [booking["id"]]
    assert [offer["status"] for offer in offers_of(connection, booking["id"])] == ["EXPIRED", "OFFERED"]
    late = act(client, slow, booking["id"], "accept")
    assert late.status_code == 409 and code_of(late) == "OFFER_EXPIRED"


def test_max_dispatch_attempts_ends_the_round_as_expired(
    client, connection, onboard, requester_session, sweep, monkeypatch
):
    monkeypatch.setattr(settings, "dispatch_batch_size", 1)
    monkeypatch.setattr(settings, "max_dispatch_attempts", 2)
    technicians = [working(client, onboard, "PAINTER", at=point) for point in (NEAR, MID, FAR)]
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()
    for _ in range(2):
        lapse_offers(connection, booking["id"])
        sweep()
    final = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert (final["status"], final["can_retry"], final["dispatch_attempts"]) == ("EXPIRED", True, 2)
    assert "accepted your request in time" in final["message"]
    # Only two of the three were ever asked.
    assert len(offers_of(connection, booking["id"])) == 2

    retried = client.post(f"/requester/bookings/{booking['id']}/retry", headers=headers).json()
    assert retried["status"] == "OFFERED"
    row = booking_row(connection, booking["id"])
    assert (row["dispatch_round"], row["dispatch_attempts"]) == (2, 1)
    asked = [offer["technician"] for offer in offers_of(connection, booking["id"])]
    assert len(set(asked)) == 3, "a new round asks the one technician nobody had asked yet"
    assert set(asked) == {user_id(technician) for technician in technicians}


def test_an_offer_expires_even_if_nobody_ever_reads_the_booking(client, connection, onboard, requester_session, sweep):
    """The sweeper moves a booking on by itself; no read is needed to trigger it."""
    lone = working(client, onboard, "CARPENTER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "CARPENTER").json()
    lapse_offers(connection, booking["id"])
    sweep()
    assert booking_row(connection, booking["id"])["status"] == "NO_TECHNICIAN_FOUND"
    assert offer_ids(client, lone) == []


# =================================================================== cancellation


def test_scenario_7_customer_cancels_while_dispatch_is_running(client, connection, onboard, requester_session, sweep):
    waiting = [working(client, onboard, "ELECTRICIAN", at=point) for point in (NEAR, MID)]
    _account, headers = requester_session()
    booking = book(client, headers, "ELECTRICIAN").json()
    assert client.post(f"/requester/bookings/{booking['id']}/cancel", headers=headers).json()["status"] == "CANCELLED"

    offers = offers_of(connection, booking["id"])
    assert {(offer["status"], offer["status_reason"]) for offer in offers} == {("CANCELLED", "CUSTOMER_CANCELLED")}
    for technician in waiting:
        late = act(client, technician, booking["id"], "accept")
        assert late.status_code == 409 and code_of(late) == "REQUEST_CANCELLED"
        assert offer_ids(client, technician) == []
    sweep()  # nothing revives a cancelled booking
    assert booking_row(connection, booking["id"])["status"] == "CANCELLED"


def test_scenario_8_an_assigned_technician_cancelling_returns_the_job_to_dispatch(
    client, connection, onboard, requester_session
):
    holder = working(client, onboard, "PLUMBER", at=NEAR, experience_years=10)
    backup = working(client, onboard, "PLUMBER", at=FAR, experience_years=0)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert act(client, holder, booking["id"], "accept").status_code == 200
    assert act(client, holder, booking["id"], "en-route").status_code == 200

    handed_back = client.post(
        f"/technicians/me/jobs/{booking['id']}/cancel",
        headers=bearer(holder["access_token"]),
        json={"reason": "VEHICLE_ISSUE"},
    )
    assert handed_back.status_code == 204, handed_back.text

    row = booking_row(connection, booking["id"])
    assert (row["status"], row["technician"], row["dispatch_round"]) == ("OFFERED", None, 2)
    assert offer_ids(client, backup) == [booking["id"]]
    statuses = {
        offer["technician"]: (offer["status"], offer["status_reason"]) for offer in offers_of(connection, booking["id"])
    }
    assert statuses[user_id(holder)] == ("TECHNICIAN_CANCELLED", "VEHICLE_ISSUE")
    # Never offered to them again, and free to take other work.
    assert offer_ids(client, holder) == []
    assert (
        client.get("/technicians/me/presence", headers=bearer(holder["access_token"])).json()["dispatch_status"]
        == "AVAILABLE"
    )
    # The customer sees the search again, with no technician attached.
    seen = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert seen["status"] == "OFFERED" and seen["technician"] is None


ANOTHER_POINT = (17.9000, 78.9000)  # ~70 km away: never offered this booking


def test_a_technician_cannot_hand_back_a_job_once_arrived_or_someone_elses(client, onboard, requester_session):
    holder = working(client, onboard, "PLUMBER", at=NEAR)
    stranger = working(client, onboard, "PLUMBER", at=ANOTHER_POINT)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    assert act(client, holder, booking["id"], "accept").status_code == 200
    assert (
        client.post(
            f"/technicians/me/jobs/{booking['id']}/cancel", headers=bearer(stranger["access_token"])
        ).status_code
        == 404
    )
    assert act(client, holder, booking["id"], "en-route").status_code == 200
    arrive(client, holder, booking["id"], HOME)
    refused = client.post(f"/technicians/me/jobs/{booking['id']}/cancel", headers=bearer(holder["access_token"]))
    assert refused.status_code == 409 and code_of(refused) == "INVALID_STATE_TRANSITION"


def test_a_hand_back_with_nobody_left_says_no_technician_found(client, connection, onboard, requester_session):
    holder = working(client, onboard, "CARPENTER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "CARPENTER").json()
    assert act(client, holder, booking["id"], "accept").status_code == 200
    assert (
        client.post(f"/technicians/me/jobs/{booking['id']}/cancel", headers=bearer(holder["access_token"])).status_code
        == 204
    )
    final = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert final["status"] == "NO_TECHNICIAN_FOUND" and final["can_retry"] is True


# ======================================================== live location rules


def test_scenario_9_three_second_updates_do_not_grow_the_database(client, connection, onboard, monkeypatch):
    """Twenty fixes, as a stationary-then-moving phone sends them: still ONE row, and
    the stationary ones are not even rewritten."""
    technician = working(client, onboard, "PAINTER", at=None)
    before = connection.execute(text("SELECT count(*) FROM partner.technician_locations")).scalar()
    answers = [locate(client, technician, HOME).json() for _ in range(10)]
    assert answers[0]["persisted"] is True
    assert not any(answer["persisted"] for answer in answers[1:]), "a stationary phone is not rewritten every 3 s"
    assert all(answer["update_interval_seconds"] == settings.location_update_interval_seconds for answer in answers)
    moving = [locate(client, technician, north_of(HOME, 0.05 * step)).json() for step in range(1, 11)]
    assert all(answer["persisted"] for answer in moving), "movement is written as it happens"
    after = connection.execute(text("SELECT count(*) FROM partner.technician_locations")).scalar()
    assert after - before == 1


def test_the_heartbeat_rewrites_a_stationary_position_before_it_goes_stale(client, connection, onboard):
    technician = working(client, onboard, "PAINTER", at=HOME)
    make_stale(connection, technician, seconds=settings.location_persist_heartbeat_seconds + 1)
    assert locate(client, technician, HOME).json()["persisted"] is True


def test_scenario_10_signing_out_stops_tracking_and_withdraws_offers(client, connection, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()
    assert offer_ids(client, technician) == [booking["id"]]

    gone = client.delete("/technicians/me/location", headers=bearer(technician["access_token"]))
    assert gone.status_code == 200 and gone.json()["has_location"] is False
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.technician_locations WHERE technician_id = :t"),
            {"t": user_id(technician)},
        ).scalar()
        == 0
    )
    offer = offers_of(connection, booking["id"])[0]
    assert (offer["status"], offer["status_reason"]) == ("CANCELLED", "TECHNICIAN_UNAVAILABLE")
    assert booking_row(connection, booking["id"])["status"] == "NO_TECHNICIAN_FOUND"


def test_a_late_fix_after_going_offline_does_not_bring_the_position_back(client, connection, onboard):
    technician = working(client, onboard, "PAINTER", at=NEAR)
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "OFFLINE"}
        ).status_code
        == 200
    )
    late = locate(client, technician, MID)
    assert late.status_code == 200
    assert (late.json()["persisted"], late.json()["tracking_required"], late.json()["has_location"]) == (
        False,
        False,
        False,
    )
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.technician_locations WHERE technician_id = :t"),
            {"t": user_id(technician)},
        ).scalar()
        == 0
    )


def test_an_impossible_jump_is_rejected_not_stored(client, connection, onboard, monkeypatch):
    monkeypatch.setattr(settings, "location_max_speed_kmph", 180.0)
    technician = working(client, onboard, "PAINTER", at=HOME)
    three_hundred_km_away = north_of(HOME, 300)
    refused = locate(client, technician, three_hundred_km_away)
    assert refused.status_code == 422 and code_of(refused) == "LOCATION_JUMP_REJECTED"
    stored = connection.execute(
        text("SELECT latitude FROM partner.technician_locations WHERE technician_id = :t"), {"t": user_id(technician)}
    ).scalar()
    assert stored == pytest.approx(HOME[0])
    # Driving speed is fine.
    assert locate(client, technician, north_of(HOME, 0.03)).status_code == 200


def test_a_wrong_device_clock_and_out_of_order_fixes_are_refused(client, onboard):
    technician = working(client, onboard, "PAINTER", at=None)
    now = naive_utc_now()
    skewed = locate(client, technician, HOME, device_timestamp=(now + timedelta(hours=2)).isoformat() + "Z")
    assert skewed.status_code == 422 and code_of(skewed) == "LOCATION_CLOCK_SKEW"
    assert locate(client, technician, HOME, device_timestamp=now.isoformat() + "Z").status_code == 200
    older = locate(
        client, technician, north_of(HOME, 0.1), device_timestamp=(now - timedelta(seconds=5)).isoformat() + "Z"
    )
    assert older.status_code == 409 and code_of(older) == "LOCATION_OUT_OF_ORDER"


@pytest.mark.parametrize(
    "body",
    [
        {"latitude": 91, "longitude": 78.4},
        {"latitude": 17.4, "longitude": 181},
        {"latitude": 17.4, "longitude": 78.4, "accuracy": -1},
        {"latitude": 17.4, "longitude": 78.4, "speed": 500},
        {"latitude": 0, "longitude": 0},
    ],
)
def test_impossible_coordinates_are_refused(client, onboard, body):
    technician = working(client, onboard, "PAINTER", at=None)
    assert (
        client.post("/technicians/me/location", headers=bearer(technician["access_token"]), json=body).status_code
        == 422
    )


def test_paused_technicians_keep_their_job_but_get_no_new_offers(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=NEAR)
    paused = client.patch(
        "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "PAUSED"}
    )
    assert paused.json()["work_status"] == "PAUSED" and paused.json()["is_available"] is False
    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert presence["dispatch_status"] == "PAUSED" and presence["has_location"] is True
    _account, headers = requester_session()
    assert book(client, headers, "PAINTER").json()["status"] == "NO_TECHNICIAN_FOUND"
    assert (
        client.patch(
            "/technicians/me/availability", headers=bearer(technician["access_token"]), json={"status": "ON_JOB"}
        ).status_code
        == 422
    )


# ===================================================================== sweeper


def test_the_sweeper_dispatches_a_booking_stuck_in_searching(client, connection, onboard, requester_session, sweep):
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()  # nobody yet
    assert booking["status"] == "NO_TECHNICIAN_FOUND"
    technician = working(client, onboard, "PAINTER", at=NEAR)
    # As if the process died between saving the booking and sending its batch.
    connection.execute(
        text(
            "UPDATE partner.bookings SET status = 'SEARCHING', last_dispatched_at = NULL, "
            "updated_at = :old WHERE id = :b"
        ),
        {"b": booking["id"], "old": naive_utc_now() - timedelta(minutes=5)},
    )
    assert sweep()["redispatched"] == 1
    assert offer_ids(client, technician) == [booking["id"]]


def test_the_sweeper_purges_abandoned_positions(client, connection, onboard, sweep):
    technician = working(client, onboard, "PAINTER", at=NEAR)
    make_stale(connection, technician, seconds=settings.location_purge_after_seconds + 60)
    assert sweep()["purged_locations"] >= 1
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.technician_locations WHERE technician_id = :t"),
            {"t": user_id(technician)},
        ).scalar()
        == 0
    )


# ============================================================== observability


def test_every_log_line_carries_the_reference_and_no_personal_data(client, onboard, requester_session, caplog):
    caplog.set_level(logging.INFO)
    technician = working(client, onboard, "PAINTER", at=NEAR)
    _account, headers = requester_session(name="Priya Sharma", address="Flat 7B, 12-4 Main Road, Alpha Main")
    booking = book(client, headers, "PAINTER").json()
    assert act(client, technician, booking["id"], "accept").status_code == 200
    lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith("dispatch.")]
    events = {line.split(" ", 1)[0] for line in lines}
    assert {
        "dispatch.request_created",
        "dispatch.candidates",
        "dispatch.ranked",
        "dispatch.offer_created",
        "dispatch.assignment_succeeded",
    } <= events
    assert all(f"request={booking['reference']}" in line for line in lines if " request=" in line)
    everything = "\n".join(lines)
    for secret in ("Priya", "Sharma", "Flat 7B", "9123456780", "17.44", "78.39"):
        assert secret not in everything, secret


def test_errors_carry_a_stable_code(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=NEAR)
    missing = act(client, technician, uuid.uuid4(), "accept")
    assert missing.status_code == 404 and missing.json()["detail"] == {
        "code": "OFFER_NOT_FOUND",
        "message": "Job not found",
    }
    _account, headers = requester_session()
    first = book(client, headers, "PAINTER").json()
    duplicate = book(client, headers, "PAINTER")
    assert code_of(duplicate) == "DUPLICATE_OPEN_BOOKING" and duplicate.json()["detail"]["booking_id"] == first["id"]
    not_retryable = client.post(f"/requester/bookings/{first['id']}/retry", headers=headers)
    assert code_of(not_retryable) == "INVALID_STATE_TRANSITION"


# ========================================================= realtime across processes


def test_messages_are_relayed_through_postgres_listen_notify(client, onboard, requester_session, monkeypatch):
    """With the cross-process relay on, an offer reaches the technician's socket by
    way of NOTIFY -> LISTEN, exactly as it would from another worker process."""
    from app.modules.bookings.dependencies import get_realtime
    from app.modules.realtime.router import DISPATCH_SUBPROTOCOL

    technician = working(client, onboard, "PAINTER", at=NEAR)
    _account, headers = requester_session()
    hub = get_realtime()
    hub.attach(hub._loop, cross_process=True)
    try:
        deadline = time.monotonic() + 10
        while not hub.relaying and time.monotonic() < deadline:
            time.sleep(0.05)
        assert hub.relaying, "the LISTEN connection should be up"
        with client.websocket_connect(
            "/dispatch/ws/technician",
            subprotocols=[DISPATCH_SUBPROTOCOL],
            headers=technician_cookie(technician["access_token"]),
        ) as socket:
            booking = book(client, headers, "PAINTER").json()
            frame = socket.receive_json()
            assert frame["type"] == "booking_offer" and frame["booking_id"] == booking["id"]
    finally:
        hub._cross_process = False
        hub._stop.set()
        if hub._listener is not None:
            hub._listener.join(timeout=5)
        hub._listener = None
        hub._listening.clear()


def test_an_oversized_message_becomes_a_resync(monkeypatch):
    from app.modules.realtime.hub import RealtimeHub

    sent = []

    class FakeConnection:
        def execution_options(self, **_):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def execute(self, _statement, params):
            sent.append(params["payload"])

    class FakeEngine:
        def connect(self):
            return FakeConnection()

    hub = RealtimeHub(FakeEngine(), cross_process=True, channel="test")
    hub._notify("booking", "room", {"type": "route_updated", "booking_id": "b-1", "route": "x" * 20000})
    assert '"type":"resync"' in sent[0] and '"booking_id":"b-1"' in sent[0] and len(sent[0]) < 7900


# ============================================== committed race (disposable database)


@pytest.mark.skipif(
    os.environ.get("PARTNER_TEST_COMMITTED_CONCURRENCY") != "1",
    reason="needs committed rows on a disposable test database (PARTNER_TEST_COMMITTED_CONCURRENCY=1)",
)
def test_five_technicians_accepting_at_the_same_instant_on_separate_connections():
    """Real transactions, real threads, one barrier: exactly one acceptance commits."""
    from fastapi import HTTPException

    from app.database.session import engine
    from app.modules.bookings.dependencies import build_dispatch_service
    from app.modules.identity.models import Technician

    marker = uuid.uuid4().hex[:10]
    ids = {"technicians": []}
    with engine.begin() as c:
        ids["owner"] = c.execute(
            text(
                f"INSERT INTO {REQUESTERS_STAND_IN} (id, name, email, phone, status, address, pincode, location, requester_role) "
                "VALUES (gen_random_uuid(), 'Race5 Owner', :e, :p, 'ACTIVE', '1 Road', '000405', "
                "'Alpha Main', 'OWNER') RETURNING id"
            ),
            {"e": f"race5-{marker}@example.com", "p": "8" + marker[:9].translate(str.maketrans("abcdef", "123456"))},
        ).scalar_one()
        ids["booking"] = c.execute(
            text(
                "INSERT INTO partner.bookings (requested_by_user_id, requested_by_role, technician_type, service_address, "
                "pincode, status, service_latitude, service_longitude, assigned_at, dispatch_attempts) VALUES (:o, 'OWNER', "
                "'PLUMBER', '1 Road', '000405', 'OFFERED', 17.4483, 78.3915, now(), 1) RETURNING id"
            ),
            {"o": ids["owner"]},
        ).scalar_one()
        for index in range(5):
            user = c.execute(
                text(
                    "INSERT INTO partner.technicians (email, phone, status, onboarding_completed_at, email_verified_at, pincode) "
                    "VALUES (:e, '9876543210', 'ACTIVE', now(), now(), '000405') RETURNING id"
                ),
                {"e": f"race5-{index}-{marker}@example.com"},
            ).scalar_one()
            c.execute(
                text(
                    "INSERT INTO partner.technician_profiles (technician_id, technician_type, work_status) "
                    "VALUES (:u, 'PLUMBER', 'AVAILABLE')"
                ),
                {"u": user},
            )
            c.execute(
                text(
                    "INSERT INTO partner.technician_identity_verifications (technician_id, face_status, aadhaar_status) "
                    "VALUES (:u, 'VERIFIED', 'VERIFIED')"
                ),
                {"u": user},
            )
            c.execute(
                text(
                    "INSERT INTO partner.booking_offers (booking_id, technician_id, status, distance_meters, "
                    "offered_at, expires_at, rank) VALUES (:b, :t, 'OFFERED', 100, now(), "
                    "now() + interval '5 minutes', :r)"
                ),
                {"b": ids["booking"], "t": user, "r": index + 1},
            )
            ids["technicians"].append(user)

    barrier = threading.Barrier(5)
    outcomes = []

    def accept(technician_id):
        with Session(engine) as session:
            service = build_dispatch_service(session)
            user = session.get(Technician, technician_id)
            barrier.wait()
            try:
                service.answer_offer(user, ids["booking"], True)
                outcomes.append("accepted")
            except HTTPException as error:
                session.rollback()
                outcomes.append(error.detail["code"])

    try:
        threads = [threading.Thread(target=accept, args=(technician,)) for technician in ids["technicians"]]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
        assert sorted(outcomes) == ["REQUEST_ALREADY_ASSIGNED"] * 4 + ["accepted"], outcomes
        with engine.connect() as c:
            assert (
                c.execute(
                    text("SELECT count(*) FROM partner.booking_offers WHERE booking_id = :b AND status = 'ACCEPTED'"),
                    {"b": ids["booking"]},
                ).scalar()
                == 1
            )
            assert (
                c.execute(
                    text("SELECT count(*) FROM partner.booking_offers WHERE booking_id = :b AND status = 'LOST_RACE'"),
                    {"b": ids["booking"]},
                ).scalar()
                == 4
            )
            assert (
                c.execute(text("SELECT status FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]}).scalar()
                == "ACCEPTED"
            )
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM partner.booking_offers WHERE booking_id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]})
            for technician in ids["technicians"]:
                c.execute(
                    text("DELETE FROM partner.technician_identity_verifications WHERE technician_id = :u"),
                    {"u": technician},
                )
                c.execute(text("DELETE FROM partner.technician_profiles WHERE technician_id = :u"), {"u": technician})
                c.execute(text("DELETE FROM partner.technicians WHERE id = :u"), {"u": technician})
            c.execute(text(f"DELETE FROM {REQUESTERS_STAND_IN} WHERE id = :o"), {"o": ids["owner"]})
