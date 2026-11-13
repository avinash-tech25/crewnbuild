"""Nearby dispatch: real distance, several candidates, exactly one winner.

Everything runs through the real API against the real `partner` schema, inside
the rolled-back transaction the shared fixtures set up.
"""

import uuid

import pytest
from legacy import bearer, requester_cookie, technician_cookie
from legacy_dispatch import (
    ANOTHER_CITY,
    AT_HOME,
    FAR,
    HOME,
    MID,
    NEAR,
    act,
    book,
    offer_ids,
    offers,
    place,
    working,
)
from sqlalchemy import text

from app.core.runtime import settings

# ------------------------------------------------------- distance, not PIN code


def test_candidates_are_measured_by_real_distance(client, onboard, requester_session):
    """A House Owner at one point, two painters at known distances from it.

    The experienced painter is the further one: experience decided the old postal
    ranking, and it must not decide this one.
    """
    near = working(client, onboard, "PAINTER", at=NEAR, experience_years=1)
    mid = working(client, onboard, "PAINTER", at=MID, experience_years=20)
    _account, headers = requester_session()

    booking = book(client, headers, "PAINTER", description="Bedroom", at=HOME)
    assert booking.status_code == 201, booking.text
    booking_id = booking.json()["id"]

    near_offer = [offer for offer in offers(client, near) if offer["booking_id"] == booking_id]
    mid_offer = [offer for offer in offers(client, mid) if offer["booking_id"] == booking_id]
    assert near_offer and mid_offer, "both technicians inside the first radius should be asked"
    # Measured against the real coordinates, to within a few metres.
    assert near_offer[0]["distance_meters"] == pytest.approx(800, abs=60)
    assert mid_offer[0]["distance_meters"] == pytest.approx(1600, abs=60)
    assert near_offer[0]["distance_meters"] < mid_offer[0]["distance_meters"]


def test_a_closer_technician_ranks_above_an_otherwise_equal_further_one(client, connection, onboard, requester_session):
    """Two newcomers with identical records: distance is what separates them."""
    close = working(client, onboard, "PAINTER", at=NEAR, experience_years=3)  # 0.8 km
    across_town = working(client, onboard, "PAINTER", at=FAR, experience_years=3)  # 3.4 km
    _account, headers = requester_session()

    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert offer_ids(client, close) == [booking["id"]] and offer_ids(client, across_town) == [booking["id"]]
    ranks = dict(
        connection.execute(
            text("SELECT technician_id::text, rank FROM partner.booking_offers WHERE booking_id = :id"),
            {"id": booking["id"]},
        ).all()
    )
    assert ranks[close["user"]["id"]] == 1 and ranks[across_town["user"]["id"]] == 2


def test_a_technician_too_far_away_is_not_offered_the_job(client, onboard, requester_session):
    """PIN code is not what decides: a technician in another city is not nearby,
    however their address reads."""
    distant = working(client, onboard, "PLUMBER", at=ANOTHER_CITY)
    _account, headers = requester_session()

    booking = book(client, headers, "PLUMBER", at=HOME).json()
    assert booking["status"] == "NO_TECHNICIAN_FOUND"
    assert offer_ids(client, distant) == []


def test_the_search_widens_only_when_the_closer_rings_are_empty(client, onboard, requester_session, monkeypatch):
    monkeypatch.setattr(settings, "technician_search_radius_km", 1.0)
    monkeypatch.setattr(settings, "technician_search_radius_step_km", 9.0)
    monkeypatch.setattr(settings, "technician_max_search_radius_km", 10.0)
    outside_first_ring = working(client, onboard, "CARPENTER", at=FAR)  # 3.4 km: past 1 km, inside 10 km
    _account, headers = requester_session()

    booking = book(client, headers, "CARPENTER", at=HOME).json()
    assert booking["status"] == "OFFERED"
    assert offer_ids(client, outside_first_ring) == [booking["id"]]


# ------------------------------------------------------------ location freshness


def test_a_technician_without_a_position_is_not_dispatched(client, onboard, requester_session):
    working(client, onboard, "ELECTRICIAN", at=None)  # registered, never reported a position
    _account, headers = requester_session()
    assert book(client, headers, "ELECTRICIAN", at=HOME).json()["status"] == "NO_TECHNICIAN_FOUND"


