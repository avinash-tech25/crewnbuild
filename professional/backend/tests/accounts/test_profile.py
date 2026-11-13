"""The account's own profile: complete-profile per role, categories, phone change,
photo, logo, location and the pincode lookup. Outside services are faked."""

import json
import uuid
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from identity.helpers import WHATSAPP_SETTINGS, FakeWhatsApp, create_user, service_overrides, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.accounts import router as accounts_router_module
from app.modules.accounts import service as accounts_service_module
from app.modules.accounts.models import BuilderProfile, EngineerProfile, OwnerProfile, SupplierProfile
from app.modules.admin.models import AdminAuditLog
from app.modules.files.models import File
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_MANAGER, ROLE_SUPPLIER, User, UserSession

COMPLETE = "/api/v1/auth/complete-profile"
BASE = {"phone": "9876543210", "address": "12 MG Road, Bengaluru", "pincode": "560001"}
BRANCHES = [
    {"name": "MG Road", "district": "Bengaluru", "state": "Karnataka", "country": "India",
     "display": "MG Road, Bengaluru, Karnataka"},
    {"name": "Shivajinagar", "district": "Bengaluru", "state": "Karnataka", "country": "India",
     "display": "Shivajinagar, Bengaluru, Karnataka"},
]  # fmt: skip


def signed_in(client: TestClient, database: Session, **user: Any) -> tuple[User, dict[str, str]]:
    account = create_user(database, **user)
    csrf = sign_in(client, identifier=user.get("email", "asha@example.in"))
    return account, {"X-CSRF-Token": csrf}


def add_file(database: Session, owner: User) -> str:
    stored = File(storage_key=f"k/{uuid.uuid4()}", filename="a.png", content_type="image/png", size_bytes=1,
                  owner_user_id=owner.id)  # fmt: skip
    database.add(stored)
    database.commit()
    return f"/files/{stored.id}"


def test_no_accounts_endpoint_takes_an_account_id() -> None:
    for route in accounts_router_module.router.routes:
        assert isinstance(route, APIRoute)
        assert "{" not in route.path or route.path == "/locations/pincode/{pincode}", route.path


