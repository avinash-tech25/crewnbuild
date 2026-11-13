"""Work bill: materials, additional labour, bill photos, attachments and notes.

Real API inside the shared rolled-back transaction. Photos go to a per-test
temporary directory (never the real JOB_MEDIA_DIRECTORY). OSRM is never called.
"""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from bookings.test_job_execution import jpeg, stored_files
from legacy import bearer
from legacy_dispatch import AT_HOME, HOME, act, arrive, working
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.runtime import settings
from app.modules.bookings.dependencies import get_routing_service
from app.modules.technicians.earnings_service import INDIA
from app.modules.tracking.routing_service import RouteResult

ORDER = ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]


# --------------------------------------------------------------------- fixtures


@pytest.fixture(autouse=True)
def media_directory(monkeypatch, tmp_path):
    folder = tmp_path / "job_media"
    monkeypatch.setattr(settings, "job_media_directory", str(folder))
    return folder


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
    monkeypatch.setattr(settings, "partner_commission_rate_percent", Decimal("0"))


@pytest.fixture()
def job(client, onboard, requester_session, connection):
    """A booking walked to `status` by a fresh PLUMBER. price=None: a pre-catalog booking."""

    def create(status="IN_PROGRESS", price="499.00"):
        technician = working(client, onboard, "PLUMBER", at=AT_HOME)
        _account, headers = requester_session()
        body = {
            "technician_type": "PLUMBER",
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        }
        if price is not None:
            body["service_id"] = str(
                connection.execute(
                    text(
                        "INSERT INTO partner.catalog_services (trade, slug, service_name, service_kind, price, currency, sort_order) "
                        "VALUES ('PLUMBER', :slug, 'Pipe Leakage Repair (bill test)', 'SERVICE', :price, 'INR', 999) RETURNING id"
                    ),
                    {"slug": f"bill-{uuid.uuid4().hex[:8]}", "price": price},
                ).scalar_one()
            )
        booking = client.post("/requester/bookings", headers=headers, json=body)
        assert booking.status_code == 201, booking.text
        booking_id = booking.json()["id"]
        walk(client, technician, booking_id, status)
        return technician, headers, booking_id

    return create


def walk(client, technician, booking_id, to, start="SEARCHING"):
    for step in ORDER[(ORDER.index(start) + 1 if start in ORDER else 0) : ORDER.index(to) + 1]:
        if step == "ACCEPTED":
            assert act(client, technician, booking_id, "accept").status_code == 200
        elif step == "EN_ROUTE":
            assert act(client, technician, booking_id, "en-route").status_code == 200
        elif step == "ARRIVED":
            assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"
        elif step == "IN_PROGRESS":
            assert act(client, technician, booking_id, "start").status_code == 200
        else:
            response = act(client, technician, booking_id, "complete")
            assert response.status_code == 200, response.text


# ---------------------------------------------------------------------- helpers


def auth(technician):
    return bearer(technician["access_token"])


def base(booking_id):
    return f"/technicians/me/jobs/{booking_id}/bill"


def material(**overrides):
    return {
        "kind": "MATERIAL",
        "name": "PVC pipe 1 inch",
        "quantity": "2",
        "unit": "m",
        "unit_price": "90",
        **overrides,
    }


def labour(**overrides):
    return {
        "kind": "LABOUR",
        "name": "Extra plumbing work",
        "quantity": "1.5",
        "unit": "hr",
        "unit_price": "100",
        **overrides,
    }


def add(client, technician, booking_id, body):
    return client.post(f"{base(booking_id)}/items", headers=auth(technician), json=body)


def bill(client, technician, booking_id):
    response = client.get(base(booking_id), headers=auth(technician))
    assert response.status_code == 200, response.text
    return response.json()


def upload(client, technician, path, content=None):
    return client.post(
        path,
        headers=auth(technician),
        files={"file": ("photo.jpg", content if content is not None else jpeg(), "image/jpeg")},
    )


def material_photo(client, technician, booking_id, item_id, content=None):
    return upload(client, technician, f"{base(booking_id)}/items/{item_id}/photos", content)


def attachment(client, technician, booking_id, content=None):
    return upload(client, technician, f"{base(booking_id)}/attachments", content)


def bill_rows(connection, booking_id):
    return (
        connection.execute(text("SELECT * FROM partner.booking_work_bills WHERE booking_id = :b"), {"b": booking_id})
        .mappings()
        .all()
    )


