"""Support tickets, reports and the contact form. E-mail and S3 are faked."""

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from conftest import ClientFactory
from fastapi import Depends
from fastapi.testclient import TestClient
from files.test_files import BUCKETS, PNG, FakeStorage
from identity.helpers import FakeEmailSender, create_user, service_overrides, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.modules.accounts.models import BuilderProfile
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService
from app.modules.identity.models import ROLE_BUILDER
from app.modules.messaging.models import Notification
from app.modules.support import router as support_router
from app.modules.support import ticket_service
from app.modules.support.models import STATUS_CLOSED, STATUS_WAITING_FOR_USER, SupportTicket


@pytest.fixture(autouse=True)
def fresh_limits() -> Iterator[None]:
    ticket_service.reset_rate_limit()
    support_router.reset_contact_rate_limit()
    yield


@pytest.fixture
def mailbox() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


def build(make_client: ClientFactory, mailbox: FakeEmailSender, storage: FakeStorage, **settings: Any) -> TestClient:
    client = make_client(
        overrides=service_overrides(email=mailbox),
        **{**BUCKETS, "support_email": "help@example.in", "contact_destination_email": "hello@example.in", **settings},
    )
    app_settings = client.app.state.settings  # type: ignore[attr-defined]

    def fake_uploads(database: Session = Depends(get_db)) -> UploadService:
        return UploadService(database, app_settings, storage)  # type: ignore[arg-type]

    client.app.dependency_overrides[get_upload_service] = fake_uploads  # type: ignore[attr-defined]
    return client


@pytest.fixture
def client(make_client: ClientFactory, mailbox: FakeEmailSender, storage: FakeStorage) -> TestClient:
    return build(make_client, mailbox, storage)


def submission(**changes: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "client_request_id": str(uuid.uuid4()),
        "account_type": "HOMEOWNER",
        "category": "PAYMENTS",
        "issue_type": "PAYMENT_FAILURE",
        "description": "My payment failed twice today.",
        "details": {"transaction_reference": "TXN-1", "unknown": "dropped"},
        "contact": {"name": "Visitor", "email": "visitor@example.in", "dial_code": "+91", "phone": "+91 98765 43210"},
    }
    values.update(changes)
    return values


def submit(client: TestClient, payload: dict[str, Any], headers: dict[str, str] | None = None, **files: Any) -> Any:
    return client.post(
        "/api/v1/support/tickets", data={"payload": json.dumps(payload)}, files=files or None, headers=headers or {}
    )


def test_config_is_public_and_knows_a_signed_in_builder(client: TestClient, database: Session) -> None:
    config = client.get("/api/v1/support/config").json()
    assert config["tickets_available"] is True
    assert config["contact"]["email"] == "help@example.in"
    assert "account" not in config
    create_user(database, role=ROLE_BUILDER, phone="9876543210")
    sign_in(client)
    account = client.get("/api/v1/support/config").json()["account"]
    assert account == {
        "name": "Asha Rao",
        "email": "asha@example.in",
        "phone": "9876543210",
        "dial_code": "+91",
        "account_type": "BUILDER",
    }


def test_a_visitor_files_a_ticket_once(client: TestClient, database: Session, mailbox: FakeEmailSender) -> None:
    payload = submission()
    first = submit(client, payload)
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["created"] is True and body["signed_in"] is False
    assert body["reference"] == "CNB-000001" or body["reference"].startswith("CNB-")
    assert body["created_at"].endswith("Z")
    stored = database.scalars(select(SupportTicket)).one()
    assert stored.details == {"transaction_reference": "TXN-1"}
    assert (stored.contact_phone, stored.contact_dial_code) == ("9876543210", "+91")
    assert {message["to"] for message in mailbox.sent} == {"visitor@example.in", "help@example.in"}

    again = submit(client, payload)
    assert again.status_code == 200 and again.json()["created"] is False
    assert again.json()["reference"] == body["reference"]


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"account_type": "ALIEN"}, "account_type"),
        ({"category": "LEADS"}, "category"),
        ({"issue_type": "NOPE"}, "issue_type"),
        ({"description": "short"}, "description"),
        ({"priority": "URGENT"}, "priority"),
        ({"contact": {"name": "V", "email": "not-an-email"}}, "contact.email"),
        (
            {"contact": {"name": "V", "email": "v@example.in", "dial_code": "+44", "phone": "7700900123"}},
            "contact.dial_code",
        ),
    ],
)
def test_choices_are_validated(client: TestClient, database: Session, changes: dict[str, Any], field: str) -> None:
    response = submit(client, submission(**changes))
    assert response.status_code == 422
    assert ".".join(response.json()["detail"][0]["loc"][1:]) == field


def test_a_signed_in_ticket_uses_the_account_and_allows_one_urgent(client: TestClient, database: Session) -> None:
    user = create_user(database, phone="9876543210")
    csrf = sign_in(client)
    headers = {"X-CSRF-Token": csrf}
    response = submit(client, submission(priority="URGENT", contact={}), headers)
    assert response.status_code == 201, response.text
    stored = database.scalars(select(SupportTicket)).one()
    assert (stored.user_id, stored.contact_name, stored.contact_email) == (user.id, "Asha Rao", "asha@example.in")
    assert database.scalars(select(Notification)).one().title == "Support ticket received"
    second = submit(client, submission(priority="URGENT"), headers)
    assert second.status_code == 422
    assert second.json()["detail"][0]["msg"].startswith("You already have an urgent ticket open")


