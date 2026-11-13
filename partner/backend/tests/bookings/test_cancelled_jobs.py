"""Cancelled job history for technicians, and telling the technician who had
accepted a job when its requester cancels it.

Existing rules, unchanged: only the requester cancels, and only while the booking
is REQUESTED / SEARCHING / ASSIGNED / ACCEPTED / EN_ROUTE / NO_TECHNICIAN_FOUND.
A cancelled booking keeps its technician_id and records cancelled_at; no reason or
actor is stored.
"""

import pytest
from legacy import bearer, technician_cookie
from legacy_dispatch import AT_HOME, HOME, act, arrive, book, jobs, offer_ids, working

from app.modules.bookings.dependencies import get_routing_service
from app.modules.realtime.router import DISPATCH_SUBPROTOCOL
from app.modules.tracking.routing_service import RouteResult


@pytest.fixture(autouse=True)
def routes(monkeypatch):
    def stub(origin, destination):
        return RouteResult(
            distance_meters=1500.0, duration_seconds=300.0, coordinates=[origin, destination], source="osrm"
        )

    get_routing_service()._routes.clear()
    monkeypatch.setattr(get_routing_service(), "get_route", stub)
    yield
    get_routing_service()._routes.clear()


def accepted_job(client, onboard, requester_session, trade="PLUMBER"):
    technician = working(client, onboard, trade, at=AT_HOME)
    _account, headers = requester_session()
    booking = book(client, headers, trade, description="Kitchen", at=HOME).json()
    assert act(client, technician, booking["id"], "accept").status_code == 200
    return technician, headers, booking["id"]


def cancel(client, headers, booking_id):
    return client.post(f"/requester/bookings/{booking_id}/cancel", headers=headers)


def summary(client, technician):
    return client.get("/technicians/me/dashboard", headers=bearer(technician["access_token"])).json()


# ------------------------------------------------------------------ the bucket


