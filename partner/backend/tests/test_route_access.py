"""Every route of the app: the reviewed public ones answer without a session, every other
one answers 401 without one (discovered from the app, so a new route is covered)."""

import re

import pytest
from conftest import ClientFactory
from fastapi.routing import APIRoute, APIWebSocketRoute
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.auth.public_routes import PUBLIC_ROUTES, is_public

# 2 health + 9 /auth + 3 /onboarding + 3 /locations + 38 /technicians/me (profile, work,
# earnings, bank account, offers, jobs, location) + 23 /requester (5 session, 2 catalog,
# 16 bookings) + 3 /tracking
EXPECTED_ROUTES = 81
SOCKETS = ("/api/v1/dispatch/ws/technician", "/api/v1/tracking/ws/bookings/{booking_id}")


def test_every_route_needs_a_session_unless_reviewed_public(make_client: ClientFactory, database: Session) -> None:
    client = make_client()
    routes = [route for route in client.app.routes if isinstance(route, APIRoute)]  # type: ignore[attr-defined]
    found = set()
    for route in routes:
        path = route.path.removeprefix("/api/v1")
        for method in route.methods:
            found.add((method, path))
            if is_public(method, path):
                continue
            concrete = re.sub(r"[{][^}]+[}]", "x", path)
            answer = client.request(method, f"/api/v1{concrete}", json={})
            assert answer.status_code == 401, (method, path, answer.status_code)
    assert found >= PUBLIC_ROUTES  # every reviewed public route exists
    assert len(found) == EXPECTED_ROUTES


def test_every_socket_refuses_a_handshake_without_a_session(make_client: ClientFactory, database: Session) -> None:
    client = make_client()
    sockets = {route.path for route in client.app.routes if isinstance(route, APIWebSocketRoute)}  # type: ignore[attr-defined]
    assert sockets == set(SOCKETS)
    for path, subprotocol in zip(SOCKETS, ("partner.dispatch.v1", "partner.tracking.v1"), strict=True):
        concrete = path.replace("{booking_id}", "01a1d46b-c840-7248-909d-eda994d7faa9")
        with pytest.raises(WebSocketDisconnect), client.websocket_connect(concrete, subprotocols=[subprotocol]):
            pass
