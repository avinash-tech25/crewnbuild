"""The stubs the projects module wired back: the owner's first project, builder reviews,
the deletion blockers, project reports, file access (cover, site media, team files),
the admin project screens and project weather."""

from typing import Any

import pytest
from admin.helpers import create_admin, signed_in
from conftest import ClientFactory
from fastapi.testclient import TestClient
from files.test_files import PNG, FakeStorage
from identity.helpers import FakeEmailSender
from sqlalchemy import select
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.accounts import deletion_blockers
from app.modules.accounts.models import OwnerProfile
from app.modules.accounts.profile_payloads import builder_reviews
from app.modules.projects import daily_window
from app.modules.projects.models import Project, Review
from app.modules.projects.owner_first_project import create_owner_profile_project_if_missing
from app.modules.weather.models import WeatherSiteLocation
from app.modules.weather.repository import WeatherRepository
from projects.helpers import award, builder, create_project, engineer, owner
from projects.test_projects import THURSDAY_MORNING


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage(), aws_site_images_bucket_in="site-images")


def test_the_owner_first_project_and_builder_reviews(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    profile = database.scalars(select(OwnerProfile).where(OwnerProfile.user_id == house_owner.user.id)).one()
    profile.project_title, profile.project_description = "First home", "From the profile"
    database.commit()
    made = create_owner_profile_project_if_missing(database, house_owner.user)
    database.commit()
    assert made is not None and made.title == "First home" and made.pincode == "560001"
    assert create_owner_profile_project_if_missing(database, house_owner.user) is None  # one only

    house_builder = builder(client, database)
    database.add(Review(project_id=made.id, reviewer_id=house_owner.user.id, reviewee_id=house_builder.user.id,
                        rating=5, comment="Good work"))  # fmt: skip
    database.commit()
    count, reviews = builder_reviews(database, house_builder.user)
    assert count == 1 and reviews[0]["reviewer_name"] == "owner"


def test_the_deletion_blockers_see_projects(client: TestClient, database: Session) -> None:
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    project_id = create_project(house_owner)["id"]
    assert deletion_blockers.deletion_history.shared_project_titles(database, house_owner.user.id) == []
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    database.expire_all()
    assert deletion_blockers.deletion_history.shared_project_titles(database, house_owner.user.id) == ["Rao Residence"]
    assert deletion_blockers.builder_history_project_titles(database, house_builder.user.id) == ["Rao Residence"]
    assert deletion_blockers.engineer_history_project_titles(database, site_engineer.user.id) == ["Rao Residence"]
    blocker = deletion_blockers.account_deletion_blockers(database, house_builder.user)
    assert blocker is not None and blocker["code"] == "BUILDER_PROJECT_HISTORY"


def test_a_project_can_be_reported(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    project_id = create_project(house_owner)["id"]
    report = {
        "subject_type": "project",
        "subject_id": project_id,
        "category": "OTHER",
        "description": "Unsafe scaffolding.",
    }
    created = house_owner.post("/reports", json=report)
    assert created.status_code == 201, created.text
    assert created.json()["subject_name"] == "Rao Residence" and created.json()["scope"] == "IN"


def upload(who: Any, project_id: str | None = None, *, cover: bool = False) -> str:
    if cover:
        form = {key: str(value) for key, value in {
            "title": "Covered", "description": "With a cover", "address": "12 MG Road", "pincode": "560001",
            "building_type": "RESIDENTIAL", "construction_type": "CONTRACTOR", "budget": 100,
            "start_date": "2026-12-01", "end_date": "2027-01-01"}.items()}  # fmt: skip
        made = who.post("/projects/create-with-image", data=form, files={"image": ("c.png", PNG, "image/png")})
        assert made.status_code == 200, made.text
        return str(made.json()["cover_image_url"])
    form = {"title": "Slab", "description": "Done", "date": "2026-11-12", "completion_status": "active"}
    saved = who.post(
        f"/timelines/create?project_id={project_id}", data=form, files={"images": ("s.png", PNG, "image/png")}
    )
    assert saved.status_code == 200, saved.text
    return str(saved.json()["images"][0]["image_url"])


def test_file_access_follows_the_project(
    client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(daily_window, "local_workflow_now", lambda: THURSDAY_MORNING)
    house_owner, house_builder, site_engineer = (
        owner(client, database),
        builder(client, database),
        engineer(client, database),
    )
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    cover = upload(house_owner, cover=True)
    assert stranger.get(cover).status_code == 200  # a cover is shown with the project

    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    code = house_builder.post("/engineers/invite", json={"email": "engineer@example.in"}).json()["invite_code"]
    site_engineer.post("/engineers/join-team", json={"invite_code": code})
    house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site_engineer.user.id)})
    photo = upload(site_engineer, project_id)
    for member in (house_owner, house_builder, site_engineer):
        assert member.get(photo).status_code == 200
    assert stranger.get(photo).status_code != 200
    photos = house_owner.get(f"/projects/{project_id}/photos").json()
    assert [row["media_type"] for row in photos] == ["image"] and photos[0]["work_date"] == "2026-11-12"


def test_admin_project_screens_and_project_weather(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    create_admin(database)
    admin, _ = signed_in(client, "india.admin@example.in")
    listed = admin.get("/api/v1/admin/projects").json()
    assert [row["id"] for row in listed["projects"]] == [project_id]
    one = admin.get(f"/api/v1/admin/projects/{project_id}").json()
    assert one["contractor"]["name"] == "builder" and one["owner"]["name"] == "owner"
    leads = admin.get("/api/v1/admin/leads").json()
    assert leads["summary"]["accepted"] == 1 and leads["requests"][0]["direction"] == "Owner → Builder"
    user_detail = admin.get(f"/api/v1/admin/users/{house_builder.user.id}").json()
    assert [row["title"] for row in user_detail["projects_building"]] == ["Rao Residence"]
    assert admin.get("/api/v1/admin/overview").json()["countries"][0]["projects"] == 1

    repository = WeatherRepository(database)
    assert [project.id for project in repository.accessible_projects(house_builder.user)] == [
        database.get(Project, house_owner.get(f"/projects/{project_id}").json()["id"]).id
    ]
    recipients = {user.name for user in repository.project_recipients(database.get(Project, project_id))}
    assert recipients == {"owner", "builder"}
    assert house_owner.get("/weather/projects").json()["projects"][0]["title"] == "Rao Residence"


def test_deleting_a_project_removes_its_weather_site(client: TestClient, database: Session) -> None:
    house_owner = owner(client, database)
    project_id = create_project(house_owner)["id"]
    database.add(WeatherSiteLocation(project_id=project_id, latitude=12.9, longitude=77.6, source="MANUAL"))
    database.commit()
    assert house_owner.delete(f"/projects/{project_id}").status_code == 200
    database.expire_all()
    assert database.scalars(select(WeatherSiteLocation)).all() == []
