"""HTTP middleware: request ID and CORS (technical-architecture.md API-13, 14.3).

CSRF protection is app/core/security/csrf_protection.py; security headers and body
limits app/core/http_hardening.py; rate limits app/modules/rate_limits.
"""

import re
import uuid
from contextvars import ContextVar

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.http_hardening import BodySizeLimitMiddleware, SecurityHeadersMiddleware

REQUEST_ID_HEADER = "X-Request-ID"
# A caller-supplied request ID is kept only if it looks like one (no header injection,
# no unbounded log lines).
ACCEPTED_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

_request_id: ContextVar[str] = ContextVar("request_id", default="")


def current_request_id() -> str:
    return _request_id.get()


class RequestIdMiddleware:
    """Gives every HTTP request and WebSocket an ID, binds it to every log line, and
    returns it in the X-Request-ID response header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        supplied = ""
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                supplied = value.decode("latin-1")
                break
        request_id = supplied if ACCEPTED_REQUEST_ID.match(supplied) else uuid.uuid4().hex
        _request_id.set(request_id)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.lower().encode("latin-1"), request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_request_id)


# ---- Allowed browser origins (ported from the old app/utils/origins.py) ----
# One definition, used by CORS now and by the CSRF/Origin check and the websocket
# handshakes from R6 on.

DEVELOPMENT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
)

# Outside production: any address that can only be this machine or this office
# (loopback and the three private ranges), so the site opens from a phone on the LAN.
LOCAL_ORIGIN_PATTERN = (
    r"^http://("
    r"localhost"
    r"|127\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|\[::1\]"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)
_LOCAL_ORIGIN = re.compile(LOCAL_ORIGIN_PATTERN)


def allowed_origins(settings: Settings) -> list[str]:
    """In production the deployed frontend is the only origin."""
    if settings.is_production():
        return [settings.frontend_origin]
    return [settings.frontend_origin, *DEVELOPMENT_ORIGINS]


def is_allowed_origin(origin: str | None, settings: Settings) -> bool:
    """True for an origin CORS lets call this API with credentials."""
    if not origin:
        return False
    if origin in allowed_origins(settings):
        return True
    return not settings.is_production() and bool(_LOCAL_ORIGIN.match(origin))


# CORS (14.3): only the configured frontend origins, with credentials, and only the
# methods and headers the web app uses (R6: was "*").
CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Accept", "Accept-Language", "Content-Type", "X-CSRF-Token", "X-Request-ID"]


def add_middleware(app: FastAPI, settings: Settings) -> None:
    """Order matters: the last one added is the outermost. Security headers are outermost,
    so every answer carries them; CORS is next, so its headers are on every answer,
    refusals included; the request ID and the body-size limit sit inside it."""
    app.add_middleware(BodySizeLimitMiddleware, settings=settings)
    app.add_middleware(RequestIdMiddleware)
    cors_options: dict[str, object] = {
        "allow_origins": allowed_origins(settings),
        "allow_credentials": True,
        "allow_methods": CORS_METHODS,
        "allow_headers": CORS_HEADERS,
        "expose_headers": [REQUEST_ID_HEADER],
    }
    if not settings.is_production():
        cors_options["allow_origin_regex"] = LOCAL_ORIGIN_PATTERN
    app.add_middleware(CORSMiddleware, **cors_options)  # type: ignore[arg-type]
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
