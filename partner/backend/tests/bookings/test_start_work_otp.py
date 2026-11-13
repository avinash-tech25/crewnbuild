"""Start Work OTP (0012): ARRIVED -> IN_PROGRESS only with the customer's code.

Everything runs in the rolled-back test transaction, except the committed
concurrency test at the end, which only runs on a disposable database.
"""

import logging
import os
import re
import threading
import uuid

import pytest
from conftest import REQUESTERS_STAND_IN
from fastapi import HTTPException
from legacy import bearer
from legacy_dispatch import AT_HOME, FAR, HOME, act, arrive, book, working
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.modules.bookings.dependencies import build_dispatch_service
from app.modules.bookings.repository import ServiceRequestRepository
from app.modules.identity.models import Technician

pytestmark = pytest.mark.usefixtures("fast_limits")


@pytest.fixture()
def fast_limits(monkeypatch):
    monkeypatch.setattr(settings, "start_otp_ttl_minutes", 30)
    monkeypatch.setattr(settings, "start_otp_max_attempts", 5)
    monkeypatch.setattr(settings, "start_otp_regenerate_cooldown_seconds", 30)
    monkeypatch.setattr(settings, "start_otp_max_codes_per_hour", 10)


@pytest.fixture()
def job(client, onboard, requester_session):
    """A booking walked to `to` by a fresh technician; returns (technician, owner headers, booking id)."""

    def create(to="ARRIVED", trade="PLUMBER"):
        technician = working(client, onboard, trade, at=AT_HOME)
        _account, headers = requester_session()
        booking_id = book(client, headers, trade, at=HOME).json()["id"]
        assert act(client, technician, booking_id, "accept").status_code == 200
        if to in ("EN_ROUTE", "ARRIVED"):
            assert act(client, technician, booking_id, "en-route").status_code == 200
        if to == "ARRIVED":
            assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"
        return technician, headers, booking_id

    return create


def view(client, headers, booking_id):
    return client.get(f"/requester/bookings/{booking_id}/start-otp", headers=headers)


def regenerate(client, headers, booking_id):
    return client.post(f"/requester/bookings/{booking_id}/start-otp/regenerate", headers=headers)


def start(client, technician, booking_id, otp):
    return client.post(
        f"/technicians/me/jobs/{booking_id}/start", headers=bearer(technician["access_token"]), json={"otp": otp}
    )


def rows(connection, booking_id):
    return (
        connection.execute(
            text(
                "SELECT status, code_ciphertext, code_digest, failed_attempts, consumed_at, consumed_by_technician_id, closed_at "
                "FROM partner.booking_start_codes WHERE booking_id = :b ORDER BY created_at"
            ),
            {"b": booking_id},
        )
        .mappings()
        .all()
    )


def booking_row(connection, booking_id):
    return (
        connection.execute(text("SELECT status, started_at FROM partner.bookings WHERE id = :b"), {"b": booking_id})
        .mappings()
        .one()
    )


def wrong(code):
    return f"{(int(code) + 1) % 10**6:06d}"


# =========================================================== before arrival


@pytest.mark.parametrize("to", ["ACCEPTED", "EN_ROUTE"])
def test_no_code_exists_before_arrival(client, job, connection, to):
    technician, headers, booking_id = job(to)
    body = view(client, headers, booking_id).json()
    assert body["state"] == "WAITING_FOR_ARRIVAL" and body["code"] is None
    assert rows(connection, booking_id) == []  # nothing issued
    assert regenerate(client, headers, booking_id).status_code == 409
    # And starting is impossible before arrival, whatever is sent.
    assert start(client, technician, booking_id, "123456").status_code == 409
    assert booking_row(connection, booking_id)["status"] == to


def test_gps_arrival_is_still_required(client, onboard, requester_session, connection):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    _account, headers = requester_session()
    booking_id = book(client, headers, "PLUMBER", at=HOME).json()["id"]
    act(client, technician, booking_id, "accept")
    act(client, technician, booking_id, "en-route")
    # 3.4 km away: the position does not arrive, and claiming arrival is refused.
    assert arrive(client, technician, booking_id, FAR)["status"] == "EN_ROUTE"
    assert act(client, technician, booking_id, "arrived").status_code == 409
    assert view(client, headers, booking_id).json()["state"] == "WAITING_FOR_ARRIVAL"


# ============================================================ the customer


