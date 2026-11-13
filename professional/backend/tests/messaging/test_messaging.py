"""Messaging: conversations and messages (start, send, edit, read, search), the chat
socket and the live-events socket (session cookie and Origin at the handshake; only a
conversation's participants), the notification bell, and what messaging unblocks
elsewhere (chat cards from projects and property, attachments in file access)."""

import json
import uuid
from typing import Any

import pytest
from conftest import ClientFactory, app_routes
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import PNG, FakeStorage
from identity.helpers import FakeEmailSender
from projects.helpers import Person, builder, create_project, owner
from projects.test_projects import detail
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect
from support.test_support import build

from app.modules.messaging import router as messaging_router
from app.modules.messaging.models import Message, Notification

ORIGIN = "http://localhost:5173"


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


def socket(who: Person, path: str, origin: str = ORIGIN) -> Any:
    return who.browser.websocket_connect(f"/api/v1{path}", headers={"origin": origin})


def refused(who: Person | TestClient, path: str, origin: str = ORIGIN) -> int:
    browser = who.browser if isinstance(who, Person) else who
    # The close arrives on the first read.
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        browser.websocket_connect(f"/api/v1{path}", headers={"origin": origin}) as connection,
    ):
        connection.receive_json()
    return closed.value.code


def start(sender: Person, receiver: Person) -> str:
    started = sender.post("/messages/start", json={"receiver_id": str(receiver.user.id)})
    assert started.status_code == 200, started.text
    return started.json()["id"]


def test_every_messaging_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in app_routes(client.app)
        if isinstance(route, APIRoute) and route.endpoint.__module__ == messaging_router.__name__
    ]
    assert len(routes) == 9
    for route in routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"
    # The sockets refuse a handshake without a session.
    assert refused(client, f"/messages/ws/{uuid.uuid4()}") == 1008
    assert refused(client, "/events/ws") == 1008


