"""CSRF protection for cookie-authenticated writes (technical-architecture.md 6.2, 14.1;
the old Partner app/utils/csrf.py).

A browser attaches the session cookies to any request it sends here, so a
state-changing request that carries them must also prove it came from Partner's own
page:

* its Origin (or, failing that, Referer) must be an allowed origin, and
* it must carry X-CSRF-Token equal to the CSRF token of a session whose cookie it
  carries. The page receives the token in the body of sign-in, refresh and session
  answers and keeps it in memory only.

The endpoints that run before the page can hold a token (sign-in, sign-up codes,
refresh, sign-out, password reset, the hand-off) get the Origin check alone, which a
cross-site page cannot satisfy.

Sessions are cookie-only: no Authorization header skips this check (the old code let a
Bearer token through). A request with no session cookie at all carries no ambient
credential and is passed on; a protected route then answers 401.
"""

from hmac import compare_digest
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.requests import cookie_parser
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import Settings
from app.core.middleware import is_allowed_origin
from app.core.security.access_tokens import csrf_token_for, read_requester_access, read_technician_access
from app.core.security.session_cookies import (
    API_PREFIX,
    REQUESTER,
    TECHNICIAN,
    access_cookie_name,
    all_cookie_names,
)

CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
ORIGIN_ONLY_PATHS = frozenset(
    f"{API_PREFIX}{path}"
    for path in (
        "/auth/signup/send-code",
        "/auth/signup/verify-code",
        "/auth/login",
        "/auth/refresh",
        "/auth/logout",
        "/auth/password-reset/send-code",
        "/auth/password-reset/verify-code",
        "/auth/password-reset/reset",
        "/requester/session",
        "/requester/refresh",
        "/requester/logout",
    )
)
ORIGIN_NOT_ALLOWED = "This request did not come from an allowed origin."
CSRF_FAILED = "Missing or invalid CSRF token. Reload the page and try again."


def request_origin(headers: Headers) -> str | None:
    origin = headers.get("origin")
    if origin and origin != "null":
        return origin
    referer = headers.get("referer")
    if referer:
        parts = urlsplit(referer)
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
    return None


def refusal(message: str, code: str) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": {"code": code, "message": message}})


class CsrfProtectionMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in SAFE_METHODS:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        cookies = cookie_parser(headers.get("cookie", ""))
        if not any(cookies.get(name) for name in all_cookie_names(self.settings)):
            await self.app(scope, receive, send)
            return

        origin = request_origin(headers)
        if origin is not None and not is_allowed_origin(origin, self.settings):
            await refusal(ORIGIN_NOT_ALLOWED, "ORIGIN_NOT_ALLOWED")(scope, receive, send)
            return
        if scope["path"] in ORIGIN_ONLY_PATHS:
            if origin is None:
                await refusal(ORIGIN_NOT_ALLOWED, "ORIGIN_REQUIRED")(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        expected = []
        technician = read_technician_access(
            self.settings, cookies.get(access_cookie_name(self.settings, TECHNICIAN)) or ""
        )
        if technician is not None:
            expected.append(csrf_token_for(self.settings, technician.family_id))
        requester = read_requester_access(
            self.settings, cookies.get(access_cookie_name(self.settings, REQUESTER)) or ""
        )
        if requester is not None:
            expected.append(csrf_token_for(self.settings, requester.family_id))
        if not expected:
            # No usable access cookie: nothing here is authenticated by it, and a
            # protected route answers 401.
            await self.app(scope, receive, send)
            return
        sent = headers.get(CSRF_HEADER) or ""
        if not sent or not any(compare_digest(sent, token) for token in expected):
            await refusal(CSRF_FAILED, "CSRF_FAILED")(scope, receive, send)
            return
        await self.app(scope, receive, send)
