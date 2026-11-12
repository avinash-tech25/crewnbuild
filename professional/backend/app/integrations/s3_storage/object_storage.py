"""Amazon S3 object storage for uploaded files (ported from the old upload_service.py).

Explicit keys from the settings win; when they are blank boto3 resolves credentials
the usual way, so an instance role works without long-lived keys on the machine. One
client per process (a client holds its own connection pool and is thread-safe).
"""

import threading
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, status

from app.core.config import Settings

MISSING_OBJECT_CODES = {"NoSuchKey", "NoSuchBucket", "404"}


class StoredObjectMissingError(Exception):
    """The object is not in its bucket."""


def storage_error_detail(error: Exception) -> str:
    if isinstance(error, ClientError):
        return str(error.response.get("Error", {}).get("Message") or error)
    return str(error)


def storage_unavailable(error: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"File storage is unavailable: {storage_error_detail(error)}",
    )


def object_is_missing(error: ClientError) -> bool:
    return error.response.get("Error", {}).get("Code", "") in MISSING_OBJECT_CODES


def build_s3_client(settings: Settings) -> Any:
    options: dict[str, Any] = {
        "region_name": settings.aws_region or None,
        "config": Config(retries={"max_attempts": 3, "mode": "standard"}),
    }
    if settings.aws_endpoint_url:
        options["endpoint_url"] = settings.aws_endpoint_url
    secret = settings.aws_secret_access_key.get_secret_value()
    if settings.aws_access_key_id and secret:
        options["aws_access_key_id"] = settings.aws_access_key_id
        options["aws_secret_access_key"] = secret
        session_token = settings.aws_session_token.get_secret_value()
        if session_token:
            options["aws_session_token"] = session_token
    return boto3.client("s3", **options)


class ObjectStorage:
    """put / get / delete of one object. Storage errors become a 503; a missing object
    on read is StoredObjectMissingError; a missing object on delete counts as deleted."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def put(self, bucket: str, key: str, content: bytes, content_type: str) -> None:
        try:
            self.client.put_object(Bucket=bucket, Key=key, Body=content, ContentType=content_type)
        except (ClientError, BotoCoreError) as error:
            raise storage_unavailable(error) from error

    def get(self, bucket: str, key: str) -> bytes:
        try:
            content: bytes = self.client.get_object(Bucket=bucket, Key=key)["Body"].read()
            return content
        except ClientError as error:
            if object_is_missing(error):
                raise StoredObjectMissingError from error
            raise storage_unavailable(error) from error
        except BotoCoreError as error:
            raise storage_unavailable(error) from error

    def delete(self, bucket: str, key: str) -> None:
        try:
            self.client.delete_object(Bucket=bucket, Key=key)
        except ClientError as error:
            if object_is_missing(error):
                return
            raise storage_unavailable(error) from error
        except BotoCoreError as error:
            raise storage_unavailable(error) from error


_shared_storage: ObjectStorage | None = None
_shared_lock = threading.Lock()


def shared_object_storage(settings: Settings) -> ObjectStorage:
    global _shared_storage
    if _shared_storage is None:
        with _shared_lock:
            if _shared_storage is None:
                _shared_storage = ObjectStorage(build_s3_client(settings))
    return _shared_storage
