"""Estimates, ads, translation and the Vastu tool. Outside services are faked."""

import io
import json
import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from identity.helpers import create_user, sign_in
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.content import estimate_location_check, translation_service
from app.modules.content import router as content_router
from app.modules.content.models import Ad, AdDailyStat
from app.modules.content.vastu.geometry import classify
from app.modules.content.vastu.labels import normalise_label
from app.modules.files.models import File

ESTIMATE = {
    "location": "Hyderabad",
    "pincode": "500001",
    "plot_area": 1000,
    "floor_type": "G+1",
    "construction_type": "CONTRACTOR",
    "building_type": "RESIDENTIAL",
    "finishing_type": "Standard",
}


# ---- estimates ----


def test_the_public_calculation_is_unchanged(client: TestClient) -> None:
    body = client.post("/api/v1/estimates/calculate", json=ESTIMATE).json()
    assert (body["rate_zone"], body["location_multiplier"]) == ("Hyderabad", 1.15)
    assert body["rate_per_sqft"] == round(2800 * 1.15)
    assert body["built_up_area"] == 2000 and body["floors"] == 2
    assert body["estimated_cost"] == pytest.approx(2000 * 3220 * 1.10)
    assert sum(stage["share"] for stage in body["construction_stages"]) == pytest.approx(1.0)
    assert sum(phase["share"] for phase in body["cost_phases"]) == pytest.approx(1.0)
    assert client.post("/api/v1/estimates/calculate", json={**ESTIMATE, "pincode": "012345"}).status_code == 400
    assert client.post("/api/v1/estimates/calculate", json={**ESTIMATE, "floor_type": "G+9"}).status_code == 400
    assert client.post("/api/v1/estimates/calculate", json={**ESTIMATE, "country": "Kuwait"}).status_code == 422


