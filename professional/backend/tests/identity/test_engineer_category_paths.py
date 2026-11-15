"""Every path that sets an engineer's Engineer Category (specialization) keeps
engineer_profiles.category in step, by the old app's rule (exactly "Site Engineer" ->
SITE_ENGINEER, "Store Manager" -> STORE_MANAGER, anything else -> none); the three
readers -- the project Site Engineer assignment, Book Technician and the Partner
requester view -- agree; and migration 0005 fixed rows written otherwise."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import ClientFactory
from fastapi.testclient import TestClient
from projects.helpers import award, builder, create_project, owner, person
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.modules.accounts.models import EngineerProfile
from app.modules.accounts.partner_view import CREATE_VIEW_SQL, VIEW_NAME
from app.modules.identity.models import ROLE_ENGINEER, User
from app.modules.identity.policies import can_create_partner_handoff
from identity.helpers import WHATSAPP_SETTINGS, FakeEmailSender, FakeWhatsApp, create_user, service_overrides, sign_in

COMPLETE = "/api/v1/auth/complete-profile"
MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "20261115_0005_engineer_category_from_specialization.py"
)
STRONG = "Strong#Pass123"


def profile_of(database: Session, email: str | None = None, phone: str | None = None) -> EngineerProfile:
    database.expire_all()
    user = database.query(User).filter((User.email == email) if email else (User.phone == phone)).one()
    return user.engineer_profile


# ---- e-mail sign-up and WhatsApp (phone-first) sign-up ----


@pytest.mark.parametrize(("specialization", "category"), [("Site Engineer", "SITE_ENGINEER"), ("Civil Engineer", None)])
def test_email_sign_up_sets_the_category(
    make_client: ClientFactory, database: Session, specialization: str, category: str | None
) -> None:
    mailbox = FakeEmailSender()
    client = make_client(overrides=service_overrides(email=mailbox))
    client.post("/api/v1/auth/email/send-code", json={"email": "rama@example.in"})
    client.post("/api/v1/auth/email/verify-code", json={"email": "rama@example.in", "code": mailbox.last_code()})
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Rama",
            "email": "rama@example.in",
            "password": STRONG,
            "role": "ENGINEER",
            "specialization": specialization,
        },
    )
    assert signup.status_code == 200, signup.text
    profile = profile_of(database, email="rama@example.in")
    assert (profile.specialization, profile.category) == (specialization, category)


@pytest.mark.parametrize(("specialization", "category"), [("Site Engineer", "SITE_ENGINEER"), ("Civil Engineer", None)])
def test_whatsapp_sign_up_sets_the_category(
    make_client: ClientFactory, database: Session, specialization: str, category: str | None
) -> None:
    whatsapp = FakeWhatsApp()
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    client.post("/api/v1/auth/phone/send-code", json={"phone": "9876500031"})
    token = client.post(
        "/api/v1/auth/phone/verify-code", json={"phone": "9876500031", "code": whatsapp.last_code()}
    ).json()["verification_token"]
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Rama",
            "phone": "9876500031",
            "role": "ENGINEER",
            "specialization": specialization,
            "phone_verification_token": token,
        },
    )
    assert signup.status_code == 200, signup.text
    profile = profile_of(database, phone="9876500031")
    assert (profile.specialization, profile.category) == (specialization, category)


# ---- complete-profile (also the engineer's Profile Settings save) ----


def test_complete_profile_sets_and_clears_the_category(client: TestClient, database: Session) -> None:
    create_user(database, role=ROLE_ENGINEER, specialization="Civil Engineer", phone="9876543210")
    headers = {"X-CSRF-Token": sign_in(client)}
    base = {"phone": "9876543210", "address": "12 MG Road, Bengaluru", "pincode": "560001"}

    to_site = client.patch(COMPLETE, json={**base, "specialization": "Site Engineer"}, headers=headers)
    assert to_site.status_code == 200, to_site.text
    profile = profile_of(database, email="asha@example.in")
    assert (profile.specialization, profile.category) == ("Site Engineer", "SITE_ENGINEER")

    to_civil = client.patch(COMPLETE, json={**base, "specialization": "Civil Engineer"}, headers=headers)
    assert to_civil.status_code == 200, to_civil.text
    profile = profile_of(database, email="asha@example.in")
    assert (profile.specialization, profile.category) == ("Civil Engineer", None)


# ---- the three readers agree ----


def engineer_on_team(client: TestClient, database: Session, house_builder, specialization: str, email: str, phone: str):
    engineer = person(client, database, email, phone, ROLE_ENGINEER, specialization=specialization)
    invite = house_builder.post("/engineers/invite", json={"email": email}).json()["invite_code"]
    assert engineer.post("/engineers/join-team", json={"invite_code": invite}).json()["status"] == "joined"
    return engineer


def test_assignment_book_technician_and_the_partner_view_agree(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    award(house_owner, house_builder, project_id)
    civil = engineer_on_team(client, database, house_builder, "Civil Engineer", "civil@example.in", "9876500041")
    site = engineer_on_team(client, database, house_builder, "Site Engineer", "site@example.in", "9876500042")

    refused = house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(civil.user.id)})
    assert refused.status_code == 400
    assert "Only an Engineer whose category is Site Engineer" in refused.json()["detail"]
    assigned = house_builder.post(f"/projects/{project_id}/assign-engineer", json={"engineer_id": str(site.user.id)})
    assert assigned.json()["status"] == "assigned", assigned.text

    database.expire_all()
    assert can_create_partner_handoff(database.get(User, site.user.id)) is True
    assert can_create_partner_handoff(database.get(User, civil.user.id)) is False

    database.execute(text(f"DROP VIEW IF EXISTS {VIEW_NAME}"))
    database.execute(text(CREATE_VIEW_SQL))
    try:
        roles = dict(
            database.execute(
                text(f"SELECT id, requester_role FROM {VIEW_NAME} WHERE id IN (:site, :civil)"),  # noqa: S608
                {"site": site.user.id, "civil": civil.user.id},
            ).all()
        )
        assert roles == {site.user.id: "SITE_ENGINEER", civil.user.id: None}
    finally:
        database.execute(text(f"DROP VIEW IF EXISTS {VIEW_NAME}"))
        database.commit()


# ---- migration 0005 ----


def run_migration(database: Session) -> None:
    spec = importlib.util.spec_from_file_location("engineer_category_from_specialization", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(database.connection())):
        module.upgrade()
    database.commit()
    database.expire_all()


def test_the_migration_fills_the_category_from_the_specialization(database: Session) -> None:
    rows = {
        "site@example.in": ("Site Engineer", None),  # missing -> SITE_ENGINEER
        "padded@example.in": (" Site Engineer ", None),  # trimmed, as the old rule
        "store@example.in": ("store manager", None),  # any case -> STORE_MANAGER
        "civil@example.in": ("Civil Engineer", "SITE_ENGINEER"),  # wrong -> cleared
        "lower@example.in": ("site engineer", "SITE_ENGINEER"),  # not exact -> cleared
        "none@example.in": (None, None),
    }
    for index, (email, (specialization, category)) in enumerate(rows.items()):
        user = create_user(database, role=ROLE_ENGINEER, email=email, phone=f"98765001{index:02d}")
        # Written behind the model's back, as a row from before the column existed would be.
        database.execute(
            update(EngineerProfile)
            .where(EngineerProfile.user_id == user.id)
            .values(specialization=specialization, category=category)
        )
    database.commit()

    run_migration(database)

    expected = {
        "site@example.in": "SITE_ENGINEER",
        "padded@example.in": "SITE_ENGINEER",
        "store@example.in": "STORE_MANAGER",
        "civil@example.in": None,
        "lower@example.in": None,
        "none@example.in": None,
    }
    for email, category in expected.items():
        assert profile_of(database, email=email).category == category, email