def test_the_owner_sees_one_six_digit_code_that_stays_the_same(client, job, connection):
    _technician, headers, booking_id = job()
    first = view(client, headers, booking_id)
    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-store"
    body = first.json()
    assert body["state"] == "READY" and re.fullmatch(r"[0-9]{6}", body["code"]) and body["expires_at"]
    assert body["message"].startswith("Share this code with the technician only when you are ready")
    assert view(client, headers, booking_id).json()["code"] == body["code"]  # same code while valid
    stored = rows(connection, booking_id)
    assert len(stored) == 1 and stored[0]["status"] == "ACTIVE"
    assert body["code"] not in stored[0]["code_ciphertext"] and body["code"] not in stored[0]["code_digest"]
    assert re.fullmatch(r"[0-9a-f]{64}", stored[0]["code_digest"])


def test_another_customer_cannot_see_or_refresh_it(client, job, requester_session):
    _technician, headers, booking_id = job()
    assert view(client, headers, booking_id).status_code == 200
    _other, other_headers = requester_session()
    assert view(client, other_headers, booking_id).status_code == 404
    assert regenerate(client, other_headers, booking_id).status_code == 404
    assert view(client, headers, uuid.uuid4()).status_code == 404
    assert client.get(f"/requester/bookings/{booking_id}/start-otp").status_code == 401


def test_the_technician_never_receives_the_code(client, job):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    tech = bearer(technician["access_token"])
    reads = [
        client.get("/technicians/me/jobs", headers=tech, params={"bucket": bucket})
        for bucket in ("accepted", "active", "completed")
    ] + [
        client.get(f"/technicians/me/jobs/{booking_id}/execution", headers=tech),
        client.get("/technicians/me/offers", headers=tech),
        client.get("/technicians/me/dashboard", headers=tech),
        client.get("/auth/me", headers=tech),
        client.get(f"/tracking/bookings/{booking_id}/sharing", headers=tech),
        start(client, technician, booking_id, wrong(code)),  # a failed attempt says nothing either
    ]
    for response in reads:
        assert code not in response.text, response.request.url
    # The customer's endpoints refuse a technician session outright.
    assert client.get(f"/requester/bookings/{booking_id}/start-otp", headers=tech).status_code == 401
    # The customer's general booking response carries no code either.
    assert code not in client.get(f"/requester/bookings/{booking_id}", headers=headers).text


# ========================================================= the technician


def test_the_right_code_starts_the_job_once(client, job, connection):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    response = start(client, technician, booking_id, code)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "IN_PROGRESS" and code not in response.text
    started = booking_row(connection, booking_id)
    assert started["status"] == "IN_PROGRESS" and started["started_at"] is not None
    stored = rows(connection, booking_id)[0]
    assert stored["status"] == "CONSUMED" and stored["code_ciphertext"] is None and stored["consumed_at"] is not None
    assert str(stored["consumed_by_technician_id"]) == technician["user"]["id"]
    # Not shown any more; cannot be used again; started_at is not rewritten.
    after = view(client, headers, booking_id).json()
    assert after["state"] == "WORK_STARTED" and after["code"] is None
    assert start(client, technician, booking_id, code).status_code == 409
    assert booking_row(connection, booking_id)["started_at"] == started["started_at"]


def test_a_wrong_code_does_not_start_and_is_counted(client, job, connection):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    refused = start(client, technician, booking_id, wrong(code))
    assert refused.status_code == 400
    assert refused.json()["detail"] == "Incorrect OTP. Please check the code with the customer. 4 tries left."
    assert booking_row(connection, booking_id)["status"] == "ARRIVED"
    assert rows(connection, booking_id)[0]["failed_attempts"] == 1
    # A malformed code is refused without spending a try.
    for malformed in ("", "12345", "1234567", "12a456", " 12 34 "):
        assert start(client, technician, booking_id, malformed).status_code == 422
    assert rows(connection, booking_id)[0]["failed_attempts"] == 1
    assert start(client, technician, booking_id, code).status_code == 200