def test_the_verified_public_calculation(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def branches(pincode: str) -> list[dict[str, str]]:
        return [
            {"name": "Abids", "district": "Hyderabad", "division": "Hyderabad City", "block": "", "state": "Telangana"}
        ]

    monkeypatch.setattr(estimate_location_check, "fetch_india_pincode_branches", branches)
    request = {**ESTIMATE, "country": "India", "state": "Telangana", "city": "Hyderabad"}
    request.pop("location")
    verified = client.post("/api/v1/estimates/public-calculate", json=request)
    assert verified.status_code == 200 and verified.json()["location"] == "Hyderabad, Telangana"
    wrong_state = client.post("/api/v1/estimates/public-calculate", json={**request, "state": "Kerala"})
    assert wrong_state.status_code == 400 and wrong_state.json()["detail"]["code"] == "state_mismatch"


def test_saving_an_estimate_is_retired(client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(client)
    assert client.post("/api/v1/estimates", json=ESTIMATE, headers={"X-CSRF-Token": csrf}).status_code == 404


# ---- ads ----


def add_ad(database: Session, **values: Any) -> Ad:
    advert = Ad(
        **{
            "title": "Cement sale",
            "image_url": "https://example.in/a.png",
            "placements": "home@top",
            "scope": "IN",
            "status": "ACTIVE",
            **values,
        }
    )
    database.add(advert)
    database.commit()
    return advert


def test_the_ads_a_screen_shows(client: TestClient, database: Session) -> None:
    shown = add_ad(database)
    add_ad(database, title="Draft", status="DRAFT")
    add_ad(database, title="Ended", ends_on=date.today() - timedelta(days=1))
    add_ad(database, title="Footer", placements="home")
    console = add_ad(database, title="Console", placements="owner_dashboard@top")
    top = client.get("/api/v1/ads", params={"placement": "home", "position": "top"}).json()
    assert [advert["id"] for advert in top] == [str(shown.id)]
    assert [advert["title"] for advert in client.get("/api/v1/ads", params={"placement": "home"}).json()] == ["Footer"]
    section = client.get("/api/v1/ads", params={"placement": "owner_dashboard:newPage", "position": "top"}).json()
    assert [advert["id"] for advert in section] == [str(console.id)]
    assert client.get("/api/v1/ads", params={"placement": "nowhere"}).json() == []
    assert client.get("/api/v1/ads", params={"placement": "home", "country": "Kuwait"}).status_code == 422


def test_views_and_clicks_are_counted(client: TestClient, database: Session) -> None:
    advert = add_ad(database)
    for event in ("VIEW", "view", "CLICK", "WINK"):
        assert (
            client.post(f"/api/v1/ads/{advert.id}/event", json={"placement": "home", "event": event}).status_code == 204
        )
    stat = database.scalars(select(AdDailyStat)).one()
    assert (stat.views, stat.clicks, stat.placement) == (2, 1, "home")
    missing = client.post(f"/api/v1/ads/{uuid.uuid4()}/event", json={"placement": "home", "event": "VIEW"})
    assert missing.status_code == 404 and missing.json() == {"detail": "No such advert."}


class SigningStorage:
    def presigned_get_url(self, bucket: str, key: str, **options: Any) -> str:
        return f"https://signed.example/{bucket}/{key}"


def test_an_advert_picture_is_public_only_if_uploaded_as_one(
    client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(content_router, "shared_object_storage", lambda settings: SigningStorage())
    picture = File(
        storage_key="uploads/adverts/a/1-ad.png",
        bucket="user-images",
        filename="ad.png",
        content_type="image/png",
        size_bytes=1,
    )
    licence = File(
        storage_key="uploads/builder/b/2-licence.pdf",
        bucket="user-images",
        filename="l.pdf",
        content_type="application/pdf",
        size_bytes=1,
    )
    database.add_all([picture, licence])
    database.commit()
    advert = add_ad(database, image_url=f"/files/{picture.id}")
    listed = client.get("/api/v1/ads", params={"placement": "home", "position": "top"}).json()[0]
    assert listed["image_url"] == f"/ads/{advert.id}/image?f={picture.id}"
    client.follow_redirects = False
    redirect = client.get(f"/api/v1/ads/{advert.id}/image")
    assert redirect.status_code == 307 and redirect.headers["location"].startswith("https://signed.example/")

    leaking = add_ad(database, image_url=f"/files/{licence.id}")
    assert client.get(f"/api/v1/ads/{leaking.id}/image").status_code == 404
    typed = add_ad(database)
    assert client.get(f"/api/v1/ads/{typed.id}/image").status_code == 404
    assert client.get(f"/api/v1/ads/{uuid.uuid4()}/image").status_code == 404


def test_placements_are_listed(client: TestClient) -> None:
    keys = [placement["key"] for placement in client.get("/api/v1/ad-placements").json()]
    assert "home" in keys and "owner_dashboard:projects" in keys


# ---- translation ----


def test_translation_needs_a_session_and_a_supported_language(client: TestClient, database: Session) -> None:
    assert client.post("/api/v1/translate", json={"texts": ["Hello"], "target": "te"}).status_code == 401
    create_user(database)
    csrf = sign_in(client)
    headers = {"X-CSRF-Token": csrf}
    assert (
        client.post("/api/v1/translate", json={"texts": ["Hello"], "target": "ar"}, headers=headers).status_code == 422
    )
    english = client.post("/api/v1/translate", json={"texts": ["Hello"], "target": "en"}, headers=headers).json()
    assert english["translations"] == {"Hello": "Hello"}


class FakeProviderAnswer:
    status_code = 200

    def __init__(self, translations: list[str]) -> None:
        self.translations = translations

    def json(self) -> dict[str, Any]:
        content = json.dumps({"translations": self.translations}, ensure_ascii=False)
        return {"choices": [{"message": {"content": content}}]}


def test_translation_keeps_protected_values(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    service = translation_service.TranslationService()
    monkeypatch.setattr(translation_service, "_cache_directory", lambda: tmp_path)
    monkeypatch.setattr(type(service), "configured", property(lambda self: True))
    answers = {"3BHK villa": "3BHK విల్లా", "Call 9876543210": "కాల్"}
    calls: list[list[str]] = []

    def provider(url: str, **request: Any) -> FakeProviderAnswer:
        texts = json.loads(request["json"]["messages"][1]["content"])["texts"]
        calls.append(texts)
        return FakeProviderAnswer([answers[text] for text in texts])

    monkeypatch.setattr(translation_service.httpx, "post", provider)
    result = service.translate(["3BHK villa", "Call 9876543210", "42"], "te")
    assert result["3BHK villa"] == answers["3BHK villa"]
    assert result["Call 9876543210"] == "Call 9876543210"  # the number was dropped: answer refused
    assert result["42"] == "42"
    assert calls == [["3BHK villa", "Call 9876543210"]]
    service.translate(["3BHK villa"], "te")  # answered from the cache
    assert len(calls) == 1


# ---- Vastu ----


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def test_vastu_refuses_unusable_files_and_answers_503_without_a_provider(client: TestClient) -> None:
    url = "/api/v1/vastu/plan-analysis"
    empty = client.post(url, files={"plan": ("plan.png", b"", "image/png")})
    assert empty.status_code == 400 and empty.json()["status"] == "invalid_file"
    wrong = client.post(url, files={"plan": ("plan.gif", b"GIF89a....", "image/gif")})
    assert wrong.status_code == 415
    unavailable = client.post(url, files={"plan": ("plan.png", png_bytes(), "image/png")})
    assert unavailable.status_code == 503 and unavailable.json()["status"] == "unavailable"


def test_vastu_label_and_direction_rules() -> None:
    assert normalise_label("BEDROOM 12' X 12'").category == "genericBedroom"
    assert normalise_label("Master Bed").component == "masterBedroom"
    assert normalise_label("KITCHEN / DINING").ambiguous is True
    assert classify(44.0, 5.0).key == "ne" and classify(44.0, 5.0).uncertain is False
    assert classify(23.0, 5.0).uncertain is True