def earning_rows(connection, booking_id):
    return (
        connection.execute(text("SELECT * FROM partner.technician_earnings WHERE booking_id = :b"), {"b": booking_id})
        .mappings()
        .all()
    )


def full_bill(client, technician, booking_id):
    """₹180 of materials and ₹150 of additional labour, with a photo, an attachment and notes."""
    body = add(client, technician, booking_id, material()).json()
    item_id = body["materials"][0]["id"]
    assert material_photo(client, technician, booking_id, item_id).status_code == 201
    assert add(client, technician, booking_id, labour()).status_code == 201
    assert attachment(client, technician, booking_id).status_code == 201
    notes = client.put(
        f"{base(booking_id)}/notes", headers=auth(technician), json={"notes": "  Replaced 2 m of pipe.  "}
    )
    assert notes.status_code == 200, notes.text
    return item_id


# ================================================================ lines and totals


def test_a_material_line_is_created_with_its_amount(client, job, connection):
    technician, _headers, booking_id = job()
    assert bill(client, technician, booking_id)["status"] is None
    assert bill_rows(connection, booking_id) == []  # viewing creates nothing

    response = add(client, technician, booking_id, material(description="  Grey, ISI marked  "))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "DRAFT" and body["booking_status"] == "IN_PROGRESS"
    [line] = body["materials"]
    assert (line["name"], line["unit"], line["description"], line["work_date"]) == (
        "PVC pipe 1 inch",
        "m",
        "Grey, ISI marked",
        None,
    )
    assert (Decimal(line["quantity"]), Decimal(line["unit_price"]), Decimal(line["amount"])) == (
        Decimal("2"),
        Decimal("90"),
        Decimal("180"),
    )
    assert body["labour"] == [] and line["photos"] == []
    assert len(bill_rows(connection, booking_id)) == 1


def test_line_amounts_are_rounded_to_the_paisa_half_up(client, job):
    technician, _headers, booking_id = job()
    body = add(client, technician, booking_id, material(quantity="2.5", unit_price="33.33")).json()
    assert Decimal(body["materials"][0]["amount"]) == Decimal("83.33")  # 83.325 -> 83.33
    body = add(client, technician, booking_id, material(quantity="0.01", unit_price="0.5")).json()
    assert Decimal(body["materials"][1]["amount"]) == Decimal("0.01")  # 0.005 -> 0.01
    assert Decimal(body["materials_total"]) == Decimal("83.34")


def test_invalid_lines_are_refused(client, job):
    technician, _headers, booking_id = job()
    today = __import__("datetime").datetime.now(INDIA).date()
    for body in (
        material(quantity="0"),
        material(quantity="-1"),
        material(unit_price="-1"),
        material(quantity="1.234"),
        material(unit_price="10.001"),
        material(name="   "),
        material(unit=""),
        material(name="x" * 121),
        material(work_date=str(today)),  # a material has no work date
        labour(work_date=str(today + timedelta(days=2))),  # not in the future
        material(quantity="9999.99", unit_price="999999.99"),  # over ₹10,00,000 on one line
        {**material(), "kind": "DISCOUNT"},
        material(amount="1"),
    ):
        response = add(client, technician, booking_id, body)
        # `amount` is never read from the request: extra fields are ignored, the line is valid.
        if "amount" in body:
            assert response.status_code == 201 and Decimal(response.json()["materials"][-1]["amount"]) == Decimal("180")
            continue
        assert response.status_code == 422, (body, response.text)


def test_additional_labour_has_a_date_rate_and_amount(client, job):
    technician, _headers, booking_id = job()
    today = __import__("datetime").datetime.now(INDIA).date()
    body = add(client, technician, booking_id, labour(work_date=str(today), description="Re-routed the drain")).json()
    [line] = body["labour"]
    assert line["kind"] == "LABOUR" and line["work_date"] == str(today) and line["description"] == "Re-routed the drain"
    assert Decimal(line["amount"]) == Decimal("150")
    assert Decimal(body["additional_labour_total"]) == Decimal("150") and body["materials"] == []


def test_totals_add_materials_and_labour_to_the_service_price(client, job):
    technician, _headers, booking_id = job()
    full_bill(client, technician, booking_id)
    body = bill(client, technician, booking_id)
    assert Decimal(body["service_price"]) == Decimal("499")
    assert Decimal(body["materials_total"]) == Decimal("180")
    assert Decimal(body["additional_labour_total"]) == Decimal("150")
    assert Decimal(body["bill_total"]) == Decimal("829")


