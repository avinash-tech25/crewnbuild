"""The marketplace: a supplier's own listings (catalog snapshot, price, stock, discount,
bulk tiers, delete), the buyer's cart, checkout into a purchase order, the supplier's
decision and fulfilment into project stock, discovery and the public profiles, who may
reach each (the old 403/404 answers), and what the marketplace unblocks elsewhere."""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import ClientFactory, app_routes
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from projects.helpers import Person, award, builder, create_project, engineer, owner, person
from projects.test_projects import THURSDAY_MORNING, detail
from site_operations.test_site_operations import DAY, Site, workflow
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.catalog import supplier_links
from app.modules.catalog.models import (
    CatalogBrand,
    CatalogCategory,
    CatalogProduct,
    CatalogProductMedia,
    CatalogProductVariant,
    CatalogSubcategory,
    CatalogUnit,
)
from app.modules.identity.models import ROLE_SUPPLIER
from app.modules.marketplace import account_links, order_service, site_links
from app.modules.marketplace import router as marketplace_router
from app.modules.marketplace.models import PurchaseOrder, SupplierProduct
from app.modules.projects import daily_window
from app.modules.projects.models import ProjectRequest
from app.modules.site_operations import service as site_service
from app.modules.site_operations.models import CostMaterialInventory

# 10:30 in India on the test day, stored as UTC.
FULFILLED_AT = datetime(2026, 11, 12, 5, 0)
IMAGE = "https://cdn.example.in/catalog/opc.png"


@pytest.fixture
def client(make_client: ClientFactory, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    monkeypatch.setattr(site_service, "local_workflow_now", lambda: THURSDAY_MORNING)
    monkeypatch.setattr(order_service, "naive_utc_now", lambda: FULFILLED_AT)
    return build(make_client, FakeEmailSender(), FakeStorage(), aws_site_images_bucket_in="site-images")


@pytest.fixture
def site(client: TestClient, database: Session) -> Site:
    """An awarded project with its Site Engineer assigned (as in the site tests)."""
    house_owner, house_builder = owner(client, database), builder(client, database)
    site_engineer = engineer(client, database)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    return Site(house_owner, house_builder, site_engineer, project_id)


class Catalog:
    def __init__(self, product: CatalogProduct, variant: CatalogProductVariant, plain: CatalogProduct) -> None:
        self.product_id, self.variant_id, self.plain_id = str(product.id), str(variant.id), str(plain.id)


@pytest.fixture
def catalog(database: Session) -> Catalog:
    return make_catalog(database)


def make_catalog(database: Session) -> Catalog:
    unit = CatalogUnit(code="BAG", name="Bag")
    category = CatalogCategory(
        country_code="IN", slug="cement", name="Cement", image_url="https://cdn.example.in/c.png"
    )
    brand = CatalogBrand(slug="dalmia", name="Dalmia", logo_url="https://cdn.example.in/dalmia.png")
    database.add_all([unit, category, brand])
    database.flush()
    subcategory = CatalogSubcategory(category_id=category.id, slug="opc", name="OPC")
    database.add(subcategory)
    database.flush()
    product = CatalogProduct(
        country_code="IN",
        subcategory_id=subcategory.id,
        brand_id=brand.id,
        slug="opc-53",
        name="OPC 53 Grade Cement",
        description="Strong cement for slabs.",
        unit_id=unit.id,
        specifications={"Grade": "53"},
    )
    plain = CatalogProduct(
        country_code="IN", subcategory_id=subcategory.id, slug="river-sand", name="River Sand", unit_id=unit.id
    )
    database.add_all([product, plain])
    database.flush()
    variant = CatalogProductVariant(product_id=product.id, slug="50-kg", name="50 kg", unit_id=unit.id)
    database.add_all([variant, CatalogProductMedia(product_id=product.id, image_url=IMAGE, is_primary=True)])
    database.commit()
    return Catalog(product, variant, plain)


def supplier(
    client: TestClient, database: Session, email: str = "supplier@example.in", phone: str = "9876500004"
) -> Person:
    return person(client, database, email, phone, ROLE_SUPPLIER)


def list_product(seller: Person, catalog: Catalog, **changes: Any) -> Any:
    body = {"master_product_id": catalog.product_id, "master_variant_id": catalog.variant_id, "price": 400,
            "quantity": 100, "discount_percentage": 10, **changes}  # fmt: skip
    return seller.post("/supplier-products/from-catalog", json=body)


def put(who: Person, path: str, body: Any) -> Any:
    return who.browser.put(f"/api/v1{path}", headers=who.headers, json=body)


def accept_between(database: Session, sender: Person, receiver: Person, request_type: str, project_id: Any) -> None:
    database.add(
        ProjectRequest(
            project_id=uuid.UUID(project_id) if project_id else None,
            sender_id=sender.user.id,
            receiver_id=receiver.user.id,
            request_type=request_type,
            status="accepted",
        )
    )
    database.commit()


def test_every_marketplace_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in app_routes(client.app)
        if isinstance(route, APIRoute) and route.endpoint.__module__ == marketplace_router.__name__
    ]
    assert len(routes) == 28
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"


