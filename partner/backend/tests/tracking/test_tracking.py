"""Live tracking after a technician accepts a booking.

There is one way a position enters the system -- POST /technicians/me/location --
and one place it is kept, `technician_locations`. The customer's map shows the
position of whichever technician holds the booking right now, while it is
ACCEPTED, EN_ROUTE or ARRIVED.

Everything here runs through the real API against the real `partner` schema,
inside the rolled-back transaction the shared fixtures set up. OSRM is never
called: the process-wide routing service is given a counting stub, which also
lets the cache and the refresh throttle be asserted exactly.
"""

import time
import uuid

import pytest
from fastapi import WebSocketDisconnect
from legacy import bearer, requester_cookie
from legacy_dispatch import AT_HOME, act, arrive, book, code_of, offer_ids, working
from sqlalchemy import text

from app.core.runtime import settings
from app.core.runtime import settings as running_settings
from app.core.security.access_tokens import read_requester_access
from app.modules.bookings.dependencies import get_routing_service
from app.modules.realtime.router import TRACKING_SUBPROTOCOL
from app.modules.tracking.routing_service import RouteResult

HYDERABAD = AT_HOME
# Where the accepted technician starts: ~2.4 km north of the address.
START = (17.4700, 78.3915)
# ~1.5 km north of the address, along a plausible pair of road points.
ON_THE_WAY = (17.4620, 78.3915)
NEARBY = (17.4618, 78.3916)


def publish(client, auth, point, **extra):
    """One fix from the technician's app, through the one location endpoint."""
    return client.post(
        "/technicians/me/location",
        headers=bearer(auth["access_token"]),
        json={"latitude": point[0], "longitude": point[1], **extra},
    )


def snapshot(client, headers, booking_id):
    response = client.get(f"/tracking/bookings/{booking_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def set_destination(client, headers, booking_id, point=HYDERABAD):
    return client.put(
        f"/tracking/bookings/{booking_id}/destination",
        headers=headers,
        json={"latitude": point[0], "longitude": point[1], "accuracy": 12.0},
    )


@pytest.fixture()
def accepted(client, onboard, requester_session):
    """A real booking through the existing flow, accepted by the offered technician."""

    def create(trade="PAINTER", **account):
        technician = working(client, onboard, trade, at=START)
        _account_id, headers = requester_session(**account)
        booking = book(client, headers, trade, at=HYDERABAD).json()
        assert booking["status"] == "OFFERED", booking
        assert offer_ids(client, technician) == [booking["id"]]
        assert act(client, technician, booking["id"], "accept").status_code == 200
        return technician, headers, booking["id"]

    return create


class CountingRoutes:
    """Stands in for OSRM. Records every call so the cache can be asserted."""

    def __init__(self):
        self.calls = []

    def __call__(self, origin, destination):
        self.calls.append((origin, destination))
        return RouteResult(
            distance_meters=1500.0, duration_seconds=300.0, coordinates=[origin, destination], source="osrm"
        )


@pytest.fixture(autouse=True)
def routes(monkeypatch):
    """No network, and an empty route cache for every test."""
    get_routing_service()._routes.clear()
    stub = CountingRoutes()
    monkeypatch.setattr(get_routing_service(), "get_route", stub)
    yield stub
    get_routing_service()._routes.clear()


# ------------------------------------------------------- before an acceptance


def test_tracking_is_closed_until_the_technician_accepts(client, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=START)
    _account_id, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HYDERABAD).json()

    assert booking["status"] == "OFFERED"
    view = snapshot(client, headers, booking["id"])
    assert view["is_live"] is False and view["position"] is None and view["route"] is None

    # A technician who has only been OFFERED the job keeps reporting, as everyone
    # waiting for work does, but none of it reaches this customer's map.
    answer = publish(client, technician, ON_THE_WAY, accuracy=8.0)
    assert answer.status_code == 200 and answer.json()["active_job"] is None
    assert snapshot(client, headers, booking["id"])["position"] is None


# ------------------------------------------------------------- authorisation


