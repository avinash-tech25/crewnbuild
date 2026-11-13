"""Property: a seller's listings (draft, gallery, status moves, delete), the buyer's
browse and detail in their own locality, enquiries answered through /project-requests
as before; who may reach each (the old 403/404 answers), and what property unblocks
elsewhere (contact on an accepted enquiry, listing media in file access)."""

import uuid
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from projects.helpers import Person, builder, create_project, owner, person
from projects.test_projects import detail
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.identity.models import ROLE_SUPPLIER
from app.modules.property import links
from app.modules.property import router as property_router
from app.modules.property.models import PropertyEnquiry

HOUSE = {"title": "3 BHK villa", "description": "Corner plot, east facing.", "property_type": "INDEPENDENT_HOUSE",
         "listing_type": "SALE", "address": "4 Lake Road, Bengaluru", "pincode": "560001", "price": 9500000,
         "bedrooms": 3, "city": "Bengaluru"}  # fmt: skip


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


def put(who: Person, path: str, body: Any) -> Any:
    return who.browser.put(f"/api/v1{path}", headers=who.headers, json=body)


def listed(seller: Person, **changes: Any) -> dict[str, Any]:
    created = seller.post("/property-listings", json={**HOUSE, **changes})
    assert created.status_code == 200, created.text
    listing = created.json()
    published = seller.patch(f"/property-listings/{listing['id']}/status", json={"status": "listed"})
    assert published.json()["status"] == "LISTED", published.text
    return published.json()


def test_every_property_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == property_router.__name__
    ]
    assert len(routes) == 10
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_a_seller_manages_only_its_own_listings(client: TestClient, database: Session) -> None:
    seller = owner(client, database)
    created = seller.post("/property-listings", json={**HOUSE, "image_urls": ["/files/a", " ", "/files/b"]})
    assert created.status_code == 200, created.text
    listing = created.json()
    assert (listing["status"], listing["seller_phone"], listing["can_view_contact"]) == ("DRAFT", "9876500001", True)
    assert [(image["image_url"], image["sort_order"]) for image in listing["images"]] == [
        ("/files/a", 0),
        ("/files/b", 2),
    ]
    assert builder(client, database).post("/property-listings", json=HOUSE).status_code == 200
    stores = person(client, database, "supplier@example.in", "9876500004", ROLE_SUPPLIER)
    refused = stores.post("/property-listings", json=HOUSE)
    assert (refused.status_code, detail(refused)) == (403, "This account cannot list a property")
    assert seller.post("/property-listings", json={**HOUSE, "country": "Kuwait"}).status_code == 422
    assert seller.post("/property-listings", json={**HOUSE, "price": "NaN"}).status_code == 422  # crash fixed
    assert seller.post("/property-listings", json={**HOUSE, "title": "x" * 181}).status_code == 422  # crash fixed
    assert detail(seller.post("/property-listings", json={**HOUSE, "title": " "})) == "Property title is required"
    assert detail(seller.post("/property-listings", json={**HOUSE, "price": -1})) == "Price cannot be negative"
    others = create_project(owner(client, database, "other@example.in", "9876500009"))["id"]
    foreign = seller.post("/property-listings", json={**HOUSE, "source_project_id": others})
    assert (foreign.status_code, detail(foreign)) == (404, "Project not found")

    base = f"/property-listings/{listing['id']}"
    assert seller.patch(base, json={"price": 9000000}).json()["price"] == 9000000.0
    assert [
        image["image_url"] for image in put(seller, f"{base}/images", {"image_urls": ["/files/c"]}).json()["images"]
    ] == ["/files/c"]
    sold = seller.patch(f"{base}/status", json={"status": "SOLD"})
    assert (sold.status_code, detail(sold)) == (409, "A DRAFT listing cannot become SOLD. Allowed: LISTED, WITHDRAWN")
    assert detail(seller.patch(f"{base}/status", json={"status": "GONE"})) == "Unknown property listing status"
    assert seller.patch(f"{base}/status", json={"status": "listed"}).json()["listed_at"]
    assert [row["status"] for row in seller.get("/property-listings/mine", params={"status": "LISTED"}).json()] == [
        "LISTED"
    ]

    # Anyone else gets the old 404, whatever they try.
    stranger = owner(client, database, "stranger@example.in", "9876500008")
    for answer in (
        stranger.patch(base, json={"price": 1}),
        put(stranger, f"{base}/images", {"image_urls": []}),
        stranger.patch(f"{base}/status", json={"status": "WITHDRAWN"}),
        stranger.get(f"{base}/requests"),
        stranger.delete(base),
    ):
        assert (answer.status_code, detail(answer)) == (404, "Property listing not found")
    assert detail(stores.get("/property-listings/mine")) == "This account cannot list a property"
    assert seller.delete(base).json() == {"deleted": True}


