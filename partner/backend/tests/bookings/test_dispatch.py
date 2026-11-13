"""Booking, eligibility and the job workflow.

How candidates are chosen is covered by `test_nearby_dispatch.py`; this file is
about who may book, who may be offered work at all, and what happens to a job
once a technician holds it.
"""

import uuid

import pytest
from legacy import handoff_token
from legacy_dispatch import AT_HOME, HOME, NEAR, act, arrive, book, jobs, offer_ids, working
from sqlalchemy import text

from app.core.runtime import settings

NO_TECHNICIANS = "No available {}s were found in your locality."
TRADES = ["PAINTER", "PLUMBER", "ELECTRICIAN", "CARPENTER"]


# ---------------------------------------------------------------- who may book


def test_requester_identity_is_verified_on_the_server(client, make_requester_account):
    owner = make_requester_account(role="OWNER")
    site_engineer = make_requester_account(role="ENGINEER", specialization="Site Engineer")
    other_engineer = make_requester_account(role="ENGINEER", specialization="Plumbing Engineer")
    builder = make_requester_account(role="CONTRACTOR")
    suspended = make_requester_account(status="SUSPENDED")

    for account, role in ((owner, "OWNER"), (site_engineer, "SITE_ENGINEER")):
        response = client.post("/requester/session", json={"handoff_token": handoff_token(account)})
        assert response.status_code == 200 and response.json()["requester"]["role"] == role

    refused = {
        "specialist engineer": (other_engineer, 403),
        "builder": (builder, 403),
        "suspended owner": (suspended, 403),
        "unknown account": (uuid.uuid4(), 401),
    }
    for label, (account, expected) in refused.items():
        assert (
            client.post("/requester/session", json={"handoff_token": handoff_token(account)}).status_code == expected
        ), label
    for label, token in {
        "refresh token": handoff_token(owner, token_type="refresh"),
        "an Professional access token": handoff_token(owner, token_type="access", audience=None),
        "expired": handoff_token(owner, minutes=-1),
        "forged": handoff_token(owner, secret="not-octabuilds-secret"),
    }.items():
        assert client.post("/requester/session", json={"handoff_token": token}).status_code == 401, label


# ---------------------------------------------------------------- the complete job


@pytest.mark.parametrize(
    "role,specialization,trade", [("OWNER", None, "PAINTER"), ("ENGINEER", "Site Engineer", "PLUMBER")]
)
def test_booking_is_offered_accepted_and_completed(
    client, connection, onboard, requester_session, role, specialization, trade
):
    technician = working(client, onboard, trade, at=AT_HOME)
    requester_id, headers = requester_session(role=role, specialization=specialization)

    created = book(client, headers, trade, description="Kitchen", at=HOME)
    assert created.status_code == 201, created.text
    booking = created.json()
    # Offers are out; nobody holds it, so no technician is shown to the requester.
    assert (booking["status"], booking["status_label"]) == ("OFFERED", "Waiting for a technician to accept")
    assert booking["reference"].startswith("SR-") and len(booking["reference"]) == 11
    assert booking["technician"] is None

    assert offer_ids(client, technician) == [booking["id"]]
    accepted = act(client, technician, booking["id"], "accept")
    assert accepted.status_code == 200 and accepted.json()["outcome"] == "ACCEPTED"

    held = jobs(client, technician, "accepted")[0]
    expected_type = "OWNER" if role == "OWNER" else "SITE_ENGINEER"
    assert (held["id"], held["requester_type"], held["pincode"]) == (booking["id"], expected_type, "000405")
    assert held["requester_phone"] == "9123456780" and held["match_label"].endswith("away")
    assert (
        client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()["technician"]["phone"]
        == "9876543210"
    )

    labels = []
    assert act(client, technician, booking["id"], "en-route").status_code == 200
    labels.append(client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()["status_label"])
    # Arriving is reaching the address; the technician does not announce it.
    arrive(client, technician, booking["id"], HOME)
    labels.append(client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()["status_label"])
    for action in ("start", "complete"):
        step = act(client, technician, booking["id"], action)
        assert step.status_code == 200, step.text
        labels.append(client.get(f"/requester/bookings/{booking['id']}", headers=headers).json()["status_label"])
    assert labels == ["On the way", "Arrived", "Work in progress", "Completed"]
    assert [job["id"] for job in jobs(client, technician, "completed")] == [booking["id"]]
    assert act(client, technician, booking["id"], "complete").status_code == 409

    row = (
        connection.execute(
            text(
                "SELECT id, requested_by_user_id, requested_by_role, technician_id, status, service_latitude, "
                "completed_at IS NOT NULL AS done FROM partner.bookings WHERE id = :id"
            ),
            {"id": booking["id"]},
        )
        .mappings()
        .one()
    )
    assert isinstance(row["id"], uuid.UUID) and row["requested_by_user_id"] == requester_id
    assert str(row["technician_id"]) == technician["user"]["id"] and (
        row["status"],
        row["requested_by_role"],
        row["done"],
    ) == ("COMPLETED", expected_type, True)
    assert row["service_latitude"] == pytest.approx(HOME[0])