def test_conversations_and_messages(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    conversation_id = start(house_owner, house_builder)
    assert start(house_owner, house_builder) == conversation_id  # the same direct conversation
    assert detail(house_owner.post("/messages/start", json={"receiver_id": str(house_owner.user.id)})) == (
        "Cannot start a conversation with yourself"
    )
    assert house_owner.post("/messages/start", json={"receiver_id": str(uuid.uuid4())}).status_code == 404

    sent = house_owner.post("/messages/send", json={"conversation_id": conversation_id, "body": "Hello builder"})
    assert sent.status_code == 200, sent.text
    message = sent.json()
    assert (message["body"], message["is_mine"], message["delivered"]) == ("Hello builder", True, False)
    assert message["createdAt"].endswith("+05:30")
    # The receiver had no open socket: they get the chat notice, kept out of the bell list.
    notice = database.scalars(select(Notification).where(Notification.user_id == house_builder.user.id)).one()
    assert (notice.title, notice.category) == ("New message", "MESSAGE")
    assert house_builder.get("/notifications").json() == []

    inbox = house_builder.get("/messages/conversations").json()
    assert [(row["id"], row["unread_count"], row["latest_message"]) for row in inbox] == [
        (conversation_id, 1, "Hello builder")
    ]
    page = house_builder.get(f"/messages/conversation/{conversation_id}").json()
    assert [row["body"] for row in page] == ["Hello builder"] and page[0]["read"] is True
    assert house_builder.get("/messages/conversations").json()[0]["unread_count"] == 0
    assert house_builder.get(f"/messages/conversation/{conversation_id}", params={"search": "builder"}).json()

    edit = f"/messages/{message['id']}"
    not_mine = house_builder.browser.put(f"/api/v1{edit}", headers=house_builder.headers, json={"body": "x"})
    assert (not_mine.status_code, detail(not_mine)) == (403, "Only the sender can edit this message")
    edited = house_owner.browser.put(f"/api/v1{edit}", headers=house_owner.headers, json={"body": "Hello again"})
    assert (edited.json()["body"], edited.json()["edited"]) == ("Hello again", True)
    assert house_owner.browser.put(f"/api/v1/messages/{uuid.uuid4()}", headers=house_owner.headers,
                                   json={"body": "x"}).status_code == 404  # fmt: skip

    # Only participants reach a conversation.
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    denied = stranger.get(f"/messages/conversation/{conversation_id}")
    assert (denied.status_code, detail(denied)) == (403, "Conversation access denied")
    denied = stranger.post("/messages/send", json={"conversation_id": conversation_id, "body": "Hi"})
    assert (denied.status_code, detail(denied)) == (403, "Conversation access denied")
    assert (
        detail(house_owner.post("/messages/send", json={"body": "Hi"})) == "conversation_id or receiver_id is required"
    )
    assert detail(house_owner.post("/messages/send", json={"conversation_id": conversation_id, "body": " "})) == (
        "Message body or attachment is required"
    )
    by_receiver = stranger.post("/messages/send", json={"receiver_id": str(house_owner.user.id), "body": "New chat"})
    assert by_receiver.status_code == 200 and by_receiver.json()["conversation_id"] != conversation_id

    # Wired back into file access: an attachment opens to the conversation, not others.
    upload = house_owner.browser.post(
        "/api/v1/files/upload", files={"file": ("plan.png", PNG, "image/png")}, headers=house_owner.headers
    )
    address = upload.json()["url"]
    attached = house_owner.post(
        "/messages/send", json={"conversation_id": conversation_id, "body": "Plan", "attachment_url": address}
    )
    assert attached.json()["attachment_url"] == address, attached.text  # type stays TEXT, as before
    assert house_builder.get(address).status_code == 200
    assert stranger.get(address).status_code == 403
    free_url = house_owner.post(
        "/messages/send", json={"conversation_id": conversation_id, "body": "x", "attachment_url": "http://evil/x"}
    )
    assert (free_url.status_code, detail(free_url)) == (422, "Attachment must be a file you uploaded.")


def test_the_chat_socket(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    conversation_id = start(house_owner, house_builder)
    house_owner.post("/messages/send", json={"conversation_id": conversation_id, "body": "Waiting for you"})
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    assert refused(stranger, f"/messages/ws/{conversation_id}") == 1008  # not a participant
    assert refused(house_builder, f"/messages/ws/{conversation_id}", origin="https://evil.example") == 1008
    with socket(house_builder, f"/messages/ws/{conversation_id}") as chat:
        connected = chat.receive_json()
        assert connected["event"] == "connected"
        assert [row["body"] for row in connected["messages"]] == ["Waiting for you"]
        chat.send_json({"event": "ping"})
        assert chat.receive_json() == {"event": "pong"}
        chat.send_json({"event": "message", "body": "On my way"})
        echoed = chat.receive_json()
        assert (echoed["event"], echoed["message"]["body"], echoed["message"]["is_mine"]) == (
            "message",
            "On my way",
            True,
        )
        chat.send_json({"event": "message", "body": " "})
        assert chat.receive_json() == {"event": "error", "detail": "Message body or attachment is required"}
        chat.send_json({"event": "dance"})
        assert chat.receive_json() == {"event": "error", "detail": "Unsupported websocket event"}
    # The backlog reached the builder's socket: the owner's message is delivered.
    first = database.scalars(select(Message).where(Message.body == "Waiting for you")).one()
    database.refresh(first)
    assert first.delivered_at is not None
    page = house_owner.get(f"/messages/conversation/{conversation_id}").json()
    assert [row["body"] for row in page] == ["Waiting for you", "On my way"]


def test_live_hints_and_the_bell(client: TestClient, database: Session) -> None:
    house_owner, house_builder = owner(client, database), builder(client, database)
    project_id = create_project(house_owner)["id"]
    with socket(house_builder, "/events/ws") as events:
        events.send_json({"event": "ping"})
        assert events.receive_json() == {"event": "pong"}
        sent = house_owner.post(
            "/project-requests/send",
            json={"receiver_id": str(house_builder.user.id), "project_id": project_id,
                  "request_type": "OWNER_TO_CONTRACTOR"},
        )  # fmt: skip
        assert sent.status_code == 200, sent.text
        # Wired back (#38): the committed request tells the builder's open dashboard.
        assert events.receive_json() == {"event": "requests_changed"}

    # Wired back (#47): the request's card is in the conversation, contact withheld.
    inbox = house_builder.get("/messages/conversations").json()
    assert inbox[0]["latest_message"].startswith("REQUEST: owner sent a request for Rao Residence")
    card = house_builder.get(f"/messages/conversation/{inbox[0]['id']}").json()[0]
    body = json.loads(card["body"])
    assert (card["message_type"], body["status"], body["sender_phone"]) == ("REQUEST", "pending", "")

    bell = house_builder.get("/notifications").json()
    assert bell and bell[0]["module"] == "request" and bell[0]["created_at"].endswith("+05:30")
    one = bell[0]["id"]
    assert house_owner.post(f"/notifications/{one}/read").status_code == 404  # another account's
    assert house_builder.post(f"/notifications/{one}/read").json() == {"status": "read", "id": one}
    assert detail(house_builder.post("/notifications/read-module")) == "Give a module or a category."
    module = house_builder.post("/notifications/read-module", params={"category": "negotiation"}).json()
    assert module == {"status": "read", "module": None, "category": ["NEGOTIATION"]}
    assert house_builder.post("/notifications/read-all").json() == {"status": "read"}
    assert all(row["is_read"] for row in house_builder.get("/notifications").json())
