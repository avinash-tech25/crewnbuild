"""The other party's public business details on /project-requests/incoming: what a
supplier offers and who it is, for the builder; who the builder is, for the supplier.
Contact (phone, e-mail, street address) stays withheld until the request is accepted,
and a name that is really a phone number is never shown."""

from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient
from marketplace.test_marketplace import list_product, make_catalog
from sqlalchemy.orm import Session

from app.modules.equipment_supply.models import EquipmentItem
from app.modules.identity.models import ROLE_ENGINEER, ROLE_SUPPLIER, User
from app.modules.labour_supply.models import LaborService
from app.modules.projects.people import engineer_summary_payload
from projects.helpers import Person, builder, person

PUBLIC_FIELDS = {"profile_location", "profile_verified", "profile_member_since"}


def a_supplier(client: TestClient, database: Session, category: str, email: str, phone: str) -> Person:
    supplier = person(client, database, email, phone, ROLE_SUPPLIER)
    supplier.user.location = "Bengaluru"
    supplier.user.supplier_profile.supplier_category = category
    database.commit()
    return supplier


def request_from(supplier: Person, receiver: Person) -> str:
    body = {"receiver_id": str(receiver.user.id), "project_id": None, "request_type": "SUPPLIER_TO_CONTRACTOR"}
    response = supplier.post("/project-requests/send", json=body)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def row_for(who: Person, request_id: str) -> dict[str, Any]:
    return next(row for row in who.get("/project-requests/incoming").json() if row["id"] == request_id)


def test_a_material_supplier_shows_its_listings_and_catalog_categories_and_no_contact(
    client: TestClient, database: Session
) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Material Supplier", "material@example.in", "9876500011")
    catalog = make_catalog(database)
    assert list_product(supplier, catalog).status_code == 200
    request_id = request_from(supplier, house_builder)

    row = row_for(house_builder, request_id)
    assert row.keys() >= PUBLIC_FIELDS
    assert row["profile_supplier_category"] == "Material Supplier"
    assert row["profile_offer"] == {"active_listings": 1, "categories": ["Cement"]}
    assert row["profile_title"] == "Rao Stores"
    assert row["profile_location"] == "Bengaluru"
    assert row["profile_verified"] is False
    assert row["profile_member_since"]
    # Before acceptance: no contact, and no new field carries one.
    assert (row["profile_phone"], row["profile_email"], row["can_view_contact"]) == ("", "", False)
    assert supplier.user.phone not in str(row) and supplier.user.email not in str(row)

    assert house_builder.post("/project-requests/accept", json={"request_id": request_id}).status_code == 200
    row = row_for(house_builder, request_id)
    assert (row["profile_phone"], row["can_view_contact"]) == (supplier.user.phone, True)


def test_a_labour_supplier_shows_its_active_trades(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Labor Supplier", "labour@example.in", "9876500012")
    database.add_all(
        [
            LaborService(supplier_id=supplier.user.id, trade="Mason", worker_capacity=5),
            LaborService(supplier_id=supplier.user.id, trade="Carpenter", worker_capacity=2),
            LaborService(supplier_id=supplier.user.id, trade="Painter", worker_capacity=1, is_active=False),
        ]
    )
    database.commit()
    row = row_for(house_builder, request_from(supplier, house_builder))
    assert row["profile_supplier_category"] == "Labor Supplier"
    assert row["profile_offer"] == {"trades": ["Carpenter", "Mason"]}
    assert row["profile_phone"] == ""


def test_an_equipment_supplier_shows_its_equipment_types(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Equipment Supplier", "equipment@example.in", "9876500013")
    item = {"condition": "NEW", "mode": "RENT", "quantity_total": 1, "daily_rate": Decimal("1500")}
    database.add_all(
        [
            EquipmentItem(supplier_id=supplier.user.id, name="JCB 3DX", category="Excavator", **item),
            EquipmentItem(supplier_id=supplier.user.id, name="Mixer", category="Concrete Mixer", **item),
        ]
    )
    database.commit()
    row = row_for(house_builder, request_from(supplier, house_builder))
    assert row["profile_offer"] == {"equipment_types": ["Concrete Mixer", "Excavator"]}
    assert row["profile_email"] == ""


def test_the_supplier_sees_the_builder_public_details_and_no_contact(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Material Supplier", "material@example.in", "9876500011")
    request_id = request_from(supplier, house_builder)
    row = row_for(supplier, request_id)
    assert row.keys() >= PUBLIC_FIELDS
    assert "profile_offer" not in row and "profile_supplier_category" not in row
    assert row["profile_verified"] is False and row["profile_member_since"]
    assert (row["profile_phone"], row["profile_email"]) == ("", "")
    assert house_builder.user.phone not in str(row)


# ---- street address: contact, so withheld until the request is accepted ----


def test_the_street_address_waits_for_acceptance(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Material Supplier", "material@example.in", "9876500011")
    supplier.user.address = "7 Supplier Lane, Bengaluru"
    house_builder.user.address = "9 Builder Street, Bengaluru"
    database.commit()
    request_id = request_from(supplier, house_builder)

    builder_row, supplier_row = row_for(house_builder, request_id), row_for(supplier, request_id)
    assert (builder_row["sender_address"], builder_row["profile_address"]) == ("", "")
    assert "7 Supplier Lane" not in str(builder_row)
    assert (supplier_row["sender_address"], supplier_row["profile_address"]) == ("", "")
    assert "9 Builder Street" not in str(supplier_row)
    # Area-level details stay for discovery.
    assert (builder_row["profile_pincode"], builder_row["profile_location"]) == ("560001", "Bengaluru")

    assert house_builder.post("/project-requests/accept", json={"request_id": request_id}).status_code == 200
    builder_row, supplier_row = row_for(house_builder, request_id), row_for(supplier, request_id)
    assert builder_row["sender_address"] == builder_row["profile_address"] == "7 Supplier Lane, Bengaluru"
    assert supplier_row["sender_address"] == supplier_row["profile_address"] == "9 Builder Street, Bengaluru"


# ---- a name that is really a phone number is never shown ----


def test_a_phone_number_saved_as_a_name_is_not_shown(client: TestClient, database: Session) -> None:
    house_builder = builder(client, database)
    supplier = a_supplier(client, database, "Material Supplier", "material@example.in", "9876500011")
    request_id = request_from(supplier, house_builder)
    # Saved before saves refused one, and with nothing for migration 0004 to recover.
    supplier.user.name = "+91 96406 77606"
    supplier.user.supplier_profile.store_name = "96406 77606"
    database.commit()

    row = row_for(house_builder, request_id)
    assert (row["sender_name"], row["profile_name"], row["profile_title"]) == ("", "", "")
    assert "77606" not in str(row)


def test_an_engineer_summary_withholds_the_street_address_and_a_phone_number_name() -> None:
    engineer = User(name="9640677606", role=ROLE_ENGINEER, address="3 Site Road, Bengaluru", pincode="560001")
    hidden = engineer_summary_payload(engineer, None, can_view_contact=False)
    assert (hidden["name"], hidden["address"], hidden["pincode"]) == ("", "", "560001")
    assert engineer_summary_payload(engineer, None, can_view_contact=True)["address"] == "3 Site Road, Bengaluru"