def test_a_stale_position_is_not_dispatched_on(client, connection, onboard, requester_session):
    technician = working(client, onboard, "ELECTRICIAN", at=AT_HOME)
    connection.execute(
        text("UPDATE partner.technician_locations SET last_location_at = now() at time zone 'utc' - interval '2 hours'")
    )
    _account, headers = requester_session()

    assert book(client, headers, "ELECTRICIAN", at=HOME).json()["status"] == "NO_TECHNICIAN_FOUND"
    assert offer_ids(client, technician) == []

    # Reporting a fresh position brings them back into range.
    place(client, technician, AT_HOME)
    retried = client.post(f"/requester/bookings/{_open_booking(client, headers)}/retry", headers=headers).json()
    assert retried["status"] == "OFFERED"
    assert offer_ids(client, technician) == [retried["id"]]


def _open_booking(client, headers):
    return client.get("/requester/bookings", headers=headers).json()[0]["id"]


def test_going_unavailable_forgets_where_the_technician_is(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    forgotten = client.delete("/technicians/me/location", headers=bearer(technician["access_token"]))
    assert forgotten.status_code == 200
    assert forgotten.json()["has_location"] is False

    _account, headers = requester_session()
    assert book(client, headers, "PAINTER", at=HOME).json()["status"] == "NO_TECHNICIAN_FOUND"


def test_presence_says_what_is_missing(client, onboard):
    technician = working(client, onboard, "PAINTER", at=None)
    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert presence["has_location"] is False and presence["ready_for_nearby_jobs"] is False
    assert "Location access is required" in presence["message"]

    place(client, technician, AT_HOME)
    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert (presence["has_location"], presence["ready_for_nearby_jobs"], presence["message"]) == (True, True, None)


# ------------------------------------------- nothing identifying before accepting


def test_an_offer_carries_nothing_that_identifies_the_customer(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session(name="Priya Sharma", address="Flat 7B, 12-4 Main Road, Alpha Main")

    booking = book(client, headers, "PAINTER", description="Bathroom / Toilet", at=HOME).json()
    response = client.get("/technicians/me/offers", headers=bearer(technician["access_token"]))
    assert response.status_code == 200
    offer = response.json()[0]

    # What they do get: the trade, the part of the property, and how far it is.
    assert offer["booking_id"] == booking["id"]
    assert (offer["technician_type"], offer["work_area"]) == ("PAINTER", "Bathroom / Toilet")
    assert offer["distance_meters"] is not None

    # What they do not get, in the model at all:
    for forbidden in (
        "requester_name",
        "requester_phone",
        "service_address",
        "pincode",
        "service_latitude",
        "service_longitude",
        "latitude",
        "longitude",
        "service_area",
    ):
        assert forbidden not in offer, forbidden
    body = response.text
    for secret in ("Priya", "Sharma", "Flat 7B", "Main Road", "9123456780", "000405", "17.44", "78.39"):
        assert secret not in body, secret


def test_the_address_arrives_only_after_accepting(client, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HOME).json()

    assert act(client, technician, booking["id"], "accept").status_code == 200
    held = client.get(
        "/technicians/me/jobs", headers=bearer(technician["access_token"]), params={"bucket": "accepted"}
    ).json()[0]
    assert held["service_address"] and held["pincode"] == "000405"
    assert held["requester_phone"] == "9123456780"
    # And the point to travel to, which is what the live map routes along.
    assert held["service_latitude"] == pytest.approx(HOME[0]) and held["service_longitude"] == pytest.approx(HOME[1])


# --------------------------------------------------------- one winner, no more


def test_several_technicians_are_offered_one_job_and_exactly_one_wins(client, connection, onboard, requester_session):
    first = working(client, onboard, "CARPENTER", at=AT_HOME)
    second = working(client, onboard, "CARPENTER", at=NEAR)
    third = working(client, onboard, "CARPENTER", at=MID)
    _account, headers = requester_session()

    booking = book(client, headers, "CARPENTER", at=HOME).json()
    assert booking["status"] == "OFFERED"
    # Nobody holds it yet, so the requester is not shown a technician.
    assert booking["technician"] is None

    for technician in (first, second, third):
        assert offer_ids(client, technician) == [booking["id"]]

    assert act(client, second, booking["id"], "accept").status_code == 200

    # The losers cannot take it, and it is gone from their list.
    for loser in (first, third):
        refused = act(client, loser, booking["id"], "accept")
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"]["code"] == "REQUEST_ALREADY_ASSIGNED"
        assert "already been accepted" in refused.json()["detail"]["message"]
        assert offer_ids(client, loser) == []

    assert (
        connection.execute(
            text(
                "SELECT count(*) FROM partner.bookings WHERE id = :id AND technician_id = :winner AND status = 'ACCEPTED'"
            ),
            {"id": booking["id"], "winner": second["user"]["id"]},
        ).scalar()
        == 1
    )
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.booking_offers WHERE booking_id = :id AND status = 'ACCEPTED'"),
            {"id": booking["id"]},
        ).scalar()
        == 1
    )

    seen = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert seen["status"] == "ACCEPTED" and seen["technician"]["name"] == "Test"