def test_only_the_technician_holding_the_booking_appears_on_its_map(client, accepted, onboard):
    technician, headers, booking_id = accepted()
    other = working(client, onboard, "PAINTER", at=NEARBY, pincode="000901")

    # Somebody else's position is theirs alone: it never reaches this booking.
    assert publish(client, other, ON_THE_WAY, accuracy=5.0).status_code == 200
    assert snapshot(client, headers, booking_id)["position"]["latitude"] == pytest.approx(START[0])

    assert publish(client, technician, ON_THE_WAY, accuracy=5.0).status_code == 200
    assert snapshot(client, headers, booking_id)["position"]["latitude"] == pytest.approx(ON_THE_WAY[0])


def test_a_body_cannot_claim_another_technician_or_job(client, accepted, onboard):
    """There is no technician id and no booking id in the API: extra fields are ignored."""
    technician, headers, booking_id = accepted()
    other = working(client, onboard, "PAINTER", at=NEARBY, pincode="000901")
    response = publish(client, other, ON_THE_WAY, technician_id=technician["user"]["id"], booking_id=booking_id)
    assert response.status_code == 200 and response.json()["active_job"] is None
    assert snapshot(client, headers, booking_id)["position"]["latitude"] == pytest.approx(START[0])


def test_only_the_requester_who_booked_may_watch(client, accepted, requester_session):
    _technician, headers, booking_id = accepted()
    _other_id, other_headers = requester_session()
    # Changing the booking id in the address bar reaches a 404, not a technician.
    assert client.get(f"/tracking/bookings/{booking_id}", headers=other_headers).status_code == 404
    assert set_destination(client, other_headers, booking_id).status_code == 404
    assert client.get(f"/tracking/bookings/{booking_id}", headers=headers).status_code == 200


def test_tracking_needs_a_session(client, accepted):
    _technician, _headers, booking_id = accepted()
    assert client.get(f"/tracking/bookings/{booking_id}").status_code == 401
    assert client.post("/technicians/me/location", json={"latitude": 17.4, "longitude": 78.4}).status_code == 401


def test_a_technician_token_cannot_read_the_requester_view(client, accepted):
    technician, _headers, booking_id = accepted()
    assert client.get(f"/tracking/bookings/{booking_id}", headers=bearer(technician["access_token"])).status_code == 401


# --------------------------------------------------------- the live positions


def test_the_requester_sees_the_technician_from_the_moment_they_accept(client, accepted):
    technician, headers, booking_id = accepted()
    first = snapshot(client, headers, booking_id)
    assert first["is_live"] is True and first["status"] == "ACCEPTED"
    assert first["position"]["latitude"] == pytest.approx(START[0])
    assert first["stale_after_seconds"] == 15

    answer = publish(client, technician, ON_THE_WAY, accuracy=8.0, speed=4.2)
    assert answer.status_code == 200
    assert answer.json()["active_job"]["booking_id"] == booking_id
    second = snapshot(client, headers, booking_id)
    assert second["position"]["latitude"] == pytest.approx(ON_THE_WAY[0])
    assert second["position"]["accuracy"] == pytest.approx(8.0)
    assert second["route"]["source"] == "osrm" and second["eta_basis"] == "road_route"
    assert second["technician"]["name"]

    closer = (17.4520, 78.3915)
    assert publish(client, technician, closer).status_code == 200
    third = snapshot(client, headers, booking_id)
    assert third["position"]["latitude"] == pytest.approx(closer[0])
    assert third["distance_remaining_meters"] < second["distance_remaining_meters"]
    assert third["eta_seconds"] < second["eta_seconds"]


def test_one_booking_keeps_exactly_one_tracking_row_and_one_position(client, connection, accepted):
    technician, headers, booking_id = accepted()
    assert set_destination(client, headers, booking_id).status_code == 200
    for point in (ON_THE_WAY, NEARBY, (17.4550, 78.3920), (17.4500, 78.3918)):
        assert publish(client, technician, point).status_code == 200

    assert (
        connection.exec_driver_sql(
            "SELECT count(*) FROM partner.booking_destinations WHERE booking_id = %s", (booking_id,)
        ).scalar()
        == 1
    )
    assert (
        connection.exec_driver_sql(
            "SELECT count(*) FROM partner.technician_locations WHERE technician_id = %s", (technician["user"]["id"],)
        ).scalar()
        == 1
    )


def test_the_destination_is_the_point_chosen_when_booking(client, accepted):
    _technician, headers, booking_id = accepted()
    view = snapshot(client, headers, booking_id)
    assert view["destination"] == {"latitude": pytest.approx(HYDERABAD[0]), "longitude": pytest.approx(HYDERABAD[1])}
    assert view["route"] is not None


