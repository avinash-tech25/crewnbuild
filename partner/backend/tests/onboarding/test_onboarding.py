"""Technician onboarding after the e-mail code: face capture, Aadhaar and profile, in order;
identity data encrypted at rest with a key version and only ever shown masked; the pincode
lookup; the catalog the booking pages read."""

import logging
import random
from pathlib import Path
from typing import Any

import pytest
from conftest import ClientFactory
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from helpers import FakeEmail, add_requester, csrf, key_pair, sign_handoff
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_email_sender
from app.core.security import data_encryption
from app.modules.locations.location_service import get_pincode_directory
from app.modules.technicians.identity_service import _VERHOEFF_D, _VERHOEFF_P
from app.modules.technicians.models import IdentityVerification
from app.seeds.seed_service_catalog import seed as seed_catalog

JPEG = b"\xff\xd8\xff\xe0" + bytes(64)
DIRECTORY = {
    "560001": [
        {"name": "MG Road S.O", "block": "Bangalore North", "division": "Bangalore East",
         "district": "Bengaluru", "state": "Karnataka", "pincode": "560001",
         "display": "MG Road S.O, Bengaluru, Karnataka"},
    ]
}  # fmt: skip


class FakeDirectory:
    def branches(self, pincode: str) -> list[dict[str, str]]:
        if pincode not in DIRECTORY:
            raise HTTPException(status_code=404, detail="This pincode was not found. Check the 6 digits and try again.")
        return DIRECTORY[pincode]

    def branch(self, pincode: str, name: str) -> dict[str, str]:
        for candidate in self.branches(pincode):
            if candidate["name"].casefold() == name.strip().casefold():
                return candidate
        raise HTTPException(status_code=422, detail="Select one of the areas listed for this pincode.")


def valid_aadhaar() -> str:
    body = str(random.randint(2, 9)) + "".join(str(random.randint(0, 9)) for _ in range(10))
    checksum = 0
    for position, digit in enumerate(reversed(body)):
        checksum = _VERHOEFF_D[checksum][_VERHOEFF_P[(position + 1) % 8][int(digit)]]
    return body + str((0, 4, 3, 2, 1, 5, 6, 7, 8, 9)[checksum])


@pytest.fixture
def mailbox() -> FakeEmail:
    return FakeEmail()


@pytest.fixture
def keys() -> tuple[str, str]:
    return key_pair()


@pytest.fixture
def client(make_client: ClientFactory, mailbox: FakeEmail, tmp_path: Path, keys: tuple[str, str]) -> TestClient:
    return make_client(
        overrides={get_email_sender: lambda: mailbox, get_pincode_directory: FakeDirectory},
        data_encryption_key=Fernet.generate_key().decode(),
        data_encryption_key_version=3,
        face_capture_directory=str(tmp_path / "faces"),
        professional_handoff_public_key=keys[1],
    )


def register(client: TestClient, mailbox: FakeEmail, email: str = "new.tech@example.in") -> dict[str, str]:
    client.post("/api/v1/auth/signup/send-code", json={"email": email})
    verified = client.post(
        "/api/v1/auth/signup/verify-code", json={"email": email, "phone": "9876500100", "code": mailbox.last_code()}
    )
    assert verified.status_code == 200, verified.text
    return csrf(verified)


def face(client: TestClient, headers: dict[str, str], **form: Any) -> Any:
    data = {"consent": "true", **form}
    return client.post(
        "/api/v1/onboarding/face", data=data, files={"capture": ("face.jpg", JPEG, "image/jpeg")}, headers=headers
    )


def aadhaar(client: TestClient, headers: dict[str, str], number: str, consent: bool = True) -> Any:
    return client.post(
        "/api/v1/onboarding/aadhaar", json={"aadhaar_number": number, "consent": consent}, headers=headers
    )


PROFILE = {
    "name": "Ravi Kumar",
    "technician_type": "PLUMBER",
    "address": "Door 4, Market Street",
    "pincode": "560001",
    "area": "MG Road S.O",
    "experience_years": 4,
    "is_available": True,
    "password": "Strong#Pass123",
}