def test_two_acceptances_at_once_still_produce_one_assignment(client, connection, onboard, requester_session):
    """The race is settled in PostgreSQL, not in the browser.

    Both requests are made against the same booking with no coordination between
    them; the row lock in `answer_offer` serialises them, so the second finds a
    booking that is no longer SEARCHING.
    """
    first = working(client, onboard, "PAINTER", at=AT_HOME)
    second = working(client, onboard, "PAINTER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()

    results = [act(client, first, booking["id"], "accept"), act(client, second, booking["id"], "accept")]
    codes = sorted(response.status_code for response in results)
    assert codes == [200, 409], [r.text for r in results]

    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.bookings WHERE id = :id AND technician_id IS NOT NULL"),
            {"id": booking["id"]},
        ).scalar()
        == 1
    )


# -------------------------------------------------------------------- declining


def test_declining_keeps_the_booking_searching_for_someone_else(client, onboard, requester_session):
    first = working(client, onboard, "PLUMBER", at=AT_HOME)
    second = working(client, onboard, "PLUMBER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HOME).json()

    declined = act(client, first, booking["id"], "decline")
    assert declined.status_code == 200 and declined.json()["outcome"] == "DECLINED"

    # The customer's booking is untouched, and the other technician still has it.
    still_open = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert still_open["status"] == "OFFERED"
    assert offer_ids(client, second) == [booking["id"]]
    assert offer_ids(client, first) == []
    # And the one who declined cannot change their mind.
    assert act(client, first, booking["id"], "accept").status_code == 409


def test_when_everyone_declines_the_booking_says_so(client, onboard, requester_session):
    first = working(client, onboard, "PLUMBER", at=AT_HOME)
    second = working(client, onboard, "PLUMBER", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HOME).json()

    for technician in (first, second):
        assert act(client, technician, booking["id"], "decline").status_code == 200

    final = client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()
    assert (final["status"], final["can_retry"]) == ("NO_TECHNICIAN_FOUND", True)

    # Somebody new comes online; searching again reaches them, never the two who passed.
    newcomer = working(client, onboard, "PLUMBER", at=AT_HOME)
    retried = client.post(f"/requester/bookings/{booking['id']}/retry", headers=headers).json()
    assert retried["status"] == "OFFERED"
    assert offer_ids(client, newcomer) == [booking["id"]]
    assert offer_ids(client, first) == [] and offer_ids(client, second) == []


# --------------------------------------------------------------------- timeout


def test_an_unanswered_offer_lapses_and_moves_to_the_next_technician(
    client, connection, onboard, requester_session, monkeypatch
):
    monkeypatch.setattr(settings, "dispatch_batch_size", 1)
    slow = working(client, onboard, "ELECTRICIAN", at=AT_HOME)
    backup = working(client, onboard, "ELECTRICIAN", at=NEAR)
    _account, headers = requester_session()
    booking = book(client, headers, "ELECTRICIAN", at=HOME).json()

    holder, waiting = (slow, backup) if offer_ids(client, slow) else (backup, slow)
    connection.execute(
        text(
            "UPDATE partner.booking_offers SET expires_at = now() at time zone 'utc' - interval '1 minute' "
            "WHERE booking_id = :id"
        ),
        {"id": booking["id"]},
    )

    # Too late: the offer has lapsed, and the booking has moved on.
    assert act(client, holder, booking["id"], "accept").status_code == 409
    assert offer_ids(client, waiting) == [booking["id"]]
    assert client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()["status"] == "OFFERED"


def test_a_booking_nobody_offered_you_answers_like_one_that_does_not_exist(client, onboard, requester_session):
    """So a technician cannot probe which booking ids are real."""
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    # Far enough away that this booking is never offered to them.
    stranger = working(client, onboard, "PAINTER", at=ANOTHER_CITY)
    _account, headers = requester_session()
    booking = book(client, headers, "PAINTER", at=HOME).json()
    assert offer_ids(client, technician) == [booking["id"]] and offer_ids(client, stranger) == []

    unknown = act(client, technician, uuid.uuid4(), "accept")
    never_offered = act(client, stranger, booking["id"], "accept")
    assert unknown.status_code == never_offered.status_code == 404
    assert unknown.json()["detail"] == never_offered.json()["detail"]


# --------------------------------------------------------------- websocket


def test_an_offer_and_its_job_say_what_was_booked_and_its_price(client, connection, onboard, requester_session):
    """The service name and quoted price describe the work, not the customer: they
    are on the offer before accepting, and nothing identifying comes with them."""
    service_id = connection.execute(
        text(
            "INSERT INTO partner.catalog_services (trade, slug, service_name, service_kind, price, currency, sort_order) "
            "VALUES ('PAINTER', :slug, 'Step1 Wall Touch-up', 'SERVICE', 349, 'INR', 999) RETURNING id"
        ),
        {"slug": f"step1-test-{uuid.uuid4().hex[:8]}"},
    ).scalar_one()
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session(name="Priya Sharma", address="Flat 7B, 12-4 Main Road, Alpha Main")
    booking = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PAINTER",
            "service_id": str(service_id),
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        },
    )
    assert booking.status_code == 201, booking.text

    response = client.get("/technicians/me/offers", headers=bearer(technician["access_token"]))
    offer = response.json()[0]
    assert (offer["service_name"], offer["service_kind"], offer["currency"]) == (
        "Step1 Wall Touch-up",
        "SERVICE",
        "INR",
    )
    assert float(offer["quoted_amount"]) == 349
    assert offer["work_area"] == "Kitchen" and offer["distance_meters"] is not None
    for forbidden in (
        "requester_name",
        "requester_phone",
        "service_address",
        "pincode",
        "service_latitude",
        "service_longitude",
        "service_area",
    ):
        assert forbidden not in offer, forbidden
    for secret in ("Priya", "Sharma", "Flat 7B", "Main Road", "9123456780", "000405"):
        assert secret not in response.text, secret

    assert act(client, technician, booking.json()["id"], "accept").status_code == 200
    held = client.get(
        "/technicians/me/jobs", headers=bearer(technician["access_token"]), params={"bucket": "accepted"}
    ).json()[0]
    assert held["service_name"] == "Step1 Wall Touch-up" and float(held["quoted_amount"]) == 349
    assert held["requester_name"] == "Priya"