def test_buyers_browse_enquire_and_the_seller_answers(client: TestClient, database: Session) -> None:
    seller = owner(client, database)
    listing = listed(seller, cover_image_url=f"/files/{uuid.uuid4()}")
    draft = seller.post("/property-listings", json={**HOUSE, "title": "Draft plot"}).json()
    buyer = owner(client, database, "buyer@example.in", "9876500009")
    found = buyer.get("/property-listings", params={"search": "villa east", "city": "bengaluru"}).json()
    assert [row["id"] for row in found["listings"]] == [listing["id"]]
    assert found["cities"] == ["Bengaluru"] and "seller_phone" not in found["listings"][0]
    assert seller.get("/property-listings").json()["listings"] == []  # never one's own
    assert buyer.get("/property-listings", params={"bedrooms": 4}).json()["listings"] == []
    assert detail(buyer.get(f"/property-listings/{draft['id']}")) == "Property listing not found"
    shown = buyer.get(f"/property-listings/{listing['id']}").json()
    assert shown["can_view_contact"] is False and "seller_phone" not in shown
    far = owner(client, database, "far@example.in", "9876500010")
    far.user.pincode = "110001"
    database.commit()
    assert far.get(f"/property-listings/{listing['id']}").status_code == 404
    assert far.get("/property-listings").json()["listings"] == []

    # Wired back into file access: the cover opens for whoever may see the listing.
    cover = uuid.UUID(listing["cover_image_url"].rsplit("/", 1)[1])
    assert links.listing_shows_file_to(database, seller.user.id, cover, buyer.user)
    assert not links.listing_shows_file_to(database, seller.user.id, cover, far.user)

    enquiry = buyer.post(f"/property-listings/{listing['id']}/request", json={"offer_amount": 9000000})
    assert enquiry.status_code == 200, enquiry.text
    enquiry_id = enquiry.json()["id"]
    assert enquiry.json()["status"] == "pending" and enquiry.json()["receiver_id"] == str(seller.user.id)
    again = buyer.post(f"/property-listings/{listing['id']}/request")
    assert (again.status_code, detail(again)) == (409, "Request already sent")
    own = seller.post(f"/property-listings/{listing['id']}/request")
    assert detail(own) == "You cannot send a request on your own property"
    assert detail(far.post(f"/property-listings/{listing['id']}/request")) == "Property listing not found"
    on_listing = seller.get(f"/property-listings/{listing['id']}/requests").json()
    assert [(row["buyer_name"], row["offer_amount"]) for row in on_listing] == [("buyer", 9000000.0)]

    # Wired back into /project-requests: the enquiry is in the list and answered there.
    incoming = seller.get("/project-requests/incoming").json()
    row = next(item for item in incoming if item["id"] == enquiry_id)
    assert (row["request_type"], row["property_title"], row["property_price"]) == (
        "PROPERTY_BUYER_TO_SELLER", "3 BHK villa", 9500000.0,
    )  # fmt: skip
    assert buyer.post("/project-requests/accept", json={"request_id": enquiry_id}).status_code == 404
    accepted = seller.post("/project-requests/accept", json={"request_id": enquiry_id})
    assert accepted.json() == {"status": "accepted"}, accepted.text
    twice = seller.post("/project-requests/accept", json={"request_id": enquiry_id})
    assert (twice.status_code, detail(twice)) == (409, "This request has already been accepted.")
    # Wired back into the contact rule: the accepted enquiry opens the seller's contact.
    assert buyer.get(f"/property-listings/{listing['id']}").json()["seller_phone"] == "9876500001"

    second = owner(client, database, "second@example.in", "9876500011")
    other = second.post(f"/property-listings/{listing['id']}/request").json()["id"]
    assert seller.post("/project-requests/reject", json={"request_id": other}).json() == {"status": "rejected"}
    assert (
        second.post(f"/property-listings/{listing['id']}/request").status_code == 200
    )  # a rejected one blocks nothing

    assert seller.delete(f"/property-listings/{listing['id']}").json() == {"deleted": True}
    assert database.scalar(select(func.count(PropertyEnquiry.id))) == 0