def test_the_steps_run_in_order_and_finish_with_a_dashboard_session(
    client: TestClient, mailbox: FakeEmail, database: Session, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    headers = register(client, mailbox)
    number = valid_aadhaar()
    out_of_order = aadhaar(client, headers, number)
    assert (out_of_order.status_code, out_of_order.json()["detail"]) == (409, "Complete face verification first.")
    assert face(client, headers, consent="false").status_code == 422
    not_an_image = client.post(
        "/api/v1/onboarding/face",
        data={"consent": "true"},
        files={"capture": ("x.txt", b"hello", "text/plain")},
        headers=headers,
    )
    assert not_an_image.status_code == 422

    caplog.set_level(logging.DEBUG)
    captured = face(client, headers)
    assert captured.status_code == 200, captured.text
    assert captured.json()["onboarding"] == {
        "step": "AADHAAR",
        "face_status": "PENDING",
        "aadhaar_status": "NOT_SUBMITTED",
        "aadhaar_masked": None,
        "can_receive_jobs": False,
        "pending_requirements": captured.json()["onboarding"]["pending_requirements"],
    }
    # The capture is stored encrypted, with its key version.
    stored = list((tmp_path / "faces").iterdir())
    assert len(stored) == 1 and JPEG not in stored[0].read_bytes()
    assert aadhaar(client, headers, "123412341234").status_code == 422  # not a valid Aadhaar
    submitted = aadhaar(client, headers, number)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["onboarding"]["aadhaar_masked"] == f"XXXX XXXX {number[-4:]}"
    assert number not in submitted.text and number not in caplog.text

    record = database.scalars(select(IdentityVerification)).one()
    assert record.aadhaar_key_version == 3 and record.face_capture_key_version == 3
    assert record.aadhaar_ciphertext and number.encode() not in record.aadhaar_ciphertext
    assert data_encryption.decrypt(record.aadhaar_ciphertext, 3).decode() == number

    weak = client.post("/api/v1/onboarding/profile", json={**PROFILE, "password": "weak"}, headers=headers)
    assert weak.status_code == 422
    finished = client.post("/api/v1/onboarding/profile", json=PROFILE, headers=headers)
    assert finished.status_code == 200, finished.text
    body = finished.json()
    assert body["session_type"] == "partner" and body["csrf_token"]
    assert (body["technician_type"], body["district"], body["onboarding"]["step"]) == (
        "PLUMBER",
        "Bengaluru",
        "COMPLETE",
    )
    assert body["onboarding"]["can_receive_jobs"] is True
    assert client.get("/api/v1/auth/me").json()["session_type"] == "partner"
    # Sending the step again earns no new session and never replaces the password.
    again = client.post(
        "/api/v1/onboarding/profile", json={**PROFILE, "password": "Other#Pass456"}, headers=csrf(finished)
    )
    assert again.status_code == 200 and again.json()["session_type"] is None
    trade = client.post(
        "/api/v1/onboarding/profile", json={**PROFILE, "technician_type": "PAINTER"}, headers=csrf(finished)
    )
    assert trade.status_code == 409


def test_one_aadhaar_cannot_be_linked_to_two_accounts(client: TestClient, mailbox: FakeEmail) -> None:
    number = valid_aadhaar()
    first = register(client, mailbox, "first@example.in")
    face(client, first)
    assert aadhaar(client, first, number).status_code == 200
    other = TestClient(client.app, headers={"Origin": "http://localhost:5373"})
    second = register(other, mailbox, "second@example.in")
    face(other, second)
    taken = aadhaar(other, second, number)
    assert taken.status_code == 409 and number not in taken.text


def test_without_a_key_identity_steps_answer_503(
    make_client: ClientFactory, mailbox: FakeEmail, tmp_path: Path
) -> None:
    client = make_client(overrides={get_email_sender: lambda: mailbox}, face_capture_directory=str(tmp_path))
    headers = register(client, mailbox)
    assert face(client, headers).status_code == 503


def test_the_onboarding_routes_need_a_technician_session(client: TestClient) -> None:
    for path in ("/api/v1/onboarding/face", "/api/v1/onboarding/aadhaar", "/api/v1/onboarding/profile"):
        assert client.post(path, json={}).status_code == 401


def test_the_pincode_lookup_is_public(client: TestClient) -> None:
    found = client.get("/api/v1/locations/pincode/560001").json()
    assert found["district"] == "Bengaluru" and found["areas"][0]["name"] == "MG Road S.O"
    assert client.get("/api/v1/locations/pincode/999999").status_code == 404
    assert client.get("/api/v1/locations/pincode/12ab").status_code == 400  # as before


def test_the_catalog_needs_a_booking_session(client: TestClient, database: Session, keys: tuple[str, str]) -> None:
    seed_catalog(database)
    assert client.get("/api/v1/requester/services?trade=PLUMBER").status_code == 401
    owner = add_requester(database)
    client.post("/api/v1/requester/session", json={"handoff_token": sign_handoff(keys[0], owner)})
    services = client.get("/api/v1/requester/services?trade=PLUMBER").json()
    assert services and all(service["trade"] == "PLUMBER" for service in services)
    first = services[0]
    detail = client.get(f"/api/v1/requester/services/PLUMBER/{first['slug']}").json()
    assert detail["price"] == first["price"]
    assert client.get("/api/v1/requester/services/PLUMBER/no-such-service").status_code == 404
    assert client.get("/api/v1/requester/services?trade=PILOT").status_code == 422


def test_a_rotated_key_still_decrypts_what_the_old_one_wrote(make_client: ClientFactory, database: Session) -> None:
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    make_client(data_encryption_key=old_key, data_encryption_key_version=1)
    ciphertext, version = data_encryption.encrypt(b"123456789012")
    assert version == 1
    make_client(
        data_encryption_key=new_key, data_encryption_key_version=2, data_encryption_previous_keys=f"1:{old_key}"
    )
    assert data_encryption.decrypt(ciphertext, 1) == b"123456789012"
    assert data_encryption.encrypt(b"x")[1] == 2
    make_client(data_encryption_key=new_key, data_encryption_key_version=2)
    with pytest.raises(data_encryption.DecryptionError):
        data_encryption.decrypt(ciphertext, 1)