def test_jobs_cannot_skip_steps(client, onboard, requester_session):
    technician = working(client, onboard, "CARPENTER", at=AT_HOME)
    _, headers = requester_session()
    booking = book(client, headers, "CARPENTER").json()
    # Not held yet: a step on a job is not possible before accepting it.
    assert act(client, technician, booking["id"], "start").status_code == 404
    assert act(client, technician, booking["id"], "accept").status_code == 200
    assert act(client, technician, booking["id"], "arrived").status_code == 409


# ---------------------------------------------------------------- eligibility


@pytest.mark.parametrize("trade", TRADES)
def test_ineligible_technicians_are_never_offered_work(client, connection, onboard, requester_session, trade):
    working(client, onboard, trade, at=AT_HOME, available=False)
    working(client, onboard, trade, at=None, stop_after="aadhaar")  # never completed the profile
    suspended = working(client, onboard, trade, at=AT_HOME)
    connection.execute(
        text("UPDATE partner.technicians SET status = 'SUSPENDED' WHERE id = :id"), {"id": suspended["user"]["id"]}
    )
    working(client, onboard, "PAINTER" if trade != "PAINTER" else "PLUMBER", at=AT_HOME)  # wrong trade
    _, headers = requester_session()

    booking = book(client, headers, trade).json()
    assert (booking["status"], booking["message"], booking["technician"]) == (
        "NO_TECHNICIAN_FOUND",
        NO_TECHNICIANS.format(trade.lower()),
        None,
    )


def test_verified_identity_can_be_required(client, onboard, requester_session, monkeypatch):
    working(client, onboard, "PAINTER", at=AT_HOME)
    monkeypatch.setattr(settings, "require_verified_identity_for_jobs", True)
    _, headers = requester_session()
    assert book(client, headers, "PAINTER").json()["status"] == "NO_TECHNICIAN_FOUND"


def test_busy_technician_gets_one_job_at_a_time(client, onboard, requester_session):
    technician = working(client, onboard, "CARPENTER", at=AT_HOME)
    _, first_headers = requester_session()
    _, second_headers = requester_session()

    first = book(client, first_headers, "CARPENTER").json()
    # Their only nearby carpenter is already holding an offer.
    assert book(client, second_headers, "CARPENTER").json()["status"] == "NO_TECHNICIAN_FOUND"
    assert act(client, technician, first["id"], "accept").status_code == 200
    assert act(client, technician, first["id"], "en-route").status_code == 200
    arrive(client, technician, first["id"], HOME)
    for action in ("start", "complete"):
        assert act(client, technician, first["id"], action).status_code == 200

    _, third_headers = requester_session()
    assert book(client, third_headers, "CARPENTER").json()["status"] == "OFFERED"


# ---------------------------------------------------------------- requester rules


