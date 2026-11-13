"""Live cameras: first-time setup (the recorder verified with the typed login, cameras
discovered), device and channel management, live and recorded playback through the
media gateway, the gateway's loopback callback; who may see or control a camera (the
project's House Owner, awarded builder and assigned Site Engineer, each after verifying;
the old 403/404/409 answers), and that a camera login is encrypted at rest and never in
an answer. The recorder (ONVIF) and the media gateway are faked."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import ClientFactory
from cryptography.fernet import Fernet
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from files.test_files import FakeStorage
from identity.helpers import FakeEmailSender
from labour_supply.helpers import Site, make_site, put
from projects.helpers import Person, owner, person
from projects.test_projects import detail
from sqlalchemy import select
from sqlalchemy.orm import Session
from support.test_support import build

from app.modules.cctv import router as cctv_router
from app.modules.cctv import runtime
from app.modules.cctv.models import CctvDeviceCredential
from app.modules.cctv.services import connectivity, media_gateway, network_policy
from app.modules.cctv.services import onvif_client as onvif
from app.modules.identity.models import ROLE_SUPPLIER

KEY = Fernet.generate_key().decode()
SETTINGS = {
    "camera_credentials_key": KEY,
    "cctv_media_gateway_api_url": "http://127.0.0.1:9997",
    "cctv_media_gateway_hls_url": "https://cameras.example.in",
    "cctv_media_gateway_webrtc_url": "https://cameras.example.in",
    "cctv_media_gateway_api_secret": "g" * 40,
    "cctv_reconnect_min_interval_seconds": 0,
    "cctv_reconnect_max_per_minute": 100,
}
HOST = "10.20.30.40"
PASSWORD = "Recorder#Secret9"


class FakeRecorder:
    """A two-camera DVR that answers only with the right login."""

    def __init__(self, *, host: str, credentials: Any, **_options: Any) -> None:
        self.host, self.credentials = host, credentials

    def __enter__(self) -> "FakeRecorder":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False

    def close(self) -> None:
        return None

    def sync_clock(self) -> None:
        return None

    def get_device_information(self, *, authenticated: bool = True) -> onvif.DeviceInformation:
        if not authenticated or self.credentials.password.get_secret_value() != PASSWORD:
            raise onvif.OnvifFailure(onvif.RESULT_AUTHENTICATION_FAILED, "NOT_AUTHORIZED")
        return onvif.DeviceInformation("Hikvision", "DS-7608", "V4.0", "SN-1")

    def locate_media_service(self) -> None:
        return None

    def locate_services(self) -> None:
        return None

    def get_video_sources(self) -> list[onvif.VideoSource]:
        return [onvif.VideoSource("vs1", 1920, 1080), onvif.VideoSource("vs2", 1920, 1080)]

    def get_profiles(self) -> list[onvif.MediaProfile]:
        return [
            onvif.MediaProfile("main1", "Main 1", "vs1", "Gate", "H264", 1920, 1080),
            onvif.MediaProfile("sub1", "Sub 1", "vs1", "Gate", "H264", 640, 360),
            onvif.MediaProfile("main2", "Main 2", "vs2", "Yard", "H264", 1920, 1080),
        ]

    def get_stream_uri(self, profile_token: str) -> str:
        number = 1 if profile_token.endswith("1") else 2
        subtype = 1 if profile_token.startswith("sub") else 0
        return f"rtsp://{self.host}:554/cam/realmonitor?channel={number}&subtype={subtype}"

    def recording_spans(self) -> list[onvif.RecordingSpan]:
        start = datetime(2026, 11, 12, 4, 30, tzinfo=UTC)
        return [onvif.RecordingSpan("Recordmain1", "vs1", start, start + timedelta(hours=2))]


class FakeGateway:
    def __init__(self) -> None:
        self.paths: dict[str, str] = {}

    def add_path(self, gateway_path: str, source_url: str, *, rtsp_scale: str | None = None) -> None:
        self.paths[gateway_path] = source_url

    def remove_path(self, gateway_path: str) -> bool:
        return self.paths.pop(gateway_path, None) is not None


@pytest.fixture
def gateway(monkeypatch: pytest.MonkeyPatch) -> FakeGateway:
    fake = FakeGateway()
    monkeypatch.setattr(media_gateway, "add_path", fake.add_path)
    monkeypatch.setattr(media_gateway, "remove_path", fake.remove_path)
    return fake


@pytest.fixture
def client(make_client: ClientFactory, monkeypatch: pytest.MonkeyPatch, gateway: FakeGateway) -> Any:
    monkeypatch.setattr(onvif, "OnvifClient", FakeRecorder)
    monkeypatch.setattr(connectivity, "_classify_unreachable", lambda *_args: None)
    monkeypatch.setattr(network_policy, "tcp_port_reachable", lambda *_args: True)
    monkeypatch.setattr(network_policy, "tcp_probe", lambda *_args: "OPEN")
    test_client = build(make_client, FakeEmailSender(), FakeStorage(), **SETTINGS)
    runtime.use_settings(test_client.app.state.settings)
    yield test_client
    runtime.use_settings(None)


@pytest.fixture
def site(client: TestClient, database: Session) -> Site:
    return make_site(client, database)


def setup_body(password: str = PASSWORD) -> dict[str, Any]:
    return {"device": {"host": HOST, "port": 80, "rtsp_port": 554},
            "credentials": {"username": "admin", "password": password}}  # fmt: skip


def connect(who: Person, project_id: str, password: str = PASSWORD) -> Any:
    return who.post(f"/cctv/projects/{project_id}/camera-setup", json=setup_body(password))


def channels_of(who: Person, project_id: str) -> list[dict[str, Any]]:
    devices = who.get(f"/cctv/projects/{project_id}/devices").json()
    return devices[0]["channels"]


def test_every_cctv_route_needs_a_session(client: TestClient) -> None:
    routes = [
        route
        for route in client.app.routes  # type: ignore[attr-defined]
        if isinstance(route, APIRoute) and route.endpoint.__module__ == cctv_router.__name__
    ]
    session_routes = [route for route in routes if not route.path.startswith("/api/v1/internal/")]
    assert (len(routes), len(session_routes)) == (23, 22)
    for route in session_routes:
        path = route.path
        for name in route.param_convertors:
            path = path.replace("{" + name + "}", str(uuid.uuid4()))
        for method in route.methods:
            assert client.request(method, path).status_code == 401, f"{method} {path}"
    # The gateway callback has no session; it answers 404 to anything not on this machine.
    assert client.post("/api/v1/internal/cctv/media-gateway/auth", json={"action": "api"}).status_code == 404


def test_setup_and_who_may_see_the_camera(client: TestClient, database: Session, site: Site) -> None:
    project_id = site.project_id
    status = site.owner.get(f"/cctv/projects/{project_id}/camera-setup").json()
    assert status["has_device"] is False and status["access_granted"] is False
    connected = connect(site.owner, project_id)
    assert connected.status_code == 200, connected.text
    setup = connected.json()
    assert (setup["verified"], setup["device_created"], setup["channels_discovered"]) == (True, True, 2)

    # The login is encrypted at rest and in no answer.
    stored = database.scalars(select(CctvDeviceCredential)).one()
    assert PASSWORD.encode() not in stored.password_ciphertext
    assert Fernet(KEY.encode()).decrypt(stored.password_ciphertext).decode() == PASSWORD
    listed = site.owner.get(f"/cctv/projects/{project_id}/devices")
    assert PASSWORD not in listed.text and "admin" not in listed.text and listed.json()[0]["has_credentials"]
    assert [row["name"] for row in listed.json()[0]["channels"]] == ["Gate", "Yard"]
    assert [row["project_id"] for row in site.owner.get("/cctv/projects").json()] == [project_id]

    # Each member verifies for themselves; anyone else is not told the project exists.
    unverified = site.engineer.get(f"/cctv/projects/{project_id}/devices")
    assert (unverified.status_code, detail(unverified)["code"]) == (409, "CCTV_SETUP_REQUIRED")
    wrong = connect(site.engineer, project_id, password="nope")
    assert wrong.status_code == 409 and detail(wrong)["code"] == "CCTV_SETUP_VERIFICATION_FAILED"
    assert connect(site.engineer, project_id).json()["device_created"] is False
    assert len(channels_of(site.engineer, project_id)) == 2
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    hidden = stranger.get(f"/cctv/projects/{project_id}/devices")
    assert (hidden.status_code, detail(hidden)["code"]) == (404, "CCTV_NOT_FOUND")
    stores = person(client, database, "supplier@example.in", "9876500004", ROLE_SUPPLIER)
    refused = stores.get("/cctv/projects")
    assert (refused.status_code, detail(refused)["code"]) == (403, "CCTV_ROLE_NOT_ALLOWED")
    # A validation error never echoes the request (the password included).
    bad = site.owner.post(f"/cctv/projects/{project_id}/camera-setup", json={"credentials": {"password": PASSWORD}})
    assert bad.status_code == 422 and PASSWORD not in bad.text


def test_device_and_channel_management(client: TestClient, database: Session, site: Site) -> None:
    project_id = site.project_id
    connect(site.owner, project_id)
    device = site.owner.get(f"/cctv/projects/{project_id}/devices").json()[0]
    base = f"/cctv/devices/{device['id']}"
    assert site.owner.get(base).json()["id"] == device["id"]
    assert site.owner.patch(base, json={"name": "Gate DVR"}).json()["name"] == "Gate DVR"
    renamed = put(site.owner, f"{base}/credentials", {"username": "admin", "password": PASSWORD})
    assert renamed.status_code == 200 and PASSWORD not in renamed.text
    verified = site.owner.post(f"{base}/verify")
    assert verified.json()["result"] == onvif.RESULT_DEVICE_VERIFIED, verified.text
    assert site.owner.post(f"{base}/reconnect").status_code == 200
    discovered = site.owner.post(f"{base}/channels/discover").json()
    assert len(discovered["candidates"]) == 2
    picked = {"candidate_id": discovered["candidates"][0]["candidate_id"], "channel_number": 1, "name": "Front gate"}
    saved = put(
        site.owner, f"{base}/channels/discovered", {"discovery_id": discovered["discovery_id"], "selections": [picked]}
    )
    assert saved.status_code == 200, saved.text

    channel = saved.json()["channels"][0]
    channel_base = f"/cctv/channels/{channel['id']}"
    assert site.owner.get(channel_base).json()["name"] == "Front gate"
    assert site.owner.patch(channel_base, json={"location_label": "North"}).json()["location_label"] == "North"
    assert site.owner.get(f"{channel_base}/status").json()["channel_id"] == channel["id"]
    back = {"channel_number": 3, "name": "Back", "main_stream_path": "/back", "preferred_stream": "MAIN"}
    manual = put(site.owner, f"{base}/channels", {"channels": [back]})
    assert [row["name"] for row in manual.json()["channels"]] == ["Back"], manual.text

    # Old bug kept: the management rule (owner and builder only) was never applied, so a
    # verified Site Engineer may change the recorder too, as in the old app.
    connect(site.engineer, project_id)
    assert site.engineer.patch(base, json={"name": "Engineer's name"}).status_code == 200
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    hidden = stranger.patch(base, json={"name": "Mine"})
    assert (hidden.status_code, detail(hidden)["code"]) == (404, "CCTV_NOT_FOUND")
    created = site.owner.post(f"/cctv/projects/{project_id}/devices", json={
        "name": "Second", "device_type": "NVR", "host": "10.20.30.41", "rtsp_port": 554,
        "connection_method": "MANUAL", "credentials": {"username": "admin", "password": PASSWORD}})  # fmt: skip
    assert created.status_code == 201 and PASSWORD not in created.text, created.text
    # As in the old app, a recorder is deleted only by someone who verified its own login.
    unverified = site.owner.delete(f"/cctv/devices/{created.json()['id']}")
    assert (unverified.status_code, detail(unverified)["code"]) == (409, "CCTV_SETUP_REQUIRED")
    removed = site.owner.delete(base)
    assert removed.json() == {"deleted": True, "device_id": device["id"]}, removed.text
    assert site.owner.get(base).status_code == 404
    assert site.owner.get(f"/cctv/devices/{uuid.uuid4()}").status_code == 404


def test_playback_through_the_gateway(client: TestClient, database: Session, site: Site, gateway: FakeGateway) -> None:
    project_id = site.project_id
    connect(site.owner, project_id)
    channel = channels_of(site.owner, project_id)[0]
    started = site.owner.post(f"/cctv/channels/{channel['id']}/playback", json={"transport": "LL_HLS"})
    assert started.status_code == 201, started.text
    session = started.json()
    assert session["playback_url"].startswith("https://cameras.example.in/")
    assert PASSWORD not in started.text and HOST not in started.text
    # The gateway holds the camera source (with its login); the browser never does.
    (path, source), = gateway.paths.items()  # fmt: skip
    assert source.startswith("rtsp://admin:") and HOST in source

    loopback = TestClient(LoopbackApp(client.app), base_url="http://testserver")
    callback = {"action": "read", "protocol": "hls", "path": path, "token": session["playback_token"], "ip": "10.0.0.9"}
    assert loopback.post("/api/v1/internal/cctv/media-gateway/auth", json=callback).status_code == 200
    forged = {**callback, "token": "not-the-token"}
    assert loopback.post("/api/v1/internal/cctv/media-gateway/auth", json=forged).status_code == 401
    api_call = {"action": "api", "user": "crewnbuild-backend", "password": "g" * 40}
    assert loopback.post("/api/v1/internal/cctv/media-gateway/auth", json=api_call).status_code == 200

    assert site.owner.post(f"/cctv/playback/{session['session_id']}/renew").status_code == 200
    stranger = owner(client, database, "stranger@example.in", "9876500009")
    assert stranger.post(f"/cctv/playback/{session['session_id']}/renew").status_code == 404
    ended = site.owner.delete(f"/cctv/playback/{session['session_id']}")
    assert ended.json()["status"] == "ENDED", ended.text
    assert gateway.paths == {}

    # Recorded playback: the recorder's own recordings, searched in local time.
    window = {"start": "2026-11-12T09:00:00", "end": "2026-11-12T13:00:00"}
    found = site.owner.post(f"/cctv/channels/{channel['id']}/recordings/search", json=window)
    assert found.status_code == 200 and len(found.json()["segments"]) == 1, found.text
    recorded = site.owner.post(f"/cctv/channels/{channel['id']}/recordings/playback",
                               json={"start": "2026-11-12T10:00:00", "end": "2026-11-12T10:30:00"})  # fmt: skip
    assert recorded.status_code == 201, recorded.text


class LoopbackApp:
    """The app as a caller on this machine sees it (the gateway's callback)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        await self.app({**scope, "client": ("127.0.0.1", 40000)}, receive, send)
