"""Technician earnings: recorded when a priced job is completed, and read back.

Real API inside the shared rolled-back transaction, except the one concurrency
test, which needs two real connections and therefore committed rows: it runs only
when PARTNER_TEST_COMMITTED_CONCURRENCY=1 (a disposable test database), and it
deletes exactly the rows it created.
"""

import os
import threading
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from legacy import bearer
from legacy_dispatch import AT_HOME, HOME, act, arrive, working
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.runtime import settings
from app.modules.bookings.dependencies import build_dispatch_service, get_routing_service
from app.modules.realtime.router import DISPATCH_SUBPROTOCOL  # noqa: F401  (dispatch router loaded)
from app.modules.technicians.earnings_service import CommissionConfigurationError, EarningsService, split_amount
from app.modules.technicians.repository import EarningsRepository
from app.modules.tracking.routing_service import RouteResult

EARNING_KEYS = {
    "id",
    "service_request_id",
    "service_name",
    "service_kind",
    "earned_at",
    "gross_amount",
    "commission_rate",
    "commission_amount",
    "net_amount",
    "currency",
    "status",
}


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


@pytest.fixture(autouse=True)
def zero_commission(monkeypatch):
    """Every test starts from the development default."""
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("0"))


@pytest.fixture()
def priced_service(connection):
    def create(price="499.00", trade="PLUMBER", name="Pipe Leakage Repair (earnings test)"):
        return str(
            connection.execute(
                text(
                    "INSERT INTO partner.catalog_services (trade, slug, service_name, service_kind, price, currency, sort_order) "
                    "VALUES (:trade, :slug, :name, 'SERVICE', :price, 'INR', 999) RETURNING id"
                ),
                {"trade": trade, "slug": f"earn-{uuid.uuid4().hex[:8]}", "name": name, "price": price},
            ).scalar_one()
        )

    return create


@pytest.fixture()
def job_at(client, onboard, requester_session, priced_service):
    """A booking walked to the given status by a fresh technician. price=None: pre-catalog."""

    def create(status, price="499.00", technician=None):
        technician = technician or working(client, onboard, "PLUMBER", at=AT_HOME)
        _account, headers = requester_session()
        body = {
            "technician_type": "PLUMBER",
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        }
        if price is not None:
            body["service_id"] = priced_service(price)
        booking = client.post("/requester/bookings", headers=headers, json=body)
        assert booking.status_code == 201, booking.text
        booking_id = booking.json()["id"]
        steps = ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]
        for step in steps[: steps.index(status) + 1] if status in steps else []:
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


def earnings_rows(connection, booking_id):
    return (
        connection.execute(text("SELECT * FROM partner.technician_earnings WHERE booking_id = :b"), {"b": booking_id})
        .mappings()
        .all()
    )


def history(client, technician, **params):
    return client.get("/technicians/me/earnings", headers=bearer(technician["access_token"]), params=params)


def summary(client, technician):
    return client.get("/technicians/me/earnings/summary", headers=bearer(technician["access_token"]))


# ============================================================ recording at completion


def test_completing_a_priced_job_records_exactly_one_earning(job_at, connection):
    _technician, _headers, booking_id = job_at("COMPLETED")
    rows = earnings_rows(connection, booking_id)
    assert len(rows) == 1
    earning = rows[0]
    quoted, completed_at = connection.execute(
        text("SELECT quoted_amount, completed_at FROM partner.bookings WHERE id = :b"), {"b": booking_id}
    ).one()
    assert earning["gross_amount"] == quoted == Decimal("499.00")
    assert earning["earned_at"] == completed_at  # one moment, one transaction
    assert earning["status"] == "RECORDED" and earning["currency"] == "INR"
    assert earning["service_name"] == "Pipe Leakage Repair (earnings test)" and earning["service_kind"] == "SERVICE"


