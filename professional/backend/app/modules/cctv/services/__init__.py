"""Live Camera / CCTV services.

The CCTV feature writes only its own tables (app/modules/cctv/models.py). Projects,
users and project_engineer_assignments are read for authorization and never written.

Every error this package raises carries a stable machine-readable `code` and a
human message, and never a credential, a token, a stream location or any part
of the request body.
"""

from fastapi import HTTPException, status


def cctv_error(status_code: int, code: str, message: str, fields: list[dict] | None = None) -> HTTPException:
    detail: dict = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    return HTTPException(status_code=status_code, detail=detail)


def field_error(field: str, message: str, code: str = "CCTV_VALIDATION_ERROR") -> HTTPException:
    return cctv_error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        code,
        "Please correct the highlighted field.",
        [{"field": field, "message": message}],
    )


def not_found() -> HTTPException:
    # One answer for "does not exist" and "exists but is not yours", so an id
    # cannot be probed by comparing responses.
    return cctv_error(status.HTTP_404_NOT_FOUND, "CCTV_NOT_FOUND", "Not found.")
