"""The old Partner suite's fixtures, adapted to this app (pytest plugin, see conftest.py).

The ported tests drive the API as the old suite did, and these fixtures keep its rules:

* every test runs inside one outer transaction on crewnbuild_test that is rolled back at
  the end; the app's own commits become savepoint releases inside it;
* the India Post directory and the e-mail sender are replaced at the edge;
* the old tests sent `Authorization: Bearer <token>`. Sessions are cookie-only now, so the
  test client turns that header into the session's cookie plus its CSRF token and Origin,
  exactly what the browser sends; the app's own checks stay strict;
* answers that start a session have their cookie values copied into the JSON under the
  keys the old tests read (access_token, refresh_token, session_token, ...);
* a Professional House Owner or Site Engineer is a row of the stand-in for
  professional.v_partner_requesters, and a hand-off is shaped like Professional's
  (ES256, iss professional, aud partner, at most 60 seconds).
"""

import json
import random
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from conftest import FRONTEND_ORIGIN, REQUESTERS_STAND_IN, make_settings
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from helpers import key_pair
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.auth.dependencies import get_email_sender
from app.core.security.access_tokens import csrf_token_for
from app.core.security.session_cookies import REQUESTER, TECHNICIAN, access_cookie_name, refresh_cookie_name
from app.database.session import engine, get_db
from app.main import create_app
from app.modules.locations.location_service import get_pincode_directory
from app.modules.technicians.identity_service import _VERHOEFF_D, _VERHOEFF_P

TEST_HANDOFF_PRIVATE_KEY, TEST_HANDOFF_PUBLIC_KEY = key_pair()
OTHER_HANDOFF_PRIVATE_KEY, _OTHER_HANDOFF_PUBLIC_KEY = key_pair()
TEST_ORIGIN = FRONTEND_ORIGIN


def branch(name: str, block: str, division: str, district: str, state: str, pincode: str) -> dict[str, str]:
    return {
        "name": name,
        "block": block,
        "division": division,
        "district": district,
        "state": state,
        "pincode": pincode,
        "display": f"{name}, {district}, {state}",
    }


# Synthetic 000xxx pincodes India Post never issues, shaped like real answers.
DIRECTORY = {
    "000405": [
        branch("Alpha Main", "North Block", "Alpha Division", "Alpha District", "Test State", "000405"),
        branch("Alpha East", "East Block", "Alpha Division", "Alpha District", "Test State", "000405"),
    ],
    "000301": [branch("North Town", "North Block", "Alpha Division", "Alpha District", "Test State", "000301")],
    "000001": [branch("Division Town", "Central Block", "Alpha Division", "Alpha District", "Test State", "000001")],
    "000172": [branch("District Town", "South Block", "Other Division", "Alpha District", "Test State", "000172")],
    "000406": [branch("Beta Town", "Beta Block", "Beta Division", "Beta District", "Test State", "000406")],
    "000901": [branch("Gamma Town", "Gamma Block", "Gamma Division", "Gamma District", "Test State", "000901")],
}
AREA_OF = {pin: branches[0]["name"] for pin, branches in DIRECTORY.items()}
JPEG_CAPTURE = b"\xff\xd8\xff\xe0" + b"\x00\x10JFIF" + bytes(256)


class FakeDirectory:
    def __init__(self) -> None:
        self.reachable = True

    def branches(self, pincode: str) -> list[dict[str, str]]:
        if not self.reachable:
            raise HTTPException(status_code=503, detail="The pincode directory could not be reached. Please try again.")
        if pincode not in DIRECTORY:
            raise HTTPException(status_code=404, detail="This pincode was not found. Check the 6 digits and try again.")
        return DIRECTORY[pincode]

    def branch(self, pincode: str, branch_name: str) -> dict[str, str]:
        for candidate in self.branches(pincode):
            if candidate["name"].casefold() == (branch_name or "").strip().casefold():
                return candidate
        raise HTTPException(status_code=422, detail="Select one of the areas listed for this pincode.")


class RecordingEmail:
    """Stands in for SMTP: records each message instead of sending it."""

    configured = True

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        self.sent.append({"to": to_email, "subject": subject, "body": text_body})
        return True

    def last_code(self, email: str) -> str:
        for message in reversed(self.sent):
            if message["to"] == email:
                found = re.search(r"\b(\d{6})\b", message["body"])
                assert found is not None
                return found.group(1)
        raise AssertionError(f"no email was sent to {email}")