def test_cancel_duplicate_and_missing_location(client, onboard, requester_session):
    technician = working(client, onboard, "PAINTER", at=AT_HOME)
    _, headers = requester_session()
    booking = book(client, headers, "PAINTER").json()

    duplicate = book(client, headers, "PAINTER")
    assert duplicate.status_code == 409 and duplicate.json()["detail"]["booking_id"] == booking["id"]

    cancelled = client.post(f"/requester/bookings/{booking['id']}/cancel", headers=headers).json()
    assert cancelled["status"] == "CANCELLED"
    # The request disappears from the technician who was still deciding.
    assert offer_ids(client, technician) == []

    second = book(client, headers, "PAINTER").json()
    assert act(client, technician, second["id"], "accept").status_code == 200
    assert act(client, technician, second["id"], "en-route").status_code == 200
    arrive(client, technician, second["id"], HOME)
    assert client.post(f"/requester/bookings/{second['id']}/cancel", headers=headers).status_code == 409

    _, no_location = requester_session(pincode="", address="", location=None)
    assert book(client, no_location, "PAINTER").status_code == 422
    assert book(client, headers, "MASON").status_code == 422


def test_a_booking_needs_a_point_on_the_map(client, onboard, requester_session):
    working(client, onboard, "PAINTER", at=AT_HOME)
    _, headers = requester_session()
    refused = book(client, headers, "PAINTER", at=None)
    assert refused.status_code == 422 and "map" in refused.json()["detail"]["message"]


def test_everyone_sees_only_their_own(client, onboard, requester_session):
    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    stranger = working(client, onboard, "PLUMBER", at=NEAR)
    _, owner_headers = requester_session()
    _, other_headers = requester_session(role="ENGINEER", specialization="Site Engineer")
    booking = book(client, owner_headers, "PLUMBER").json()

    assert client.get(f"/requester/bookings/{booking['id']}", headers=other_headers).status_code == 404
    assert client.post(f"/requester/bookings/{booking['id']}/cancel", headers=other_headers).status_code == 404
    assert client.get("/requester/bookings", headers=other_headers).json() == []

    # Both were offered it; once one accepts, the other cannot act on it at all.
    assert act(client, technician, booking["id"], "accept").status_code == 200
    for action in ("accept", "reject", "en-route", "complete"):
        assert act(client, stranger, booking["id"], action).status_code in (404, 409), action
    # A booking session is not a technician session.
    assert client.get("/technicians/me/jobs", headers=owner_headers).status_code == 401
    assert client.get("/technicians/me/offers", headers=owner_headers).status_code == 401


def test_a_requester_with_bookings_cannot_be_deleted():
    """Changed by decision (R4c): the old app deleted a requester's bookings with them
    (CASCADE). The bookings now keep their requester: the key to professional.users is
    RESTRICT, so Professional must deal with the bookings before the account goes."""
    from app.modules.bookings.models import BOOKING_REQUESTER_FOREIGN_KEY

    statement = " ".join(BOOKING_REQUESTER_FOREIGN_KEY.statement.split())
    assert "REFERENCES professional.users (id) ON DELETE RESTRICT" in statement


def test_a_booking_carries_one_of_the_listed_service_areas(client, onboard, requester_session):
    working(client, onboard, "ELECTRICIAN", at=AT_HOME)
    _requester_id, headers = requester_session()

    created = book(client, headers, "ELECTRICIAN", description="Bathroom / Toilet")
    assert created.status_code == 201, created.text
    assert created.json()["description"] == "Bathroom / Toilet"


@pytest.mark.parametrize("sent,stored", [("kitchen", "Kitchen"), ("  Full Property  ", "Full Property")])
def test_a_service_area_is_stored_in_the_lists_own_spelling(client, onboard, requester_session, sent, stored):
    """So pricing can match on the value exactly, whatever casing or spacing arrived."""
    working(client, onboard, "CARPENTER", at=AT_HOME)
    _requester_id, headers = requester_session()

    created = book(client, headers, "CARPENTER", description=sent)
    assert created.status_code == 201, created.text
    assert created.json()["description"] == stored


def test_free_text_is_not_accepted_as_a_service_area(client, onboard, requester_session):
    working(client, onboard, "PAINTER", at=AT_HOME)
    _requester_id, headers = requester_session()

    refused = book(client, headers, "PAINTER", description="paint the kitchen wall please")
    assert refused.status_code == 422, refused.text


def test_a_booking_without_a_service_area_is_still_accepted(client, onboard, requester_session):
    """Bookings made before the form asked for an area must keep working."""
    working(client, onboard, "PLUMBER", at=AT_HOME)
    _requester_id, headers = requester_session()

    created = book(client, headers, "PLUMBER", description=None)
    assert created.status_code == 201, created.text
    assert created.json()["description"] is None