def test_a_draft_line_can_be_edited_and_removed_with_its_photos(client, job, connection, media_directory):
    technician, _headers, booking_id = job()
    item_id = add(client, technician, booking_id, material()).json()["materials"][0]["id"]
    assert material_photo(client, technician, booking_id, item_id).status_code == 201
    assert len(stored_files(media_directory)) == 1

    edited = client.put(
        f"{base(booking_id)}/items/{item_id}",
        headers=auth(technician),
        json={"name": "CPVC pipe", "quantity": "3", "unit": "m", "unit_price": "95"},
    )
    assert edited.status_code == 200, edited.text
    line = edited.json()["materials"][0]
    assert (line["name"], Decimal(line["amount"]), len(line["photos"])) == ("CPVC pipe", Decimal("285"), 1)

    removed = client.delete(f"{base(booking_id)}/items/{item_id}", headers=auth(technician))
    assert removed.status_code == 200 and removed.json()["materials"] == []
    assert Decimal(removed.json()["materials_total"]) == 0
    assert stored_files(media_directory) == []  # the photo's file went with it
    assert (
        connection.execute(
            text("SELECT count(*) FROM partner.booking_media WHERE booking_id = :b"), {"b": booking_id}
        ).scalar()
        == 0
    )


def test_the_line_limit_is_enforced(client, job, monkeypatch):
    monkeypatch.setattr(settings, "work_bill_max_items", 2)
    technician, _headers, booking_id = job()
    assert add(client, technician, booking_id, material()).status_code == 201
    assert add(client, technician, booking_id, labour()).status_code == 201
    assert add(client, technician, booking_id, material()).status_code == 409


# ========================================================== photos and attachments


def test_material_photos_are_private_encrypted_and_limited(client, job, media_directory, monkeypatch):
    monkeypatch.setattr(settings, "work_bill_max_material_photos", 2)
    technician, headers, booking_id = job()
    body = add(client, technician, booking_id, material()).json()
    item_id = body["materials"][0]["id"]

    photo = material_photo(client, technician, booking_id, item_id)
    assert photo.status_code == 201, photo.text
    assert set(photo.json()) == {"id", "kind", "content_type", "byte_size", "created_at", "can_delete"}
    assert photo.json()["kind"] == "MATERIAL"
    assert material_photo(client, technician, booking_id, item_id).status_code == 201
    assert material_photo(client, technician, booking_id, item_id).status_code == 409  # limit of 2 per line

    [stored] = stored_files(media_directory)[:1]
    assert (
        stored.endswith(".bin") and b"\xff\xd8" not in (media_directory / stored).read_bytes()[:4]
    )  # encrypted at rest
    content = client.get(f"{base(booking_id)}/media/{photo.json()['id']}/content", headers=auth(technician))
    assert content.status_code == 200 and content.content[:2] == b"\xff\xd8"
    assert content.headers["cache-control"] == "private, no-store"
    view = bill(client, technician, booking_id)
    assert [p["id"] for p in view["materials"][0]["photos"]][0] == photo.json()["id"]
    assert "storage_key" not in str(view) and ".bin" not in str(view)


def test_photos_belong_to_material_lines_only(client, job):
    technician, _headers, booking_id = job()
    labour_id = add(client, technician, booking_id, labour()).json()["labour"][0]["id"]
    assert material_photo(client, technician, booking_id, labour_id).status_code == 422
    assert material_photo(client, technician, booking_id, uuid.uuid4()).status_code == 404


def test_a_bill_photo_must_be_an_image(client, job):
    technician, _headers, booking_id = job()
    response = client.post(
        f"{base(booking_id)}/attachments",
        headers=auth(technician),
        files={"file": ("bill.pdf", b"%PDF-1.4 not an image", "application/pdf")},
    )
    assert response.status_code in (415, 422), response.text