def valid_aadhaar() -> str:
    """A random, checksum-valid 12-digit number (never kept beyond the rolled-back test)."""
    body = str(random.randint(2, 9)) + "".join(str(random.randint(0, 9)) for _ in range(10))  # noqa: S311
    checksum = 0
    for position, digit in enumerate(reversed(body)):
        checksum = _VERHOEFF_D[checksum][_VERHOEFF_P[(position + 1) % 8][int(digit)]]
    inverse = (0, 4, 3, 2, 1, 5, 6, 7, 8, 9)
    return body + str(inverse[checksum])


@pytest.fixture
def connection(database_tables: None) -> Iterator[Connection]:
    connection = engine.connect()
    transaction = connection.begin()
    try:
        yield connection
    finally:
        transaction.rollback()
        connection.close()


@pytest.fixture
def directory() -> FakeDirectory:
    return FakeDirectory()


@pytest.fixture
def mailbox() -> RecordingEmail:
    return RecordingEmail()


def set_cookies(response: Any) -> dict[str, str]:
    """name -> value of the cookies a response sets (a deletion has an empty value)."""
    found = {}
    for header in response.headers.get_list("set-cookie"):
        name, _, rest = header.partition("=")
        found[name.strip()] = rest.split(";", 1)[0].strip().strip('"')
    return found


@pytest.fixture(autouse=True)
def legacy_settings(tmp_path: Any) -> Any:
    """The settings of the ported tests' app, bound before any test fixture patches one."""
    from app.core.runtime import use_settings

    configured = make_settings(
        upload_directory=str(tmp_path / "uploads"),
        face_capture_directory=str(tmp_path / "face_captures"),
        job_media_directory=str(tmp_path / "job_media"),
        data_encryption_key=Fernet.generate_key().decode(),
        require_verified_identity_for_jobs=False,
        professional_handoff_public_key=TEST_HANDOFF_PUBLIC_KEY,
        # Realtime stays inside this process and the sweeper is off: a test drives
        # expiry itself with the `sweep` fixture, at the moment it chooses.
        realtime_cross_process=False,
        dispatch_worker_enabled=False,
        # Tests place technicians anywhere instantly; the jump check has its own tests.
        location_max_speed_kmph=0.0,
    )
    use_settings(configured)
    return configured


@pytest.fixture
def client(
    connection: Connection,
    directory: FakeDirectory,
    mailbox: RecordingEmail,
    legacy_settings: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    from app.modules.realtime import router as realtime_router

    # The sockets open their own short sessions; here they join the test's transaction.
    monkeypatch.setattr(
        realtime_router,
        "database_session",
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False),
    )

    def override_database() -> Iterator[Session]:
        session = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
        try:
            yield session
        finally:
            session.close()

    app = create_app(legacy_settings)
    app.dependency_overrides[get_db] = override_database
    app.dependency_overrides[get_pincode_directory] = lambda: directory
    app.dependency_overrides[get_email_sender] = lambda: mailbox
    names = {
        "technician_access": access_cookie_name(legacy_settings, TECHNICIAN),
        "technician_refresh": refresh_cookie_name(legacy_settings, TECHNICIAN),
        "requester_access": access_cookie_name(legacy_settings, REQUESTER),
        "requester_refresh": refresh_cookie_name(legacy_settings, REQUESTER),
    }
    with TestClient(app, base_url="http://testserver/api/v1", headers={"Origin": TEST_ORIGIN}) as test_client:
        test_client.booking_requesters = {}  # type: ignore[attr-defined]
        request = test_client.request

        def legacy_request(method: str, url: str, *args: Any, **kwargs: Any) -> Any:
            headers = dict(kwargs.pop("headers", None) or {})
            authorization = headers.pop("Authorization", None) or headers.pop("authorization", None)
            test_client.cookies.clear()
            if authorization and authorization.lower().startswith("bearer "):
                token = authorization.split(" ", 1)[1]
                try:
                    claims = jwt.decode(token, options={"verify_signature": False})
                except jwt.PyJWTError:
                    claims = {}
                name = names["requester_access"] if claims.get("type") == "requester" else names["technician_access"]
                test_client.cookies.set(name, token)
                if method.upper() not in {"GET", "HEAD", "OPTIONS"} and claims.get("fam"):
                    headers.setdefault("X-CSRF-Token", csrf_token_for(legacy_settings, uuid.UUID(claims["fam"])))
            kwargs["headers"] = headers
            response = request(method, url, *args, **kwargs)
            test_client.cookies.clear()
            cookies = set_cookies(response)
            extra = {}
            if cookies.get(names["technician_access"]):
                extra = {
                    "access_token": cookies[names["technician_access"]],
                    "refresh_token": cookies.get(names["technician_refresh"]),
                }
            elif cookies.get(names["requester_access"]):
                extra = {
                    "session_token": cookies[names["requester_access"]],
                    "requester_refresh_token": cookies.get(names["requester_refresh"]),
                }
            if extra and "application/json" in response.headers.get("content-type", ""):
                body = response.json()
                if isinstance(body, dict):
                    response._content = json.dumps({**body, **extra}).encode("utf-8")
            if method.upper() == "POST" and url == "/requester/bookings" and response.status_code == 201:
                test_client.booking_requesters[response.json()["id"]] = {"Authorization": authorization}  # type: ignore[attr-defined]
            return response

        test_client.request = legacy_request  # type: ignore[method-assign]
        websocket_connect = test_client.websocket_connect

        def legacy_websocket_connect(url: str, *args: Any, **kwargs: Any) -> Any:
            # A websocket URL is not joined to base_url; the old paths sit under /api/v1.
            return websocket_connect(f"/api/v1{url}" if url.startswith("/") else url, *args, **kwargs)

        test_client.websocket_connect = legacy_websocket_connect  # type: ignore[method-assign]
        test_client.cookie_names = names  # type: ignore[attr-defined]
        yield test_client


