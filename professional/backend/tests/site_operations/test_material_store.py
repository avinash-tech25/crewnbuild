"""The Site Engineer's Store: one card per product and variant per project, stock in on
delivery (fulfilment, not acceptance), usage recorded there or in the daily record lowering
the same balance once, every movement traceable, and who may read or write it."""

import json
import uuid
from typing import Any

from fastapi.testclient import TestClient
from marketplace import test_marketplace as market
from marketplace.test_marketplace import Catalog, accept_between, assign_supplier, list_product, put, supplier
from projects.helpers import Person, engineer, owner
from projects.test_projects import detail
from sqlalchemy.orm import Session

from site_operations.test_site_operations import DAY, Site, workflow

# The marketplace tests' fixtures: a client, an awarded project with its Site Engineer, a catalog.
client, site, catalog = market.client, market.site, market.catalog


class Shop:
    def __init__(self, site: Site, seller: Person, listing_id: str) -> None:
        self.site, self.seller, self.listing_id = site, seller, listing_id

    @property
    def store(self) -> str:
        return f"/projects/{self.site.project_id}/material-store"

    def order(self, quantity: float, *, fulfil: bool = True) -> None:
        """The Site Engineer buys `quantity`; the supplier accepts and (by default) delivers."""
        engineer_ = self.site.engineer
        line = {"project_id": self.site.project_id, "product_id": self.listing_id, "quantity": quantity}
        assert engineer_.post("/cart/items", json=line).status_code == 200
        request = {"project_id": self.site.project_id, "supplier_id": str(self.seller.user.id),
                   "request_key": str(uuid.uuid4())}  # fmt: skip
        placed = engineer_.post("/cart/checkout", json=request)
        assert placed.status_code == 200, placed.text
        code = placed.json()["request_code"]
        assert (
            self.seller.post(f"/supplier/purchase-requests/{code}/respond", json={"action": "ACCEPT"}).status_code
            == 200
        )
        if fulfil:
            lines = [
                row for row in self.seller.get("/supplier/material-requests").json() if row["status"] == "ACCEPTED"
            ]
            for row in lines:
                done = self.seller.post(f"/supplier/material-requests/{row['id']}/respond", json={"action": "FULFILL"})
                assert done.status_code == 200, done.text

    def cards(self, who: Person | None = None) -> list[dict[str, Any]]:
        answer = (who or self.site.engineer).get(self.store)
        assert answer.status_code == 200, answer.text
        return answer.json()["items"]

    def card(self) -> dict[str, Any]:
        (only,) = self.cards()
        return only

    def use(self, quantity: Any, *, unit: str | None = None, who: Person | None = None, **extra: Any) -> Any:
        stock = self.card()
        body = {"quantity": quantity, "unit": unit or stock["unit"], **extra}
        return (who or self.site.engineer).post(f"{self.store}/{stock['id']}/usage", json=body)


def open_shop(client: TestClient, database: Session, catalog: Catalog, site: Site) -> Shop:
    seller = supplier(client, database)
    listing_id = list_product(seller, catalog).json()["id"]
    accept_between(database, site.builder, seller, "CONTRACTOR_TO_SUPPLIER", None)
    assign_supplier(site, seller)
    return Shop(site, seller, listing_id)


def totals(card: dict[str, Any]) -> tuple[float, float, float]:
    return card["in_stock"], card["received_total"], card["used_total"]


