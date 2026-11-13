"""The booking map's search box: what reaches Nominatim and what comes back.

Nominatim is stubbed throughout -- these tests never leave the machine.
"""

import pytest

from app.core.runtime import settings
from app.modules.locations import geocoding_service as geocoding
from app.modules.locations.geocoding_service import GeocodingService, _relaxations


def hit(name, lat=17.46, lon=78.36):
    return {"display_name": name, "lat": str(lat), "lon": str(lon)}


@pytest.fixture
def nominatim(monkeypatch):
    """A GeocodingService whose Nominatim answers from `answers`, keyed by the
    q it was asked, and which records every request it was sent."""
    monkeypatch.setattr(geocoding, "MIN_REQUEST_INTERVAL_SECONDS", 0)
    service = GeocodingService()
    service.answers = {}
    service.requests = []

    def fake_get(path, params):
        service.requests.append(dict(params))
        return service.answers.get(params["q"].casefold(), [])

    monkeypatch.setattr(service, "_get", fake_get)
    return service


def test_asks_for_twenty_places_in_india(nominatim):
    nominatim.search_typed("Kondapur")
    params = nominatim.requests[0]
    assert params["limit"] == settings.geocoder_max_results == 20
    assert params["countrycodes"] == "in"


def test_every_kind_of_place_is_kept(nominatim):
    nominatim.answers["kondapur"] = [
        hit("Kondapur, Hyderabad (suburb)"),
        hit("Kondapur, Siddipet (village)"),
        hit("Kondapur Road (street)"),
        hit("Kondapur Metro Station (landmark)"),
        hit("500084, Kondapur (postcode)"),
    ]
    places, matched = nominatim.search_typed("Kondapur")
    assert [place.name for place in places] == [item["display_name"] for item in nominatim.answers["kondapur"]]
    assert matched is None


def test_same_named_segments_of_one_road_are_listed_once(nominatim):
    nominatim.answers["inorbit mall road"] = [
        hit("Inorbit Mall Road, Madhapur", 17.43, 78.38),
        hit("Inorbit Mall Road, Madhapur", 17.44, 78.39),
        hit("Inorbit Mall Cyberabad, Madhapur", 17.43, 78.38),
    ]
    places, _ = nominatim.search_typed("Inorbit Mall Road")
    assert [place.name for place in places] == ["Inorbit Mall Road, Madhapur", "Inorbit Mall Cyberabad, Madhapur"]
    assert (places[0].latitude, places[0].longitude) == (17.43, 78.38)  # the first one's own point


def test_a_result_without_coordinates_is_dropped(nominatim):
    nominatim.answers["tadoor"] = [{"display_name": "Tadoor, broken"}, hit("Tadoor, Nagarkurnool", 16.5, 78.1)]
    places, _ = nominatim.search_typed("Tadoor")
    assert [(place.name, place.latitude) for place in places] == [("Tadoor, Nagarkurnool", 16.5)]


def test_an_unmapped_apartment_falls_back_to_its_area(nominatim):
    nominatim.answers["kondapur"] = [hit("Kondapur, Hyderabad")]
    places, matched = nominatim.search_typed("Flat 302 Sri Sai Residency Kondapur")
    assert [place.name for place in places] == ["Kondapur, Hyderabad"]
    assert matched == "Kondapur"


def test_a_comma_address_drops_one_part_at_a_time(nominatim):
    nominatim.answers["road no 5, kondapur, hyderabad"] = [hit("Road No 5, Kondapur, Hyderabad")]
    places, matched = nominatim.search_typed("Flat 302, Sri Sai Residency, Road No 5, Kondapur, Hyderabad")
    assert matched == "Road No 5, Kondapur, Hyderabad"
    assert places[0].name == "Road No 5, Kondapur, Hyderabad"


def test_retries_are_capped(nominatim):
    nominatim.search_typed("Flat 9, Alpha, Beta, Gamma, Delta, Epsilon, Zeta")
    # The typed text once, then at most MAX_RELAXED_SEARCHES broader versions.
    assert len(nominatim.requests) == 1 + geocoding.MAX_RELAXED_SEARCHES


def test_a_fallback_with_a_pincode_stays_inside_that_pincode(nominatim):
    nominatim.answers["500084, india"] = [hit("500084, Hyderabad", 17.47, 78.35)]
    nominatim.answers["kondapur"] = [hit("Kondapur, Hyderabad")]
    places, matched = nominatim.search_typed("Flat 302 Sri Sai Residency Kondapur 500084")
    assert matched == "Kondapur, 500084"
    confined = [params for params in nominatim.requests if params["q"] == "Kondapur"]
    assert confined and confined[-1]["bounded"] == 1 and "viewbox" in confined[-1]


def test_a_found_search_is_not_retried(nominatim):
    nominatim.answers["charminar"] = [hit("Charminar, Hyderabad")]
    places, matched = nominatim.search_typed("Charminar")
    assert matched is None and len(nominatim.requests) == 1


def test_a_pincode_alone_is_a_single_plain_search(nominatim):
    nominatim.answers["500081"] = [hit("500081, Kondapur, Hyderabad")]
    places, matched = nominatim.search_typed("500081")
    assert [place.name for place in places] == ["500081, Kondapur, Hyderabad"] and matched is None
    assert len(nominatim.requests) == 1


def test_nothing_anywhere_answers_nothing(nominatim):
    assert nominatim.search_typed("Qwzxv Plkjh") == ([], None)


@pytest.mark.parametrize(
    "typed, expected",
    [
        # "Residency Kondapur" would find some other residency: skipped for the area.
        ("Flat 302 Sri Sai Residency Kondapur", ["Sri Sai Residency Kondapur", "Kondapur"]),
        ("Flat 3 Sai Residency Jubilee Hills", ["Sai Residency Jubilee Hills", "Jubilee Hills", "Hills"]),
        ("Plot No. 12, Kondapur, Hyderabad", ["Kondapur, Hyderabad", "Hyderabad"]),
        ("H.No 1-2-3/4, Madhapur", ["Madhapur"]),
        ("Kondapur", []),
    ],
)
def test_relaxations(typed, expected):
    assert _relaxations(typed) == expected


def test_search_endpoint_reports_the_broader_match(client, requester_session, monkeypatch):
    from app.modules.locations.geocoding_service import geocoding_service

    monkeypatch.setattr(
        geocoding_service,
        "search_typed",
        lambda q: ([geocoding.Place("Kondapur, Hyderabad", 17.46, 78.36)], "Kondapur"),
    )
    _account, headers = requester_session()
    response = client.get("/locations/search", params={"q": "Flat 302 Kondapur"}, headers=headers)
    assert response.status_code == 200
    assert response.json() == {
        "results": [{"name": "Kondapur, Hyderabad", "latitude": 17.46, "longitude": 78.36}],
        "matched": "Kondapur",
    }