@pytest.fixture
def db_session(connection: Connection) -> Iterator[Session]:
    """A session on the test's own transaction, for calling services directly."""
    session = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def sweep(db_session: Session, client: TestClient) -> Any:
    """Run one pass of the background sweeper, as it would run every few seconds."""
    from app.modules.bookings.dependencies import build_dispatch_service

    def run(now: datetime | None = None) -> Any:
        db_session.expire_all()
        return build_dispatch_service(db_session).sweep(now)

    return run


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def technician_cookie(token: str) -> dict[str, str]:
    """The technician session cookie, as a browser would send it (with its Origin)."""
    return {"cookie": f"par_at={token}", "origin": TEST_ORIGIN}


def requester_cookie(token: str) -> dict[str, str]:
    """The booking session cookie, as a browser would send it (with its Origin)."""
    return {"cookie": f"par_req_at={token}", "origin": TEST_ORIGIN}


def refresh_technician(client: TestClient, refresh_token: str) -> Any:
    """POST /auth/refresh the way the Partner page does: the refresh cookie, from Partner's origin."""
    return client.post("/auth/refresh", headers={"cookie": f"par_rt={refresh_token}", "origin": TEST_ORIGIN})


def new_password() -> str:
    """A random password that meets the rule, made fresh for each use."""
    return f"Pw-{uuid.uuid4().hex[:12]}A1"


