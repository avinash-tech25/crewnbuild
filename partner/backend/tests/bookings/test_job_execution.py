"""Job execution: checklist snapshot, service notes and private job photos.

Everything runs through the real API inside the shared rolled-back transaction.
Photos are written to a per-test temporary directory (never the real
JOB_MEDIA_DIRECTORY) and encrypted with the per-test key conftest sets up.
OSRM is never called: routing is stubbed as in test_tracking.
"""

import io
import uuid

import pytest
from conftest import REQUESTERS_STAND_IN
from legacy import bearer, handoff_token
from legacy_dispatch import ANOTHER_CITY, AT_HOME, HOME, act, arrive, offer_ids, offers, working
from PIL import Image, PngImagePlugin
from sqlalchemy import text

from app.core.runtime import settings
from app.modules.bookings.dependencies import get_routing_service
from app.modules.bookings.job_media_storage import job_media_root
from app.modules.tracking.routing_service import RouteResult

# The Step-1 offer shape. Nothing about photos may ever join it.
OFFER_KEYS = {
    "booking_id",
    "currency",
    "distance_meters",
    "estimated_net_amount",
    "expires_at",
    "offered_at",
    "quoted_amount",
    "reference",
    "service_kind",
    "service_name",
    "technician_type",
    "work_area",
}


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


@pytest.fixture()
def catalog(connection):
    """A PLUMBER catalog service inside the rolled-back transaction, with optional templates."""

    def create(steps=(), inactive=()):
        service_id = connection.execute(
            text(
                "INSERT INTO partner.catalog_services (trade, slug, service_name, service_kind, price, currency, sort_order) "
                "VALUES ('PLUMBER', :slug, 'Pipe Leakage Repair (test)', 'SERVICE', 499, 'INR', 999) RETURNING id"
            ),
            {"slug": f"stage-a-{uuid.uuid4().hex[:8]}"},
        ).scalar_one()
        for position, title in enumerate(steps, start=1):
            connection.execute(
                text(
                    "INSERT INTO partner.catalog_service_checklist_steps (catalog_service_id, position, title, is_active) VALUES (:s, :p, :t, :a)"
                ),
                {"s": service_id, "p": position, "t": title, "a": position not in inactive},
            )
        return str(service_id)

    return create


@pytest.fixture()
def owner(client, connection):
    """A House Owner session. Each gets its own phone number: Professional allows one phone per country."""

    def create():
        account_id = connection.execute(
            text(
                f"INSERT INTO {REQUESTERS_STAND_IN} (id, name, email, phone, status, address, pincode, location, requester_role) "
                "VALUES (gen_random_uuid(), 'Other Owner', :email, :phone, 'ACTIVE', '9 Other Road, Alpha Main', '000405', "
                "'Alpha Main, Alpha District, Test State', 'OWNER') RETURNING id"
            ),
            {"email": f"partner-test-{uuid.uuid4().hex}@example.com", "phone": "8" + uuid.uuid4().int.__str__()[:9]},
        ).scalar_one()
        response = client.post("/requester/session", json={"handoff_token": handoff_token(account_id)})
        assert response.status_code == 200, response.text
        return bearer(response.json()["session_token"])

    return create


@pytest.fixture()
def job(client, onboard, owner, catalog):
    """A catalog booking offered to one nearby PLUMBER. `advance` walks it forward."""

    def create(steps=(), accept=True, service=True, **catalog_options):
        technician = working(client, onboard, "PLUMBER", at=AT_HOME)
        headers = owner()
        body = {
            "technician_type": "PLUMBER",
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        }
        if service:
            body["service_id"] = catalog(steps, **catalog_options)
        booking = client.post("/requester/bookings", headers=headers, json=body)
        assert booking.status_code == 201, booking.text
        booking_id = booking.json()["id"]
        if accept:
            assert act(client, technician, booking_id, "accept").status_code == 200
        return technician, headers, booking_id

    return create


def advance(client, technician, booking_id, to):
    order = ["EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]
    for status in order[: order.index(to) + 1]:
        if status == "EN_ROUTE":
            assert act(client, technician, booking_id, "en-route").status_code == 200
        elif status == "ARRIVED":
            assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"
        elif status == "IN_PROGRESS":
            assert act(client, technician, booking_id, "start").status_code == 200
        else:
            assert act(client, technician, booking_id, "complete").status_code == 200


# ----------------------------------------------------------------------- images


def jpeg(size=(64, 48), orientation=None, gps=True, color=(200, 30, 30)):
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMake"
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (17.0, 26.0, 53.9), 3: "E", 4: (78.0, 23.0, 29.4)}
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format="JPEG", exif=exif.tobytes())
    return output.getvalue()


