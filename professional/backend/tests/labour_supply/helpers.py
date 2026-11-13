"""A project with its builder, House Owner and assigned Site Engineer, and suppliers of a
given category assigned to that engineer (shared by the labour and equipment tests)."""

from typing import Any

from fastapi.testclient import TestClient
from projects.helpers import Person, award, builder, create_project, engineer, owner, person
from sqlalchemy.orm import Session

from app.modules.identity.models import ROLE_SUPPLIER
from app.modules.projects.models import ProjectRequest


class Site:
    def __init__(self, house_owner: Person, house_builder: Person, site_engineer: Person, project_id: str) -> None:
        self.owner, self.builder, self.engineer, self.project_id = house_owner, house_builder, site_engineer, project_id


def make_site(client: TestClient, database: Session) -> Site:
    house_owner, house_builder = owner(client, database), builder(client, database)
    site_engineer = engineer(client, database)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    return Site(house_owner, house_builder, site_engineer, project_id)


def category_supplier(
    client: TestClient, database: Session, category: str, email: str, phone: str, **profile: Any
) -> Person:
    """A supplier of this category (Labor Supplier, Equipment Supplier ...)."""
    who = person(client, database, email, phone, ROLE_SUPPLIER)
    who.user.supplier_profile.supplier_category = category
    for name, value in profile.items():
        setattr(who.user.supplier_profile, name, value)
    database.commit()
    return who


def assign(database: Session, site: Site, supplier: Person) -> None:
    """The builder and supplier connected (an accepted request), then the supplier
    assigned to the project's Site Engineer through the projects endpoint."""
    database.add(
        ProjectRequest(
            sender_id=site.builder.user.id,
            receiver_id=supplier.user.id,
            request_type="CONTRACTOR_TO_SUPPLIER",
            status="accepted",
        )
    )
    database.commit()
    pair = {"supplier_id": str(supplier.user.id), "engineer_id": str(site.engineer.user.id)}
    assigned = site.builder.post(f"/projects/{site.project_id}/assign-supplier", json=pair)
    assert assigned.json()["status"] == "assigned", assigned.text


def unassign(site: Site, supplier: Person) -> None:
    pair = {"supplier_id": str(supplier.user.id), "engineer_id": str(site.engineer.user.id)}
    assert (
        site.builder.post(f"/projects/{site.project_id}/unassign-supplier", json=pair).json()["status"] == "unassigned"
    )


def put(who: Person, path: str, body: Any) -> Any:
    return who.browser.put(f"/api/v1{path}", headers=who.headers, json=body)
