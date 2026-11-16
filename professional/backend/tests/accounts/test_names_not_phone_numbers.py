"""A phone number is never a name: not the person's, not a builder's company name, not a
supplier's store name. Sign-up and complete-profile refuse one, and migration 0004
corrected the rows saved before (from the person's real name, or back the other way)."""

import importlib.util
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import ClientFactory
from fastapi.testclient import TestClient
from identity.helpers import FakeEmailSender, create_user, service_overrides, sign_in
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.display_names import COMPANY_IS_PHONE, NAME_IS_PHONE, STORE_IS_PHONE, looks_like_phone, public_name
from app.modules.accounts.models import SupplierProfile
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, ROLE_SUPPLIER, User

COMPLETE = "/api/v1/auth/complete-profile"
BASE = {"phone": "9876543210", "address": "12 MG Road, Bengaluru", "pincode": "560001"}
MIGRATION = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "20261115_0004_names_not_phone_numbers.py"


@pytest.mark.parametrize(
    ("value", "phone_like"),
    [
        ("9640677606", True),
        ("+91 96406 77606", True),
        ("(080) 2345-6789", True),
        ("964.067.7606", True),
        ("Shakra", False),
        ("Builders 24x7", False),
        ("A1 Constructions", False),
        ("12345", False),  # too short to be a number anyone dials
        ("١٢٣٤٥٦٧", False),  # ASCII digits only, as the SQL and the frontend
        ("", False),
        (None, False),
    ],
)
def test_what_counts_as_a_phone_number(value: str | None, phone_like: bool) -> None:
    assert looks_like_phone(value) is phone_like


@pytest.mark.parametrize(("value", "shown"), [("+91 96406 77606", ""), ("Builders 24x7", "Builders 24x7"), (None, "")])
def test_a_public_name_is_never_a_phone_number(value: str | None, shown: str) -> None:
    assert public_name(value) == shown


# ---- sign-up ----


@pytest.fixture
def mail_client(make_client: ClientFactory) -> TestClient:
    return make_client(overrides=service_overrides(email=FakeEmailSender()))


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"name": "9640677606", "role": "OWNER"}, NAME_IS_PHONE),
        ({"name": "Shakra", "role": "CONTRACTOR", "company_name": "9640677606"}, COMPANY_IS_PHONE),
        ({"name": "Indra", "role": "SUPPLIER", "store_name": "+91 96406 77606"}, STORE_IS_PHONE),
    ],
)
def test_sign_up_refuses_a_phone_number_as_a_name(mail_client: TestClient, body: dict, message: str) -> None:
    response = mail_client.post(
        "/api/v1/auth/signup", json={"email": "new@example.in", "password": "Strong#Pass123", **body}
    )
    assert (response.status_code, response.json()) == (422, {"detail": message})


# ---- complete-profile (also every dashboard's Profile Settings save) ----


def signed_in(client: TestClient, database: Session, role: str) -> tuple[User, dict[str, str]]:
    user = create_user(database, role=role, phone="9876543210")
    if role == ROLE_SUPPLIER:
        database.add(SupplierProfile(user_id=user.id, store_name="Shop", supplier_category="Material Supplier"))
        database.commit()
    csrf = sign_in(client, identifier="asha@example.in")
    return user, {"X-CSRF-Token": csrf}


@pytest.mark.parametrize("role", [ROLE_OWNER, ROLE_BUILDER, ROLE_SUPPLIER, ROLE_ENGINEER])
def test_complete_profile_refuses_a_phone_number_as_the_persons_name(
    client: TestClient, database: Session, role: str
) -> None:
    _, headers = signed_in(client, database, role)
    response = client.patch(COMPLETE, json={**BASE, "name": "9640677606"}, headers=headers)
    assert response.status_code == 422
    assert response.json()["detail"]["fields"]["name"] == NAME_IS_PHONE


@pytest.mark.parametrize(
    ("role", "field", "message"),
    [(ROLE_BUILDER, "company_name", COMPANY_IS_PHONE), (ROLE_SUPPLIER, "store_name", STORE_IS_PHONE)],
)
def test_complete_profile_refuses_a_phone_number_as_the_business_name(
    client: TestClient, database: Session, role: str, field: str, message: str
) -> None:
    _, headers = signed_in(client, database, role)
    response = client.patch(COMPLETE, json={**BASE, "name": "Shakra", field: "9640677606"}, headers=headers)
    assert response.status_code == 422
    assert response.json()["detail"]["fields"][field] == message


# ---- migration 0004 ----