def test_a_booking_without_a_service_offers_no_name_or_price(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session()
    book(client, headers, "PAINTER", at=HOME)
    offer = offers(client, technician)[0]
    assert (offer["service_name"], offer["quoted_amount"], offer["currency"]) == (None, None, None)


def test_a_job_request_reaches_the_technician_over_the_websocket(client, onboard, requester_session):
    """No refresh, no polling: the request arrives the moment the booking is made."""
    from app.modules.realtime.router import DISPATCH_SUBPROTOCOL

    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session()
    token = technician["access_token"]

    with client.websocket_connect(
        "/dispatch/ws/technician", subprotocols=[DISPATCH_SUBPROTOCOL], headers=technician_cookie(token)
    ) as socket:
        booking = book(client, headers, "PAINTER", description="Kitchen", at=HOME).json()

        frame = socket.receive_json()
        assert frame["type"] == "booking_offer"
        assert frame["booking_id"] == booking["id"]
        assert frame["technician_type"] == "PAINTER" and frame["work_area"] == "Kitchen"
        assert frame["distance_meters"] is not None
        assert "service_name" in frame and "quoted_amount" in frame
        # The alert itself carries nothing identifying either.
        for forbidden in (
            "requester_name",
            "requester_phone",
            "service_address",
            "pincode",
            "service_latitude",
            "service_longitude",
        ):
            assert forbidden not in frame, forbidden

        socket.send_json({"type": "ping"})
        assert socket.receive_json()["type"] == "pong"


def test_the_losers_are_told_the_job_is_taken(client, onboard, requester_session):
    winner = working(client, onboard, "CARPENTER", at=AT_HOME)
    loser = working(client, onboard, "CARPENTER", at=NEAR)
    _account, headers = requester_session()
    from app.modules.realtime.router import DISPATCH_SUBPROTOCOL

    with client.websocket_connect(
        "/dispatch/ws/technician", subprotocols=[DISPATCH_SUBPROTOCOL], headers=technician_cookie(loser["access_token"])
    ) as socket:
        booking = book(client, headers, "CARPENTER", at=HOME).json()
        assert socket.receive_json()["type"] == "booking_offer"

        assert act(client, winner, booking["id"], "accept").status_code == 200
        # The card goes from the loser's screen at once, so two technicians never
        # set off to the same job.
        taken = socket.receive_json()
        assert taken["type"] == "booking_taken" and taken["booking_id"] == booking["id"]


def test_the_dispatch_socket_refuses_anyone_else(client, onboard, requester_session):
    from fastapi import WebSocketDisconnect

    from app.modules.realtime.router import DISPATCH_SUBPROTOCOL

    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, requester_headers = requester_session()
    registration = onboard("PLUMBER", "000405", stop_after="aadhaar")

    booking_token = requester_headers["Authorization"].split(" ", 1)[1]
    refused = {
        "a booking session": ([DISPATCH_SUBPROTOCOL], requester_cookie(booking_token)),
        "a booking session in the technician cookie": ([DISPATCH_SUBPROTOCOL], technician_cookie(booking_token)),
        "a registration session": ([DISPATCH_SUBPROTOCOL], technician_cookie(registration["access_token"])),
        "no session": ([DISPATCH_SUBPROTOCOL], {}),
        "a token that is not a session": ([DISPATCH_SUBPROTOCOL], technician_cookie("not-a-token")),
        "the wrong subprotocol": (["something.else"], technician_cookie(technician["access_token"])),
        "another site's page": (
            [DISPATCH_SUBPROTOCOL],
            {**technician_cookie(technician["access_token"]), "origin": "https://evil.example"},
        ),
    }
    for label, (subprotocols, headers) in refused.items():
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/dispatch/ws/technician", subprotocols=subprotocols, headers=headers
            ) as socket:
                socket.receive_json()
        assert True, label


