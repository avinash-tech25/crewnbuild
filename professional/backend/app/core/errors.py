"""The one error body of the API (technical-architecture.md API-04):

    {"error": {"code": "BOOKING_NOT_FOUND", "message": "...", "request_id": "...", "details": []}}

Raise ApiError from services; the handler turns it into that body. An unexpected
exception answers 500 with the same shape and never a stack trace (14.4).

Not done yet: the old code answers with FastAPI's {"detail": ...} body from
HTTPException and validation errors, and the old frontends read it. Those two handlers
switch to this body together with the frontend change (decision pending, see the R4a
report), so endpoints ported in R4 keep answering as before.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.middleware import current_request_id

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: list[Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


def error_body(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": current_request_id(),
            "details": details or [],
        }
    }


async def handle_api_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ApiError):
        raise error
    return JSONResponse(status_code=error.status_code, content=error_body(error.code, error.message, error.details))


async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500, content=error_body("INTERNAL_ERROR", "Something went wrong. Please try again.")
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
