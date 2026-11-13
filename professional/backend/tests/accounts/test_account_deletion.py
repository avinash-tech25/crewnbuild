"""Delete Account: soft delete with anonymisation, refused while a Partner booking is
open, history kept with original_user_id."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from identity.helpers import create_user, sign_in
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.accounts.models import AccountDeletionRequest, BuilderProfile
from app.modules.accounts.repository import AccountRepository
from app.modules.identity.models import (
    ROLE_BUILDER,
    ROLE_ENGINEER,
    ROLE_MANAGER,
    User,
    UserOAuthIdentity,
    UserSession,
)

FORM = {
    "full_name": "Asha Rao",
    "role": "OWNER",
    "email": "asha@example.in",
    "phone": "+91 98765 43210",
    "reason_code": "NO_LONGER_NEEDED",
    "confirm_deletion": True,
    "confirmation_text": "DELETE",
}


def signed_in(client: TestClient, database: Session, **user: Any) -> tuple[User, dict[str, str]]:
    account = create_user(database, **{"phone": "9876543210", **user})
    csrf = sign_in(client, identifier=user.get("email", "asha@example.in"))
    return account, {"X-CSRF-Token": csrf}


def test_public_config_and_retired_endpoints(client: TestClient, database: Session) -> None:
    config = client.get("/api/v1/account-deletion-requests/config")
    assert config.status_code == 200
    assert {role["value"] for role in config.json()["roles"]} >= {"OWNER", "BUILDER", "STORE_MANAGER"}
    assert client.post("/api/v1/account-deletion-requests").status_code == 410
    _, headers = signed_in(client, database)
    assert client.delete("/api/v1/account", headers=headers).status_code == 410


def test_the_form_is_filled_from_the_account(client: TestClient, database: Session) -> None:
    signed_in(client, database, role=ROLE_ENGINEER, specialization="Store Manager")
    form = client.get("/api/v1/account/deletion-form").json()
    assert form["account"] == {
        "name": "Asha Rao",
        "role": "STORE_MANAGER",
        "email": "asha@example.in",
        "phone": "9876543210",
        "email_verified": True,
    }


def test_deletion_anonymises_the_account_and_ends_every_session(client: TestClient, database: Session) -> None:
    user, headers = signed_in(client, database)
    database.add(UserOAuthIdentity(user_id=user.id, provider="google", subject="g-1", email="asha@example.in"))
    database.commit()
    other_device = TestClient(client.app, headers={"Origin": "http://localhost:5173"})
    sign_in(other_device)

    response = client.post("/api/v1/account/delete", json=FORM, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deleted"] is True and body["reference"].startswith("DEL-")
    assert body["deleted_at"].endswith("+05:30")

    database.expire_all()
    stored = database.get(User, user.id)
    assert stored is not None  # kept, not removed
    assert stored.status == "DELETED" and stored.deleted_at is not None
    assert (stored.name, stored.email, stored.phone, stored.address, stored.pincode) == (
        "Deleted account",
        None,
        "",
        "",
        "",
    )
    assert database.scalars(select(UserOAuthIdentity)).first() is None
    assert all(row.revoked_at is not None for row in database.scalars(select(UserSession)))
    assert client.get("/api/v1/auth/session").status_code == 401
    assert other_device.get("/api/v1/auth/session").status_code == 401

    history = database.scalars(select(AccountDeletionRequest)).one()
    assert history.status == "DELETED" and history.original_user_id == user.id
    assert history.account_email == "asha@example.in"
    assert history.deletion_summary["method"] == "SOFT_DELETE_ANONYMISED"

    # The address and the number are free for a new account.
    create_user(database, email="asha@example.in", phone="9876543210", name="New Asha")


def test_original_user_id_has_no_foreign_key(database: Session) -> None:
    table = AccountDeletionRequest.__table__
    assert not table.c.original_user_id.foreign_keys
    assert table.c.user_id.foreign_keys


def test_an_open_partner_booking_blocks_deletion(
    client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, headers = signed_in(client, database)
    monkeypatch.setattr(AccountRepository, "count_open_partner_bookings", lambda self, user_id: 1)
    response = client.post("/api/v1/account/delete", json=FORM, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PARTNER_OPEN_BOOKINGS"
    database.expire_all()
    assert database.get(User, user.id).status == "ACTIVE"  # type: ignore[union-attr]
    assert database.scalars(select(AccountDeletionRequest)).first() is None


def test_no_partner_view_means_no_open_bookings(database: Session) -> None:
    user = create_user(database)
    assert AccountRepository(database).count_open_partner_bookings(user.id) == 0


@pytest.mark.parametrize(
    ("change", "status", "field"),
    [
        ({"full_name": "Someone Else"}, 422, "full_name"),
        ({"role": "SUPPLIER"}, 422, "role"),
        ({"email": "other@example.in"}, 422, "email"),
        ({"phone": "9000000000"}, 422, "phone"),
        ({"confirmation_text": "delete"}, 422, "confirmation_text"),
        ({"reason_code": "OTHER"}, 422, None),
    ],
)
def test_the_form_must_match_the_account(
    client: TestClient, database: Session, change: dict[str, Any], status: int, field: str | None
) -> None:
    _, headers = signed_in(client, database)
    response = client.post("/api/v1/account/delete", json={**FORM, **change}, headers=headers)
    assert response.status_code == status
    if field:
        assert response.json()["detail"]["field"] == field


def test_an_unverified_email_and_administrators_are_refused(client: TestClient, database: Session) -> None:
    user, headers = signed_in(client, database)
    user.email_verified_at = None
    database.commit()
    assert client.post("/api/v1/account/delete", json=FORM, headers=headers).status_code == 403
    client.post("/api/v1/auth/logout")
    _, admin_headers = signed_in(
        client, database, role=ROLE_MANAGER, email="manager@example.in", name="Manager", phone="9876500111"
    )
    refused = client.post(
        "/api/v1/account/delete",
        json={**FORM, "full_name": "Manager", "email": "manager@example.in"},
        headers=admin_headers,
    )
    assert refused.status_code == 403


def test_a_builder_with_an_unpaid_plan_can_still_delete(client: TestClient, database: Session) -> None:
    builder, headers = signed_in(client, database, role=ROLE_BUILDER)
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    profile.signup_plan_code, profile.signup_duration_code = "BUSINESS", "ANNUAL"
    database.commit()
    assert client.get("/api/v1/account/deletion-form").status_code == 200
    # The old role name is still accepted in the form.
    response = client.post("/api/v1/account/delete", json={**FORM, "role": "CONTRACTOR"}, headers=headers)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("role", "specialization", "stub", "value", "code"),
    [
        ("OWNER", None, "deletion_history.shared_project_titles", ["Villa"], "SHARED_PROJECTS"),
        (ROLE_BUILDER, None, "builder_history_project_titles", ["Villa"], "BUILDER_PROJECT_HISTORY"),
        ("SUPPLIER", None, "supplier_transaction_history_count", 2, "SUPPLIER_TRANSACTION_HISTORY"),
        ("SUPPLIER", None, "supplier_project_history_titles", ["Villa"], "SUPPLIER_PROJECT_HISTORY"),
        (ROLE_ENGINEER, "Store Manager", "store_manager_shared_history_count", 1, "STORE_MANAGER_HISTORY"),
        (
            ROLE_ENGINEER,
            "Site Engineer",
            "engineer_history_project_titles",
            ["Villa"],
            "ENGINEER_PROJECT_HISTORY",
        ),
    ],
)
def test_every_old_refusal_is_kept(
    client: TestClient,
    database: Session,
    monkeypatch: pytest.MonkeyPatch,
    role: str,
    specialization: str | None,
    stub: str,
    value: Any,
    code: str,
) -> None:
    from app.modules.accounts import deletion_blockers
    from app.modules.accounts.account_deletion_service import account_role_code

    user, headers = signed_in(client, database, role=role, specialization=specialization)
    target, name = deletion_blockers, stub
    if "." in stub:  # a function of another module the rule calls
        module, name = stub.split(".")
        target = getattr(deletion_blockers, module)
    monkeypatch.setattr(target, name, lambda database, user_id: value)
    form = {**FORM, "role": account_role_code(user)}
    response = client.post("/api/v1/account/delete", json=form, headers=headers)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == code
    if isinstance(value, list):
        assert "Villa" in detail["message"]
    database.expire_all()
    assert database.get(User, user.id).status == "ACTIVE"  # type: ignore[union-attr]


def test_shared_projects_are_checked_before_open_bookings(
    client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.accounts import deletion_blockers

    _, headers = signed_in(client, database)
    history = deletion_blockers.deletion_history
    monkeypatch.setattr(history, "shared_project_titles", lambda database, user_id: ["Villa"])
    monkeypatch.setattr(AccountRepository, "count_open_partner_bookings", lambda self, user_id: 1)
    response = client.post("/api/v1/account/delete", json=FORM, headers=headers)
    assert response.json()["detail"]["code"] == "SHARED_PROJECTS"
    assert response.json()["detail"]["message"] == (
        "You own projects other users are working on (Villa). Contact us to resolve them before deleting your "
        "account, so that their records are protected."
    )


# ---- finished bookings and the RESTRICT key from Partner (R4c decision) ----


@pytest.fixture
def partner_bookings(database: Session, monkeypatch: pytest.MonkeyPatch) -> Any:
    """Partner's bookings as Professional sees them: a table whose requester key references
    professional.users with ON DELETE RESTRICT (as partner.bookings does), and a view with
    the columns of partner.v_professional_bookings that the repository is pointed at. The
    Professional test role may not create objects in schema partner, so both live in
    professional for this test and are dropped afterwards."""
    from app.modules.accounts import repository

    database.execute(
        text(
            "CREATE TABLE professional.test_partner_bookings ("
            " id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
            " requested_by_user_id uuid NOT NULL REFERENCES professional.users (id) ON DELETE RESTRICT,"
            " requested_by_role varchar(20) NOT NULL DEFAULT 'OWNER', status varchar(20) NOT NULL)"
        )
    )
    database.execute(
        text(
            "CREATE VIEW professional.test_v_professional_bookings AS SELECT id, requested_by_user_id,"
            " requested_by_role, status FROM professional.test_partner_bookings"
        )
    )
    database.commit()
    monkeypatch.setattr(repository, "PARTNER_BOOKINGS_VIEW_SCHEMA", "professional")
    monkeypatch.setattr(repository, "PARTNER_BOOKINGS_VIEW_NAME", "test_v_professional_bookings")

    def add(user_id: Any, status: str) -> None:
        database.execute(
            text("INSERT INTO professional.test_partner_bookings (requested_by_user_id, status) VALUES (:u, :s)"),
            {"u": user_id, "s": status},
        )
        database.commit()

    yield add
    database.rollback()
    database.execute(text("DROP VIEW IF EXISTS professional.test_v_professional_bookings"))
    database.execute(text("DROP TABLE IF EXISTS professional.test_partner_bookings"))
    database.commit()


def test_finished_bookings_do_not_block_deletion_and_the_restrict_key_holds(
    client: TestClient, database: Session, partner_bookings: Any
) -> None:
    user, headers = signed_in(client, database)
    partner_bookings(user.id, "COMPLETED")
    partner_bookings(user.id, "CANCELLED")

    response = client.post("/api/v1/account/delete", json=FORM, headers=headers)
    assert response.status_code == 200, response.text

    database.expire_all()
    stored = database.get(User, user.id)
    assert stored is not None and stored.status == "DELETED" and stored.deleted_at is not None
    # Soft delete: the users row stays, so the bookings keep their requester.
    kept = database.execute(
        text("SELECT count(*) FROM professional.test_partner_bookings WHERE requested_by_user_id = :u"), {"u": user.id}
    ).scalar()
    assert kept == 2
    # And the key really is RESTRICT: removing the row outright is refused.
    with pytest.raises(IntegrityError):
        database.execute(text("DELETE FROM professional.users WHERE id = :u"), {"u": user.id})
    database.rollback()


def test_an_open_booking_in_the_view_blocks_deletion(
    client: TestClient, database: Session, partner_bookings: Any
) -> None:
    user, headers = signed_in(client, database)
    partner_bookings(user.id, "COMPLETED")
    partner_bookings(user.id, "IN_PROGRESS")
    response = client.post("/api/v1/account/delete", json=FORM, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PARTNER_OPEN_BOOKINGS"
