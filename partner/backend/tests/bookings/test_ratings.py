"""Customer -> technician ratings (Partner 0013): whole stars, optional
predefined tags, once per completed booking, aggregates from real rows.

Rolled-back test transaction throughout, except the committed concurrency test
at the end, which only runs on a disposable database.
"""

import os
import threading
import uuid
from decimal import Decimal

import pytest
from conftest import REQUESTERS_STAND_IN
from fastapi import HTTPException
from legacy import bearer
from legacy_dispatch import AT_HOME, HOME, act, arrive, book, working
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.modules.bookings.rating_service import TAGS, rounded_average

POSITIVE = [key for key, _ in TAGS["positive"]]
MIXED = [key for key, _ in TAGS["mixed"]]
NEGATIVE = [key for key, _ in TAGS["negative"]]


@pytest.fixture()
def job(client, onboard, requester_session):
    """A booking walked to `to` (default COMPLETED); returns (technician, owner headers, booking id)."""

    def create(to="COMPLETED", technician=None, headers=None, trade="PLUMBER"):
        technician = technician or working(client, onboard, trade, at=AT_HOME)
        if headers is None:
            _account, headers = requester_session()
        booking_id = book(client, headers, trade, at=HOME).json()["id"]
        steps = ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]
        for step in steps[: steps.index(to) + 1] if to in steps else []:
            if step == "ACCEPTED":
                assert act(client, technician, booking_id, "accept").status_code == 200
            elif step == "EN_ROUTE":
                assert act(client, technician, booking_id, "en-route").status_code == 200
            elif step == "ARRIVED":
                assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"
            elif step == "IN_PROGRESS":
                assert act(client, technician, booking_id, "start").status_code == 200
            else:
                assert act(client, technician, booking_id, "complete").status_code == 200
        return technician, headers, booking_id

    return create


def rate(client, headers, booking_id, body):
    return client.post(f"/requester/bookings/{booking_id}/rating", headers=headers, json=body)


def view(client, headers, booking_id):
    return client.get(f"/requester/bookings/{booking_id}/rating", headers=headers)


def dashboard(client, technician):
    return client.get("/technicians/me/dashboard", headers=bearer(technician["access_token"])).json()


def rating_rows(connection, booking_id):
    return (
        connection.execute(
            text(
                "SELECT r.technician_id::text, r.stars, array_remove(array_agg(t.tag ORDER BY t.tag), NULL) AS tags "
                "FROM partner.booking_ratings r LEFT JOIN partner.booking_rating_tags t ON t.rating_id = r.id "
                "WHERE r.booking_id = :b GROUP BY r.id"
            ),
            {"b": booking_id},
        )
        .mappings()
        .all()
    )


# ========================================================== when it is possible