def test_bill_attachments_are_added_limited_and_removed(client, job, media_directory, monkeypatch):
    monkeypatch.setattr(settings, "work_bill_max_attachments", 1)
    technician, _headers, booking_id = job()
    first = attachment(client, technician, booking_id)  # may be the bill's first entry
    assert first.status_code == 201 and first.json()["kind"] == "BILL"
    assert attachment(client, technician, booking_id).status_code == 409
    body = bill(client, technician, booking_id)
    assert body["status"] == "DRAFT" and [a["id"] for a in body["attachments"]] == [first.json()["id"]]
    assert body["attachments"][0]["can_delete"] is True

    assert client.delete(f"{base(booking_id)}/media/{first.json()['id']}", headers=auth(technician)).status_code == 204
    assert bill(client, technician, booking_id)["attachments"] == [] and stored_files(media_directory) == []


# ========================================================================= notes


def test_bill_notes_are_separate_from_service_notes(client, job):
    technician, _headers, booking_id = job()
    put = lambda notes: client.put(f"{base(booking_id)}/notes", headers=auth(technician), json={"notes": notes})
    assert put("x" * 2001).status_code == 422
    saved = put("  Customer supplied the tap.  ")
    assert saved.status_code == 200 and saved.json()["notes"] == "Customer supplied the tap."
    execution = client.get(f"/technicians/me/jobs/{booking_id}/execution", headers=auth(technician)).json()
    assert execution["service_notes"] is None
    assert put("").json()["notes"] is None


def test_clearing_notes_on_a_job_without_a_bill_creates_none(client, job, connection):
    technician, _headers, booking_id = job()
    response = client.put(f"{base(booking_id)}/notes", headers=auth(technician), json={"notes": "   "})
    assert response.status_code == 200 and response.json()["status"] is None
    assert bill_rows(connection, booking_id) == []


# ======================================================================== submit


def test_submit_finalizes_and_snapshots_without_touching_the_job(client, job, connection):
    technician, _headers, booking_id = job()
    full_bill(client, technician, booking_id)
    response = client.post(f"{base(booking_id)}/submit", headers=auth(technician))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "FINALIZED" and body["finalized_at"] and body["booking_status"] == "IN_PROGRESS"
    assert (body["can_edit"], body["can_submit"]) == (False, False)
    assert all(p["can_delete"] is False for p in body["attachments"] + body["materials"][0]["photos"])

    [row] = bill_rows(connection, booking_id)
    assert (
        row["status"],
        row["service_price"],
        row["materials_total"],
        row["additional_labour_total"],
        row["bill_total"],
    ) == ("FINALIZED", Decimal("499.00"), Decimal("180.00"), Decimal("150.00"), Decimal("829.00"))
    status, completed_at, quoted = connection.execute(
        text("SELECT status, completed_at, quoted_amount FROM partner.bookings WHERE id = :b"), {"b": booking_id}
    ).one()
    assert (status, completed_at, quoted) == ("IN_PROGRESS", None, Decimal("499.00"))
    assert earning_rows(connection, booking_id) == []  # submitting creates no earning


def test_a_finalized_bill_is_read_only(client, job, media_directory):
    technician, _headers, booking_id = job()
    item_id = full_bill(client, technician, booking_id)
    before = bill(client, technician, booking_id)
    photo_id = before["materials"][0]["photos"][0]["id"]
    attachment_id = before["attachments"][0]["id"]
    assert client.post(f"{base(booking_id)}/submit", headers=auth(technician)).status_code == 200
    frozen = bill(client, technician, booking_id)
    files = stored_files(media_directory)

    refusals = [
        add(client, technician, booking_id, material()),
        client.put(
            f"{base(booking_id)}/items/{item_id}",
            headers=auth(technician),
            json={"name": "Changed", "quantity": "1", "unit": "m", "unit_price": "1"},
        ),
        client.delete(f"{base(booking_id)}/items/{item_id}", headers=auth(technician)),
        client.put(f"{base(booking_id)}/notes", headers=auth(technician), json={"notes": "changed"}),
        material_photo(client, technician, booking_id, item_id),
        attachment(client, technician, booking_id),
        client.delete(f"{base(booking_id)}/media/{photo_id}", headers=auth(technician)),
        client.delete(f"{base(booking_id)}/media/{attachment_id}", headers=auth(technician)),
    ]
    for response in refusals:
        assert response.status_code == 409, response.text
        assert "submitted" in response.json()["detail"]
    assert bill(client, technician, booking_id) == frozen
    assert stored_files(media_directory) == files