def test_a_supplier_manages_only_its_own_listings(client: TestClient, database: Session, catalog: Catalog) -> None:
    seller = supplier(client, database)
    no_variant = list_product(seller, catalog, master_variant_id=None)
    assert (no_variant.status_code, detail(no_variant)) == (400, "Choose a variant for this product.")
    assert detail(list_product(seller, catalog, master_variant_id=str(uuid.uuid4()))) == (
        "That variant does not belong to this product."
    )
    unknown = list_product(seller, catalog, master_product_id=str(uuid.uuid4()))
    assert (unknown.status_code, detail(unknown)) == (404, "That product is not in the catalog.")
    assert list_product(seller, catalog, name="Mine").status_code == 422

    listed = list_product(seller, catalog)
    assert listed.status_code == 200, listed.text
    listing = listed.json()
    assert (listing["name"], listing["brand"], listing["size"], listing["unit"]) == (
        "OPC 53 Grade Cement", "Dalmia", "50 kg", "BAG",
    )  # fmt: skip
    assert (listing["category"], listing["grade"], listing["image_url"]) == ("Cement", "53", IMAGE)
    assert listing["discounted_price"] == 360.0 and listing["description"] == "Strong cement for slabs."
    assert listing["brand_logo_url"].endswith("dalmia.png") and listing["subcategory_name"] == "OPC"
    duplicate = list_product(seller, catalog)
    assert (duplicate.status_code, detail(duplicate)) == (
        409,
        "That product is already in your catalog. Edit its price instead.",
    )
    plain = {"master_product_id": catalog.plain_id, "price": 50, "quantity": 10}
    plain_id = seller.post("/supplier-products/from-catalog", json=plain).json()["id"]
    assert seller.post("/supplier-products/from-catalog", json=plain).status_code == 409  # crash fixed
    assert len(seller.get("/supplier-products").json()) == 2

    base = f"/supplier-products/{listing['id']}"
    assert seller.patch(f"{base}/price", json={"price": 450}).json()["price"] == 450
    locked = seller.patch(base, json={"name": "Cement"})
    assert detail(locked).startswith("This product's details come from the master catalog")
    assert (
        seller.patch(base, json={"quantity": 5, "low_stock_threshold": 10}).json()["stock_alert_state"] == "LOW_STOCK"
    )
    assert detail(seller.patch(base, json={"quantity": -1})) == "Quantity cannot be negative"
    seller.patch(base, json={"quantity": 100})
    tiers = [{"min_quantity": 10, "max_quantity": 49, "unit_price": 350}, {"min_quantity": 50, "unit_price": 330}]
    assert len(put(seller, f"{base}/bulk-pricing", {"tiers": tiers}).json()["tiers"]) == 2
    assert seller.get(f"{base}/bulk-pricing").json()["normal_price"] == 450
    overlap = put(seller, f"{base}/bulk-pricing", {"tiers": [*tiers, {"min_quantity": 40, "unit_price": 340}]})
    assert detail(overlap).startswith("Tiers overlap")
    nan = put(seller, f"{base}/bulk-pricing", {"tiers": [{"min_quantity": "NaN", "unit_price": 1}]})
    assert detail(nan) == "Tier 1: enter numbers for quantity and price."  # crash fixed

    # Another supplier never reaches this listing: the old 404.
    rival = supplier(client, database, "rival@example.in", "9876500005")
    for answer in (
        rival.patch(f"{base}/price", json={"price": 1}),
        rival.patch(base, json={"quantity": 1}),
        rival.get(f"{base}/bulk-pricing"),
        put(rival, f"{base}/bulk-pricing", {"tiers": []}),
        rival.delete(base),
    ):
        assert (answer.status_code, detail(answer)) == (404, "Product not found")
    house_owner = owner(client, database)
    assert detail(house_owner.get("/supplier-products")) == "SUPPLIER role required"
    rival.user.supplier_profile.supplier_category = "Labor Supplier"
    database.commit()
    refused = list_product(rival, catalog)
    assert (refused.status_code, detail(refused)) == (403, "Only a Material Supplier can manage material products.")

    picture = uuid.uuid4()
    own = {"name": "Bricks", "category": "Masonry", "unit": "nos", "price": 8, "quantity": 1000,
           "image_url": f"/files/{picture}"}  # fmt: skip
    assert seller.post("/supplier-products", json=own).json()["name"] == "Bricks"
    # Wired back into file access: a picture on the supplier's own listing.
    assert account_links.is_supplier_listing_image(database, seller.user.id, picture)
    assert not account_links.is_supplier_listing_image(database, rival.user.id, picture)
    assert detail(seller.post("/supplier-products", json={**own, "name": " "})) == (
        "Name, material category, and unit are required"
    )

    # Wired back into the catalog: offers, the listing count, a supplier's media.
    offers = house_owner.get(f"/catalog/products/{catalog.product_id}/offers").json()["offers"]
    assert [(offer["supplier_name"], offer["discounted_price"]) for offer in offers] == [("Rao Stores", 405.0)]
    assert supplier_links.listing_count(database, uuid.UUID(catalog.product_id)) == 1
    assert len(seller.get(f"/catalog/products/{catalog.product_id}").json()["images"]) == 1

    assert seller.delete(f"/supplier-products/{plain_id}").json() == {"deleted": True, "removed_requests": 0}