def png_with_text():
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "secret-home-location")
    output = io.BytesIO()
    Image.new("RGBA", (32, 32), (0, 128, 0, 255)).save(output, format="PNG", pnginfo=info)
    return output.getvalue()


def webp_with_exif():
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMake"
    output = io.BytesIO()
    Image.new("RGB", (40, 30), (0, 0, 200)).save(output, format="WEBP", exif=exif.tobytes())
    return output.getvalue()


def technician_upload(client, technician, booking_id, kind, content=None, name="photo.jpg", mime="image/jpeg"):
    return client.post(
        f"/technicians/me/jobs/{booking_id}/media",
        headers=bearer(technician["access_token"]),
        data={"kind": kind},
        files={"file": (name, content if content is not None else jpeg(), mime)},
    )


def requester_upload(client, headers, booking_id, content=None, name="photo.jpg", mime="image/jpeg"):
    return client.post(
        f"/requester/bookings/{booking_id}/media",
        headers=headers,
        files={"file": (name, content if content is not None else jpeg(), mime)},
    )


def tech_execution(client, technician, booking_id):
    return client.get(f"/technicians/me/jobs/{booking_id}/execution", headers=bearer(technician["access_token"]))


def tech_content(client, technician, booking_id, media_id):
    return client.get(
        f"/technicians/me/jobs/{booking_id}/media/{media_id}/content", headers=bearer(technician["access_token"])
    )


def stored_files(folder):
    return sorted(path.name for path in folder.glob("*")) if folder.exists() else []


# ------------------------------------------------------------ checklist snapshot


def test_a_new_catalog_booking_copies_the_active_templates(client, job, connection):
    technician, headers, booking_id = job(
        steps=("Inspect leakage", "Shut off water", "Old step", "Final inspection"), inactive=(3,)
    )
    view = tech_execution(client, technician, booking_id).json()
    assert [(s["position"], s["title"], s["completed"]) for s in view["steps"]] == [
        (1, "Inspect leakage", False),
        (2, "Shut off water", False),
        (4, "Final inspection", False),
    ]
    assert (view["steps_total"], view["steps_completed"]) == (3, 0)
    template_ids = connection.execute(
        text("SELECT count(*) FROM partner.booking_checklist_steps WHERE booking_id = :b AND template_id IS NOT NULL"),
        {"b": booking_id},
    ).scalar()
    assert template_ids == 3

    # A later catalog edit does not rewrite the booking's copy.
    connection.execute(
        text(
            "UPDATE partner.catalog_service_checklist_steps SET title = 'Renamed' WHERE position = 1 AND title = 'Inspect leakage'"
        )
    )
    assert tech_execution(client, technician, booking_id).json()["steps"][0]["title"] == "Inspect leakage"


def test_a_service_without_templates_books_with_no_steps(client, job):
    technician, headers, booking_id = job(steps=())
    view = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    assert view["steps"] == [] and view["steps_total"] == 0


def test_a_booking_without_a_service_degrades_gracefully(client, job):
    technician, headers, booking_id = job(service=False)
    view = tech_execution(client, technician, booking_id).json()
    assert (view["steps"], view["service_notes"], view["media"]) == ([], None, [])
    assert view["can_upload"] == [] and view["can_edit_steps"] is False


# ------------------------------------------------------------------- checklist


def test_steps_can_only_be_ticked_while_in_progress(client, job):
    technician, headers, booking_id = job(steps=("Inspect", "Repair"))
    step_id = tech_execution(client, technician, booking_id).json()["steps"][0]["id"]
    patch = lambda done: client.patch(
        f"/technicians/me/jobs/{booking_id}/steps/{step_id}",
        headers=bearer(technician["access_token"]),
        json={"completed": done},
    )
    assert patch(True).status_code == 409  # ACCEPTED
    advance(client, technician, booking_id, "ARRIVED")
    assert patch(True).status_code == 409
    act(client, technician, booking_id, "start")

    ticked = patch(True)
    assert ticked.status_code == 200, ticked.text
    body = ticked.json()
    assert body["steps"][0]["completed"] is True and body["steps"][0]["completed_at"] and body["steps_completed"] == 1
    assert patch(False).json()["steps"][0]["completed_at"] is None

    # The status workflow is untouched by the checklist.
    assert body["status"] == "IN_PROGRESS"
    act(client, technician, booking_id, "complete")
    assert patch(True).status_code == 409  # read-only after completion
    # The requester sees the checklist, read-only.
    view = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    assert view["steps_total"] == 2 and view["can_edit_steps"] is False