def test_submitting_twice_changes_nothing(client, job, connection):
    technician, _headers, booking_id = job()
    full_bill(client, technician, booking_id)
    first = client.post(f"{base(booking_id)}/submit", headers=auth(technician)).json()
    second = client.post(f"{base(booking_id)}/submit", headers=auth(technician))
    assert second.status_code == 200 and second.json() == first
    assert len(bill_rows(connection, booking_id)) == 1
    assert (
        connection.execute(
            text(
                "SELECT count(*) FROM partner.booking_work_bill_items i JOIN partner.booking_work_bills b ON b.id = i.bill_id "
                "WHERE b.booking_id = :b"
            ),
            {"b": booking_id},
        ).scalar()
        == 2
    )


def test_there_is_nothing_to_submit_without_a_bill(client, job, connection):
    technician, _headers, booking_id = job()
    assert client.post(f"{base(booking_id)}/submit", headers=auth(technician)).status_code == 409
    assert bill_rows(connection, booking_id) == []


# ============================================================= status windows


@pytest.mark.parametrize("status", ["ACCEPTED", "EN_ROUTE", "ARRIVED"])
def test_the_bill_cannot_be_started_before_the_work(client, job, connection, status):
    technician, _headers, booking_id = job(status)
    body = bill(client, technician, booking_id)
    assert (body["status"], body["can_edit"], body["can_submit"]) == (None, False, False)
    assert add(client, technician, booking_id, material()).status_code == 409
    assert attachment(client, technician, booking_id).status_code == 409
    assert client.put(f"{base(booking_id)}/notes", headers=auth(technician), json={"notes": "early"}).status_code == 409
    assert client.post(f"{base(booking_id)}/submit", headers=auth(technician)).status_code == 409
    assert bill_rows(connection, booking_id) == []


def test_in_progress_can_edit_a_draft(client, job):
    technician, _headers, booking_id = job()
    body = add(client, technician, booking_id, material()).json()
    assert (body["status"], body["can_edit"], body["can_submit"]) == ("DRAFT", True, True)


# ==================================================================== completion


def test_completion_leaves_a_finalized_bill_unchanged(client, job, connection):
    technician, _headers, booking_id = job()
    full_bill(client, technician, booking_id)
    assert client.post(f"{base(booking_id)}/submit", headers=auth(technician)).status_code == 200
    [before] = bill_rows(connection, booking_id)
    walk(client, technician, booking_id, "COMPLETED", start="IN_PROGRESS")
    [after] = bill_rows(connection, booking_id)
    assert dict(after) == dict(before)
    [earning] = earning_rows(connection, booking_id)
    assert earning["gross_amount"] == Decimal("499.00") and earning["net_amount"] == Decimal("499.00")


def test_completion_finalizes_a_draft_bill_in_the_same_transaction(client, job, connection):
    technician, _headers, booking_id = job()
    full_bill(client, technician, booking_id)
    walk(client, technician, booking_id, "COMPLETED", start="IN_PROGRESS")
    [row] = bill_rows(connection, booking_id)
    completed_at = connection.execute(
        text("SELECT completed_at FROM partner.bookings WHERE id = :b"), {"b": booking_id}
    ).scalar()
    assert row["status"] == "FINALIZED" and row["finalized_at"] == completed_at
    assert (row["service_price"], row["bill_total"]) == (Decimal("499.00"), Decimal("829.00"))
    body = bill(client, technician, booking_id)
    assert (body["status"], body["booking_status"], body["can_edit"]) == ("FINALIZED", "COMPLETED", False)
    [earning] = earning_rows(connection, booking_id)
    assert earning["gross_amount"] == Decimal("499.00")  # the service price, never the ₹829 bill


def test_completion_without_a_bill_creates_none(client, job, connection):
    technician, _headers, booking_id = job()
    walk(client, technician, booking_id, "COMPLETED", start="IN_PROGRESS")
    assert bill_rows(connection, booking_id) == []
    assert len(earning_rows(connection, booking_id)) == 1
    body = bill(client, technician, booking_id)
    assert body["status"] is None and Decimal(body["service_price"]) == Decimal("499")
    assert Decimal(body["bill_total"]) == Decimal("499") and body["can_edit"] is False


def test_a_completed_booking_without_a_bill_is_unchanged_by_viewing_it(client, job, connection):
    technician, headers, booking_id = job("COMPLETED")
    snapshot = lambda: dict(
        connection.execute(text("SELECT * FROM partner.bookings WHERE id = :b"), {"b": booking_id}).mappings().one()
    )
    before = snapshot()
    assert bill(client, technician, booking_id)["status"] is None
    assert client.get(f"/requester/bookings/{booking_id}/bill", headers=headers).json()["status"] is None
    assert snapshot() == before and bill_rows(connection, booking_id) == []
    assert add(client, technician, booking_id, material()).status_code == 409