def test_five_wrong_codes_lock_it_until_the_customer_gets_a_new_one(client, job, connection):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    for attempt in range(1, 5):
        assert start(client, technician, booking_id, wrong(code)).status_code == 400
    locked = start(client, technician, booking_id, wrong(code))
    assert locked.status_code == 409 and "Ask the customer to get a new code" in locked.json()["detail"]
    stored = rows(connection, booking_id)[0]
    assert stored["status"] == "LOCKED" and stored["code_ciphertext"] is None and stored["failed_attempts"] == 5
    # Even the right code no longer works: no more guessing on this one.
    assert start(client, technician, booking_id, code).status_code == 409
    state = view(client, headers, booking_id).json()
    assert state["state"] == "LOCKED" and state["code"] is None and state["can_regenerate"] is True
    # The customer can get a new code (after the 30 s cooldown) -- no permanent lockout.
    assert regenerate(client, headers, booking_id).status_code == 429
    connection.execute(
        text(
            "UPDATE partner.booking_start_codes SET created_at = created_at - interval '1 minute', "
            "expires_at = expires_at - interval '1 minute' WHERE booking_id = :b"
        ),
        {"b": booking_id},
    )
    fresh = regenerate(client, headers, booking_id).json()
    assert fresh["state"] == "READY" and fresh["code"]
    assert start(client, technician, booking_id, fresh["code"]).status_code == 200


def test_a_new_code_replaces_the_old_one(client, job, connection):
    technician, headers, booking_id = job()
    old = view(client, headers, booking_id).json()["code"]
    connection.execute(
        text(  # step past the 30 s cooldown
            "UPDATE partner.booking_start_codes SET created_at = created_at - interval '1 minute' WHERE booking_id = :b"
        ),
        {"b": booking_id},
    )
    new = regenerate(client, headers, booking_id)
    assert new.status_code == 200 and new.headers["cache-control"] == "no-store"
    new_code = new.json()["code"]
    first, second = rows(connection, booking_id)
    assert first["status"] == "SUPERSEDED" and first["code_ciphertext"] is None and first["closed_at"] is not None
    assert second["status"] == "ACTIVE"
    if old != new_code:  # one chance in a million they coincide
        assert start(client, technician, booking_id, old).status_code == 400
    assert start(client, technician, booking_id, new_code).status_code == 200