def test_a_step_of_another_booking_is_not_found(client, job):
    technician, _headers, booking_id = job(steps=("Inspect",))
    other_tech, _other_headers, other_booking = job(steps=("Other",))
    foreign_step = tech_execution(client, other_tech, other_booking).json()["steps"][0]["id"]
    advance(client, technician, booking_id, "IN_PROGRESS")
    response = client.patch(
        f"/technicians/me/jobs/{booking_id}/steps/{foreign_step}",
        headers=bearer(technician["access_token"]),
        json={"completed": True},
    )
    assert response.status_code == 404


# ------------------------------------------------------------------------ notes


def test_notes_are_trimmed_limited_and_editable_only_in_progress(client, job):
    technician, headers, booking_id = job()
    put = lambda notes: client.put(
        f"/technicians/me/jobs/{booking_id}/notes", headers=bearer(technician["access_token"]), json={"notes": notes}
    )
    assert put("early").status_code == 409
    advance(client, technician, booking_id, "IN_PROGRESS")

    saved = put("  Replaced damaged pipe joint and tested water flow.  ")
    assert (
        saved.status_code == 200
        and saved.json()["service_notes"] == "Replaced damaged pipe joint and tested water flow."
    )
    assert saved.json()["service_notes_updated_at"]
    assert put("   ").json()["service_notes"] is None
    assert put("x" * 2001).status_code == 422
    assert put("  " + "y" * 2000 + "  ").json()["service_notes"] == "y" * 2000

    act(client, technician, booking_id, "complete")
    assert put("after").status_code == 409
    # The technician still reads their notes after completion; the requester never does.
    assert tech_execution(client, technician, booking_id).json()["service_notes"] == "y" * 2000
    view = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    assert "service_notes" not in view and "service_notes_updated_at" not in view
    assert view["can_edit_notes"] is False


NOTE = "PRIVATE-NOTE customer was rude, used spare joint from my own van"


def test_the_requester_never_receives_the_technicians_notes(client, job):
    technician, headers, booking_id = job(steps=("Inspect", "Repair"))
    token = bearer(technician["access_token"])
    requester_view = lambda: client.get(f"/requester/bookings/{booking_id}/execution", headers=headers)

    advance(client, technician, booking_id, "ARRIVED")
    before = technician_upload(client, technician, booking_id, "BEFORE")
    assert before.status_code == 201
    act(client, technician, booking_id, "start")
    saved = client.put(f"/technicians/me/jobs/{booking_id}/notes", headers=token, json={"notes": NOTE})
    assert saved.status_code == 200 and saved.json()["service_notes"] == NOTE
    step_id = saved.json()["steps"][0]["id"]
    assert (
        client.patch(
            f"/technicians/me/jobs/{booking_id}/steps/{step_id}", headers=token, json={"completed": True}
        ).status_code
        == 200
    )
    after = technician_upload(client, technician, booking_id, "AFTER")
    assert after.status_code == 201

    for stage in ("IN_PROGRESS", "COMPLETED"):
        if stage == "COMPLETED":
            assert act(client, technician, booking_id, "complete").status_code == 200
        # 1. The technician keeps reading their own notes.
        mine = tech_execution(client, technician, booking_id).json()
        assert mine["service_notes"] == NOTE and mine["service_notes_updated_at"]

        # 2. Not a field, not a value, not a timestamp anywhere in the requester's answer.
        response = requester_view()
        assert response.status_code == 200
        body = response.json()
        assert "service_notes" not in body and "service_notes_updated_at" not in body
        assert NOTE not in response.text and "PRIVATE-NOTE" not in response.text

        # 3. Checklist progress still reaches the requester.
        assert (body["steps_total"], body["steps_completed"]) == (2, 1)
        assert [step["completed"] for step in body["steps"]] == [True, False]
        assert body["status"] == stage and body["can_edit_steps"] is False

        # 4. Customer-visible photos still work.
        assert sorted(item["kind"] for item in body["media"]) == ["AFTER", "BEFORE"]
        for media_id in (before.json()["id"], after.json()["id"]):
            photo = client.get(f"/requester/bookings/{booking_id}/media/{media_id}/content", headers=headers)
            assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"

    # The notes themselves are untouched in storage: the technician's view still has them.
    assert tech_execution(client, technician, booking_id).json()["service_notes"] == NOTE