def test_zero_percent_commission_leaves_the_whole_price(job_at, connection):
    _t, _h, booking_id = job_at("COMPLETED")
    row = earnings_rows(connection, booking_id)[0]
    assert (row["commission_rate"], row["commission_amount"], row["net_amount"]) == (
        Decimal("0.00"),
        Decimal("0.00"),
        Decimal("499.00"),
    )


def test_a_configured_rate_is_snapshotted_and_applied(job_at, connection, monkeypatch):
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("15"))
    _t, _h, booking_id = job_at("COMPLETED")
    row = earnings_rows(connection, booking_id)[0]
    assert row["commission_rate"] == Decimal("15.00")
    assert row["commission_amount"] == Decimal("74.85")  # 499 * 15%
    assert row["net_amount"] == Decimal("424.15")
    assert row["commission_amount"] + row["net_amount"] == row["gross_amount"]


def test_amounts_round_half_up_to_the_paisa(job_at, connection, monkeypatch):
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("12.5"))
    _t, _h, booking_id = job_at("COMPLETED", price="999.00")
    row = earnings_rows(connection, booking_id)[0]
    assert (row["commission_amount"], row["net_amount"]) == (Decimal("124.88"), Decimal("874.12"))  # 124.875 -> 124.88
    assert split_amount(Decimal("0.01"), Decimal("50")) == (Decimal("0.01"), Decimal("0.00"))  # 0.005 -> 0.01
    assert split_amount(Decimal("333.33"), Decimal("33.33")) == (Decimal("111.10"), Decimal("222.23"))


@pytest.mark.parametrize("rate, commission, net", [("0", "0.00", "499.00"), ("100", "499.00", "0.00")])
def test_rate_boundaries(job_at, connection, monkeypatch, rate, commission, net):
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal(rate))
    _t, _h, booking_id = job_at("COMPLETED")
    row = earnings_rows(connection, booking_id)[0]
    assert (row["commission_amount"], row["net_amount"]) == (Decimal(commission), Decimal(net))


@pytest.mark.parametrize("value", ["101", "-0.01", "abc", "12.345", "NaN", "Infinity"])
def test_invalid_configuration_is_refused_at_startup(value):
    with pytest.raises(ValidationError):
        Settings(partner_commission_rate_percent=value)
    assert Settings(partner_commission_rate_percent="12.5").partner_commission_rate_percent == Decimal("12.5")


def test_a_bad_rate_at_runtime_fails_the_completion_and_writes_nothing(job_at, client, connection, monkeypatch):
    technician, _h, booking_id = job_at("IN_PROGRESS")
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("150"))
    with pytest.raises(CommissionConfigurationError):
        act(client, technician, booking_id, "complete")
    status = connection.execute(
        text("SELECT status, completed_at FROM partner.bookings WHERE id = :b"), {"b": booking_id}
    ).one()
    assert tuple(status) == ("IN_PROGRESS", None)  # completion rolled back with the earning
    assert earnings_rows(connection, booking_id) == []


def test_a_failure_while_committing_completion_rolls_back_the_earning(job_at, client, connection, monkeypatch):
    technician, _h, booking_id = job_at("IN_PROGRESS")

    def failing_commit(self):
        self.flush()  # both the earning and the COMPLETED status reach the database...
        raise RuntimeError("simulated failure while completing")  # ...and the commit never happens

    monkeypatch.setattr(Session, "commit", failing_commit)
    with pytest.raises(RuntimeError, match="simulated failure"):
        act(client, technician, booking_id, "complete")
    monkeypatch.undo()
    assert (
        connection.execute(text("SELECT status FROM partner.bookings WHERE id = :b"), {"b": booking_id}).scalar()
        == "IN_PROGRESS"
    )
    assert earnings_rows(connection, booking_id) == []


def test_changing_the_rate_never_touches_existing_earnings(job_at, onboard, client, connection, monkeypatch):
    first_tech, _h, first = job_at("COMPLETED")
    before = dict(earnings_rows(connection, first)[0])
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("20"))
    _second_tech, _h2, second = job_at("COMPLETED")
    assert dict(earnings_rows(connection, first)[0]) == before  # still 0%
    later = earnings_rows(connection, second)[0]
    assert (later["commission_rate"], later["commission_amount"], later["net_amount"]) == (
        Decimal("20.00"),
        Decimal("99.80"),
        Decimal("399.20"),
    )