@pytest.fixture
def onboard(client: TestClient, mailbox: RecordingEmail) -> Any:
    """Register a technician through the real API, step by step, and return the auth payload
    (the old fixture): a finished one signs in with e-mail and password and returns that
    dashboard session, keeping the registration session and the password."""

    def create(
        technician_type: str = "PAINTER",
        pincode: str = "000405",
        *,
        experience_years: int = 3,
        available: bool = True,
        name: str | None = None,
        stop_after: str | None = None,
        email: str | None = None,
    ) -> dict[str, Any]:
        email = email or f"tech-{uuid.uuid4().hex[:10]}@example.com"
        assert client.post("/auth/signup/send-code", json={"email": email}).status_code == 200
        verified = client.post(
            "/auth/signup/verify-code",
            json={"email": email, "phone": "9876543210", "code": mailbox.last_code(email)},
        )
        assert verified.status_code == 200, verified.text
        auth: dict[str, Any] = verified.json()
        headers = bearer(auth["access_token"])
        if stop_after == "email":
            return auth
        face = client.post(
            "/onboarding/face",
            headers=headers,
            data={"consent": "true"},
            files={"capture": ("face.jpg", JPEG_CAPTURE, "image/jpeg")},
        )
        assert face.status_code == 200, face.text
        if stop_after == "face":
            return auth
        aadhaar = client.post(
            "/onboarding/aadhaar", headers=headers, json={"aadhaar_number": valid_aadhaar(), "consent": True}
        )
        assert aadhaar.status_code == 200, aadhaar.text
        if stop_after == "aadhaar":
            return auth
        password = new_password()
        profile = client.post(
            "/onboarding/profile",
            headers=headers,
            json={
                "name": name or f"Test {technician_type.title()}",
                "technician_type": technician_type,
                "address": "Door 4, Market Street",
                "pincode": pincode,
                "area": AREA_OF[pincode],
                "experience_years": experience_years,
                "is_available": available,
                "password": password,
            },
        )
        assert profile.status_code == 200, profile.text
        login = client.post("/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, login.text
        session: dict[str, Any] = login.json()
        session["registration_session"] = {"access_token": auth["access_token"], "refresh_token": auth["refresh_token"]}
        session["password"] = password
        return session

    return create


FIRST_REQUESTER_PHONE = "9123456780"


@pytest.fixture
def make_requester_account(connection: Connection) -> Any:
    """A Professional account in the stand-in requester view, inside the rolled-back
    transaction. The view's requester_role is OWNER for a House Owner, SITE_ENGINEER for an
    Engineer whose category is Site Engineer, and NULL for anyone else."""
    used_phones: set[str] = set()

    def unique_phone() -> str:
        if FIRST_REQUESTER_PHONE not in used_phones:
            return FIRST_REQUESTER_PHONE
        while True:
            candidate = "9" + "".join(str(random.randint(0, 9)) for _ in range(9))  # noqa: S311
            if candidate not in used_phones:
                return candidate

    def create(
        role: str = "OWNER",
        pincode: str = "000405",
        location: str = "Alpha Main, Alpha District, Test State",
        address: str = "12-4 Main Road, Alpha Main",
        status: str = "ACTIVE",
        specialization: str | None = None,
        name: str | None = None,
    ) -> uuid.UUID:
        phone = unique_phone()
        used_phones.add(phone)
        requester_role = (
            "OWNER"
            if role == "OWNER"
            else "SITE_ENGINEER"
            if role == "ENGINEER" and specialization == "Site Engineer"
            else None
        )
        account_id = uuid.uuid4()
        connection.execute(
            text(
                f"INSERT INTO {REQUESTERS_STAND_IN} (id, name, email, phone, status, address, pincode, location, "  # noqa: S608
                "requester_role) VALUES (:id, :name, :email, :phone, :status, :address, :pincode, :location, :role)"
            ),
            {
                "id": account_id,
                "name": name or f"Test {role.title()}",
                "email": f"partner-test-{uuid.uuid4().hex}@example.com",
                "phone": phone,
                "status": status,
                "address": address,
                "pincode": pincode,
                "location": location,
                "role": requester_role,
            },
        )
        return account_id

    return create


def handoff_token(
    account_id: Any,
    token_type: str = "partner_handoff",
    minutes: int = 1,
    secret: str | None = None,
    audience: str | None = "partner",
    issuer: str = "professional",
    private_key: str | None = None,
) -> str:
    """A token in exactly the shape Professional's create_partner_handoff_token produces.
    Other `token_type`s, issuers, `secret` (HS256) or another key must all be refused."""
    now = datetime.now(UTC)
    claims: dict[str, Any] = {
        "sub": str(account_id),
        "type": token_type,
        "iss": issuer,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
        "jti": uuid.uuid4().hex,
    }
    if audience is not None:
        claims["aud"] = audience
    if secret is not None:
        return jwt.encode(claims, secret, algorithm="HS256")
    return jwt.encode(claims, private_key or TEST_HANDOFF_PRIVATE_KEY, algorithm="ES256")


@pytest.fixture
def requester_session(client: TestClient, make_requester_account: Any) -> Any:
    def start(**account: Any) -> tuple[uuid.UUID, dict[str, str]]:
        account_id = make_requester_account(**account)
        response = client.post("/requester/session", json={"handoff_token": handoff_token(account_id)})
        assert response.status_code == 200, response.text
        return account_id, bearer(response.json()["session_token"])

    return start