def test_zero_zero_is_refused_as_a_position(client, accepted):
    technician, _headers, _booking_id = accepted()
    assert publish(client, technician, (0.0, 0.0)).status_code == 422


# ------------------------------------------------------------ OSRM throttling


def test_osrm_is_not_called_for_every_fix(client, accepted, routes):
    technician, headers, booking_id = accepted()
    assert routes.calls == []

    assert publish(client, technician, ON_THE_WAY).status_code == 200
    assert len(routes.calls) == 1, "the first fix of a journey plans the route"

    for point in (NEARBY, (17.4619, 78.3914), (17.4617, 78.3917)):
        assert publish(client, technician, point).status_code == 200
    assert len(routes.calls) == 1, "further fixes on the planned route reuse the cached one"

    for _ in range(3):
        snapshot(client, headers, booking_id)
    assert len(routes.calls) == 1


def test_moving_the_destination_replans_the_route(client, accepted, routes):
    technician, headers, booking_id = accepted()
    assert publish(client, technician, ON_THE_WAY).status_code == 200
    assert len(routes.calls) == 1

    moved = (17.4400, 78.3800)
    assert set_destination(client, headers, booking_id, moved).status_code == 200
    assert len(routes.calls) == 2
    assert routes.calls[-1][1] == pytest.approx(moved)


def test_a_technician_far_off_the_route_is_replanned_once_the_guard_has_passed(client, accepted, routes):
    technician, _headers, booking_id = accepted()
    assert publish(client, technician, ON_THE_WAY).status_code == 200
    assert len(routes.calls) == 1

    far_away = (17.5200, 78.5000)
    assert publish(client, technician, far_away).status_code == 200
    assert len(routes.calls) == 1

    get_routing_service()._routes[uuid.UUID(booking_id)].fetched_at -= 6.0
    assert publish(client, technician, far_away).status_code == 200
    assert len(routes.calls) == 2
    assert routes.calls[-1][0] == pytest.approx(far_away)


# ------------------------------------------------------------- stop tracking


@pytest.mark.parametrize("finish", ["complete", "cancel"])
def test_tracking_stops_when_the_booking_ends(client, accepted, finish):
    technician, headers, booking_id = accepted()
    assert publish(client, technician, ON_THE_WAY).status_code == 200
    assert snapshot(client, headers, booking_id)["position"] is not None

    if finish == "complete":
        assert act(client, technician, booking_id, "en-route").status_code == 200
        arrive(client, technician, booking_id, HYDERABAD)
        for action in ("start", "complete"):
            assert act(client, technician, booking_id, action).status_code == 200, action
        expected_status = "COMPLETED"
    else:
        assert client.post(f"/requester/bookings/{booking_id}/cancel", headers=headers).status_code == 200
        expected_status = "CANCELLED"

    closed = snapshot(client, headers, booking_id)
    assert closed["status"] == expected_status
    assert closed["is_live"] is False
    assert closed["position"] is None, "a finished booking shows no technician location"
    assert closed["route"] is None

    # The phone keeps reporting (the technician is still working), but no longer for this job.
    answer = publish(client, technician, NEARBY)
    assert answer.status_code == 200 and answer.json()["active_job"] is None
    assert snapshot(client, headers, booking_id)["position"] is None


def test_the_position_is_not_shown_once_work_has_started(client, accepted):
    technician, headers, booking_id = accepted()
    assert act(client, technician, booking_id, "en-route").status_code == 200
    arrive(client, technician, booking_id, HYDERABAD)
    assert act(client, technician, booking_id, "start").status_code == 200

    answer = publish(client, technician, NEARBY)
    assert answer.status_code == 200
    assert answer.json()["active_job"]["sharing_allowed"] is False
    view = snapshot(client, headers, booking_id)
    assert view["status"] == "IN_PROGRESS" and view["is_live"] is False and view["position"] is None


