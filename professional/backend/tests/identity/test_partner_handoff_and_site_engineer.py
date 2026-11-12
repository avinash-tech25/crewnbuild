"""The Book Technician hand-off (ES256, no role claim) and the Site Engineer rule."""

import uuid
from typing import Any

import jwt
import pytest
from conftest import ClientFactory, make_settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security.access_tokens import read_access_claims
from app.modules.accounts.models import EngineerProfile, engineer_category_for
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER
from identity.helpers import create_user, sign_in

HANDOFF = "/api/v1/auth/partner-handoff"


def new_key_pair() -> tuple[str, Any]:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode("ascii")
    return pem, key.public_key()


@pytest.fixture
def handoff_key() -> tuple[str, Any]:
    return new_key_pair()


def handoff_client(make_client: ClientFactory, handoff_key: tuple[str, Any]) -> TestClient:
    return make_client(partner_handoff_private_key=handoff_key[0])


def test_house_owner_gets_an_es256_token_without_a_role_claim(
    make_client: ClientFactory, database: Session, handoff_key: tuple[str, Any]
) -> None:
    owner = create_user(database)
    client = handoff_client(make_client, handoff_key)
    csrf = sign_in(client)
    response = client.post(HANDOFF, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in_seconds"] == 60

    token = body["handoff_token"]
    assert jwt.get_unverified_header(token)["alg"] == "ES256"
    claims = jwt.decode(token, handoff_key[1], algorithms=["ES256"], audience="partner")
    assert claims["sub"] == str(owner.id)
    assert claims["aud"] == "partner"
    assert claims["type"] == "partner_handoff"
    assert claims["iss"] == "professional"
    assert claims["jti"]
    assert claims["exp"] - claims["iat"] <= 60
    assert "role" not in claims


def test_each_handoff_token_is_single_use_by_jti(
    make_client: ClientFactory, database: Session, handoff_key: tuple[str, Any]
) -> None:
    create_user(database)
    client = handoff_client(make_client, handoff_key)
    csrf = sign_in(client)
    first = client.post(HANDOFF, headers={"X-CSRF-Token": csrf}).json()["handoff_token"]
    second = client.post(HANDOFF, headers={"X-CSRF-Token": csrf}).json()["handoff_token"]
    jti = {
        jwt.decode(token, handoff_key[1], algorithms=["ES256"], audience="partner")["jti"] for token in (first, second)
    }
    assert len(jti) == 2


def test_handoff_answers_503_when_no_key_is_configured(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    response = client.post(HANDOFF, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 503


@pytest.mark.parametrize(
    ("role", "specialization", "allowed"),
    [
        (ROLE_ENGINEER, "Site Engineer", True),
        (ROLE_ENGINEER, "  Site Engineer  ", True),
        (ROLE_ENGINEER, "Civil Engineer", False),
        (ROLE_ENGINEER, "Store Manager", False),
        (ROLE_ENGINEER, None, False),
        (ROLE_BUILDER, None, False),
    ],
)
def test_only_house_owners_and_site_engineers_may_hand_off(
    make_client: ClientFactory,
    database: Session,
    handoff_key: tuple[str, Any],
    role: str,
    specialization: str | None,
    allowed: bool,
) -> None:
    create_user(database, role=role, specialization=specialization, email="person@example.in")
    client = handoff_client(make_client, handoff_key)
    csrf = sign_in(client, identifier="person@example.in")
    response = client.post(HANDOFF, headers={"X-CSRF-Token": csrf})
    if allowed:
        assert response.status_code == 200
    else:
        assert response.status_code == 403
        assert response.json() == {"detail": "Book Technician is available to House Owners and Site Engineers."}


@pytest.mark.parametrize(
    ("specialization", "category"),
    [
        ("Site Engineer", "SITE_ENGINEER"),
        (" Site Engineer ", "SITE_ENGINEER"),
        ("site engineer", None),  # the old rule compared exactly after trimming
        ("Store Manager", "STORE_MANAGER"),
        ("store manager", "STORE_MANAGER"),
        ("Civil Engineer", None),
        (None, None),
    ],
)
def test_category_follows_the_old_specialization_rules(specialization: str | None, category: str | None) -> None:
    assert engineer_category_for(specialization) == category
    profile = EngineerProfile(user_id=uuid.uuid4(), specialization=specialization)
    assert profile.category == category


def test_sign_up_as_a_site_engineer_sets_the_category(client: TestClient, database: Session) -> None:
    user = create_user(database, role=ROLE_ENGINEER, specialization="Site Engineer")
    assert user.engineer_profile.category == "SITE_ENGINEER"


def test_the_session_role_names_the_engineer_category(client: TestClient, database: Session) -> None:
    create_user(database, role=ROLE_ENGINEER, specialization="Store Manager")
    sign_in(client)
    access = client.cookies.get("pro_at") or ""
    assert read_access_claims(make_settings(), access) is not None
    claims = jwt.decode(access, options={"verify_signature": False})
    assert claims["role"] == "STORE_MANAGER"
    assert claims["typ"] == "access"


ENGINEER_CATEGORY = "/api/v1/auth/engineer-category"


def test_engineer_category_is_saved_once_and_sets_the_category(client: TestClient, database: Session) -> None:
    create_user(database, role=ROLE_ENGINEER, specialization=None)
    csrf = sign_in(client)
    headers = {"X-CSRF-Token": csrf}
    saved = client.patch(ENGINEER_CATEGORY, json={"specialization": "Site Engineer"}, headers=headers)
    assert saved.status_code == 200
    assert saved.json()["specialization"] == "Site Engineer"
    assert saved.json()["user"]["engineer_profile"]["specialization"] == "Site Engineer"
    assert saved.json()["user"]["created_at"]
    database.expire_all()
    profile = database.query(EngineerProfile).one()
    assert profile.category == "SITE_ENGINEER"

    # The same value again is a no-op; another value is refused.
    assert client.patch(ENGINEER_CATEGORY, json={"specialization": "Site Engineer"}, headers=headers).status_code == 200
    locked = client.patch(ENGINEER_CATEGORY, json={"specialization": "Civil Engineer"}, headers=headers)
    assert locked.status_code == 409


def test_engineer_category_refuses_other_roles_and_unknown_categories(client: TestClient, database: Session) -> None:
    create_user(database, role=ROLE_ENGINEER, specialization=None, email="engineer@example.in")
    create_user(database, role=ROLE_BUILDER, email="builder@example.in")
    csrf = sign_in(client, identifier="engineer@example.in")
    unknown = client.patch(ENGINEER_CATEGORY, json={"specialization": "Astronaut"}, headers={"X-CSRF-Token": csrf})
    assert unknown.status_code == 422
    client.post("/api/v1/auth/logout")
    csrf = sign_in(client, identifier="builder@example.in")
    refused = client.patch(ENGINEER_CATEGORY, json={"specialization": "Site Engineer"}, headers={"X-CSRF-Token": csrf})
    assert refused.status_code == 403