BACKUP_TABLE = "professional.migration_0004_names_backup"


@pytest.fixture
def migration(database: Session) -> Iterator[ModuleType]:
    """Migration 0004, its backup table dropped afterwards (it is not one of the models,
    so the test database's cleanup does not know it)."""
    spec = importlib.util.spec_from_file_location("names_not_phone_numbers", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    database.rollback()
    database.execute(text(f"DROP TABLE IF EXISTS {BACKUP_TABLE}"))
    database.commit()


def run(database: Session, step: Callable[[], None]) -> None:
    with Operations.context(MigrationContext.configure(database.connection())):
        step()
    database.commit()
    database.expire_all()


def test_the_migration_corrects_names_saved_as_phone_numbers(database: Session, migration: ModuleType) -> None:
    # A builder whose company name is his phone number: it takes his name.
    shakra = create_user(database, role=ROLE_BUILDER, name="Shakra", email="shakra@example.in", phone="9640677606")
    shakra.contractor_profile.company_name = "9640677606"
    # A builder whose own name is a number but whose company is real: the name takes it.
    rao = create_user(database, role=ROLE_BUILDER, name="+91 98765 00002", email="rao@example.in", phone="9876500002")
    rao.contractor_profile.company_name = "Rao Constructions"
    # A supplier whose store name is a number.
    indra = create_user(database, role=ROLE_SUPPLIER, name="Indra", email="indra@example.in", phone="9876500003")
    database.add(SupplierProfile(user_id=indra.id, store_name="98765 00003", supplier_category="Material Supplier"))
    # Nothing to recover: both are numbers, so both stay for the owner to correct.
    lost = create_user(database, role=ROLE_BUILDER, name="9876500004", email="lost@example.in", phone="9876500004")
    lost.contractor_profile.company_name = "9876500004"
    # A real name with digits is not touched.
    fine = create_user(database, role=ROLE_BUILDER, name="Ravi", email="ravi@example.in", phone="9876500005")
    fine.contractor_profile.company_name = "Builders 24x7"
    # A company name longer than a person's name may be (160 against 150): cut to fit.
    long = create_user(database, role=ROLE_BUILDER, name="9876500006", email="long@example.in", phone="9876500006")
    long.contractor_profile.company_name = "L" * 155
    database.commit()

    run(database, migration.upgrade)

    assert (database.get(User, shakra.id).name, database.get(User, shakra.id).contractor_profile.company_name) == (
        "Shakra",
        "Shakra",
    )
    assert database.get(User, rao.id).name == "Rao Constructions"
    assert database.get(User, rao.id).contractor_profile.company_name == "Rao Constructions"
    assert database.get(User, indra.id).supplier_profile.store_name == "Indra"
    assert database.get(User, lost.id).name == "9876500004"
    assert database.get(User, lost.id).contractor_profile.company_name == "9876500004"
    assert database.get(User, fine.id).contractor_profile.company_name == "Builders 24x7"
    assert database.get(User, long.id).name == "L" * 150
    # Phone numbers themselves are left alone.
    assert database.get(User, shakra.id).phone == "9640677606"


def test_the_migration_runs_twice_and_downgrade_restores_the_old_values(
    database: Session, migration: ModuleType
) -> None:
    shakra = create_user(database, role=ROLE_BUILDER, name="Shakra", email="shakra@example.in", phone="9640677606")
    shakra.contractor_profile.company_name = "9640677606"
    rao = create_user(database, role=ROLE_BUILDER, name="+91 98765 00002", email="rao@example.in", phone="9876500002")
    rao.contractor_profile.company_name = "Rao Constructions"
    indra = create_user(database, role=ROLE_SUPPLIER, name="Indra", email="indra@example.in", phone="9876500003")
    database.add(SupplierProfile(user_id=indra.id, store_name="98765 00003", supplier_category="Material Supplier"))
    database.commit()

    run(database, migration.upgrade)
    run(database, migration.upgrade)
    assert database.execute(text(f"SELECT count(*) FROM {BACKUP_TABLE}")).scalar()  # noqa: S608 - a constant == 3
    assert database.get(User, rao.id).name == "Rao Constructions"

    run(database, migration.downgrade)
    assert database.get(User, shakra.id).contractor_profile.company_name == "9640677606"
    assert database.get(User, rao.id).name == "+91 98765 00002"
    assert database.get(User, indra.id).supplier_profile.store_name == "98765 00003"
    assert database.execute(text("SELECT to_regclass(:table)"), {"table": BACKUP_TABLE}).scalar() is None