# ================================================================ at most one


def test_a_repeated_completion_is_refused_and_records_nothing_more(job_at, client, connection):
    technician, _h, booking_id = job_at("COMPLETED")
    again = act(client, technician, booking_id, "complete")
    assert again.status_code == 409
    assert len(earnings_rows(connection, booking_id)) == 1


def test_the_database_refuses_a_second_earning_for_a_booking(job_at, connection):
    _t, _h, booking_id = job_at("COMPLETED")
    row = earnings_rows(connection, booking_id)[0]
    with pytest.raises(IntegrityError, match="uq_technician_earnings__booking_id"):
        with connection.begin_nested():
            connection.execute(
                text(
                    "INSERT INTO partner.technician_earnings (technician_id, booking_id, gross_amount, commission_rate, "
                    "commission_amount, net_amount, currency, earned_at) VALUES (:t, :b, 499, 0, 0, 499, 'INR', now())"
                ),
                {"t": row["technician_id"], "b": booking_id},
            )


@pytest.mark.parametrize(
    "gross, rate, commission, net, constraint",
    [
        ("499", "0", "0", "400", "net_is_gross_less_commission"),
        ("499", "15", "70", "429", "commission_matches_rate"),
        ("499", "101", "0", "499", "rate"),
        ("-1", "0", "0", "-1", "gross"),
    ],
)
def test_the_database_refuses_figures_that_do_not_add_up(job_at, connection, gross, rate, commission, net, constraint):
    _t, _h, booking_id = job_at("COMPLETED")
    technician_id = earnings_rows(connection, booking_id)[0]["technician_id"]
    with pytest.raises(IntegrityError, match=constraint):
        with connection.begin_nested():
            connection.execute(
                text(
                    "INSERT INTO partner.technician_earnings (technician_id, gross_amount, commission_rate, commission_amount, "
                    "net_amount, currency, earned_at) VALUES (:t, :g, :r, :c, :n, 'INR', now())"
                ),
                {"t": technician_id, "g": gross, "r": rate, "c": commission, "n": net},
            )