def test_an_owner_buys_and_the_supplier_decides(client: TestClient, database: Session, catalog: Catalog) -> None:
    seller = supplier(client, database)
    listing_id = list_product(seller, catalog).json()["id"]
    put(seller, f"/supplier-products/{listing_id}/bulk-pricing", {"tiers": [{"min_quantity": 10, "unit_price": 300}]})
    house_owner = owner(client, database)
    project_id = create_project(house_owner, construction_type="SELF_CONSTRUCTION")["id"]

    shop = house_owner.get("/shop/products").json()
    assert shop == {"products": [], "categories": [], "restricted": True}  # no accepted supplier yet
    line = {"project_id": project_id, "product_id": listing_id, "quantity": 5}
    added = house_owner.post("/cart/items", json=line)
    assert added.status_code == 200, added.text
    assert added.json()["total"] == 1800  # 5 x 360, the discounted price
    cart = house_owner.post("/cart/items", json=line).json()
    assert cart["total"] == 3000 and cart["items"][0]["bulk_tier"]["unit_price"] == 300  # 10 x the tier
    item_id = cart["items"][0]["id"]
    too_many = house_owner.patch(f"/cart/items/{item_id}", json={"quantity": 200})
    assert (too_many.status_code, detail(too_many)) == (409, "Only 100 BAG of OPC 53 Grade Cement are available.")
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    assert detail(stranger.patch(f"/cart/items/{item_id}", json={"quantity": 1})) == "Cart item not found"
    assert detail(stranger.delete(f"/cart/items/{item_id}")) == "Cart item not found"
    assert detail(stranger.post("/cart/items", json=line)) == "You can only order materials for your own project."
    assert house_owner.get("/cart", params={"project_id": project_id}).json()["item_count"] == 1
    assert detail(seller.get("/cart")) == "Only a House Owner or Site Engineer can use a cart."

    checkout = house_owner.post("/cart/checkout", json={"project_id": project_id, "supplier_id": str(seller.user.id)})
    assert checkout.status_code == 200, checkout.text
    code, ordered = checkout.json()["request_code"], checkout.json()["items"][0]
    assert (ordered["price"], ordered["quantity"], ordered["status"]) == (300, 10, "PENDING")
    assert checkout.json()["cart"]["item_count"] == 0
    again = house_owner.post("/cart/checkout", json={"project_id": project_id, "supplier_id": str(seller.user.id)})
    assert detail(again) == "There is nothing from that supplier in your cart."
    assert house_owner.get("/material-requests/mine").json()[0]["engineer_role"] == "OWNER"
    # Wired back into weather: an open order is a delivery destination.
    assert site_links.open_order_project_ids(database, seller.user.id) == {uuid.UUID(project_id)}
    assert site_links.open_order_supplier_ids(database, uuid.UUID(project_id)) == {seller.user.id}
    assert seller.get("/supplier/material-requests").json()[0]["project_name"] == "Rao Residence"

    # Another supplier never reaches this order: the old 404s.
    rival = supplier(client, database, "rival@example.in", "9876500005")
    accept = {"action": "ACCEPT"}
    refused = rival.post(f"/supplier/purchase-requests/{code}/respond", json=accept)
    assert (refused.status_code, detail(refused)) == (404, "Purchase request not found")
    refused = rival.post(f"/supplier/material-requests/{ordered['id']}/respond", json=accept)
    assert (refused.status_code, detail(refused)) == (404, "Material request not found")
    assert detail(seller.post(f"/supplier/purchase-requests/{code}/respond", json={"action": "MAYBE"})) == (
        "Action must be ACCEPT or REJECT"
    )
    decided = seller.post(f"/supplier/purchase-requests/{code}/respond", json=accept)
    assert [row["status"] for row in decided.json()] == ["ACCEPTED"]
    twice = seller.post(f"/supplier/purchase-requests/{code}/respond", json=accept)
    assert (twice.status_code, detail(twice)) == (409, "This order was already accepted")

    fulfilled = seller.post(f"/supplier/material-requests/{ordered['id']}/respond", json={"action": "FULFILL"})
    assert fulfilled.json()["status"] == "FULFILLED", fulfilled.text
    database.expire_all()
    assert database.get(SupplierProduct, uuid.UUID(listing_id)).quantity == 90  # type: ignore[union-attr]
    stock = database.scalars(select(CostMaterialInventory)).one()
    assert (stock.current_stock, str(stock.product_id)) == (10, listing_id)
    assert database.scalars(select(PurchaseOrder.status)).one() == "FULFILLED"
    assert site_links.open_order_project_ids(database, seller.user.id) == set()
    start = datetime(2026, 11, 11, 18, 30)
    assert len(site_links.fulfilled_orders(database, uuid.UUID(project_id), start, datetime(2026, 11, 12, 18, 30))) == 1

    # Order history keeps the listing and the supplier's account.
    kept = seller.delete(f"/supplier-products/{listing_id}")
    assert kept.status_code == 409 and "has order history" in detail(kept)
    assert deletion_blockers.supplier_transaction_history_count(database, seller.user.id) == 1

    # A deleted project takes its purchase orders with it, as the old purge did.
    assert house_owner.delete(f"/projects/{project_id}").json()["deleted"] is True
    assert database.scalar(select(func.count(PurchaseOrder.id))) == 0


