"""Every route of the app: the reviewed public ones answer without a session, every other
one answers 401 without one (discovered from the app, so a new route is covered)."""

from conftest import ClientFactory
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.auth.public_routes import PUBLIC_ROUTES, is_public


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
            answer = client.request(method, f"/api/v1{path}", json={})
            assert answer.status_code == 401, (method, path, answer.status_code)
    assert found >= PUBLIC_ROUTES  # every reviewed public route exists
    assert len(found) == 17  # 2 health + 9 /auth + 1 /technicians/me/password + 5 /requester