def test_an_accepted_job_that_is_cancelled_moves_to_the_cancelled_history(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    assert [job["id"] for job in jobs(client, technician, "accepted")] == [booking_id]
    assert cancel(client, headers, booking_id).status_code == 200

    assert jobs(client, technician, "accepted") == []
    cancelled = jobs(client, technician, "cancelled")
    assert [job["id"] for job in cancelled] == [booking_id]
    job = cancelled[0]
    assert job["status"] == "CANCELLED" and job["cancelled_at"] and job["accepted_at"]
    assert job["next_actions"] == []  # read-only: nothing to do with it
    # Existing contact rule: name and phone only while the job is live.
    assert job["requester_name"] is None and job["requester_phone"] is None
    assert job["service_address"] and job["pincode"]
    counts = summary(client, technician)
    assert (counts["accepted_jobs"], counts["cancelled_jobs"]) == (0, 1)


def test_a_job_cancelled_on_the_way_leaves_active_for_cancelled(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    assert act(client, technician, booking_id, "en-route").status_code == 200
    assert [job["id"] for job in jobs(client, technician, "active")] == [booking_id]
    assert cancel(client, headers, booking_id).status_code == 200
    assert jobs(client, technician, "active") == []
    assert [job["id"] for job in jobs(client, technician, "cancelled")] == [booking_id]


def test_an_arrived_job_still_cannot_be_cancelled(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    act(client, technician, booking_id, "en-route")
    assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"
    assert cancel(client, headers, booking_id).status_code == 409  # existing rule, unchanged
    assert jobs(client, technician, "cancelled") == []
    assert [job["id"] for job in jobs(client, technician, "active")] == [booking_id]


def test_completed_jobs_are_unaffected(client, onboard, requester_session):
    technician, _headers, booking_id = accepted_job(client, onboard, requester_session)
    act(client, technician, booking_id, "en-route")
    arrive(client, technician, booking_id, HOME)
    act(client, technician, booking_id, "start")
    assert act(client, technician, booking_id, "complete").status_code == 200
    assert [job["id"] for job in jobs(client, technician, "completed")] == [booking_id]
    assert jobs(client, technician, "cancelled") == []


def test_a_request_cancelled_before_anyone_accepted_is_in_nobodys_history(client, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    _account, headers = requester_session()
    booking = book(client, headers, "PLUMBER", at=HOME).json()
    assert booking["id"] in offer_ids(client, technician)
    assert cancel(client, headers, booking["id"]).status_code == 200
    assert jobs(client, technician, "cancelled") == []
    assert summary(client, technician)["cancelled_jobs"] == 0


def test_another_technician_never_sees_the_cancelled_job(client, onboard, requester_session):
    winner = working(client, onboard, "PLUMBER", at=AT_HOME)
    loser = working(client, onboard, "PLUMBER", at=AT_HOME)
    stranger = working(client, onboard, "PAINTER", at=AT_HOME)
    _account, headers = requester_session()
    booking_id = book(client, headers, "PLUMBER", at=HOME).json()["id"]
    assert act(client, winner, booking_id, "accept").status_code == 200
    cancel(client, headers, booking_id)
    assert [job["id"] for job in jobs(client, winner, "cancelled")] == [booking_id]
    for other in (loser, stranger):
        assert jobs(client, other, "cancelled") == []
        assert summary(client, other)["cancelled_jobs"] == 0


def test_a_cancelled_job_is_read_only(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    cancel(client, headers, booking_id)
    for action in ("en-route", "start", "complete"):
        assert act(client, technician, booking_id, action).status_code in (404, 409)
    # Execution details and photos were never reachable for it, and still are not.
    assert (
        client.get(
            f"/technicians/me/jobs/{booking_id}/execution", headers=bearer(technician["access_token"])
        ).status_code
        == 404
    )
    assert jobs(client, technician, "cancelled")[0]["status"] == "CANCELLED"


def test_the_bucket_needs_a_session_and_a_known_name(client, onboard):
    assert client.get("/technicians/me/jobs", params={"bucket": "cancelled"}).status_code == 401
    technician = onboard()
    assert (
        client.get(
            "/technicians/me/jobs", headers=bearer(technician["access_token"]), params={"bucket": "deleted"}
        ).status_code
        == 422
    )


# -------------------------------------------------------------------- realtime


def test_the_technician_who_accepted_is_told_the_moment_it_is_cancelled(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    with client.websocket_connect(
        "/dispatch/ws/technician",
        subprotocols=[DISPATCH_SUBPROTOCOL],
        headers=technician_cookie(technician["access_token"]),
    ) as socket:
        assert cancel(client, headers, booking_id).status_code == 200
        frame = socket.receive_json()
        assert frame == {"type": "job_cancelled", "booking_id": booking_id}  # nothing identifying


def test_the_same_holds_while_on_the_way(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    act(client, technician, booking_id, "en-route")
    with client.websocket_connect(
        "/dispatch/ws/technician",
        subprotocols=[DISPATCH_SUBPROTOCOL],
        headers=technician_cookie(technician["access_token"]),
    ) as socket:
        cancel(client, headers, booking_id)
        assert socket.receive_json() == {"type": "job_cancelled", "booking_id": booking_id}


def test_uninvolved_technicians_hear_nothing(client, onboard, requester_session):
    technician, headers, booking_id = accepted_job(client, onboard, requester_session)
    bystander = working(client, onboard, "PAINTER", at=AT_HOME)
    with client.websocket_connect(
        "/dispatch/ws/technician",
        subprotocols=[DISPATCH_SUBPROTOCOL],
        headers=technician_cookie(bystander["access_token"]),
    ) as socket:
        cancel(client, headers, booking_id)
        socket.send_json({"type": "ping"})
        assert socket.receive_json()["type"] == "pong"  # the very next frame: no cancellation for them


def test_a_request_still_on_offer_is_withdrawn_as_before(client, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    _account, headers = requester_session()
    with client.websocket_connect(
        "/dispatch/ws/technician",
        subprotocols=[DISPATCH_SUBPROTOCOL],
        headers=technician_cookie(technician["access_token"]),
    ) as socket:
        booking_id = book(client, headers, "PLUMBER", at=HOME).json()["id"]
        assert socket.receive_json()["type"] == "booking_offer"
        cancel(client, headers, booking_id)
        # The same event, now saying why the card goes.
        assert socket.receive_json() == {
            "type": "booking_taken",
            "booking_id": booking_id,
            "reason": "CUSTOMER_CANCELLED",
        }