def test_sharing_status_tells_the_technician_when_it_is_open(client, accepted):
    technician, _headers, booking_id = accepted()
    response = client.get(f"/tracking/bookings/{booking_id}/sharing", headers=bearer(technician["access_token"]))
    assert response.status_code == 200 and response.json()["sharing_allowed"] is True

    assert act(client, technician, booking_id, "en-route").status_code == 200
    arrive(client, technician, booking_id, HYDERABAD)
    assert act(client, technician, booking_id, "start").status_code == 200
    response = client.get(f"/tracking/bookings/{booking_id}/sharing", headers=bearer(technician["access_token"]))
    assert response.status_code == 200 and response.json()["sharing_allowed"] is False


def test_a_new_holder_is_shown_not_the_previous_one(client, connection, onboard, requester_session):
    """The map reads the position of whoever holds the booking NOW, so a booking
    that moves on can never keep showing the previous technician."""
    first = working(client, onboard, "CARPENTER", at=START)
    second = working(client, onboard, "CARPENTER", at=NEARBY)
    _account_id, headers = requester_session()
    booking = book(client, headers, "CARPENTER", at=HYDERABAD).json()

    assert act(client, first, booking["id"], "accept").status_code == 200
    assert publish(client, first, ON_THE_WAY).status_code == 200
    assert snapshot(client, headers, booking["id"])["position"]["latitude"] == pytest.approx(ON_THE_WAY[0])

    connection.exec_driver_sql(
        "UPDATE partner.bookings SET technician_id = %s WHERE id = %s",
        (str(second["user"]["id"]), booking["id"]),
    )
    view = snapshot(client, headers, booking["id"])
    assert view["position"]["latitude"] == pytest.approx(NEARBY[0]), "the current holder, not the previous one"


# ---------------------------------------------------------------- websocket


def test_the_websocket_streams_the_snapshot_and_live_positions(client, accepted):
    technician, headers, booking_id = accepted()
    token = headers["Authorization"].split(" ", 1)[1]

    with client.websocket_connect(
        f"/tracking/ws/bookings/{booking_id}", subprotocols=[TRACKING_SUBPROTOCOL], headers=requester_cookie(token)
    ) as socket:
        first = socket.receive_json()
        assert first["type"] == "tracking_snapshot"
        assert first["tracking"]["booking_id"] == booking_id
        assert first["tracking"]["position"]["latitude"] == pytest.approx(START[0])

        assert publish(client, technician, ON_THE_WAY).status_code == 200
        location = socket.receive_json()
        assert location["type"] == "technician_location"
        assert location["latitude"] == pytest.approx(ON_THE_WAY[0])
        assert location["distance_remaining_meters"] > 0 and location["eta_seconds"] > 0
        assert location["status"] == "ACCEPTED" and location["booking_id"] == booking_id

        socket.send_json({"type": "ping"})
        assert socket.receive_json()["type"] == "pong"


def test_the_websocket_refuses_anyone_but_the_requester(client, accepted, requester_session):
    _technician, headers, booking_id = accepted()
    _other_id, other_headers = requester_session()
    own = headers["Authorization"].split(" ", 1)[1]
    refused = {
        "another requester's session": (
            [TRACKING_SUBPROTOCOL],
            requester_cookie(other_headers["Authorization"].split(" ", 1)[1]),
        ),
        "no session at all": ([TRACKING_SUBPROTOCOL], {}),
        "a token that is not a session": ([TRACKING_SUBPROTOCOL], requester_cookie("not-a-token")),
        "the wrong subprotocol": (["something.else"], requester_cookie(own)),
        "another site's page": ([TRACKING_SUBPROTOCOL], {**requester_cookie(own), "origin": "https://evil.example"}),
    }
    for label, (subprotocols, socket_headers) in refused.items():
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/tracking/ws/bookings/{booking_id}", subprotocols=subprotocols, headers=socket_headers
            ) as socket:
                socket.receive_json()
        assert True, label


