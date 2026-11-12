"""The ad console, staff support tickets, the deleted-accounts history and the Global
Super Admin seed. E-mail and S3 are faked."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi.testclient import TestClient
from files.test_files import PNG, FakeStorage
from identity.helpers import FakeEmailSender, create_user
from sqlalchemy import select
from sqlalchemy.orm import Session
from support.test_support import build, submission, submit

from admin.helpers import create_admin, create_global_admin, signed_in
from app.modules.accounts.models import AccountDeletionRequest, AdminProfile
from app.modules.admin.models import AdminAuditLog
from app.modules.content.models import Ad, AdDailyStat
from app.modules.identity.models import ROLE_GLOBAL_SUPER_ADMIN, ROLE_MANAGER, User, UserSession
from app.modules.messaging.models import Notification
from app.modules.support.models import SupportTicket
from app.seeds import seed_admin_account
from app.seeds.seed_admin_account import CONVERTED, CREATED, EXISTS, SeedRefusedError, seed


@pytest.fixture
def mailbox() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def desk(
    make_client: ClientFactory, mailbox: FakeEmailSender, database: Session
) -> tuple[TestClient, TestClient, dict[str, str]]:
    """(the app's client, the India Super Admin's browser, its CSRF header)."""
    client = build(make_client, mailbox, FakeStorage(), aws_site_images_bucket_in="site-images")
    create_admin(database)
    admin, headers = signed_in(client, "india.admin@example.in")
    return client, admin, headers


AD = {"title": "Monsoon offer", "image_url": "/files/x", "placements": ["home@top", "owner_dashboard"]}


def test_the_ad_console(desk: Any, database: Session) -> None:
    client, admin, headers = desk
    assert {"key": "home", "label": "Landing page"} in admin.get("/api/v1/admin/ads/placements").json()
    assert admin.post("/api/v1/admin/ads", json={**AD, "placements": ["nowhere"]}, headers=headers).status_code == 400
    priced = {**AD, "price_amount": "100", "pricing_model": "PER_CLICK"}
    created = admin.post("/api/v1/admin/ads", json=priced, headers=headers)
    assert created.status_code == 201, created.text
    advert = created.json()
    assert advert["status"] == "DRAFT" and advert["scope"] == "IN" and advert["currency"] == "INR"
    assert advert["placement_positions"] == {"home": "top", "owner_dashboard": "footer"}
    ad_id = advert["id"]

    url = f"/api/v1/admin/ads/{ad_id}"
    assert admin.patch(url, json={}, headers=headers).status_code == 400
    renamed = admin.patch(url, json={"title": "Monsoon sale", "reason": "Typo"}, headers=headers)
    assert renamed.json()["title"] == "Monsoon sale"
    live = admin.post(f"{url}/status", json={"status": "ACTIVE"}, headers=headers)
    assert live.json()["status"] == "ACTIVE"
    assert admin.post(f"{url}/status", json={"status": "LIVE"}, headers=headers).status_code == 400

    # The public side shows it and counts the click; the console reports what it earned.
    assert [row["id"] for row in client.get("/api/v1/ads", params={"placement": "home", "position": "top"}).json()] == [
        ad_id
    ]
    database.add(AdDailyStat(ad_id=uuid.UUID(ad_id), placement="home", day=datetime.now(UTC).date(), views=5, clicks=2))
    database.commit()
    stats = admin.get(f"{url}/stats").json()
    assert stats["advert"]["earned"] == "200.00" and stats["by_placement"][0]["label"] == "Landing page"
    listing = admin.get("/api/v1/admin/ads").json()
    assert listing["total"] == 1 and listing["revenue"] == [{"currency": "INR", "earned": "200.00", "adverts": 1}]
    assert admin.get(f"/api/v1/admin/ads/{uuid.uuid4()}/stats").status_code == 404
    assert admin.get("/api/v1/admin/ads", params={"limit": -1}).status_code == 422  # crash fixed (was 500)

    actions = database.scalars(select(AdminAuditLog.action).order_by(AdminAuditLog.created_at)).all()
    assert actions == ["advert.created", "advert.updated", "advert.status"]


def test_a_location_admin_cannot_change_a_global_ad(desk: Any, database: Session) -> None:
    _, admin, headers = desk
    advert = Ad(title="Everywhere", image_url="/files/x", placements="home@footer", scope="GLOBAL")
    database.add(advert)
    database.commit()
    assert admin.get("/api/v1/admin/ads").json()["total"] == 1  # seen
    refused = admin.post(f"/api/v1/admin/ads/{advert.id}/status", json={"status": "ACTIVE"}, headers=headers)
    assert refused.status_code == 403
    assert admin.get(f"/api/v1/admin/ads/{advert.id}/stats").status_code == 200


def test_an_ad_picture_upload(desk: Any) -> None:
    _, admin, headers = desk
    pdf = admin.post("/api/v1/admin/ads/image", files={"file": ("a.pdf", b"%PDF", "application/pdf")}, headers=headers)
    assert pdf.status_code == 415
    stored = admin.post("/api/v1/admin/ads/image", files={"file": ("a.png", PNG, "image/png")}, headers=headers)
    assert stored.status_code == 200, stored.text
    assert stored.json()["url"].startswith("/files/")


def test_staff_support_tickets(desk: Any, database: Session, mailbox: FakeEmailSender) -> None:
    client, admin, headers = desk
    owner = create_user(database, email="owner@example.in", phone="9876500001")
    member, member_headers = signed_in(client, "owner@example.in")
    reference = submit(member, submission(), member_headers).json()["reference"]
    ticket = database.scalars(select(SupportTicket)).one()

    listing = admin.get("/api/v1/admin/support/tickets", params={"q": reference}).json()["tickets"]
    assert [row["reference"] for row in listing] == [reference] and listing[0]["signed_in"] is True
    assert admin.get("/api/v1/admin/support/tickets", params={"status": "LOST"}).status_code == 422
    url = f"/api/v1/admin/support/tickets/{ticket.id}"
    assert admin.get(url).json()["contact"]["email"] == "owner@example.in"
    assert admin.post(f"{url}/reply", json={}, headers=headers).status_code == 422
    answered = admin.post(f"{url}/reply", json={"body": "We are on it.", "status": "WAITING_FOR_USER"}, headers=headers)
    assert answered.status_code == 200, answered.text
    assert answered.json()["status"] == "WAITING_FOR_USER"
    assert [message["author"] for message in answered.json()["messages"]] == ["STAFF"]
    assert mailbox.sent[-1]["subject"] == f"[{reference}] Reply from CREWNBUILD Support"
    notice = database.scalars(select(Notification).where(Notification.user_id == owner.id)).all()
    assert any(row.title == f"Update on {reference}" for row in notice)
    assert admin.get(f"{url}/attachment").status_code == 404
    assert admin.get(f"/api/v1/admin/support/tickets/{uuid.uuid4()}").status_code == 404


def test_deleted_accounts_history(desk: Any, database: Session) -> None:
    _, admin, _ = desk
    row = AccountDeletionRequest(
        reference="DEL-20261112-ABC123",
        original_user_id=uuid.uuid4(),
        account_name="Ravi",
        account_email="ravi@example.in",
        submitted_email="ravi@example.in",
        submitted_phone="9876500001",
        submitted_role="OWNER",
        account_role="OWNER",
        reason_code="PRIVACY",
        status="DELETED",
        source="IN_APP",
        deleted_at=datetime.now(UTC),
        policy_accepted_at=datetime.now(UTC),
        deletion_summary={"deleted_by": "ACCOUNT_HOLDER"},
    )
    database.add(row)
    database.commit()
    listing = admin.get("/api/v1/admin/deleted-accounts", params={"q": "65000"}).json()
    assert [entry["reference"] for entry in listing] == ["DEL-20261112-ABC123"]
    assert listing[0]["reason_label"] == "Privacy concerns" and listing[0]["deleted_by"] == "Account holder"
    one = admin.get(f"/api/v1/admin/deleted-accounts/{row.id}").json()
    assert one["source"] == "IN_APP" and one["retained_records"] == {}
    assert admin.get(f"/api/v1/admin/deleted-accounts/{uuid.uuid4()}").status_code == 404


# ---- the Global Super Admin seed ----


def settings_with(phone: str, environment: str = "production") -> Any:
    return SimpleNamespace(global_admin_phone=phone, environment=environment)


def test_the_seed_creates_once_and_runs_in_production(database: Session) -> None:
    assert seed(database, settings_with("9876500900")) == CREATED
    assert seed(database, settings_with("98765 00900")) == EXISTS
    admin = database.scalars(select(User).where(User.role == ROLE_GLOBAL_SUPER_ADMIN)).one()
    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == admin.id)).one()
    assert (profile.scope, profile.phone, profile.permissions, admin.email, admin.phone) == (
        "GLOBAL",
        "9876500900",
        "",
        None,
        "",
    )


def test_the_seed_converts_the_old_password_admin(client: TestClient, database: Session) -> None:
    old = create_admin(database, role=ROLE_GLOBAL_SUPER_ADMIN, scope="GLOBAL", email="old@example.in")
    database.add(UserSession(user_id=old.id, token_family_id=uuid.uuid4(), refresh_token_hash="a" * 64,
                             csrf_secret_hash="b" * 64, expires_at=datetime(2030, 1, 1, tzinfo=UTC)))  # fmt: skip
    database.commit()
    before = old.password_hash
    assert seed(database, settings_with("9876500900")) == CONVERTED
    database.expire_all()
    assert database.get(User, old.id).password_hash != before
    assert database.scalars(select(UserSession.revoked_at)).one() is not None
    assert seed(database, settings_with("9876500900")) == EXISTS


def test_the_seed_refuses_without_guessing(database: Session) -> None:
    with pytest.raises(SeedRefusedError):
        seed(database, settings_with(""))
    with pytest.raises(SeedRefusedError):
        seed(database, settings_with("12345"))
    create_admin(database, role=ROLE_MANAGER, email="m@example.in", phone="9876500900")
    with pytest.raises(SeedRefusedError, match="MANAGER"):
        seed(database, settings_with("9876500900"))
    create_user(database, email="member@example.in", phone="9876500901")
    with pytest.raises(SeedRefusedError, match="another account"):
        seed(database, settings_with("9876500901"))
    create_global_admin(database, phone="")
    create_admin(database, role=ROLE_GLOBAL_SUPER_ADMIN, scope="GLOBAL", email="second@example.in")
    with pytest.raises(SeedRefusedError, match="not guessing"):
        seed(database, settings_with("9876500902"))
    assert database.scalars(select(AdminProfile.phone).where(AdminProfile.phone == "9876500902")).first() is None
    assert seed_admin_account.CREATED == "created"