def test_another_account_cannot_reuse_a_request_id(client: TestClient, database: Session) -> None:
    payload = submission()
    assert submit(client, payload).status_code == 201
    create_user(database)
    csrf = sign_in(client)
    assert submit(client, payload, {"X-CSRF-Token": csrf}).status_code == 409


def test_the_own_ticket_conversation(client: TestClient, database: Session, storage: FakeStorage) -> None:
    create_user(database)
    csrf = sign_in(client)
    headers = {"X-CSRF-Token": csrf}
    reference = submit(client, submission(), headers, attachment=("receipt.png", PNG, "image/png")).json()["reference"]

    listed = client.get("/api/v1/support/tickets").json()["tickets"]
    assert [ticket["reference"] for ticket in listed] == [reference]
    detail = client.get(f"/api/v1/support/tickets/{reference.lower()}").json()
    assert detail["attachment"] == {"name": "receipt.png", "content_type": "image/png"}
    attachment = client.get(f"/api/v1/support/tickets/{reference}/attachment")
    assert attachment.status_code == 200 and attachment.content == PNG
    assert attachment.headers["cache-control"] == "private, no-store"

    ticket = database.scalars(select(SupportTicket)).one()
    ticket.status = STATUS_WAITING_FOR_USER
    database.commit()
    replied = client.post(
        f"/api/v1/support/tickets/{reference}/messages", json={"body": "Here it is."}, headers=headers
    )
    assert replied.json()["status"] == "IN_PROGRESS"
    assert [message["author_label"] for message in replied.json()["messages"]] == ["You"]

    ticket.status = STATUS_CLOSED
    database.commit()
    closed = client.post(f"/api/v1/support/tickets/{reference}/messages", json={"body": "More"}, headers=headers)
    assert closed.status_code == 409


def test_someone_elses_ticket_is_not_found(client: TestClient, database: Session) -> None:
    create_user(database, email="owner@example.in", phone="9876500001")
    csrf = sign_in(client, identifier="owner@example.in")
    reference = submit(client, submission(), {"X-CSRF-Token": csrf}).json()["reference"]
    client.post("/api/v1/auth/logout")
    create_user(database, email="other@example.in", phone="9876500002")
    sign_in(client, identifier="other@example.in")
    assert client.get(f"/api/v1/support/tickets/{reference}").status_code == 404


def test_tickets_are_rate_limited(
    make_client: ClientFactory, mailbox: FakeEmailSender, storage: FakeStorage, database: Session
) -> None:
    client = build(make_client, mailbox, storage, support_max_tickets_per_hour=1)
    assert submit(client, submission()).status_code == 201
    assert submit(client, submission()).status_code == 429


def test_an_unpaid_builder_still_reaches_support(client: TestClient, database: Session) -> None:
    builder = create_user(database, role=ROLE_BUILDER)
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    profile.signup_plan_code, profile.signup_duration_code = "BUSINESS", "ANNUAL"
    database.commit()
    sign_in(client)
    assert client.get("/api/v1/support/tickets").status_code == 200


def test_reports(client: TestClient, database: Session) -> None:
    assert client.get("/api/v1/report-categories").json()["categories"][0] == "WORK_QUALITY"
    reporter = create_user(database, email="reporter@example.in", phone="9876500001")
    subject = create_user(database, email="subject@example.in", phone="9876500002", name="Ravi")
    csrf = sign_in(client, identifier="reporter@example.in")
    headers = {"X-CSRF-Token": csrf}
    report = {
        "subject_type": "user",
        "subject_id": str(subject.id),
        "category": "conduct",
        "description": "Was rude on site.",
    }
    created = client.post("/api/v1/reports", json=report, headers=headers)
    assert created.status_code == 201, created.text
    assert created.json()["subject_name"] == "Ravi (OWNER)" and created.json()["scope"] == "IN"
    assert created.json()["reporter_email"] == reporter.email

    own = client.post("/api/v1/reports", json={**report, "subject_id": str(reporter.id)}, headers=headers)
    assert own.status_code == 400
    project = client.post(
        "/api/v1/reports", json={**report, "subject_type": "project", "subject_id": "1"}, headers=headers
    )
    assert project.status_code == 404
    assert len(client.get("/api/v1/reports/mine").json()["reports"]) == 1


def test_the_contact_form(
    make_client: ClientFactory, mailbox: FakeEmailSender, storage: FakeStorage, database: Session
) -> None:
    enquiry = {"name": "Meena", "email": "meena@example.in", "message": "Do you build in Pune?", "city": "Pune"}
    client = build(make_client, mailbox, storage, contact_max_per_hour_per_ip=1)
    accepted = client.post("/api/v1/contact", json=enquiry)
    assert accepted.status_code == 202 and accepted.json() == {"accepted": True}
    assert mailbox.sent[-1]["to"] == "hello@example.in"
    assert "City:     Pune" in mailbox.sent[-1]["text"]
    assert client.post("/api/v1/contact", json=enquiry).status_code == 429

    support_router.reset_contact_rate_limit()
    mailbox.configured = False
    assert client.post("/api/v1/contact", json=enquiry).status_code == 503
    unconfigured = build(make_client, FakeEmailSender(), storage, contact_destination_email="")
    assert unconfigured.post("/api/v1/contact", json=enquiry).status_code == 503