def test_regeneration_has_a_cooldown_and_an_hourly_cap_but_no_permanent_lockout(client, job, connection, monkeypatch):
    _technician, headers, booking_id = job()
    view(client, headers, booking_id)
    too_soon = regenerate(client, headers, booking_id)
    assert too_soon.status_code == 429 and int(too_soon.headers["retry-after"]) >= 1
    monkeypatch.setattr(settings, "start_otp_regenerate_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "start_otp_max_codes_per_hour", 3)
    assert regenerate(client, headers, booking_id).status_code == 200
    assert regenerate(client, headers, booking_id).status_code == 200  # 3 codes this hour
    capped = regenerate(client, headers, booking_id)
    assert capped.status_code == 429 and int(capped.headers["retry-after"]) > 0
    # The current code still shows while capped.
    assert view(client, headers, booking_id).json()["state"] == "READY"
    # An hour later, a new code again.
    connection.execute(
        text(
            "UPDATE partner.booking_start_codes SET created_at = created_at - interval '2 hours', "
            "expires_at = expires_at - interval '2 hours' WHERE booking_id = :b"
        ),
        {"b": booking_id},
    )
    fresh = view(client, headers, booking_id).json()
    assert fresh["state"] == "READY" and fresh["code"]


def test_an_expired_code_does_not_start_and_the_next_view_issues_a_new_one(client, job, connection):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    connection.execute(
        text(
            "UPDATE partner.booking_start_codes SET created_at = created_at - interval '40 minutes', "
            "expires_at = now() - interval '1 minute' WHERE booking_id = :b"
        ),
        {"b": booking_id},
    )
    expired = start(client, technician, booking_id, code)
    assert expired.status_code == 409 and "expired" in expired.json()["detail"]
    stored = rows(connection, booking_id)[0]
    assert stored["status"] == "EXPIRED" and stored["code_ciphertext"] is None
    fresh = view(client, headers, booking_id).json()
    assert fresh["state"] == "READY" and len(rows(connection, booking_id)) == 2
    assert start(client, technician, booking_id, fresh["code"]).status_code == 200


def test_a_code_only_ever_verifies_its_own_booking(client, job, connection):
    tech_a, headers_a, booking_a = job()
    tech_b, headers_b, booking_b = job(trade="PAINTER")
    code_a = view(client, headers_a, booking_a).json()["code"]
    code_b = view(client, headers_b, booking_b).json()["code"]
    if code_a != code_b:
        assert start(client, tech_b, booking_b, code_a).status_code == 400
    assert booking_row(connection, booking_b)["status"] == "ARRIVED"
    # The same digits on another booking give another verifier.
    digests = {rows(connection, booking_a)[0]["code_digest"], rows(connection, booking_b)[0]["code_digest"]}
    assert len(digests) == 2
    assert start(client, tech_b, booking_b, code_b).status_code == 200


def test_only_the_active_assigned_technician_can_start(client, job, onboard, connection):
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    stranger = working(client, onboard, "PLUMBER", at=AT_HOME)
    assert start(client, stranger, booking_id, code).status_code == 404
    connection.execute(
        text("UPDATE partner.technicians SET status = 'SUSPENDED' WHERE id = :u"), {"u": technician["user"]["id"]}
    )
    assert start(client, technician, booking_id, code).status_code == 403
    assert booking_row(connection, booking_id)["status"] == "ARRIVED"
    assert rows(connection, booking_id)[0]["failed_attempts"] == 0  # refused before any check of the code


def test_the_old_generic_start_cannot_start_anything(client, job, connection):
    technician, headers, booking_id = job()
    view(client, headers, booking_id)
    tech = bearer(technician["access_token"])
    assert client.post(f"/technicians/me/jobs/{booking_id}/start", headers=tech).status_code == 422  # no body
    assert client.post(f"/technicians/me/jobs/{booking_id}/start", headers=tech, json={}).status_code == 422
    assert (
        client.post(f"/technicians/me/jobs/{booking_id}/start", headers=tech, params={"otp": "123456"}).status_code
        == 422
    )
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        service = build_dispatch_service(session)
        user = session.get(Technician, uuid.UUID(technician["user"]["id"]))
        with pytest.raises(HTTPException) as refused:
            service.act_on_job(user, uuid.UUID(booking_id), "start")
        assert refused.value.status_code == 409
    assert booking_row(connection, booking_id)["status"] == "ARRIVED"
    # The app is told `start` is next; only the OTP route can take it.
    held = client.get("/technicians/me/jobs", headers=tech, params={"bucket": "active"}).json()[0]
    assert held["next_actions"] == ["start"]


# ======================================================== after the start


def test_everything_after_the_start_works_as_before(client, job, connection):
    technician, headers, booking_id = job()
    tech = bearer(technician["access_token"])
    assert act(client, technician, booking_id, "start").status_code == 200
    booking = client.get(f"/requester/bookings/{booking_id}", headers=headers).json()
    assert booking["status_label"] == "Work in progress" and booking["started_at"]
    # The customer's map stops showing the technician once work starts.
    located = client.post(
        "/technicians/me/location", headers=tech, json={"latitude": HOME[0], "longitude": HOME[1], "accuracy": 8}
    )
    assert located.status_code == 200 and located.json()["active_job"]["sharing_allowed"] is False
    # Notes, bill and the customer's progress view work.
    assert (
        client.put(
            f"/technicians/me/jobs/{booking_id}/notes", headers=tech, json={"notes": "Replaced washer."}
        ).status_code
        == 200
    )
    item = client.post(
        f"/technicians/me/jobs/{booking_id}/bill/items",
        headers=tech,
        json={"kind": "MATERIAL", "name": "Washer", "quantity": "1", "unit": "piece", "unit_price": "20"},
    )
    assert item.status_code == 201, item.text
    assert client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).status_code == 200
    # Completion, the bill's finalization and the earning are unchanged.
    assert act(client, technician, booking_id, "complete").status_code == 200
    assert booking_row(connection, booking_id)["status"] == "COMPLETED"
    assert (
        connection.execute(
            text("SELECT status FROM partner.booking_work_bills WHERE booking_id = :b"), {"b": booking_id}
        ).scalar()
        == "FINALIZED"
    )
    assert view(client, headers, booking_id).json()["state"] == "WORK_STARTED"


def test_no_code_ever_reaches_the_logs(client, job, caplog):
    caplog.set_level(logging.DEBUG)
    technician, headers, booking_id = job()
    code = view(client, headers, booking_id).json()["code"]
    start(client, technician, booking_id, wrong(code))
    fresh = client.post(f"/requester/bookings/{booking_id}/start-otp/regenerate", headers=headers)  # cooldown -> 429
    assert fresh.status_code == 429
    assert start(client, technician, booking_id, code).status_code == 200
    everything = "\n".join(f"{record.getMessage()} {record.args!r}" for record in caplog.records)
    assert code not in everything and wrong(code) not in everything
    assert "Start Work code issued" in everything  # it does log that a code exists -- never the code


# ============================================= committed concurrency (disposable DB)