def test_receive_use_and_receive_again_on_one_card(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    shop = open_shop(client, database, catalog, site)
    shop.order(10, fulfil=False)
    assert shop.cards() == []  # accepted is not delivered: nothing in stock yet

    shop.order(10, fulfil=False)  # a second accepted request, still not delivered
    lines = [row for row in shop.seller.get("/supplier/material-requests").json() if row["status"] == "ACCEPTED"]
    assert len(lines) == 2
    first, second = lines
    assert (
        shop.seller.post(f"/supplier/material-requests/{first['id']}/respond", json={"action": "FULFILL"}).status_code
        == 200
    )
    card = shop.card()
    assert totals(card) == (10, 10, 0)
    assert (card["name"], card["brand"], card["size"]) == ("OPC 53 Grade Cement", "Dalmia", "50 kg")
    assert card["material"] == "OPC 53 Grade Cement · 50 kg" and card["listing_id"] == shop.listing_id
    assert card["stock_status"] == "IN_STOCK" and card["low_stock"] is False

    used = shop.use(8, note="Footing pour")
    assert used.status_code == 200, used.text
    assert totals(used.json()["item"]) == (2, 10, 8)

    # Buying the same product again adds to the same card: 2 + 10 = 12.
    assert (
        shop.seller.post(f"/supplier/material-requests/{second['id']}/respond", json={"action": "FULFILL"}).status_code
        == 200
    )
    assert totals(shop.card()) == (12, 20, 8)

    # Every movement is stored and the history adds up to the balance.
    history = site.engineer.get(f"{shop.store}/{shop.card()['id']}/movements").json()
    kinds = sorted((item["kind"], item["quantity"]) for item in history["movements"])
    assert kinds == [("RECEIVED", 10), ("RECEIVED", 10), ("USED", 8)]
    usage = next(item for item in history["movements"] if item["kind"] == "USED")
    assert usage["source"]["kind"] == "STORE_USAGE" and usage["note"] == "Footing pour"
    assert usage["by"] == site.engineer.user.name
    receipts = [item for item in history["movements"] if item["kind"] == "RECEIVED"]
    assert {item["source"]["kind"] for item in receipts} == {"ORDER"} and all(item["by"] for item in receipts)


def test_usage_is_refused_beyond_the_stock_at_zero_below_zero_and_in_another_unit(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    shop = open_shop(client, database, catalog, site)
    shop.order(10)
    too_much = shop.use(10.5)
    assert too_much.status_code == 409 and "Only 10" in detail(too_much)
    assert shop.use(0).status_code == 400
    assert shop.use(-2).status_code == 400
    wrong_unit = shop.use(1, unit="kg")
    assert wrong_unit.status_code == 400 and "record the usage in" in detail(wrong_unit)
    assert shop.use(1, used_on="2999-01-01").status_code == 400
    assert totals(shop.card()) == (10, 10, 0)  # nothing was taken
    assert shop.use(10).status_code == 200  # exactly what is there is allowed
    assert shop.card()["stock_status"] == "OUT_OF_STOCK"
    assert shop.use(1).status_code == 409


def test_only_the_assigned_site_engineer_records_usage_builder_and_owner_read(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    shop = open_shop(client, database, catalog, site)
    shop.order(10)
    other_engineer = engineer(client, database, "other.engineer@example.in", "9876500118")
    other_owner = owner(client, database, "other.owner@example.in", "9876500119")
    for refused in (other_engineer, site.builder, site.owner, shop.seller):
        assert shop.use(1, who=refused).status_code == 403
    for stranger in (other_engineer, other_owner, shop.seller):
        assert stranger.get(shop.store).status_code == 403
        assert stranger.get(f"{shop.store}/{shop.card()['id']}/movements").status_code == 403
    builder_view = site.builder.get(shop.store).json()
    owner_view = site.owner.get(shop.store).json()
    assert builder_view["items"] == owner_view["items"] == shop.cards()
    assert (builder_view["can_record_usage"], owner_view["can_record_usage"]) == (False, False)
    assert site.engineer.get(shop.store).json()["can_record_usage"] is True
    assert totals(shop.card()) == (10, 10, 0)
    # A stock id from another project is not found there.
    assert (
        site.engineer.post(f"{shop.store}/{uuid.uuid4()}/usage", json={"quantity": 1, "unit": "Bag"}).status_code == 404
    )


def test_the_daily_record_and_the_store_share_one_balance(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    shop = open_shop(client, database, catalog, site)
    shop.order(10)
    card = shop.card()
    assert shop.use(3).status_code == 200
    assert shop.card()["in_stock"] == 7

    # The day's record uses 4 of the same material: the same stock falls to 3.
    usage = [
        {"material_name": card["material"], "quantity_used": 4, "unit": card["unit"], "product_id": shop.listing_id}
    ]
    saved = workflow(site, material_usage=json.dumps(usage))
    assert saved.status_code == 200, saved.text
    assert totals(shop.card()) == (3, 10, 7)
    # Correcting the day's figure to 2 moves the balance by the difference only (no double count).
    usage[0]["quantity_used"] = 2
    assert workflow(site, material_usage=json.dumps(usage)).status_code == 200
    assert totals(shop.card()) == (5, 10, 5)
    # The Store sees the day's usage when it checks what is left.
    refused = shop.use(6)
    assert refused.status_code == 409 and "Only 5" in detail(refused)
    # The day's record sees the Store's usage too.
    usage[0]["quantity_used"] = 8
    assert workflow(site, material_usage=json.dumps(usage)).status_code == 409

    # The builder's cost summary counts both kinds of usage once.
    summary = site.builder.get(f"/cost-tool/projects/{site.project_id}/summary", params={"work_date": DAY}).json()
    material = next(item for item in summary["materials"] if item["material"] == card["material"])
    assert (material["received"], material["total_used"], material["remaining"]) == (10, 5, 5)

    history = site.engineer.get(f"{shop.store}/{card['id']}/movements").json()["movements"]
    sources = sorted((item["kind"], item["source"]["kind"], item["quantity"]) for item in history)
    assert sources == [("RECEIVED", "ORDER", 10), ("USED", "DAILY_RECORD", 2), ("USED", "STORE_USAGE", 3)]


def test_the_engineer_and_the_builder_set_the_low_stock_level(
    client: TestClient, database: Session, catalog: Catalog, site: Site
) -> None:
    shop = open_shop(client, database, catalog, site)
    shop.order(10)
    card = shop.card()
    level = f"{shop.store}/{card['id']}/threshold"
    assert (
        card["low_stock"] is False
        and shop.cards(site.builder)
        and site.builder.get(shop.store).json()["can_set_threshold"]
    )

    set_by_engineer = put(site.engineer, level, {"minimum_stock": 3, "unit": card["unit"]})
    assert set_by_engineer.status_code == 200, set_by_engineer.text
    assert set_by_engineer.json()["item"]["minimum_stock"] == 3 and set_by_engineer.json()["item"]["low_stock"] is False
    assert shop.use(7).status_code == 200  # 3 left: at the level
    assert (shop.card()["low_stock"], shop.card()["stock_status"]) == (True, "LOW_STOCK")

    # The builder may set it too; the history and the balance do not change.
    assert put(site.builder, level, {"minimum_stock": 2, "unit": card["unit"]}).status_code == 200
    assert (shop.card()["low_stock"], totals(shop.card())) == (False, (3, 10, 7))
    movements = site.engineer.get(f"{shop.store}/{card['id']}/movements").json()["movements"]
    assert sorted(item["kind"] for item in movements) == ["RECEIVED", "USED"]

    assert put(site.engineer, level, {"minimum_stock": -1, "unit": card["unit"]}).status_code == 400
    assert put(site.engineer, level, {"minimum_stock": 1, "unit": "kg"}).status_code == 400
    other_engineer = engineer(client, database, "other.engineer@example.in", "9876500118")
    for refused in (site.owner, shop.seller, other_engineer):
        assert put(refused, level, {"minimum_stock": 9, "unit": card["unit"]}).status_code == 403
    assert site.owner.get(shop.store).json()["can_set_threshold"] is False
    assert shop.card()["minimum_stock"] == 2
