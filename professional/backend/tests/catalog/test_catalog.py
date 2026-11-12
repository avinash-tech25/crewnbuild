"""The master catalog: the seed (row counts, safe to run again, delete rules), the
signed-in reader and Admin > Master Catalog. S3 is faked."""

import uuid
from typing import Any

import pytest
from admin.helpers import create_admin, create_global_admin, signed_in, whatsapp_signed_in
from conftest import ClientFactory
from fastapi.testclient import TestClient
from files.test_files import MP4, PNG, FakeStorage
from identity.helpers import WHATSAPP_SETTINGS, FakeEmailSender, FakeWhatsApp, create_user, service_overrides
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from support.test_support import build

from app.database.session import engine
from app.modules.admin.models import AdminAuditLog
from app.modules.catalog import catalog_service
from app.modules.catalog.models import (
    CatalogBrand,
    CatalogCategory,
    CatalogProduct,
    CatalogProductMedia,
    CatalogProductVariant,
    CatalogSubcategory,
    CatalogUnit,
)
from app.modules.identity.models import ROLE_SUPPLIER
from app.seeds.seed_master_catalog import run

SEEDED = {
    CatalogUnit: 6,
    CatalogBrand: 21,
    CatalogCategory: 2,
    CatalogSubcategory: 24,
    CatalogProduct: 76,
    CatalogProductVariant: 398,
    CatalogProductMedia: 0,
}


@pytest.fixture
def seeded(database: Session) -> list[str]:
    return run(engine)


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return build(make_client, FakeEmailSender(), FakeStorage())


def count(database: Session, model: Any) -> int:
    return database.scalar(select(func.count()).select_from(model)) or 0


def test_the_seed_loads_the_old_catalog_once(seeded: list[str], database: Session) -> None:
    assert seeded[-1] == "Done: 527 row(s) added, 0 already existed (left unchanged)."
    assert {model: count(database, model) for model in SEEDED} == SEEDED
    again = run(engine)
    assert again[-1] == "Done: 0 row(s) added, 129 already existed (left unchanged)."
    assert {model: count(database, model) for model in SEEDED} == SEEDED
    assert any(message.startswith("CHECK 10-12 ok") for message in again)


def test_the_seed_keeps_admin_edits(seeded: list[str], database: Session) -> None:
    product = database.scalars(select(CatalogProduct).order_by(CatalogProduct.slug)).first()
    assert product is not None
    product.name = "Renamed by the admin"
    database.commit()
    run(engine)
    database.expire_all()
    assert database.get(CatalogProduct, product.id).name == "Renamed by the admin"


def test_the_delete_rules_follow_the_seed(database: Session) -> None:
    rows = database.execute(
        text(
            "SELECT tc.table_name, kcu.column_name, rc.delete_rule FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name "
            "AND kcu.table_schema = tc.table_schema "
            "JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name "
            "AND rc.constraint_schema = tc.table_schema "
            "WHERE tc.table_schema = 'professional' AND tc.table_name LIKE 'catalog\\_%' "
            "AND tc.constraint_type = 'FOREIGN KEY'"
        )
    ).all()
    assert {(table, column): rule for table, column, rule in rows} == {
        ("catalog_subcategories", "category_id"): "RESTRICT",
        ("catalog_products", "subcategory_id"): "RESTRICT",
        ("catalog_products", "brand_id"): "RESTRICT",
        ("catalog_products", "unit_id"): "RESTRICT",
        ("catalog_products", "created_by_user_id"): "SET NULL",
        ("catalog_product_variants", "product_id"): "CASCADE",
        ("catalog_product_variants", "unit_id"): "RESTRICT",
        ("catalog_product_media", "product_id"): "CASCADE",
        ("catalog_product_media", "variant_id"): "CASCADE",
        ("catalog_product_media", "file_id"): "SET NULL",
    }


def test_the_reader_cascade(seeded: list[str], client: TestClient, database: Session) -> None:
    create_user(database)
    reader, _ = signed_in(client, "asha@example.in")
    categories = reader.get("/api/v1/catalog/categories").json()
    assert [row["slug"] for row in categories] == ["steel", "cement"]  # by the seed's sort_order
    cement = categories[1]["id"]
    subcategories = reader.get("/api/v1/catalog/subcategories", params={"category_id": cement}).json()
    assert len(subcategories) == 4
    brands = reader.get("/api/v1/catalog/brands", params={"category_id": cement}).json()
    assert {row["slug"] for row in brands} >= {"ultratech", "acc"}
    assert "tata-tiscon" not in {row["slug"] for row in brands}
    units = reader.get("/api/v1/catalog/units").json()
    assert {row["code"] for row in units} == {"Bag", "Kg", "Tonne", "Piece", "Sheet", "SqFt"}
    listed = reader.get("/api/v1/catalog/products", params={"category_id": cement, "limit": 5}).json()
    assert len(listed) == 5 and all(row["category_name"] == "Cement" for row in listed)
    assert reader.get("/api/v1/catalog/products", params={"limit": -1}).status_code == 422  # crash fixed

    found = reader.get("/api/v1/catalog/search", params={"q": "ultratech ppc cement 50 kg"}).json()
    assert found[0]["brand_name"] == "UltraTech" and found[0]["matched_variant"] is not None
    # A search of unit words only matches products sold in that unit (old rule kept).
    bags = reader.get("/api/v1/catalog/search", params={"q": "bag"}).json()
    assert bags and {row["unit_code"] for row in bags} == {"Bag"}

    product_id = found[0]["id"]
    detail = reader.get(f"/api/v1/catalog/products/{product_id}").json()
    assert detail["variants"] and detail["media"]["images_required"] == 5
    assert reader.get(f"/api/v1/catalog/products/{product_id}/variants").json() == detail["variants"]
    offers = reader.get(f"/api/v1/catalog/products/{product_id}/offers").json()
    assert offers["offers"] == [] and offers["product"]["id"] == product_id
    assert reader.get(f"/api/v1/catalog/products/{uuid.uuid4()}").status_code == 404
    assert client.get("/api/v1/catalog/categories").status_code == 401