def test_an_open_tracking_socket_ends_with_its_booking_session(client, accepted, connection, monkeypatch):
    """Live GPS stops when the requester's session ends -- signed out, expired, or
    the account suspended -- not only at the next handshake."""
    monkeypatch.setattr(settings, "websocket_session_recheck_seconds", 0.2)

    def closed(socket):
        try:
            socket.send_json({"type": "ping"})
            while socket.receive_json()["type"] != "pong":
                pass
        except WebSocketDisconnect:
            return True
        return False

    endings = {
        "signed out": lambda claims: connection.execute(
            text("UPDATE partner.sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE token_family_id = :f"),
            {"f": claims.family_id},
        ),
        "expired": lambda claims: connection.execute(
            text("UPDATE partner.sessions SET expires_at = now() - interval '1 minute' WHERE token_family_id = :f"),
            {"f": claims.family_id},
        ),
        "suspended": lambda claims: connection.execute(
            text("UPDATE partner.v_partner_requesters SET status = 'SUSPENDED' WHERE id = :id"), {"id": claims.user_id}
        ),
    }
    for label, end in endings.items():
        _technician, headers, booking_id = accepted()
        token = headers["Authorization"].split(" ", 1)[1]
        with client.websocket_connect(
            f"/tracking/ws/bookings/{booking_id}", subprotocols=[TRACKING_SUBPROTOCOL], headers=requester_cookie(token)
        ) as socket:
            assert socket.receive_json()["type"] == "tracking_snapshot"
            time.sleep(0.5)
            assert not closed(socket), f"a live session keeps its socket ({label})"
            end(read_requester_access(running_settings, token))
            time.sleep(0.6)
            assert closed(socket), label


def test_the_websocket_says_when_a_journey_has_ended(client, accepted):
    technician, headers, booking_id = accepted()
    token = headers["Authorization"].split(" ", 1)[1]
    assert act(client, technician, booking_id, "en-route").status_code == 200
    arrive(client, technician, booking_id, HYDERABAD)

    with client.websocket_connect(
        f"/tracking/ws/bookings/{booking_id}", subprotocols=[TRACKING_SUBPROTOCOL], headers=requester_cookie(token)
    ) as socket:
        assert socket.receive_json()["type"] == "tracking_snapshot"
        assert act(client, technician, booking_id, "start").status_code == 200
        seen = {}
        for _ in range(2):
            message = socket.receive_json()
            seen[message["type"]] = message
        assert seen["booking_status"]["status"] == "IN_PROGRESS"
        assert seen["tracking_stopped"]["status"] == "IN_PROGRESS"


def test_an_ip_derived_fix_is_refused_as_a_journey_position(client, accepted):
    technician, headers, booking_id = accepted()
    refused = publish(client, technician, (17.458, 78.4336), accuracy=50000.0)
    assert refused.status_code == 422 and code_of(refused) == "LOCATION_IMPRECISE"
    assert snapshot(client, headers, booking_id)["position"]["latitude"] == pytest.approx(START[0]), (
        "a guess is not stored"
    )

    assert publish(client, technician, ON_THE_WAY, accuracy=12.0).status_code == 200
    assert snapshot(client, headers, booking_id)["position"]["latitude"] == pytest.approx(ON_THE_WAY[0])


def test_a_technician_apart_from_the_destination_gives_a_real_distance_and_eta(client, accepted):
    technician, headers, booking_id = accepted()
    assert publish(client, technician, ON_THE_WAY, accuracy=10.0).status_code == 200
    view = snapshot(client, headers, booking_id)
    assert view["destination"]["latitude"] == pytest.approx(HYDERABAD[0])
    assert view["position"]["latitude"] == pytest.approx(ON_THE_WAY[0])
    assert view["distance_remaining_meters"] > 0 and view["eta_seconds"] > 0


# ------------------------------------------------------------------- arriving

BADANAPALLI = (18.4386, 79.1288)
THADOOR = (18.4700, 79.1600)


def at_metres_north(point, metres):
    return (point[0] + metres / 111195.0, point[1])


def test_arriving_is_decided_by_distance_not_by_a_button(client, accepted):
    technician, headers, booking_id = accepted()
    assert act(client, technician, booking_id, "en-route").status_code == 200

    assert publish(client, technician, at_metres_north(HYDERABAD, 430), accuracy=10.0).status_code == 200
    view = snapshot(client, headers, booking_id)
    assert view["status"] == "EN_ROUTE" and view["distance_remaining_meters"] > 400

    refused = act(client, technician, booking_id, "arrived")
    assert refused.status_code == 409, refused.text
    assert "0.43 km from the address" in refused.json()["detail"]["message"]
    assert snapshot(client, headers, booking_id)["status"] == "EN_ROUTE"

    answer = publish(client, technician, at_metres_north(HYDERABAD, 15), accuracy=8.0)
    assert answer.status_code == 200 and answer.json()["active_job"]["status"] == "ARRIVED"
    assert snapshot(client, headers, booking_id)["status"] == "ARRIVED"


