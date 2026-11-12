"""Accounts with complete profiles, projects, and a quick quotation-to-contract run."""

from typing import Any

from admin.helpers import signed_in
from fastapi.testclient import TestClient
from identity.helpers import create_user
from sqlalchemy.orm import Session

from app.modules.accounts.models import SupplierProfile
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_SUPPLIER, User

PROJECT = {
    "title": "Rao Residence",
    "description": "Two floors, three bedrooms.",
    "address": "12 MG Road, Bengaluru",
    "pincode": "560001",
    "building_type": "RESIDENTIAL",
    "construction_type": "CONTRACTOR",
    "budget": 1000000,
    "start_date": "2026-12-01",
    "end_date": "2027-06-30",
}


class Person:
    def __init__(self, user: User, browser: TestClient, headers: dict[str, str]) -> None:
        self.user, self.browser, self.headers = user, browser, headers

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.browser.get(f"/api/v1{path}", **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.browser.post(f"/api/v1{path}", headers=self.headers, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        return self.browser.patch(f"/api/v1{path}", headers=self.headers, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.browser.delete(f"/api/v1{path}", headers=self.headers, **kwargs)


def person(
    client: TestClient, database: Session, email: str, phone: str, role: str = "OWNER", **options: Any
) -> Person:
    user = create_user(
        database, role=role, email=email, phone=phone, name=options.pop("name", email.split("@")[0]), **options
    )
    if role == ROLE_BUILDER:
        builder = user.contractor_profile
        builder.license_number, builder.experience_years, builder.about = "LIC-1", 5, "Homes"
        builder.service_locations, builder.services_offered = "Bengaluru 560001", "Construction"
    if role == ROLE_SUPPLIER:
        supplier = SupplierProfile(user_id=user.id, store_name="Rao Stores", categories="Cement", about="Cement")
        supplier.supplier_category, supplier.delivery_locations = "Material Supplier", "560001"
        database.add(supplier)
    database.commit()
    browser, headers = signed_in(client, email)
    return Person(user, browser, headers)


def owner(client: TestClient, database: Session, email: str = "owner@example.in", phone: str = "9876500001") -> Person:
    return person(client, database, email, phone)


def builder(
    client: TestClient, database: Session, email: str = "builder@example.in", phone: str = "9876500002"
) -> Person:
    return person(client, database, email, phone, ROLE_BUILDER)


def engineer(
    client: TestClient, database: Session, email: str = "engineer@example.in", phone: str = "9876500003"
) -> Person:
    return person(client, database, email, phone, ROLE_ENGINEER, specialization="Site Engineer")


def create_project(who: Person, **changes: Any) -> dict[str, Any]:
    created = who.post("/projects/create", json={**PROJECT, **changes})
    assert created.status_code == 200, created.text
    return created.json()


def award(house_owner: Person, house_builder: Person, project_id: str, amount: int = 900000) -> dict[str, Any]:
    """Owner asks, builder quotes, owner sends for confirmation, builder confirms, owner assigns."""
    sent = house_owner.post(
        "/project-requests/send",
        json={
            "receiver_id": str(house_builder.user.id),
            "project_id": project_id,
            "request_type": "OWNER_TO_CONTRACTOR",
        },
    )
    assert sent.status_code == 200, sent.text
    request_id = sent.json()["id"]
    accepted = house_builder.post(
        "/project-requests/accept", json={"request_id": request_id, "quotation_amount": amount}
    )
    assert accepted.json() == {"status": "accepted"}, accepted.text
    asked = house_owner.post("/project-requests/assign", json={"request_id": request_id})
    assert asked.json()["status"] == "awaiting_builder_confirmation", asked.text
    confirmed = house_builder.post(f"/awards/{asked.json()['award_id']}/confirm", json={"amount": amount})
    assert confirmed.json()["status"] == "confirmed", confirmed.text
    assigned = house_owner.post("/project-requests/assign", json={"request_id": request_id})
    assert assigned.json()["status"] == "assigned", assigned.text
    return {"request_id": request_id, "award_id": asked.json()["award_id"], **assigned.json()}