def test_the_catalog_answers_503_without_its_tables(
    client: TestClient, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_user(database)
    reader, _ = signed_in(client, "asha@example.in")
    monkeypatch.setattr(catalog_service, "catalog_installed", lambda database: False)
    answer = reader.get("/api/v1/catalog/categories")
    assert (answer.status_code, answer.json()["detail"]) == (503, "The product catalog has not been set up yet.")


def admin_client(client: TestClient, database: Session) -> tuple[TestClient, dict[str, str]]:
    create_admin(database)
    return signed_in(client, "india.admin@example.in")


def build_product(admin: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    category = admin.post(
        "/api/v1/admin/catalog/categories", json={"slug": "Tiles", "name": "Tiles"}, params={"country": "GLOBAL"},
        headers=headers,
    )  # fmt: skip
    assert category.status_code == 201, category.text
    assert category.json()["country_code"] == "IN" and category.json()["slug"] == "tiles"
    subcategory = admin.post(
        "/api/v1/admin/catalog/subcategories",
        json={"category_id": category.json()["id"], "slug": "vitrified", "name": "Vitrified Tiles"},
        headers=headers,
    ).json()
    brand = admin.post("/api/v1/admin/catalog/brands", json={"slug": "kajaria", "name": "Kajaria"}, headers=headers)
    assert brand.status_code == 201
    product = admin.post(
        "/api/v1/admin/catalog/products",
        json={"subcategory_id": subcategory["id"], "brand_id": brand.json()["id"], "slug": "kajaria-gvt",
              "name": "Kajaria GVT", "is_active": False, "specifications": {"Finish": "Glossy"}},
        headers=headers,
    )  # fmt: skip
    assert product.status_code == 201, product.text
    return product.json()


def test_admin_builds_a_product(client: TestClient, database: Session) -> None:
    admin, headers = admin_client(client, database)
    product = build_product(admin, headers)
    assert product["category_name"] == "Tiles" and product["brand_name"] == "Kajaria"
    assert product["is_active"] is False
    url = f"/api/v1/admin/catalog/products/{product['id']}"

    duplicate = admin.post("/api/v1/admin/catalog/brands", json={"slug": "KAJARIA", "name": "K"}, headers=headers)
    assert duplicate.status_code == 409
    # Crash fixed: an explicit null for a required field is a 422, not a 500.
    assert admin.patch(url, json={"name": None}, headers=headers).status_code == 422
    assert admin.patch(url, json={"unit_id": str(uuid.uuid4())}, headers=headers).status_code == 400
    refused = admin.patch(url, json={"is_active": True}, headers=headers)
    assert refused.status_code == 400 and "Upload 5 images" in refused.json()["detail"]

    image_ids = []
    for _ in range(5):
        added = admin.post(f"{url}/image", files={"file": ("p.png", PNG, "image/png")}, headers=headers)
        assert added.status_code == 201, added.text
        image_ids.append(added.json()["id"])
    detail = admin.get(url).json()
    assert [image["is_primary"] for image in detail["images"]] == [True, False, False, False, False]
    assert detail["listing_count"] == 0
    assert admin.patch(url, json={"is_active": True}, headers=headers).json()["is_active"] is True

    order = admin.patch(f"{url}/images/order", json={"image_ids": image_ids[::-1]}, headers=headers)
    assert [row["id"] for row in order.json()] == image_ids[::-1]
    short = admin.patch(f"{url}/images/order", json={"image_ids": image_ids[:2]}, headers=headers)
    assert short.status_code == 400
    primary = admin.patch(f"/api/v1/admin/catalog/images/{image_ids[3]}/primary", headers=headers)
    assert primary.json() == {"id": image_ids[3], "is_primary": True}
    assert database.scalar(select(func.count()).where(CatalogProductMedia.is_primary.is_(True))) == 1
    assert admin.delete(f"/api/v1/admin/catalog/images/{image_ids[0]}", headers=headers).status_code == 204

    video = admin.post(f"{url}/video", files={"file": ("v.mp4", MP4, "video/mp4")}, headers=headers)
    assert video.status_code == 201, video.text
    assert admin.get(url).json()["video_url"] == video.json()["video_url"]
    assert admin.delete(f"{url}/video", headers=headers).status_code == 204
    assert admin.get(url).json()["video_url"] is None

    attach = {"image_url": "/files/x", "uploaded_file_id": str(uuid.uuid4())}
    assert admin.post(f"{url}/images", json=attach, headers=headers).status_code == 400  # crash fixed

    variant = admin.post(f"{url}/variants", json={"slug": "600x600", "name": "600 x 600 mm"}, headers=headers)
    assert variant.status_code == 201 and variant.json()["specifications"] == {"Finish": "Glossy"}
    bad_unit = {"slug": "800x800", "name": "800", "unit_id": str(uuid.uuid4())}
    assert admin.post(f"{url}/variants", json=bad_unit, headers=headers).status_code == 400  # crash fixed
    renamed = admin.patch(
        f"/api/v1/admin/catalog/variants/{variant.json()['id']}", json={"name": "60 x 60 cm"}, headers=headers
    )
    assert renamed.json()["name"] == "60 x 60 cm"

    actions = database.scalars(select(AdminAuditLog.action).order_by(AdminAuditLog.created_at)).all()
    assert actions[0] == "catalog.product_created" and actions.count("catalog.image_added") == 5
    assert "catalog.product_updated" in actions


def test_admin_lists_include_inactive_rows(seeded: list[str], client: TestClient, database: Session) -> None:
    admin, headers = admin_client(client, database)
    category = database.scalars(select(CatalogCategory).where(CatalogCategory.slug == "steel")).one()
    off = admin.patch(f"/api/v1/admin/catalog/categories/{category.id}", json={"is_active": False}, headers=headers)
    assert off.json()["is_active"] is False
    assert len(admin.get("/api/v1/admin/catalog/categories").json()) == 2
    assert len(admin.get("/api/v1/admin/catalog/brands").json()) == 21
    assert len(admin.get("/api/v1/admin/catalog/units").json()) == 6
    assert len(admin.get("/api/v1/admin/catalog/products", params={"limit": 500}).json()) == 76
    assert len(admin.get("/api/v1/admin/catalog/subcategories", params={"category_id": str(category.id)}).json()) == 20
    create_user(database)
    reader, _ = signed_in(client, "asha@example.in")
    assert [row["slug"] for row in reader.get("/api/v1/catalog/categories").json()] == ["cement"]


def test_a_category_without_a_country_is_out_of_a_location_admins_reach(client: TestClient, database: Session) -> None:
    admin, headers = admin_client(client, database)
    stray = CatalogCategory(slug="stray", name="Stray", country_code=None)
    database.add(stray)
    database.commit()
    assert (
        admin.patch(f"/api/v1/admin/catalog/categories/{stray.id}", json={"name": "x"}, headers=headers).status_code
        == 404
    )


def test_a_global_admin_names_the_country(make_client: ClientFactory, database: Session) -> None:
    whatsapp = FakeWhatsApp()
    client = make_client(overrides=service_overrides(whatsapp=whatsapp), **WHATSAPP_SETTINGS)
    create_global_admin(database)
    admin, headers = whatsapp_signed_in(client, whatsapp, "9876500900")
    body = {"slug": "tiles", "name": "Tiles"}
    missing = admin.post("/api/v1/admin/catalog/categories", json=body, headers=headers)
    assert (missing.status_code, missing.json()["detail"]) == (400, "Choose India before adding to the catalog.")
    kuwait = admin.post("/api/v1/admin/catalog/categories", json=body, params={"country": "Kuwait"}, headers=headers)
    assert kuwait.status_code == 422
    made = admin.post("/api/v1/admin/catalog/categories", json=body, params={"country": "India"}, headers=headers)
    assert made.status_code == 201 and made.json()["country_code"] == "IN"


def test_a_supplier_sees_only_the_primary_image_of_products_it_has_not_listed(
    client: TestClient, database: Session
) -> None:
    admin, headers = admin_client(client, database)
    product = build_product(admin, headers)
    url = f"/api/v1/admin/catalog/products/{product['id']}"
    for _ in range(2):
        admin.post(f"{url}/image", files={"file": ("p.png", PNG, "image/png")}, headers=headers)
    admin.patch(url, json={"is_active": True}, headers=headers)  # refused: fewer than 5 images
    database.execute(
        CatalogProduct.__table__.update().where(CatalogProduct.id == uuid.UUID(product["id"])).values(is_active=True)
    )
    database.commit()
    create_user(database, role=ROLE_SUPPLIER, email="supplier@example.in")
    supplier, _ = signed_in(client, "supplier@example.in")
    listed = supplier.get("/api/v1/catalog/products").json()
    assert len(listed) == 1 and len(listed[0]["images"]) == 1 and listed[0]["images"][0]["is_primary"]
    detail = supplier.get(f"/api/v1/catalog/products/{product['id']}").json()
    assert detail["images"] == [] and detail["image_url"] is None
    create_user(database, email="owner@example.in")
    owner, _ = signed_in(client, "owner@example.in")
    assert len(owner.get(f"/api/v1/catalog/products/{product['id']}").json()["images"]) == 2