@pytest.mark.skipif(
    os.environ.get("PARTNER_TEST_COMMITTED_CONCURRENCY") != "1",
    reason="needs committed rows on a disposable test database (PARTNER_TEST_COMMITTED_CONCURRENCY=1)",
)
def test_two_correct_submissions_at_once_start_the_job_exactly_once(database_tables):
    from app.database.session import engine
    from app.modules.bookings.repository import StartOtpRepository
    from app.modules.bookings.start_otp_service import StartOtpService
    from app.modules.requesters.repository import RequesterRepository

    marker = uuid.uuid4().hex[:10]
    ids = {}
    with engine.begin() as c:
        ids["owner"] = c.execute(
            text(
                f"INSERT INTO {REQUESTERS_STAND_IN} (id, name, email, phone, status, address, pincode, location, requester_role) "
                "VALUES (gen_random_uuid(), 'OTP Race Owner', :e, :p, 'ACTIVE', '1 Road', '000405', "
                "'Alpha Main', 'OWNER') RETURNING id"
            ),
            {"e": f"otp-race-{marker}@example.com", "p": "5" + marker[:9].translate(str.maketrans("abcdef", "123456"))},
        ).scalar_one()
        ids["technician"] = c.execute(
            text(
                "INSERT INTO partner.technicians (email, phone, status, onboarding_completed_at, email_verified_at, pincode) "
                "VALUES (:e, '9876543210', 'ACTIVE', now(), now(), '000405') RETURNING id"
            ),
            {"e": f"otp-race-{marker}@example.com"},
        ).scalar_one()
        c.execute(
            text(
                "INSERT INTO partner.technician_profiles (technician_id, technician_type, work_status) VALUES (:u, 'PLUMBER', 'AVAILABLE')"
            ),
            {"u": ids["technician"]},
        )
        c.execute(
            text(
                "INSERT INTO partner.technician_identity_verifications (technician_id, face_status, aadhaar_status) VALUES (:u, 'VERIFIED', 'VERIFIED')"
            ),
            {"u": ids["technician"]},
        )
        ids["booking"] = c.execute(
            text(
                "INSERT INTO partner.bookings (requested_by_user_id, requested_by_role, technician_id, technician_type, "
                "service_address, pincode, status, accepted_at, en_route_at, arrived_at) VALUES (:o, 'OWNER', :t, 'PLUMBER', "
                "'1 Road', '000405', 'ARRIVED', now(), now(), now()) RETURNING id"
            ),
            {"o": ids["owner"], "t": ids["technician"]},
        ).scalar_one()
    try:
        with Session(engine) as session:
            code = (
                StartOtpService(StartOtpRepository(session), ServiceRequestRepository(session))
                .requester_view(
                    RequesterRepository(session, settings.professional_schema).get(ids["owner"]), ids["booking"]
                )
                .code
            )
        barrier = threading.Barrier(2)
        outcomes = []

        def submit():
            with Session(engine) as session:
                service = build_dispatch_service(session)
                user = session.get(Technician, ids["technician"])
                barrier.wait()
                try:
                    service.start_with_otp(user, ids["booking"], code)
                    outcomes.append("started")
                except HTTPException as error:
                    session.rollback()
                    outcomes.append(error.status_code)

        threads = [threading.Thread(target=submit) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert sorted(outcomes, key=str) == [409, "started"], outcomes
        with engine.connect() as c:
            booking = c.execute(
                text("SELECT status, started_at FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]}
            ).one()
            assert booking[0] == "IN_PROGRESS" and booking[1] is not None
            consumed = c.execute(
                text("SELECT count(*) FROM partner.booking_start_codes WHERE booking_id = :b AND status = 'CONSUMED'"),
                {"b": ids["booking"]},
            ).scalar()
            assert consumed == 1
    finally:
        with engine.begin() as c:  # exactly what this test created, children first
            c.execute(text("DELETE FROM partner.booking_start_codes WHERE booking_id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]})
            c.execute(
                text("DELETE FROM partner.technician_identity_verifications WHERE technician_id = :u"),
                {"u": ids["technician"]},
            )
            c.execute(
                text("DELETE FROM partner.technician_profiles WHERE technician_id = :u"), {"u": ids["technician"]}
            )
            c.execute(text("DELETE FROM partner.technicians WHERE id = :u"), {"u": ids["technician"]})
            c.execute(text(f"DELETE FROM {REQUESTERS_STAND_IN} WHERE id = :o"), {"o": ids["owner"]})
