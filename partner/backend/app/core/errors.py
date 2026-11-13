"""Error answers of the Partner API.

The answers the old Partner frontend reads are kept:

* a validation error is 422 {"detail": "Some of the information sent is not valid.",
  "fields": [{"field", "message"}]}, never echoing what was sent (sign-up carries codes
  and, in part 2, Aadhaar numbers);
* a database that cannot be reached answers 503 with a plain message instead of a 500
  without CORS headers, which the browser would show as "Partner could not be reached";
* HTTPException keeps FastAPI's {"detail": ...} body.

ApiError and the API-04 body ({"error": {...}}) are here for new code, as in
Professional; an unexpected exception answers 500 with that body and never a stack trace.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError, ProgrammingError

from app.core.middleware import current_request_id

logger = logging.getLogger(__name__)

INVALID_INPUT_MESSAGE = "Some of the information sent is not valid."
DATABASE_UNAVAILABLE_MESSAGE = "Partner's database is unavailable right now. Please try again shortly."
DATABASE_NOT_SET_UP_MESSAGE = "Partner's database is not set up yet. Run `alembic upgrade head` in partner/backend."


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: list[Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


def error_body(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "request_id": current_request_id(), "details": details or []}}


async def handle_api_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ApiError):
        raise error
    return JSONResponse(status_code=error.status_code, content=error_body(error.code, error.message, error.details))


async def handle_validation_error(request: Request, error: Exception) -> JSONResponse:
    """422s without the submitted values (the old Partner handler)."""
    errors = error.errors() if isinstance(error, RequestValidationError) else []
    fields = [
        {
            "field": ".".join(str(part) for part in item.get("loc", ()) if part != "body"),
            "message": item.get("msg", "Invalid value"),
        }
        for item in errors
    ]
    return JSONResponse(status_code=422, content={"detail": INVALID_INPUT_MESSAGE, "fields": fields})


async def handle_database_error(request: Request, error: Exception) -> JSONResponse:
    """Database failures as an answer the browser can read (inside the CORS layer). The
    driver's message is logged by its first line only and never returned."""
    original = getattr(error, "orig", None) or error
    first_line = (str(original).strip().splitlines() or [type(original).__name__])[0]
    if isinstance(error, OperationalError | InterfaceError):
        logger.error("Database unavailable during %s %s: %s", request.method, request.url.path, first_line)
        return JSONResponse(status_code=503, content={"detail": DATABASE_UNAVAILABLE_MESSAGE})
    if isinstance(error, ProgrammingError) and "does not exist" in str(original):
        logger.error("Partner schema not migrated (%s %s): %s", request.method, request.url.path, first_line)
        return JSONResponse(status_code=503, content={"detail": DATABASE_NOT_SET_UP_MESSAGE})
    return await handle_unexpected_error(request, error)


async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500, content=error_body("INTERNAL_ERROR", "Something went wrong. Please try again.")
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(DBAPIError, handle_database_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