def test_one_line_decisions_and_buyer_refusals(client: TestClient, database: Session, catalog: Catalog) -> None:
    seller = supplier(client, database)
    listing_id = list_product(seller, catalog).json()["id"]
    house_owner = owner(client, database)
    project_id = create_project(house_owner, construction_type="SELF_CONSTRUCTION")["id"]
    order = {"project_id": project_id, "supplier_id": str(seller.user.id),
             "items": [{"product_id": listing_id, "quantity": 2}]}  # fmt: skip
    created = house_owner.post("/material-requests", json=order)
    assert created.status_code == 200, created.text
    line_id = created.json()["items"][0]["id"]
    respond = f"/supplier/material-requests/{line_id}/respond"
    assert seller.post(respond, json={"action": "ACCEPT"}).json()["status"] == "ACCEPTED"
    assert detail(seller.post(respond, json={"action": "REJECT"})) == "This order was already accepted"
    second = house_owner.post("/material-requests", json=order).json()["items"][0]["id"]
    rejected = seller.post(f"/supplier/material-requests/{second}/respond", json={"action": "REJECT"})
    assert rejected.json()["status"] == "REJECTED"
    assert detail(seller.post(respond, json={"action": "LATER"})) == "Action must be ACCEPT, FULFILL or REJECT"
    too_many = house_owner.post(
        "/material-requests", json={**order, "items": [{"product_id": listing_id, "quantity": 500}]}
    )
    assert detail(too_many) == "Insufficient stock. Only 100 BAG are currently available."
    other = owner(client, database, "other@example.in", "9876500009")
    assert detail(other.post("/material-requests", json=order)) == "You can only order materials for your own project."
    assert other.get("/material-requests/mine").json() == []

    # An owner on a contractor project buys only from a supplier who accepted them.
    contract_project = create_project(house_owner, title="Second")["id"]
    refused = house_owner.post("/material-requests", json={**order, "project_id": contract_project})
    assert detail(refused) == "You can order from this supplier once they have accepted your request."
    accept_between(database, house_owner, seller, "OWNER_TO_SUPPLIER", contract_project)
    assert house_owner.post("/material-requests", json={**order, "project_id": contract_project}).status_code == 200
    products = house_owner.get("/shop/products").json()
    assert [item["store_name"] for item in products["products"]] == ["Rao Stores"] and products["restricted"]
    cleared = house_owner.delete("/cart", params={"project_id": contract_project})
    assert cleared.json()["item_count"] == 0