def test_the_requester_schema_has_no_notes_field():
    from app.modules.bookings.schemas import JobExecutionResponse, RequesterJobExecutionResponse

    assert not {"service_notes", "service_notes_updated_at"} & set(RequesterJobExecutionResponse.model_fields)
    assert {"service_notes", "service_notes_updated_at"} <= set(JobExecutionResponse.model_fields)
    openapi = client_free_openapi()
    requester = openapi["paths"]["/api/v1/requester/bookings/{request_id}/execution"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    assert requester["$ref"].endswith("/RequesterJobExecutionResponse")
    technician = openapi["paths"]["/api/v1/technicians/me/jobs/{request_id}/execution"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    assert technician["$ref"].endswith("/JobExecutionResponse")


def client_free_openapi():
    from app.main import app

    return app.openapi()


# ------------------------------------------------------------- authorisation


def test_nobody_but_the_holder_and_the_owner_reaches_the_job(client, job, onboard, owner):
    technician, headers, booking_id = job(steps=("Inspect",))
    photo = requester_upload(client, headers, booking_id).json()["id"]
    stranger = working(client, onboard, "PAINTER", at=ANOTHER_CITY, pincode="000901")
    other_owner = owner()

    for response in (
        tech_execution(client, stranger, booking_id),
        tech_content(client, stranger, booking_id, photo),
        technician_upload(client, stranger, booking_id, "BEFORE"),
        client.put(
            f"/technicians/me/jobs/{booking_id}/notes", headers=bearer(stranger["access_token"]), json={"notes": "x"}
        ),
        client.delete(f"/technicians/me/jobs/{booking_id}/media/{photo}", headers=bearer(stranger["access_token"])),
        client.get(f"/requester/bookings/{booking_id}/execution", headers=other_owner),
        client.get(f"/requester/bookings/{booking_id}/media/{photo}/content", headers=other_owner),
        requester_upload(client, other_owner, booking_id),
        client.delete(f"/requester/bookings/{booking_id}/media/{photo}", headers=other_owner),
        client.get(f"/requester/bookings/{uuid.uuid4()}/execution", headers=headers),
        client.get(f"/requester/bookings/{booking_id}/media/{uuid.uuid4()}/content", headers=headers),
    ):
        assert response.status_code == 404, (response.request.method, response.request.url, response.text)
    # No token at all.
    assert client.get(f"/requester/bookings/{booking_id}/media/{photo}/content").status_code == 401


def test_an_offered_technician_sees_nothing_until_accepting(client, job):
    technician, headers, booking_id = job(accept=False)
    photo = requester_upload(client, headers, booking_id)
    assert photo.status_code == 201, photo.text
    assert booking_id in offer_ids(client, technician)
    assert tech_execution(client, technician, booking_id).status_code == 404
    assert tech_content(client, technician, booking_id, photo.json()["id"]).status_code == 404

    # The offer itself carries nothing about photos.
    for offer in offers(client, technician):
        assert set(offer) == OFFER_KEYS
    raw = client.get("/technicians/me/offers", headers=bearer(technician["access_token"])).text
    assert photo.json()["id"] not in raw and "media" not in raw and "photo" not in raw.lower()

    assert act(client, technician, booking_id, "accept").status_code == 200
    seen = tech_content(client, technician, booking_id, photo.json()["id"])
    assert seen.status_code == 200 and seen.headers["content-type"] == "image/jpeg"


def test_a_technician_who_lost_the_race_or_was_cancelled_has_no_access(client, onboard, owner, catalog):
    winner = working(client, onboard, "PLUMBER", at=AT_HOME)
    loser = working(client, onboard, "PLUMBER", at=AT_HOME)
    headers = owner()
    booking_id = client.post(
        "/requester/bookings",
        headers=headers,
        json={
            "technician_type": "PLUMBER",
            "service_id": catalog(("Inspect",)),
            "description": "Kitchen",
            "service_latitude": HOME[0],
            "service_longitude": HOME[1],
        },
    ).json()["id"]
    photo = requester_upload(client, headers, booking_id).json()["id"]
    assert act(client, winner, booking_id, "accept").status_code == 200
    assert tech_execution(client, loser, booking_id).status_code == 404
    assert tech_content(client, loser, booking_id, photo).status_code == 404

    # Cancelled after acceptance: the former holder loses access too.
    assert client.post(f"/requester/bookings/{booking_id}/cancel", headers=headers).status_code == 200
    assert tech_execution(client, winner, booking_id).status_code == 404
    assert tech_content(client, winner, booking_id, photo).status_code == 404
    # The owner still sees their own booking.
    assert client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).status_code == 200


def test_a_photo_is_only_reachable_through_its_own_booking(client, job):
    technician, headers, booking_id = job()
    other_tech, other_headers, other_booking = job()
    foreign = requester_upload(client, other_headers, other_booking).json()["id"]
    assert client.get(f"/requester/bookings/{booking_id}/media/{foreign}/content", headers=headers).status_code == 404
    assert tech_content(client, technician, booking_id, foreign).status_code == 404


# ------------------------------------------------------------ customer photos


def test_customer_photos_follow_the_pre_arrival_window(client, job):
    technician, headers, booking_id = job(accept=False)
    first = requester_upload(client, headers, booking_id)
    assert first.status_code == 201 and first.json()["kind"] == "CUSTOMER" and first.json()["can_delete"] is True
    for _ in range(4):
        assert requester_upload(client, headers, booking_id).status_code == 201
    assert requester_upload(client, headers, booking_id).status_code == 409  # 6th > limit 5

    removed = client.delete(f"/requester/bookings/{booking_id}/media/{first.json()['id']}", headers=headers)
    assert removed.status_code == 204
    act(client, technician, booking_id, "accept")
    assert requester_upload(client, headers, booking_id).status_code == 201  # still allowed while ACCEPTED
    advance(client, technician, booking_id, "ARRIVED")

    assert requester_upload(client, headers, booking_id).status_code == 409
    remaining = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()["media"]
    assert len(remaining) == 5 and all(item["can_delete"] is False for item in remaining)
    assert (
        client.delete(f"/requester/bookings/{booking_id}/media/{remaining[0]['id']}", headers=headers).status_code
        == 409
    )
    # The technician may view but never remove a customer's photo.
    assert (
        client.delete(
            f"/technicians/me/jobs/{booking_id}/media/{remaining[0]['id']}", headers=bearer(technician["access_token"])
        ).status_code
        == 403
    )


def test_the_uploader_is_the_verified_owner_not_anything_sent(client, job, connection):
    technician, headers, booking_id = job(accept=False)
    forged = str(uuid.uuid4())
    response = client.post(
        f"/requester/bookings/{booking_id}/media",
        headers=headers,
        data={"kind": "BEFORE", "uploaded_by_requester_id": forged, "uploaded_by_technician_id": forged},
        files={"file": ("x.jpg", jpeg(), "image/jpeg")},
    )
    assert response.status_code == 201 and response.json()["kind"] == "CUSTOMER"
    row = connection.execute(
        text(
            "SELECT m.uploaded_by_requester_id = r.requested_by_user_id, m.uploaded_by_technician_id IS NULL "
            "FROM partner.booking_media m JOIN partner.bookings r ON r.id = m.booking_id WHERE m.id = :id"
        ),
        {"id": response.json()["id"]},
    ).one()
    assert tuple(row) == (True, True)


# --------------------------------------------------------- before / after photos


def test_before_and_after_windows_limits_and_completion(client, job, media_directory):
    technician, headers, booking_id = job(steps=("Inspect", "Repair"))
    assert technician_upload(client, technician, booking_id, "BEFORE").status_code == 409  # ACCEPTED
    advance(client, technician, booking_id, "EN_ROUTE")
    assert technician_upload(client, technician, booking_id, "BEFORE").status_code == 409
    assert arrive(client, technician, booking_id, HOME)["status"] == "ARRIVED"

    befores = [technician_upload(client, technician, booking_id, "BEFORE") for _ in range(6)]
    assert all(r.status_code == 201 for r in befores), [r.text for r in befores]
    assert technician_upload(client, technician, booking_id, "BEFORE").status_code == 409  # limit 6
    assert technician_upload(client, technician, booking_id, "AFTER").status_code == 409  # not yet in progress
    assert technician_upload(client, technician, booking_id, "BILL").status_code == 422

    act(client, technician, booking_id, "start")
    after = technician_upload(client, technician, booking_id, "AFTER")
    assert after.status_code == 201
    removed = client.delete(
        f"/technicians/me/jobs/{booking_id}/media/{befores[0].json()['id']}", headers=bearer(technician["access_token"])
    )
    assert removed.status_code == 204
    assert len(stored_files(media_directory)) == 6  # 5 BEFORE + 1 AFTER; the removed file is gone

    # Rule D: completion is NOT blocked by an unfinished checklist.
    assert act(client, technician, booking_id, "complete").status_code == 200
    assert technician_upload(client, technician, booking_id, "AFTER").status_code == 409
    assert (
        client.delete(
            f"/technicians/me/jobs/{booking_id}/media/{after.json()['id']}", headers=bearer(technician["access_token"])
        ).status_code
        == 409
    )
    # The requester can view the finished work; the requester cannot remove it.
    view = client.get(f"/requester/bookings/{booking_id}/execution", headers=headers).json()
    assert sorted(item["kind"] for item in view["media"]) == ["AFTER"] + ["BEFORE"] * 5
    assert (
        client.get(f"/requester/bookings/{booking_id}/media/{after.json()['id']}/content", headers=headers).status_code
        == 200
    )
    assert (
        client.delete(f"/requester/bookings/{booking_id}/media/{after.json()['id']}", headers=headers).status_code
        == 403
    )


# ---------------------------------------------------------------- image safety


def test_metadata_is_removed_and_orientation_applied(client, job):
    technician, headers, booking_id = job()
    advance(client, technician, booking_id, "ARRIVED")
    for content, mime, name in (
        (jpeg(size=(40, 20), orientation=6), "image/jpeg", "a.jpg"),
        (png_with_text(), "image/png", "b.png"),
        (webp_with_exif(), "image/webp", "c.webp"),
    ):
        uploaded = technician_upload(client, technician, booking_id, "BEFORE", content, name, mime)
        assert uploaded.status_code == 201, uploaded.text
        served = tech_content(client, technician, booking_id, uploaded.json()["id"])
        assert served.status_code == 200 and served.headers["content-type"] == mime
        assert served.headers["cache-control"] == "private, no-store"
        assert served.headers["x-content-type-options"] == "nosniff"
        image = Image.open(io.BytesIO(served.content))
        assert len(image.getexif()) == 0
        assert not image.getexif().get_ifd(0x8825)
        for secret in (b"SecretCameraMake", b"secret-home-location", b"Exif\x00\x00"):
            assert secret not in served.content
        if name == "a.jpg":
            assert image.size == (20, 40)  # the orientation tag became real rotation


def test_large_photos_are_scaled_down(client, job, monkeypatch):
    monkeypatch.setattr(settings, "job_media_max_dimension", 100)
    technician, headers, booking_id = job()
    advance(client, technician, booking_id, "ARRIVED")
    uploaded = technician_upload(client, technician, booking_id, "BEFORE", jpeg(size=(400, 200)))
    served = tech_content(client, technician, booking_id, uploaded.json()["id"])
    assert Image.open(io.BytesIO(served.content)).size == (100, 50)


BAD_FILES = [
    ("oversized", b"\xff\xd8\xff\xe0" + bytes(5 * 1024 * 1024), "big.jpg", "image/jpeg", 413),
    ("corrupt", b"\xff\xd8\xff\xe0\x00\x10JFIF" + bytes(300), "bad.jpg", "image/jpeg", 422),
    ("truncated", None, "cut.jpg", "image/jpeg", 422),
    ("pdf disguised as jpg", b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "doc.jpg", "image/jpeg", 422),
    ("svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg", "image/svg+xml", 422),
    ("gif", None, "x.gif", "image/gif", 422),
    ("heic", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + bytes(64), "x.heic", "image/heic", 422),
    ("empty", b"", "x.jpg", "image/jpeg", 422),
]


@pytest.mark.parametrize("label, content, name, mime, status", BAD_FILES, ids=[case[0] for case in BAD_FILES])
def test_unacceptable_files_are_refused_and_nothing_is_stored(
    client, job, media_directory, label, content, name, mime, status
):
    if label == "truncated":
        content = jpeg(size=(300, 300))[:600]
    if label == "gif":
        output = io.BytesIO()
        Image.new("RGB", (8, 8)).save(output, format="GIF")
        content = output.getvalue()
    technician, headers, booking_id = job()
    advance(client, technician, booking_id, "ARRIVED")
    response = technician_upload(client, technician, booking_id, "BEFORE", content, name, mime)
    assert response.status_code == status, (label, response.text)
    assert stored_files(media_directory) == []
    assert tech_execution(client, technician, booking_id).json()["media"] == []


def test_decompression_bombs_and_animations_are_refused(client, job, monkeypatch, media_directory):
    technician, headers, booking_id = job()
    advance(client, technician, booking_id, "ARRIVED")
    monkeypatch.setattr(settings, "job_media_max_pixels", 10_000)
    bomb = io.BytesIO()
    Image.new("L", (200, 200)).save(bomb, format="PNG")
    assert (
        technician_upload(client, technician, booking_id, "BEFORE", bomb.getvalue(), "b.png", "image/png").status_code
        == 422
    )
    monkeypatch.setattr(settings, "job_media_max_pixels", 40_000_000)
    animated = io.BytesIO()
    frames = [Image.new("RGB", (16, 16), color) for color in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(animated, format="WEBP", save_all=True, append_images=frames[1:])
    assert (
        technician_upload(
            client, technician, booking_id, "BEFORE", animated.getvalue(), "a.webp", "image/webp"
        ).status_code
        == 422
    )
    assert stored_files(media_directory) == []


# --------------------------------------------------------- storage, no exposure


def test_files_are_encrypted_private_and_never_named_in_responses(client, job, connection, media_directory):
    technician, headers, booking_id = job()
    uploaded = requester_upload(client, headers, booking_id)
    media_id = uploaded.json()["id"]
    storage_key = connection.execute(
        text("SELECT storage_key FROM partner.booking_media WHERE id = :id"), {"id": media_id}
    ).scalar()
    assert job_media_root() == media_directory and stored_files(media_directory) == [f"{storage_key}.bin"]

    on_disk = (media_directory / f"{storage_key}.bin").read_bytes()
    assert not on_disk.startswith(b"\xff\xd8") and b"JFIF" not in on_disk  # encrypted, not the image

    act(client, technician, booking_id, "accept")
    responses = [
        uploaded,
        client.get(f"/requester/bookings/{booking_id}/execution", headers=headers),
        tech_execution(client, technician, booking_id),
        client.get(f"/requester/bookings/{booking_id}", headers=headers),
        client.get("/technicians/me/jobs", headers=bearer(technician["access_token"]), params={"bucket": "accepted"}),
    ]
    for response in responses:
        assert response.status_code in (200, 201)
        for secret in (storage_key, "storage_key", ".bin", str(media_directory), "job_media"):
            assert secret not in response.text, secret
    # Nothing is published under the public upload mount.
    assert client.get(f"/uploads/{storage_key}.bin").status_code == 404
    assert client.get(f"/uploads/job_media/{storage_key}.bin").status_code == 404

    # Removing the photo removes the row and the encrypted file.
    assert client.delete(f"/requester/bookings/{booking_id}/media/{media_id}", headers=headers).status_code == 204
    assert stored_files(media_directory) == []
    assert (
        connection.execute(text("SELECT count(*) FROM partner.booking_media WHERE id = :id"), {"id": media_id}).scalar()
        == 0
    )


# ------------------------------------------------------------ workflow intact


def test_the_status_workflow_is_unchanged(client, job):
    technician, headers, booking_id = job(steps=("Inspect", "Repair"))
    advance(client, technician, booking_id, "COMPLETED")
    booking = client.get(f"/requester/bookings/{booking_id}", headers=headers).json()
    assert booking["status"] == "COMPLETED"
    assert all(booking[key] for key in ("accepted_at", "en_route_at", "arrived_at", "started_at", "completed_at"))
    # An unknown action is still refused as before.
    assert act(client, technician, booking_id, "media").status_code in (404, 405, 422)