# ------------------------------- a guess from the IP address is not a position

IMPRECISE_ACCURACY = 50000.0  # what a browser returns when it geolocates by IP


def test_an_ip_derived_fix_is_refused_as_a_technician_position(client, onboard):
    """The bug this rule exists for.

    A browser with no satellite or Wi-Fi fix returns the middle of whichever city
    the connection appears to be in, accurate to tens of kilometres. Stored, it
    put a Karimnagar booking in Hyderabad and left the technician sitting exactly
    on top of the customer at 0 m.
    """
    technician = working(client, onboard, "PAINTER", at=None)
    refused = client.post(
        "/technicians/me/location",
        headers=bearer(technician["access_token"]),
        json={"latitude": 17.458, "longitude": 78.4336, "accuracy": IMPRECISE_ACCURACY},
    )
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["code"] == "LOCATION_IMPRECISE"
    assert "50.0 km" in refused.json()["detail"]["message"]

    presence = client.get("/technicians/me/presence", headers=bearer(technician["access_token"])).json()
    assert presence["has_location"] is False, "a guess must not be stored as a position"
    assert presence["ready_for_nearby_jobs"] is False


def test_a_rough_pin_can_still_be_booked(client, onboard, requester_session):
    """The requester's pin is on a map in front of them, so a rough fix shows as a
    pin they can see and drag. Refusing the booking over it would block somebody
    whose phone simply has a poor view of the sky."""
    working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session()
    created = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PAINTER",
            "description": "Bedroom",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
            "service_accuracy": 800.0,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["service_latitude"] == pytest.approx(HOME[0])


def test_a_point_placed_by_hand_needs_no_accuracy(client, onboard, requester_session):
    """Tapping the map or choosing a search result states no accuracy, because
    the requester chose the point themselves."""
    working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session()
    created = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PAINTER",
            "description": "Bedroom",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
            "service_accuracy": None,
        },
    )
    assert created.status_code == 201, created.text


def test_the_same_pin_code_does_not_mean_the_same_point(client, onboard, requester_session):
    """PIN 505405 covers many villages. Two people inside it are not at 0 m from
    each other, and the distance must come from their coordinates."""
    technician = working(client, onboard, "PAINTER", at=NEAR, pincode="000405")
    _account, headers = requester_session(pincode="000405")

    booking = book(client, headers, "PAINTER", at=HOME).json()
    offer = offers(client, technician)[0]
    assert offer["distance_meters"] > 0, "same PIN code, different coordinates -> a real distance"
    assert offer["distance_meters"] == pytest.approx(800, abs=60)
    assert booking["service_latitude"] == pytest.approx(HOME[0])