def test_a_vague_fix_at_the_door_does_not_mark_arrival(client, accepted):
    technician, headers, booking_id = accepted()
    assert act(client, technician, booking_id, "en-route").status_code == 200
    assert publish(client, technician, at_metres_north(HYDERABAD, 10), accuracy=400.0).status_code == 200
    assert snapshot(client, headers, booking_id)["status"] == "EN_ROUTE"
    assert publish(client, technician, at_metres_north(HYDERABAD, 10), accuracy=9.0).status_code == 200
    assert snapshot(client, headers, booking_id)["status"] == "ARRIVED"


def test_accepting_does_not_start_the_journey_by_itself(client, accepted):
    technician, headers, booking_id = accepted()
    assert snapshot(client, headers, booking_id)["status"] == "ACCEPTED"
    assert publish(client, technician, HYDERABAD, accuracy=5.0).status_code == 200
    assert snapshot(client, headers, booking_id)["status"] == "ACCEPTED"
    assert act(client, technician, booking_id, "en-route").status_code == 200
    assert snapshot(client, headers, booking_id)["status"] == "EN_ROUTE"


def test_two_villages_in_one_pin_code_are_a_real_journey(client, onboard, requester_session, routes):
    technician = working(client, onboard, "PAINTER", at=THADOOR, pincode="000405")
    _account, headers = requester_session(pincode="000405")
    booking = book(client, headers, "PAINTER", at=BADANAPALLI).json()
    assert act(client, technician, booking["id"], "accept").status_code == 200
    assert act(client, technician, booking["id"], "en-route").status_code == 200

    assert publish(client, technician, THADOOR, accuracy=10.0).status_code == 200
    view = snapshot(client, headers, booking["id"])
    assert view["status"] == "EN_ROUTE"
    assert view["distance_remaining_meters"] > 1000 and view["eta_seconds"] > 0
    origin, destination = routes.calls[-1]
    assert origin == pytest.approx(THADOOR) and destination == pytest.approx(BADANAPALLI)


# ------------------------------------------- the technician's navigation view


def nav(client, auth, booking_id):
    response = client.get(f"/tracking/bookings/{booking_id}/sharing", headers=bearer(auth["access_token"]))
    assert response.status_code == 200, response.text
    return response.json()


def test_an_accepted_job_carries_a_route_to_the_address_at_once(client, accepted, routes):
    """The moment a job is accepted, the route is drawn from where the technician is."""
    technician, _headers, booking_id = accepted()
    view = nav(client, technician, booking_id)
    assert view["destination"] == {"latitude": pytest.approx(HYDERABAD[0]), "longitude": pytest.approx(HYDERABAD[1])}
    assert view["position"]["latitude"] == pytest.approx(START[0])
    assert view["route"]["source"] == "osrm" and len(view["route"]["geometry"]["coordinates"]) >= 2
    assert view["distance_remaining_meters"] > 0 and view["eta_seconds"] > 0
    assert view["sharing_allowed"] is True
    origin, destination = routes.calls[-1]
    assert origin == pytest.approx(START) and destination == pytest.approx(HYDERABAD)


def test_the_navigation_view_belongs_to_the_technician_holding_the_job(client, accepted, onboard):
    technician, _headers, booking_id = accepted()
    stranger = working(client, onboard, "PAINTER", at=AT_HOME, pincode="000901")
    assert nav(client, technician, booking_id)["booking_id"] == booking_id
    refused = client.get(f"/tracking/bookings/{booking_id}/sharing", headers=bearer(stranger["access_token"]))
    assert refused.status_code == 404, refused.text


def test_the_journey_keeps_running_across_the_whole_trip(client, accepted):
    technician, headers, booking_id = accepted()
    assert act(client, technician, booking_id, "en-route").status_code == 200
    for point in (ON_THE_WAY, (17.4560, 78.3915), (17.4520, 78.3915)):
        answer = publish(client, technician, point, accuracy=9.0)
        assert answer.status_code == 200 and answer.json()["active_job"]["sharing_allowed"] is True
    view = snapshot(client, headers, booking_id)
    assert view["status"] == "EN_ROUTE" and view["distance_remaining_meters"] > 0