@pytest.mark.parametrize("to", ["SEARCHING", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"])
def test_no_rating_before_completion(client, job, to):
    _technician, headers, booking_id = job(to)
    assert view(client, headers, booking_id).json()["state"] == "NOT_YET"
    assert rate(client, headers, booking_id, {"stars": 5}).status_code == 409
    booking = client.get(f"/requester/bookings/{booking_id}", headers=headers).json()
    assert booking["can_rate"] is False


def test_the_owner_rates_a_completed_job_once(client, job, connection):
    technician, headers, booking_id = job()
    before = view(client, headers, booking_id).json()
    assert before["state"] == "CAN_RATE" and before["technician_name"] and before["stars"] is None
    assert set(before["tag_options"]) == {"positive", "mixed", "negative"}
    assert before["star_groups"] == {"1": "negative", "2": "negative", "3": "mixed", "4": "positive", "5": "positive"}
    assert client.get(f"/requester/bookings/{booking_id}", headers=headers).json()["can_rate"] is True

    made = rate(client, headers, booking_id, {"stars": 4, "tags": ["professional", "on_time"]})
    assert made.status_code == 201, made.text
    body = made.json()
    assert body["state"] == "RATED" and body["stars"] == 4
    assert [tag["key"] for tag in body["tags"]] == ["on_time", "professional"]
    stored = rating_rows(connection, booking_id)
    assert len(stored) == 1 and stored[0]["technician_id"] == technician["user"]["id"] and stored[0]["stars"] == 4
    # Reopened later: still rated, no longer offered.
    assert view(client, headers, booking_id).json()["state"] == "RATED"
    assert client.get(f"/requester/bookings/{booking_id}", headers=headers).json()["can_rate"] is False
    # Once only.
    again = rate(client, headers, booking_id, {"stars": 5})
    assert again.status_code == 409 and again.json()["detail"] == "You have already rated this job."
    assert len(rating_rows(connection, booking_id)) == 1


def test_another_customer_and_the_technician_cannot_rate(client, job, requester_session, connection):
    technician, headers, booking_id = job()
    _other, other_headers = requester_session()
    assert rate(client, other_headers, booking_id, {"stars": 1}).status_code == 404
    assert view(client, other_headers, booking_id).status_code == 404
    tech = bearer(technician["access_token"])
    assert client.post(f"/requester/bookings/{booking_id}/rating", headers=tech, json={"stars": 5}).status_code == 401
    assert client.get(f"/requester/bookings/{booking_id}/rating", headers=tech).status_code == 401
    assert rate(client, headers, uuid.uuid4(), {"stars": 5}).status_code == 404
    assert rating_rows(connection, booking_id) == []


# ================================================================ star rules


@pytest.mark.parametrize("stars", [1, 2, 3, 4, 5])
def test_every_whole_star_is_accepted(client, job, stars):
    _technician, headers, booking_id = job()
    response = rate(client, headers, booking_id, {"stars": stars})
    assert response.status_code == 201 and response.json()["stars"] == stars


@pytest.mark.parametrize(
    "body",
    [
        {"stars": 0},
        {"stars": 6},
        {"stars": 4.5},
        {"stars": "5"},
        {"stars": None},
        {"stars": True},
        {},
        {"tags": ["professional"]},
    ],
)
def test_invalid_stars_are_refused(client, job, connection, body):
    _technician, headers, booking_id = job()
    assert rate(client, headers, booking_id, body).status_code == 422
    assert rating_rows(connection, booking_id) == []


# ================================================================== tag rules


def test_tags_are_optional_and_several_can_be_chosen(client, job, connection):
    _t, headers, first = job()
    assert rate(client, headers, first, {"stars": 5}).status_code == 201  # no "tags" at all
    _t, headers, second = job()
    assert rate(client, headers, second, {"stars": 5, "tags": []}).status_code == 201
    _t, headers, third = job()
    assert rate(client, headers, third, {"stars": 5, "tags": POSITIVE}).status_code == 201  # all 8
    assert sorted(rating_rows(connection, third)[0]["tags"]) == sorted(POSITIVE)


@pytest.mark.parametrize(
    "stars, tags",
    [
        (5, ["not_a_tag"]),  # unknown
        (5, ["professional", "professional"]),  # duplicate
        (5, ["rude_behaviour"]),  # negative with 5 stars
        (4, ["work_done_ok"]),  # mixed with 4 stars
        (3, ["professional"]),  # positive with 3 stars
        (3, ["poor_quality"]),  # negative with 3 stars
        (1, ["quick_service"]),  # positive with 1 star
        (2, ["minor_delay"]),  # mixed with 2 stars
        (5, POSITIVE + ["professional"]),  # 9 tags
        (5, ["Professional"]),  # malformed / wrong case
        (5, [7]),  # not a string
    ],
)
def test_invalid_or_mismatched_tags_are_refused(client, job, connection, stars, tags):
    _technician, headers, booking_id = job()
    assert rate(client, headers, booking_id, {"stars": stars, "tags": tags}).status_code == 422
    assert rating_rows(connection, booking_id) == []


@pytest.mark.parametrize("stars, tags", [(3, MIXED), (2, NEGATIVE), (1, ["issue_unresolved", "rude_behaviour"])])
def test_each_star_group_accepts_its_own_tags(client, job, stars, tags):
    _technician, headers, booking_id = job()
    assert rate(client, headers, booking_id, {"stars": stars, "tags": tags}).status_code == 201


def test_the_technician_comes_from_the_booking_never_the_request(client, job, onboard, connection):
    technician, headers, booking_id = job()
    somebody_else = working(client, onboard, "PAINTER", at=AT_HOME)
    injected = rate(client, headers, booking_id, {"stars": 1, "technician_id": somebody_else["user"]["id"]})
    assert injected.status_code == 422  # extra fields are refused outright
    assert rating_rows(connection, booking_id) == []
    assert rate(client, headers, booking_id, {"stars": 5}).status_code == 201
    assert rating_rows(connection, booking_id)[0]["technician_id"] == technician["user"]["id"]


# =============================================================== aggregates


def test_rounding_is_exact_half_up_to_one_decimal():
    assert rounded_average(Decimal("4.6666666")) == 4.7
    assert rounded_average(Decimal("4.65")) == 4.7  # float round() would give 4.6
    assert rounded_average(Decimal("4.64")) == 4.6
    assert rounded_average(Decimal("5")) == 5.0
    assert rounded_average(Decimal("1.05")) == 1.1
    assert rounded_average(None) is None


def test_the_aggregate_is_computed_from_real_ratings(client, job, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    first = dashboard(client, technician)
    assert (first["average_rating"], first["rating_count"]) == (None, 0)  # never a fake 5.0
    for stars in (5, 4, 5):
        _t, headers, booking_id = job(technician=technician)
        assert rate(client, headers, booking_id, {"stars": stars}).status_code == 201
    after = dashboard(client, technician)
    assert (after["average_rating"], after["rating_count"]) == (4.7, 3)
    # An unrated completed job changes nothing.
    job(technician=technician)
    assert (dashboard(client, technician)["average_rating"], dashboard(client, technician)["rating_count"]) == (4.7, 3)


def test_one_rating_shows_as_x_point_0(client, job):
    technician, headers, booking_id = job()
    assert rate(client, headers, booking_id, {"stars": 5}).status_code == 201
    assert (dashboard(client, technician)["average_rating"], dashboard(client, technician)["rating_count"]) == (5.0, 1)


def test_completion_creates_no_rating_and_nothing_is_backfilled(client, job, connection):
    _technician, headers, booking_id = job()
    assert rating_rows(connection, booking_id) == []
    # An older completed job simply becomes eligible.
    connection.execute(
        text("UPDATE partner.bookings SET completed_at = completed_at - interval '400 days' WHERE id = :b"),
        {"b": booking_id},
    )
    assert view(client, headers, booking_id).json()["state"] == "CAN_RATE"
    assert rate(client, headers, booking_id, {"stars": 3, "tags": ["work_done_ok"]}).status_code == 201


# ================================================================== privacy


def test_the_technician_sees_only_the_aggregate(client, job):
    technician, headers, booking_id = job()
    rate(client, headers, booking_id, {"stars": 2, "tags": ["rude_behaviour", "late_arrival"]})
    tech = bearer(technician["access_token"])
    reads = [
        client.get("/technicians/me/dashboard", headers=tech),
        client.get("/auth/me", headers=tech),
        client.get("/technicians/me/jobs", headers=tech, params={"bucket": "completed"}),
        client.get(f"/technicians/me/jobs/{booking_id}/execution", headers=tech),
    ]
    for response in reads:
        assert response.status_code == 200
        for secret in ("rude_behaviour", "late_arrival", "Rude behaviour", "stars", "tags"):
            assert secret not in response.text, (response.request.url, secret)
    summary = dashboard(client, technician)
    assert (summary["average_rating"], summary["rating_count"]) == (2.0, 1)


def test_the_customer_sees_the_rating_only_where_technician_details_already_show(
    client, onboard, requester_session, job
):
    rated_technician, owner_headers, rated_booking = job()
    rate(client, owner_headers, rated_booking, {"stars": 4})
    _account, headers = requester_session()
    booking_id = book(client, headers, "PLUMBER", at=HOME).json()["id"]
    # Still being offered: no technician card, so no rating.
    searching = client.get(f"/requester/bookings/{booking_id}", headers=headers).json()
    assert searching["technician"] is None and "average_rating" not in str(searching.get("technician"))
    assert act(client, rated_technician, booking_id, "accept").status_code == 200
    held = client.get(f"/requester/bookings/{booking_id}", headers=headers).json()["technician"]
    assert (held["average_rating"], held["rating_count"]) == (4.0, 1)
    # The offer the technician sees carries no rating.
    other = working(client, onboard, "PLUMBER", at=AT_HOME)
    fresh = book(client, requester_session()[1], "PLUMBER", at=HOME).json()["id"]
    offers = client.get("/technicians/me/offers", headers=bearer(other["access_token"])).text
    assert "rating" not in offers


def test_the_booking_list_uses_two_grouped_rating_queries(client, job, connection):
    technician, headers, first = job()
    for _ in range(3):
        job(technician=technician, headers=headers)
    rate(client, headers, first, {"stars": 5})
    statements = []

    def count(_conn, _cursor, statement, *_args):
        if "booking_ratings" in statement:
            statements.append(statement)

    event.listen(connection, "before_cursor_execute", count)
    try:
        listed = client.get("/requester/bookings", headers=headers).json()
    finally:
        event.remove(connection, "before_cursor_execute", count)
    assert len(listed) == 4
    assert len(statements) == 2, statements  # averages per technician + rated bookings, for the whole list
    assert sum(1 for booking in listed if booking["can_rate"]) == 3
    assert all(booking["technician"]["rating_count"] == 1 for booking in listed)


def test_there_is_no_text_anywhere(client, job):
    _technician, headers, booking_id = job()
    for field in ("comment", "review", "text", "message"):
        assert rate(client, headers, booking_id, {"stars": 5, field: "Great!"}).status_code == 422
    body = rate(client, headers, booking_id, {"stars": 5}).json()
    assert set(body) == {"state", "technician_name", "stars", "tags", "tag_options", "star_groups"}


# ============================================= committed concurrency (disposable DB)


@pytest.mark.skipif(
    os.environ.get("PARTNER_TEST_COMMITTED_CONCURRENCY") != "1",
    reason="needs committed rows on a disposable test database (PARTNER_TEST_COMMITTED_CONCURRENCY=1)",
)
def test_two_submissions_at_once_make_exactly_one_rating(database_tables):
    from app.core.runtime import settings
    from app.database.session import engine
    from app.modules.bookings.rating_service import RatingService
    from app.modules.bookings.repository import RatingRepository, ServiceRequestRepository
    from app.modules.bookings.schemas import RatingSubmitRequest
    from app.modules.requesters.repository import RequesterRepository

    marker = uuid.uuid4().hex[:10]
    ids = {}
    with engine.begin() as c:
        ids["owner"] = c.execute(
            text(
                f"INSERT INTO {REQUESTERS_STAND_IN} (id, name, email, phone, status, address, pincode, location, requester_role) "
                "VALUES (gen_random_uuid(), 'Rating Race Owner', :e, :p, 'ACTIVE', '1 Road', '000405', "
                "'Alpha Main', 'OWNER') RETURNING id"
            ),
            {
                "e": f"rating-race-{marker}@example.com",
                "p": "4" + marker[:9].translate(str.maketrans("abcdef", "123456")),
            },
        ).scalar_one()
        ids["technician"] = c.execute(
            text(
                "INSERT INTO partner.technicians (email, phone, status, onboarding_completed_at, email_verified_at, pincode) "
                "VALUES (:e, '9876543210', 'ACTIVE', now(), now(), '000405') RETURNING id"
            ),
            {"e": f"rating-race-{marker}@example.com"},
        ).scalar_one()
        ids["booking"] = c.execute(
            text(
                "INSERT INTO partner.bookings (requested_by_user_id, requested_by_role, technician_id, technician_type, "
                "service_address, pincode, status, accepted_at, en_route_at, arrived_at, started_at, completed_at) VALUES (:o, 'OWNER', :t, "
                "'PLUMBER', '1 Road', '000405', 'COMPLETED', now(), now(), now(), now(), now()) RETURNING id"
            ),
            {"o": ids["owner"], "t": ids["technician"]},
        ).scalar_one()
    try:
        barrier = threading.Barrier(2)
        outcomes = []

        def submit(stars):
            with Session(engine) as session:
                service = RatingService(RatingRepository(session), ServiceRequestRepository(session))
                requester = RequesterRepository(session, settings.professional_schema).get(ids["owner"])
                barrier.wait()
                try:
                    service.submit(requester, ids["booking"], RatingSubmitRequest(stars=stars, tags=[]))
                    outcomes.append("rated")
                except HTTPException as error:
                    session.rollback()
                    outcomes.append(error.status_code)

        threads = [threading.Thread(target=submit, args=(stars,)) for stars in (5, 4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert sorted(outcomes, key=str) == [409, "rated"], outcomes
        with engine.connect() as c:
            assert (
                c.execute(
                    text("SELECT count(*) FROM partner.booking_ratings WHERE booking_id = :b"), {"b": ids["booking"]}
                ).scalar()
                == 1
            )
    finally:
        with engine.begin() as c:  # exactly what this test created, children first
            c.execute(
                text(
                    "DELETE FROM partner.booking_rating_tags WHERE rating_id IN "
                    "(SELECT id FROM partner.booking_ratings WHERE booking_id = :b)"
                ),
                {"b": ids["booking"]},
            )
            c.execute(text("DELETE FROM partner.booking_ratings WHERE booking_id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.technicians WHERE id = :u"), {"u": ids["technician"]})
            c.execute(text(f"DELETE FROM {REQUESTERS_STAND_IN} WHERE id = :o"), {"o": ids["owner"]})