def test_an_unpriced_legacy_booking_bills_only_its_extras(client, job, connection):
    technician, _headers, booking_id = job(price=None)
    body = bill(client, technician, booking_id)
    assert body["service_price"] is None and Decimal(body["bill_total"]) == 0
    full_bill(client, technician, booking_id)
    assert Decimal(bill(client, technician, booking_id)["bill_total"]) == Decimal("330")
    walk(client, technician, booking_id, "COMPLETED", start="IN_PROGRESS")
    [row] = bill_rows(connection, booking_id)
    assert (row["status"], row["service_price"], row["bill_total"]) == ("FINALIZED", None, Decimal("330.00"))
    assert earning_rows(connection, booking_id) == []  # no price, no earning -- as before


# ===================================================================== requester


def test_the_requester_sees_the_whole_bill_read_only(client, job):
    technician, headers, booking_id = job()
    full_bill(client, technician, booking_id)
    response = client.get(f"/requester/bookings/{booking_id}/bill", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["can_edit"], body["can_submit"]) == (False, False)
    assert Decimal(body["bill_total"]) == Decimal("829") and body["notes"] == "Replaced 2 m of pipe."
    assert len(body["materials"]) == 1 and len(body["labour"]) == 1 and len(body["attachments"]) == 1
    photos = body["materials"][0]["photos"] + body["attachments"]
    assert all(photo["can_delete"] is False for photo in photos)
    for photo in photos:
        content = client.get(f"/requester/bookings/{booking_id}/bill/media/{photo['id']}/content", headers=headers)
        assert content.status_code == 200 and content.content[:2] == b"\xff\xd8"


def test_the_requester_cannot_change_a_bill(client, job, connection):
    technician, headers, booking_id = job()
    item_id = full_bill(client, technician, booking_id)
    attachment_id = bill(client, technician, booking_id)["attachments"][0]["id"]
    before = bill(client, technician, booking_id)
    requester_base = f"/requester/bookings/{booking_id}/bill"
    attempts = [
        client.post(f"{requester_base}/items", headers=headers, json=material()),
        client.put(f"{requester_base}/items/{item_id}", headers=headers, json=material()),
        client.delete(f"{requester_base}/items/{item_id}", headers=headers),
        client.put(f"{requester_base}/notes", headers=headers, json={"notes": "mine"}),
        client.post(f"{requester_base}/submit", headers=headers),
        client.post(f"{requester_base}/approve", headers=headers),
        client.delete(f"{requester_base}/media/{attachment_id}", headers=headers),
        # The requester's own photo endpoints do not reach bill photos either.
        client.delete(f"/requester/bookings/{booking_id}/media/{attachment_id}", headers=headers),
        # Nor do the technician's endpoints accept a requester session.
        client.post(f"{base(booking_id)}/items", headers=headers, json=material()),
        client.post(f"{base(booking_id)}/submit", headers=headers),
    ]
    for response in attempts:
        assert response.status_code in (401, 403, 404, 405), response.text
    assert bill(client, technician, booking_id) == before
    assert bill_rows(connection, booking_id)[0]["status"] == "DRAFT"


# ================================================================== authorisation


def test_nobody_else_can_see_a_bill_or_its_photos(client, job, onboard, requester_session):
    technician, headers, booking_id = job()
    full_bill(client, technician, booking_id)
    body = bill(client, technician, booking_id)
    photo_ids = [body["materials"][0]["photos"][0]["id"], body["attachments"][0]["id"]]

    stranger = working(client, onboard, "PLUMBER", at=AT_HOME)
    _other_account, other_headers = requester_session()
    assert client.get(base(booking_id), headers=auth(stranger)).status_code == 404
    assert client.get(f"/requester/bookings/{booking_id}/bill", headers=other_headers).status_code == 404
    for photo_id in photo_ids:
        assert client.get(f"{base(booking_id)}/media/{photo_id}/content", headers=auth(stranger)).status_code == 404
        assert (
            client.get(
                f"/requester/bookings/{booking_id}/bill/media/{photo_id}/content", headers=other_headers
            ).status_code
            == 404
        )
        assert client.get(f"{base(booking_id)}/media/{photo_id}/content").status_code in (401, 403)
        assert client.get(f"/requester/bookings/{booking_id}/bill/media/{photo_id}/content").status_code in (401, 403)
    assert add(client, stranger, booking_id, material()).status_code == 404
    assert client.post(f"{base(booking_id)}/submit", headers=auth(stranger)).status_code == 404

    # A bill photo is not reachable through another booking's id.
    stranger_tech, _h, other_booking = job()
    assert (
        client.get(f"{base(other_booking)}/media/{photo_ids[0]}/content", headers=auth(stranger_tech)).status_code
        == 404
    )