@pytest.mark.skipif(
    os.environ.get("PARTNER_TEST_COMMITTED_CONCURRENCY") != "1",
    reason="needs committed rows on a disposable test database (PARTNER_TEST_COMMITTED_CONCURRENCY=1)",
)
def test_concurrent_completions_record_at_most_one_earning():
    from app.database.session import engine

    marker = uuid.uuid4().hex[:10]
    ids = {}
    with engine.begin() as c:
        ids["owner"] = c.execute(
            text(
                "INSERT INTO partner.v_partner_requesters (name, email, phone, password_hash, role, status, address, pincode, location, "
                "country_of_residence, rating, created_at) VALUES ('Race Owner', :e, :p, 'x', 'OWNER', 'ACTIVE', '1 Road', '000405', "
                "'Alpha Main', 'India', 0, now()) RETURNING id"
            ),
            {"e": f"race-{marker}@example.com", "p": "7" + marker[:9].translate(str.maketrans("abcdef", "123456"))},
        ).scalar_one()
        ids["technician"] = c.execute(
            text(
                "INSERT INTO partner.technicians (email, phone, status) VALUES (:e, '9876543210', 'ACTIVE') RETURNING id"
            ),
            {"e": f"race-tech-{marker}@example.com"},
        ).scalar_one()
        ids["booking"] = c.execute(
            text(
                "INSERT INTO partner.bookings (requested_by_user_id, requested_by_role, technician_id, technician_type, "
                "service_address, pincode, status, quoted_amount, currency, accepted_at, en_route_at, arrived_at, started_at) "
                "VALUES (:o, 'OWNER', :t, 'PLUMBER', '1 Road', '000405', 'IN_PROGRESS', 499, 'INR', now(), now(), now(), now()) RETURNING id"
            ),
            {"o": ids["owner"], "t": ids["technician"]},
        ).scalar_one()
    try:
        barrier = threading.Barrier(2)
        outcomes = []

        def complete():
            with Session(engine) as session:
                service = build_dispatch_service(session)
                barrier.wait()
                try:
                    service.act_on_job(SimpleNamespace(id=ids["technician"]), ids["booking"], "complete")
                    outcomes.append("completed")
                except HTTPException as error:
                    session.rollback()
                    outcomes.append(error.status_code)

        threads = [threading.Thread(target=complete) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert sorted(outcomes, key=str) == [409, "completed"]
        with engine.connect() as c:
            assert (
                c.execute(
                    text("SELECT count(*) FROM partner.technician_earnings WHERE booking_id = :b"),
                    {"b": ids["booking"]},
                ).scalar()
                == 1
            )
    finally:
        with engine.begin() as c:  # exactly what this test created, children first
            c.execute(text("DELETE FROM partner.technician_earnings WHERE booking_id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.bookings WHERE id = :b"), {"b": ids["booking"]})
            c.execute(text("DELETE FROM partner.technicians WHERE id = :t"), {"t": ids["technician"]})
            c.execute(text("DELETE FROM partner.v_partner_requesters WHERE id = :o"), {"o": ids["owner"]})


# =============================================================== what never earns


def test_a_pre_catalog_booking_completes_without_an_earning(job_at, connection):
    _t, _h, booking_id = job_at("COMPLETED", price=None)
    assert (
        connection.execute(text("SELECT status FROM partner.bookings WHERE id = :b"), {"b": booking_id}).scalar()
        == "COMPLETED"
    )
    assert earnings_rows(connection, booking_id) == []


@pytest.mark.parametrize("status", ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"])
def test_unfinished_jobs_never_earn(job_at, connection, status):
    _t, _h, booking_id = job_at(status)
    assert earnings_rows(connection, booking_id) == []


@pytest.mark.parametrize("cancel_at", ["ACCEPTED", "EN_ROUTE"])
def test_cancelled_jobs_never_earn(job_at, client, connection, cancel_at):
    _t, headers, booking_id = job_at(cancel_at)
    assert client.post(f"/requester/bookings/{booking_id}/cancel", headers=headers).status_code == 200
    assert earnings_rows(connection, booking_id) == []


# ================================================================== reading back


def test_summary_and_history_show_only_the_callers_earnings(job_at, onboard, client, monkeypatch):
    first, _h, first_booking = job_at("COMPLETED")
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("15"))
    second, _h2, second_booking = job_at("COMPLETED", price="999.00")

    mine = history(client, first).json()
    assert [row["service_request_id"] for row in mine] == [first_booking]
    assert [row["service_request_id"] for row in history(client, second).json()] == [second_booking]
    assert summary(client, first).json()["total_net"] == "499.00"
    theirs = summary(client, second).json()
    assert (theirs["total_gross"], theirs["total_commission"], theirs["total_net"]) == ("999.00", "149.85", "849.15")
    stranger = working(client, onboard, "PAINTER", at=AT_HOME)
    assert history(client, stranger).json() == []
    empty = summary(client, stranger).json()
    assert (empty["total_net"], empty["earnings_count"]) == ("0.00", 0)


def test_summary_periods_follow_india_time(client, onboard, connection):
    from datetime import datetime

    technician = working(client, onboard, "PLUMBER", at=AT_HOME)
    technician_id = technician["user"]["id"]
    # "Now" is pinned to Mon 21 Sep 2026, 12:00 IST (06:30 UTC). Dated rows, in UTC:
    rows = (
        ("2026-09-20 18:40", "40.00"),  # Mon 21 Sep 00:10 IST: today and this week, though still the 20th in UTC
        ("2026-09-21 05:00", "5.00"),  # Mon 21 Sep 10:30 IST: today
        ("2026-09-20 10:00", "100.00"),  # Sun 20 Sep 15:30 IST: last week, this month
        ("2026-08-15 10:00", "50.00"),  # August: only in the total
    )
    for earned_at, gross in rows:
        connection.execute(
            text(
                "INSERT INTO partner.technician_earnings (technician_id, gross_amount, commission_rate, commission_amount, "
                "net_amount, currency, earned_at) VALUES (:t, :g, 0, 0, :g, 'INR', :e)"
            ),
            {"t": technician_id, "g": gross, "e": earned_at + "+00"},  # the dates above are UTC
        )
    service = EarningsService(EarningsRepository(Session(bind=connection, join_transaction_mode="create_savepoint")))
    result = service.summary(SimpleNamespace(id=technician_id), now_utc=datetime(2026, 9, 21, 6, 30))
    assert result.today_net == Decimal("45.00")
    assert result.week_net == Decimal("45.00")
    assert result.month_net == Decimal("145.00")
    assert result.total_net == Decimal("195.00") and result.earnings_count == 4
    assert result.timezone == "Asia/Kolkata"


def test_history_is_newest_first_paged_and_holds_nothing_about_the_customer(job_at, client):
    technician, _h, first = job_at("COMPLETED")
    _t2, _h2, second = job_at("COMPLETED", technician=technician)
    rows = history(client, technician).json()
    assert [row["service_request_id"] for row in rows] == [second, first]
    assert set(rows[0]) == EARNING_KEYS
    assert [row["service_request_id"] for row in history(client, technician, limit=1, offset=1).json()] == [first]
    response = history(client, technician)
    for secret in ("Main Road", "Test Owner", "9123456780", "requester", "address", "latitude", "phone"):
        assert secret not in response.text
    assert history(client, technician, limit=101).status_code == 422
    assert history(client, technician, offset=-1).status_code == 422


def test_earnings_need_a_dashboard_session(client, onboard):
    for url in ("/technicians/me/earnings", "/technicians/me/earnings/summary"):
        assert client.get(url).status_code == 401
    registration = onboard()["registration_session"]["access_token"]
    assert client.get("/technicians/me/earnings", headers=bearer(registration)).status_code == 403


# ------------------------------------------------ offer card estimate (display only)


@pytest.mark.parametrize(
    "rate, quoted, expected",
    [
        ("0", "499.00", "499.00"),
        ("15", "999.00", "849.15"),
        ("12.5", "999.00", "874.12"),
        ("100", "499.00", "0.00"),
    ],
)
def test_offer_estimate_uses_the_completion_split(monkeypatch, rate, quoted, expected):
    from app.modules.bookings.booking_responses import estimated_net_amount

    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal(rate))
    assert estimated_net_amount(Decimal(quoted)) == Decimal(expected)
    assert estimated_net_amount(Decimal(quoted)) == split_amount(Decimal(quoted), Decimal(rate))[1]


def test_offer_estimate_is_absent_without_a_price_or_with_a_bad_rate(monkeypatch):
    from app.modules.bookings.booking_responses import estimated_net_amount

    assert estimated_net_amount(None) is None
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("150"))
    assert estimated_net_amount(Decimal("499.00")) is None  # never fails the offer


def test_the_offer_carries_the_estimate_and_records_no_earning(job_at, client, connection, monkeypatch):
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("15"))
    technician, _headers, booking_id = job_at("OFFERED", price="999.00")
    offers = client.get("/technicians/me/offers", headers=bearer(technician["access_token"])).json()
    offer = next(item for item in offers if item["booking_id"] == booking_id)
    assert Decimal(offer["quoted_amount"]) == Decimal("999.00")
    assert Decimal(offer["estimated_net_amount"]) == Decimal("849.15")
    # Display only: nothing is recorded until the job is completed.
    assert earnings_rows(connection, booking_id) == []
    assert act(client, technician, booking_id, "accept").status_code == 200
    assert earnings_rows(connection, booking_id) == []