def test_owner_completes_the_profile(client: TestClient, database: Session) -> None:
    user, headers = signed_in(client, database, phone="9876543210")
    response = client.patch(
        COMPLETE,
        json={**BASE, "name": "Asha R", "budget": 2500000, "floors": 2, "floor_type": "G+1", "project_title": "Home"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Asha R" and body["created_at"]
    assert body["owner_profile"]["budget"] == 2500000.0
    assert body["owner_profile"]["floor_type"] == "G+1"
    owner = database.scalars(select(OwnerProfile).where(OwnerProfile.user_id == user.id)).one()
    assert owner.project_title == "Home"


def test_required_fields_and_a_taken_number(client: TestClient, database: Session) -> None:
    create_user(database, email="other@example.in", phone="9876543211")
    _, headers = signed_in(client, database)
    missing = client.patch(COMPLETE, json={"phone": "", "address": "", "pincode": "12"}, headers=headers)
    assert missing.status_code == 422
    assert set(missing.json()["detail"]["fields"]) == {"phone", "address", "pincode"}
    taken = client.patch(COMPLETE, json={**BASE, "phone": "9876543211"}, headers=headers)
    assert taken.status_code == 422
    assert taken.json()["detail"]["fields"] == {"phone": "This phone number is already in use."}


def test_a_non_india_account_keeps_its_country_and_rules(client: TestClient, database: Session) -> None:
    user, headers = signed_in(client, database)
    response = client.patch(
        COMPLETE,
        json={"phone": "501234567", "address": "Dubai Marina", "pincode": "12345", "country_of_residence": "UAE"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["country_of_residence"] == "UAE"
    database.expire_all()
    assert database.get(User, user.id).country_code == "UAE"  # type: ignore[union-attr]


def test_builder_location_cap_and_portfolio_photos(client: TestClient, database: Session) -> None:
    builder, headers = signed_in(client, database, role=ROLE_BUILDER)
    stranger = create_user(database, email="stranger@example.in", phone="9876500009")
    own_photo, foreign_photo = add_file(database, builder), add_file(database, stranger)
    fields = {
        **BASE,
        "company_name": "Rao Builders",
        "license_number": "LIC-1",
        "experience_years": 5,
        "about": "We build homes.",
        "services_offered": "Construction",
    }
    too_many = client.patch(
        COMPLETE, json={**fields, "service_locations": "Bengaluru - 560001, Mysuru - 570001"}, headers=headers
    )
    assert too_many.status_code == 422
    assert too_many.json()["detail"]["code"] == "LOCATION_LIMIT_REACHED"
    assert too_many.json()["detail"]["limit"] == 1

    portfolio = [{"title": "Villa", "images": [own_photo, foreign_photo, "https://elsewhere.example/x.png"]}]
    saved = client.patch(
        COMPLETE,
        json={**fields, "service_locations": "Bengaluru - 560001", "completed_project_details": json.dumps(portfolio)},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    stored = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    database.refresh(stored)
    assert json.loads(stored.completed_project_details or "[]")[0]["images"] == [own_photo]
    assert stored.completed_projects == 1


def test_supplier_category_is_chosen_once(client: TestClient, database: Session) -> None:
    _, headers = signed_in(client, database, role=ROLE_SUPPLIER)
    url = "/api/v1/auth/supplier-category"
    assert client.patch(url, json={"supplier_category": "Steel"}, headers=headers).status_code == 422
    saved = client.patch(url, json={"supplier_category": "Labor Supplier"}, headers=headers)
    assert saved.status_code == 200
    assert saved.json()["supplier_category"] == "Labor Supplier"
    assert client.patch(url, json={"supplier_category": "Labor Supplier"}, headers=headers).status_code == 200
    assert client.patch(url, json={"supplier_category": "Material Supplier"}, headers=headers).status_code == 409


def test_supplier_complete_profile_accepts_the_british_spelling(client: TestClient, database: Session) -> None:
    supplier, headers = signed_in(client, database, role=ROLE_SUPPLIER)
    database.add(SupplierProfile(user_id=supplier.id, store_name="Shop"))
    database.commit()
    response = client.patch(
        COMPLETE,
        json={**BASE, "store_name": "Shop", "about": "Labour", "service_locations": "Bengaluru",
              "categories": "Masons", "supplier_category": "labour supplier"},
        headers=headers,
    )  # fmt: skip
    assert response.status_code == 200, response.text
    database.expire_all()
    profile = database.scalars(select(SupplierProfile).where(SupplierProfile.user_id == supplier.id)).one()
    assert profile.supplier_category == "Labor Supplier"


def test_an_engineer_cannot_cross_the_store_manager_line(client: TestClient, database: Session) -> None:
    engineer, headers = signed_in(client, database, role=ROLE_ENGINEER, specialization="Civil Engineer")
    crossed = client.patch(
        COMPLETE,
        json={**BASE, "specialization": "Store Manager", "location": "MG Road", "qualification": "B.E."},
        headers=headers,
    )
    assert crossed.status_code == 409
    moved = client.patch(COMPLETE, json={**BASE, "specialization": "Site Engineer"}, headers=headers)
    assert moved.status_code == 200
    database.expire_all()
    profile = database.scalars(select(EngineerProfile).where(EngineerProfile.user_id == engineer.id)).one()
    assert (profile.specialization, profile.category) == ("Site Engineer", "SITE_ENGINEER")


def test_profile_image_must_be_an_own_upload(client: TestClient, database: Session) -> None:
    user, headers = signed_in(client, database)
    stranger = create_user(database, email="stranger@example.in", phone="9876500009")
    url = "/api/v1/auth/profile-image"
    for refused in (add_file(database, stranger), "https://elsewhere.example/me.png", f"/files/{uuid.uuid4()}"):
        response = client.patch(url, json={"profile_image_url": refused}, headers=headers)
        assert response.status_code == 422, refused
        assert response.json() == {"detail": "Profile image must be a file you uploaded."}
    own = add_file(database, user)
    assert client.patch(url, json={"profile_image_url": own}, headers=headers).json()["profile_image_url"] == own
    assert client.patch(url, json={"profile_image_url": ""}, headers=headers).json()["profile_image_url"] == ""


def test_business_logo_for_builders_and_suppliers_only(client: TestClient, database: Session) -> None:
    builder, headers = signed_in(client, database, role=ROLE_BUILDER)
    logo = add_file(database, builder)
    response = client.patch("/api/v1/auth/business-logo", json={"logo_url": logo}, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["company_logo_url"] == logo
    assert body["is_verified"] is False and body["review_count"] == 0

    client.post("/api/v1/auth/logout")
    _, owner_headers = signed_in(client, database, email="owner@example.in", phone="9876500001")
    refused = client.patch("/api/v1/auth/business-logo", json={"logo_url": ""}, headers=owner_headers)
    assert refused.status_code == 403


@pytest.fixture
def india_post(monkeypatch: pytest.MonkeyPatch) -> None:
    async def branches(pincode: str) -> list[dict[str, str]]:
        return [{**branch, "pincode": pincode} for branch in BRANCHES]

    monkeypatch.setattr(accounts_service_module, "fetch_india_pincode_branches", branches)
    monkeypatch.setattr(accounts_router_module, "fetch_india_pincode_branches", branches)


def test_location_saves_the_chosen_branch(client: TestClient, database: Session, india_post: None) -> None:
    user, headers = signed_in(client, database)
    user.address = ""
    database.commit()
    url = "/api/v1/auth/location"
    unknown = client.patch(url, json={"pincode": "560 001", "branch_name": "Nowhere"}, headers=headers)
    assert unknown.status_code == 422
    saved = client.patch(url, json={"pincode": "560 001", "branch_name": "shivajinagar"}, headers=headers)
    assert saved.status_code == 200
    body = saved.json()
    assert (body["pincode"], body["location"]) == ("560001", "Shivajinagar, Bengaluru, Karnataka")
    assert body["address"] == "Shivajinagar, Bengaluru, Karnataka"  # filled only because it was empty
    assert client.patch(url, json={"pincode": "56001", "branch_name": "MG Road"}, headers=headers).status_code == 400


def test_location_is_for_india_accounts(client: TestClient, database: Session, india_post: None) -> None:
    user, headers = signed_in(client, database)
    user.country_code = "UAE"
    database.commit()
    response = client.patch(
        "/api/v1/auth/location", json={"pincode": "560001", "branch_name": "MG Road"}, headers=headers
    )
    assert response.status_code == 400


def test_pincode_lookup_is_public(client: TestClient, database: Session, india_post: None) -> None:
    response = client.get("/api/v1/locations/pincode/560001")
    assert response.status_code == 200
    body = response.json()
    assert body["area"] == "MG Road" and body["areas"] == ["MG Road", "Shivajinagar"]
    assert body["districts"] == ["Bengaluru"]
    assert client.get("/api/v1/locations/pincode/56A001").status_code == 400


@pytest.fixture
def whatsapp() -> FakeWhatsApp:
    return FakeWhatsApp()


def verified_token(client: TestClient, whatsapp: FakeWhatsApp, phone: str) -> str:
    assert client.post("/api/v1/auth/phone/send-code", json={"phone": phone}).status_code == 200
    answer = client.post("/api/v1/auth/phone/verify-code", json={"phone": phone, "code": whatsapp.last_code()})
    token: str = answer.json()["verification_token"]
    return token


def whatsapp_sign_in(client: TestClient, whatsapp: FakeWhatsApp, phone: str) -> dict[str, str]:
    """Where WhatsApp sign-in is on, other accounts sign in with a code, not a password."""
    assert client.post("/api/v1/auth/phone/login/send-code", json={"phone": phone}).status_code == 200
    answer = client.post("/api/v1/auth/phone/login/verify-code", json={"phone": phone, "code": whatsapp.last_code()})
    assert answer.status_code == 200, answer.text
    return {"X-CSRF-Token": answer.json()["csrf_token"]}


def test_phone_change_needs_the_whatsapp_check(
    make_client: ClientFactory, whatsapp: FakeWhatsApp, database: Session
) -> None:
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    create_user(database, phone="9876543210", email=None)
    headers = whatsapp_sign_in(client, whatsapp, "9876543210")
    url = "/api/v1/auth/phone/change"
    refused = client.post(url, json={"phone": "9876543299", "phone_verification_token": "made-up"}, headers=headers)
    assert refused.status_code == 422
    token = verified_token(client, whatsapp, "9876543299")
    changed = client.post(url, json={"phone": "9876543299", "phone_verification_token": token}, headers=headers)
    assert changed.status_code == 200, changed.text
    assert changed.json()["phone"] == "9876543299"


def test_an_administrator_phone_change_ends_its_other_sessions(
    make_client: ClientFactory, whatsapp: FakeWhatsApp, database: Session
) -> None:
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    admin = create_user(database, role=ROLE_MANAGER, email="manager@example.in", admin_phone="9876500100")
    other_device = TestClient(client.app, headers={"Origin": "http://localhost:5173"})
    sign_in(other_device, identifier="manager@example.in")
    csrf = sign_in(client, identifier="manager@example.in")
    token = verified_token(client, whatsapp, "9876500200")
    response = client.post(
        "/api/v1/auth/phone/change",
        json={"phone": "9876500200", "phone_verification_token": token},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == ""  # an administrator's number lives on its admin profile
    assert client.get("/api/v1/auth/session").status_code == 200
    assert other_device.get("/api/v1/auth/session").status_code == 401
    reasons = {
        row.revoke_reason for row in database.scalars(select(UserSession).where(UserSession.user_id == admin.id))
    }
    assert "admin_phone_changed" in reasons
    entry = database.scalars(select(AdminAuditLog)).one()  # wired back by the admin module
    assert (entry.action, entry.actor_id, entry.target_id) == ("admin.phone_changed", admin.id, str(admin.id))


ROLE_FIELDS: dict[str, dict[str, Any]] = {
    "BUILDER": {
        "company_name": "Rao Builders",
        "license_number": "LIC-1",
        "experience_years": 5,
        "about": "We build homes.",
        "services_offered": "Construction",
        "service_locations": "Bengaluru",
    },
    "SUPPLIER": {
        "store_name": "Shop",
        "about": "Cement",
        "service_locations": "Bengaluru",
        "categories": "Cement",
        "supplier_category": "material supplier",
    },
}


@pytest.mark.parametrize(
    ("role", "field", "message"),
    [
        ("OWNER", "profile_image_url", "Profile image must be a file you uploaded."),
        ("BUILDER", "company_logo_url", "Business logo must be a file you uploaded."),
        ("SUPPLIER", "store_logo_url", "Business logo must be a file you uploaded."),
    ],
)
def test_complete_profile_takes_only_own_uploads(
    client: TestClient, database: Session, role: str, field: str, message: str
) -> None:
    """R6 (porting-todo #16): complete-profile used to store any address it was sent;
    now an image or logo must be one of the account's own uploads, as elsewhere, and a
    refusal saves nothing."""
    user, headers = signed_in(client, database, role=role, phone="9876543210")
    stranger = create_user(database, email="other@example.in", phone="9123456780")
    if role == ROLE_SUPPLIER:
        database.add(SupplierProfile(user_id=user.id, store_name="Shop"))
        database.commit()
    payload = {
        **BASE,
        "name": "Changed Name",
        **ROLE_FIELDS.get(role, {}),
    }
    for refused in (add_file(database, stranger), "https://evil.example/x.png", "/files/not-a-uuid"):
        response = client.patch(COMPLETE, json={**payload, field: refused}, headers=headers)
        assert (response.status_code, response.json()) == (422, {"detail": message})
    database.expire_all()
    assert database.get(User, user.id).name == "Asha Rao"  # type: ignore[union-attr]
    own = add_file(database, user)
    accepted = client.patch(COMPLETE, json={**payload, field: own}, headers=headers)
    assert accepted.status_code == 200, accepted.text
