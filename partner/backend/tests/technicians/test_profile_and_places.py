"""Routes the old suite never called: the technician's own profile edit and photo, and the
place lookups behind the booking map and the weather card. The geocoder is a stub."""

import pytest
from legacy import AREA_OF, bearer

from app.modules.locations.geocoding_service import get_geocoding_service

PNG = b"\x89PNG\r\n\x1a\n" + bytes(64)


class StubGeocoder:
    def __init__(self) -> None:
        self.described: list[tuple[float, float]] = []

    def describe(self, latitude: float, longitude: float) -> str:
        self.described.append((latitude, longitude))
        return "Alpha Main, Alpha District"

    def search(self, query: str, near: object = None) -> list:
        return []


@pytest.fixture
def geocoder(client):
    stub = StubGeocoder()
    client.app.dependency_overrides[get_geocoding_service] = lambda: stub
    yield stub
    client.app.dependency_overrides.pop(get_geocoding_service, None)


def test_a_technician_edits_only_what_they_send(client, onboard):
    technician = onboard()
    headers = bearer(technician["access_token"])
    changed = client.patch(
        "/technicians/me",
        headers=headers,
        json={"name": "Renamed Painter", "pincode": "000301", "area": AREA_OF["000301"]},
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert (body["name"], body["pincode"]) == ("Renamed Painter", "000301")
    assert body["email"] == technician["user"]["email"]
    # An area that does not belong to the pincode is refused.
    wrong = client.patch("/technicians/me", headers=headers, json={"pincode": "000301", "area": "Nowhere"})
    assert wrong.status_code == 422


def test_a_profile_photo_is_stored_under_a_random_name(client, onboard):
    technician = onboard()
    headers = bearer(technician["access_token"])
    saved = client.post(
        "/technicians/me/profile-image", headers=headers, files={"file": ("../../me.png", PNG, "image/png")}
    )
    assert saved.status_code == 200, saved.text
    url = saved.json()["profile_image_url"]
    assert url.endswith(".png") and "me.png" not in url and ".." not in url
    refused = client.post(
        "/technicians/me/profile-image", headers=headers, files={"file": ("x.png", b"not an image", "image/png")}
    )
    assert refused.status_code == 422


def test_the_booking_map_names_a_dropped_pin(client, requester_session, geocoder):
    _account, headers = requester_session()
    answer = client.get("/locations/describe", headers=headers, params={"lat": 17.45, "lng": 78.39})
    assert answer.status_code == 200
    assert answer.json() == {"name": "Alpha Main, Alpha District"}
    assert client.get("/locations/describe", headers=headers, params={"lat": 91, "lng": 0}).status_code == 422


def test_the_registered_location_is_null_when_it_cannot_be_placed(client, requester_session, geocoder):
    _account, headers = requester_session()
    answer = client.get("/requester/me/registered-location", headers=headers)
    assert answer.status_code == 200
    assert answer.json() is None


def test_the_weather_card_names_the_device_position(client, onboard, geocoder):
    technician = onboard()
    answer = client.get(
        "/technicians/me/weather/describe",
        headers=bearer(technician["access_token"]),
        params={"lat": 17.45, "lng": 78.39},
    )
    assert answer.status_code == 200
    assert answer.json() == {"name": "Alpha Main, Alpha District"}
    assert geocoder.described == [(17.45, 78.39)]
