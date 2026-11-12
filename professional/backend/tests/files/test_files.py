"""Uploading, opening and releasing files. S3 is replaced by an in-memory store."""

from typing import Any

import pytest
from conftest import ClientFactory
from fastapi import Depends
from fastapi.testclient import TestClient
from identity.helpers import create_user, sign_in
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.integrations.s3_storage.object_storage import StoredObjectMissingError
from app.modules.accounts.models import AdminProfile, BuilderProfile
from app.modules.files import file_ownership
from app.modules.files.models import File
from app.modules.files.router import get_upload_service
from app.modules.files.upload_service import UploadService, fit_filename
from app.modules.identity.models import ROLE_BUILDER, ROLE_MANAGER, User

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
MP4 = b"\x00\x00\x00\x18ftypmp42" + bytes(range(200))
BUCKETS = {
    "aws_user_images_bucket_in": "user-images",
    "aws_supplier_data_bucket_in": "supplier-data",
    "aws_site_videos_bucket_in": "site-videos",
}


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put(self, bucket: str, key: str, content: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = content

    def get(self, bucket: str, key: str) -> bytes:
        if (bucket, key) not in self.objects:
            raise StoredObjectMissingError
        return self.objects[(bucket, key)]

    def delete(self, bucket: str, key: str) -> None:
        self.objects.pop((bucket, key), None)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> FakeStorage:
    fake = FakeStorage()
    monkeypatch.setattr(file_ownership, "shared_object_storage", lambda settings: fake)
    return fake


def with_fake_storage(client: TestClient, storage: FakeStorage) -> TestClient:
    settings = client.app.state.settings  # type: ignore[attr-defined]

    def fake_upload_service(database: Session = Depends(get_db)) -> UploadService:
        return UploadService(database, settings, storage)  # type: ignore[arg-type]

    client.app.dependency_overrides[get_upload_service] = fake_upload_service  # type: ignore[attr-defined]
    return client


@pytest.fixture
def files_client(make_client: ClientFactory, storage: FakeStorage) -> TestClient:
    return with_fake_storage(make_client(**BUCKETS), storage)


def upload(
    client: TestClient, csrf: str, content: bytes = PNG, name: str = "photo.png", kind: str = "image/png"
) -> Any:
    return client.post("/api/v1/files/upload", files={"file": (name, content, kind)}, headers={"X-CSRF-Token": csrf})


def test_upload_and_open_an_own_file(files_client: TestClient, database: Session, storage: FakeStorage) -> None:
    user = create_user(database)
    csrf = sign_in(files_client)
    response = upload(files_client, csrf)
    assert response.status_code == 200, response.text
    address = response.json()["url"]
    assert address.startswith("/files/")
    stored = database.scalars(select(File)).one()
    assert stored.owner_user_id == user.id and stored.bucket == "user-images"
    assert stored.storage_key.startswith(f"uploads/owner/{user.id}/")

    opened = files_client.get(f"/api/v1{address}")
    assert opened.status_code == 200 and opened.content == PNG
    assert opened.headers["cache-control"] == "private, max-age=3600"
    assert opened.headers["x-content-type-options"] == "nosniff"
    assert opened.headers["content-disposition"].startswith("inline;")
    again = files_client.get(f"/api/v1{address}", headers={"If-None-Match": opened.headers["etag"]})
    assert again.status_code == 304


@pytest.mark.parametrize(
    ("content", "kind", "status"),
    [
        (b"", "image/png", 400),
        (b"not a png", "image/png", 415),
        (PNG, "image/gif", 415),
        (b"%PDF-1.4", "application/pdf", 200),
    ],
)
def test_upload_rules(files_client: TestClient, database: Session, content: bytes, kind: str, status: int) -> None:
    create_user(database)
    csrf = sign_in(files_client)
    assert upload(files_client, csrf, content=content, kind=kind).status_code == status


def test_missing_bucket_is_a_503(make_client: ClientFactory, database: Session, storage: FakeStorage) -> None:
    client = with_fake_storage(make_client(), storage)
    create_user(database)
    response = upload(client, sign_in(client))
    assert response.status_code == 503
    assert "AWS_USER_IMAGES_BUCKET_IN" in response.json()["detail"]


def test_a_private_upload_is_refused_to_others_and_a_published_logo_is_not(
    files_client: TestClient, database: Session
) -> None:
    builder = create_user(database, role=ROLE_BUILDER, email="builder@example.in", phone="9876500001")
    create_user(database, email="viewer@example.in", phone="9876500002")
    builder_csrf = sign_in(files_client, identifier="builder@example.in")
    logo = upload(files_client, builder_csrf).json()["url"]
    document = upload(
        files_client, builder_csrf, content=b"%PDF-1.4", name="licence.pdf", kind="application/pdf"
    ).json()["url"]
    private = upload(files_client, builder_csrf).json()["url"]
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    profile.company_logo_url = logo
    profile.documents = f"Licence: {document}"
    database.commit()

    files_client.post("/api/v1/auth/logout")
    sign_in(files_client, identifier="viewer@example.in")
    assert files_client.get(f"/api/v1{logo}").status_code == 200
    assert files_client.get(f"/api/v1{document}").status_code == 403
    assert files_client.get(f"/api/v1{private}").status_code == 403

    files_client.post("/api/v1/auth/logout")
    create_user(database, role=ROLE_MANAGER, email="manager@example.in", phone="", admin_phone="9876500003")
    admin_profile = database.scalars(select(AdminProfile)).one()
    admin_profile.permissions = "users.view"
    database.commit()
    sign_in(files_client, identifier="manager@example.in")
    assert files_client.get(f"/api/v1{document}").status_code == 200


def test_unknown_file_and_no_session(files_client: TestClient, database: Session) -> None:
    create_user(database)
    sign_in(files_client)
    assert files_client.get("/api/v1/files/00000000-0000-7000-8000-000000000000").status_code == 404
    stranger = TestClient(files_client.app)
    refused = stranger.get("/api/v1/files/00000000-0000-7000-8000-000000000000")
    assert refused.status_code == 401 and refused.json() == {"detail": "Authentication required"}


def test_videos_answer_byte_ranges(files_client: TestClient, database: Session, storage: FakeStorage) -> None:
    create_user(database)
    csrf = sign_in(files_client)
    response = upload(files_client, csrf, content=MP4, name="walkthrough.mp4", kind="video/mp4")
    stored = database.scalars(select(File)).one()
    assert stored.bucket == "site-videos"
    partial = files_client.get(f"/api/v1{response.json()['url']}", headers={"Range": "bytes=0-9"})
    assert partial.status_code == 206
    assert partial.content == MP4[:10]
    assert partial.headers["content-range"] == f"bytes 0-9/{len(MP4)}"


def test_a_non_latin_filename_is_served(files_client: TestClient, database: Session) -> None:
    create_user(database)
    csrf = sign_in(files_client)
    address = upload(files_client, csrf, name="plan – ₹ é.png").json()["url"]  # noqa: RUF001 the point of the test
    disposition = files_client.get(f"/api/v1{address}").headers["content-disposition"]
    assert 'filename="plan _ _ _.png"' in disposition
    assert "filename*=UTF-8''plan%20%E2%80%93%20%E2%82%B9%20%C3%A9.png" in disposition


def test_long_filenames_are_fitted() -> None:
    assert fit_filename("a" * 300 + ".png", 50) == "a" * 46 + ".png"
    assert fit_filename("short.png") == "short.png"


def test_a_replaced_photo_is_released_unless_still_used(
    files_client: TestClient, database: Session, storage: FakeStorage
) -> None:
    user = create_user(database)
    csrf = sign_in(files_client)
    headers = {"X-CSRF-Token": csrf}
    first = upload(files_client, csrf).json()["url"]
    second = upload(files_client, csrf).json()["url"]
    files_client.patch("/api/v1/auth/profile-image", json={"profile_image_url": first}, headers=headers)
    # The first photo is also used elsewhere: replacing the profile photo keeps it.
    user.address = f"See {first}"
    database.commit()
    files_client.patch("/api/v1/auth/profile-image", json={"profile_image_url": second}, headers=headers)
    database.expire_all()
    assert len(list(database.scalars(select(File)))) == 2

    user = database.get(User, user.id)  # type: ignore[assignment]
    user.address = "12 MG Road, Bengaluru"
    database.commit()
    files_client.patch("/api/v1/auth/profile-image", json={"profile_image_url": ""}, headers=headers)
    database.expire_all()
    remaining = list(database.scalars(select(File)))
    assert [f"/files/{stored.id}" for stored in remaining] == [first]
    assert len(storage.objects) == 1


def test_account_deletion_releases_personal_files(
    files_client: TestClient, database: Session, storage: FakeStorage
) -> None:
    create_user(database, phone="9876543210")
    csrf = sign_in(files_client)
    headers = {"X-CSRF-Token": csrf}
    photo = upload(files_client, csrf).json()["url"]
    files_client.patch("/api/v1/auth/profile-image", json={"profile_image_url": photo}, headers=headers)
    form = {
        "full_name": "Asha Rao",
        "role": "OWNER",
        "email": "asha@example.in",
        "phone": "9876543210",
        "reason_code": "PRIVACY",
        "confirm_deletion": True,
        "confirmation_text": "DELETE",
    }
    assert files_client.post("/api/v1/account/delete", json=form, headers=headers).status_code == 200
    database.expire_all()
    assert database.scalars(select(File)).first() is None
    assert storage.objects == {}


def test_a_builder_with_an_unpaid_plan_may_open_files_but_not_upload(
    files_client: TestClient, database: Session
) -> None:
    builder = create_user(database, role=ROLE_BUILDER)
    csrf = sign_in(files_client)
    address = upload(files_client, csrf).json()["url"]
    profile = database.scalars(select(BuilderProfile).where(BuilderProfile.user_id == builder.id)).one()
    profile.signup_plan_code, profile.signup_duration_code = "BUSINESS", "ANNUAL"
    database.commit()
    assert files_client.get(f"/api/v1{address}").status_code == 200
    assert upload(files_client, csrf).status_code == 403