def test_the_site_engineer_and_the_wired_back_site_records(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    seller = supplier(client, database)
    listing_id = list_product(seller, catalog).json()["id"]
    order = {"project_id": site.project_id, "supplier_id": str(seller.user.id),
             "items": [{"product_id": listing_id, "quantity": 2}]}  # fmt: skip
    refused = site.engineer.post("/material-requests", json=order)
    assert (refused.status_code, detail(refused)) == (403, order_service.SITE_ENGINEER_USES_STORE)
    assert site.engineer.get("/shop/products").json()["restricted"] is True
    accept_between(database, site.builder, seller, "CONTRACTOR_TO_SUPPLIER", None)
    shop = site.engineer.get("/shop/products").json()
    assert [item["id"] for item in shop["products"]] == [listing_id]
    line = {"project_id": site.project_id, "product_id": listing_id, "quantity": 1}
    assert site.engineer.post("/cart/items", json=line).json()["item_count"] == 1
    assert site.engineer.get("/material-requests/mine").json() == []

    # Wired back into projects: an assigned supplier's published products.
    pair = {"supplier_id": str(seller.user.id), "engineer_id": str(site.engineer.user.id)}
    assigned = site.builder.post(f"/projects/{site.project_id}/assign-supplier", json=pair)
    assert assigned.json()["status"] == "assigned", assigned.text
    suppliers = site.engineer.get(f"/projects/{site.project_id}/suppliers").json()
    assert [item["id"] for item in suppliers[0]["products"]] == [listing_id] and suppliers[0]["categories"] == [
        "Cement"
    ]
    team = site.engineer.get(f"/projects/{site.project_id}/team-suppliers").json()
    assert team[0]["products"][0]["discounted_price"] == 360.0

    # Material usage naming a known listing is accepted again, at the listing's price,
    # and the stock shows its supplier and what exactly it is.
    usage = json.dumps([{"material_name": "Cement", "quantity_used": 0, "product_id": listing_id, "unit": "BAG"}])
    saved = workflow(site, material_usage=usage)
    assert saved.status_code == 200, saved.text
    summary = site.builder.get(f"/cost-tool/projects/{site.project_id}/summary", params={"work_date": DAY}).json()
    cement = next(item for item in summary["materials"] if item["material"] == "Cement")
    assert (cement["supplier_name"], cement["specification"], cement["rate"]) == ("Rao Stores", "Dalmia · 50 kg", 400.0)
    assert summary["received_orders"] == []


def test_discovery_and_profiles(client: TestClient, database: Session, catalog: Catalog) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    site_engineer, seller = engineer(client, database), supplier(client, database)
    list_product(seller, catalog)
    project_id = create_project(house_owner)["id"]

    nearby = house_owner.get("/contractors/nearby").json()
    assert [item["user_id"] for item in nearby] == [str(house_builder.user.id)]
    builder_profile = house_owner.get(f"/contractors/{house_builder.user.id}/profile").json()
    assert builder_profile["company_name"] == "Rao Builders" and builder_profile["email"] == ""
    missing = house_owner.get(f"/contractors/{uuid.uuid4()}/profile")
    assert (missing.status_code, detail(missing)) == (404, "Builder profile not found")
    assert house_owner.get("/contractors/nearby", params={"country": "Kuwait"}).status_code == 422

    suppliers = house_owner.get("/suppliers/nearby", params={"project_id": project_id}).json()
    assert [(item["store_name"], item["request_status"]) for item in suppliers] == [("Rao Stores", "none")]
    assert suppliers[0]["products"][0]["category_name"] == "Cement"
    profile = house_owner.get(f"/suppliers/{seller.user.id}/profile").json()
    assert profile["profile_products"][0]["catalog"]["name"] == "OPC 53 Grade Cement"
    assert detail(house_owner.get(f"/suppliers/{uuid.uuid4()}/profile")) == "Supplier profile not found"

    clients = house_builder.get("/contractors/find-clients").json()
    assert {item["client_type"] for item in clients} == {"PROJECT", "SUPPLIER"}
    assert detail(house_owner.get("/contractors/find-clients")) == "CONTRACTOR role required"
    builders = seller.get("/suppliers/find-clients").json()
    assert [item["company_name"] for item in builders] == ["Rao Builders"]
    assert detail(house_owner.get("/suppliers/find-clients")) == "SUPPLIER role required"

    engineers = house_builder.get("/engineers/find").json()
    assert [item["user_id"] for item in engineers] == [str(site_engineer.user.id)]
    assert house_owner.get("/engineers/find").json()[0]["working_on_project"] is False
    assert detail(seller.get("/engineers/find")) == "CONTRACTOR role required"
    assert house_owner.get(f"/engineers/{site_engineer.user.id}/profile").json()["created_at"]
    assert detail(house_owner.get(f"/engineers/{uuid.uuid4()}/profile")) == "Site engineer profile not found"

    # An account its holder deleted is never listed or shown.
    house_builder.user.deleted_at = datetime.now(UTC)
    database.commit()
    assert house_owner.get("/contractors/nearby").json() == []
    assert house_owner.get(f"/contractors/{house_builder.user.id}/profile").status_code == 404