def test_job_photos_and_bill_photos_stay_apart(client, job):
    technician, headers, booking_id = job()
    before = client.post(
        f"/technicians/me/jobs/{booking_id}/media",
        headers=auth(technician),
        data={"kind": "BEFORE"},
        files={"file": ("p.jpg", jpeg(), "image/jpeg")},
    )
    assert before.status_code == 201
    full_bill(client, technician, booking_id)
    body = bill(client, technician, booking_id)
    bill_ids = {body["materials"][0]["photos"][0]["id"], body["attachments"][0]["id"]}

    execution = client.get(f"/technicians/me/jobs/{booking_id}/execution", headers=auth(technician)).json()
    assert [m["id"] for m in execution["media"]] == [before.json()["id"]]
    assert (
        client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()["media"][0]["kind"]
        == "BEFORE"
    )
    for photo_id in bill_ids:
        # The job-photo endpoints neither serve nor remove bill photos...
        assert (
            client.get(
                f"/technicians/me/jobs/{booking_id}/media/{photo_id}/content", headers=auth(technician)
            ).status_code
            == 404
        )
        assert (
            client.delete(f"/technicians/me/jobs/{booking_id}/media/{photo_id}", headers=auth(technician)).status_code
            == 404
        )
    # ...and the bill endpoints do not serve or remove job photos.
    assert (
        client.get(f"{base(booking_id)}/media/{before.json()['id']}/content", headers=auth(technician)).status_code
        == 404
    )
    assert client.delete(f"{base(booking_id)}/media/{before.json()['id']}", headers=auth(technician)).status_code == 404
    assert (
        client.get(
            f"/technicians/me/jobs/{booking_id}/media/{before.json()['id']}/content", headers=auth(technician)
        ).status_code
        == 200
    )
    # The job photo kinds are unchanged: BILL and MATERIAL are not accepted there.
    for kind in ("BILL", "MATERIAL"):
        refused = client.post(
            f"/technicians/me/jobs/{booking_id}/media",
            headers=auth(technician),
            data={"kind": kind},
            files={"file": ("p.jpg", jpeg(), "image/jpeg")},
        )
        assert refused.status_code == 422


# ===================================================================== database


def test_the_database_holds_line_amounts_and_totals_to_the_formula(client, job, connection):
    technician, _headers, booking_id = job()
    item_id = add(client, technician, booking_id, material()).json()["materials"][0]["id"]
    bill_id = bill_rows(connection, booking_id)[0]["id"]
    for statement, params in (
        ("UPDATE partner.booking_work_bill_items SET amount = 181 WHERE id = :i", {"i": item_id}),
        ("UPDATE partner.booking_work_bill_items SET work_date = current_date WHERE id = :i", {"i": item_id}),
        (
            "UPDATE partner.booking_work_bills SET status = 'FINALIZED', finalized_at = now(), materials_total = 180, "
            "additional_labour_total = 0, bill_total = 1 WHERE id = :i",
            {"i": bill_id},
        ),
        ("UPDATE partner.booking_work_bills SET status = 'APPROVED' WHERE id = :i", {"i": bill_id}),
        (
            "INSERT INTO partner.booking_media (booking_id, kind, uploaded_by_technician_id, storage_key, "
            "content_type, byte_size) SELECT :b, 'MATERIAL', technician_id, repeat('a', 48), 'image/jpeg', 1 "
            "FROM partner.bookings WHERE id = :b",
            {"b": booking_id},
        ),
        ("INSERT INTO partner.booking_work_bills (booking_id) VALUES (:b)", {"b": booking_id}),
    ):
        savepoint = connection.begin_nested()
        with pytest.raises(IntegrityError):
            connection.execute(text(statement), params)
        savepoint.rollback()
