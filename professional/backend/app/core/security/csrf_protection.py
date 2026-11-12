"""CSRF protection for cookie-authenticated writes (technical-architecture.md 6.2, 14.1).

The browser attaches the session cookies to any request it sends here, so a
state-changing request that carries them must also prove it came from this
application's own page:

* its Origin (or, failing that, Referer) must be an allowed origin, and
* it must carry X-CSRF-Token equal to its session family's CSRF token, which the page
  receives in the body of sign-in, refresh and GET /auth/session and keeps in memory.

The auth endpoints a page calls before it can hold that token (sign-in, sign-up,
refresh, sign-out, the code requests) get the Origin check only, which a cross-site
page cannot pass.

Sessions are cookie-only: no Authorization header (Bearer or any other) skips this
check. A request with no session cookie at all carries no ambient credential and is
passed on; a protected route then answers 401.

Refusals keep the old body: 403 {"detail": {"code": ..., "message": ...}}.
"""

from hmac import compare_digest
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.requests import cookie_parser
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import Settings
from app.core.middleware import is_allowed_origin
from app.core.security.access_tokens import csrf_token_for, read_access_claims
from app.core.security.session_cookies import API_PREFIX, access_cookie_name, refresh_cookie_name

CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

# Endpoints a page calls before it can hold a CSRF token: Origin-checked only.
ORIGIN_ONLY_PATHS = frozenset(
    f"{API_PREFIX}{path}"
    for path in (
        "/auth/login",
        "/auth/signup",
        "/auth/refresh",
        "/auth/logout",
        "/auth/email/send-code",
        "/auth/email/verify-code",
        "/auth/phone/send-code",
        "/auth/phone/verify-code",
        "/auth/phone/login/send-code",
        "/auth/phone/login/verify-code",
        "/auth/password/forgot",
        "/auth/password/verify-code",
        "/auth/password/reset",
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
        access_token = cookies.get(access_cookie_name(self.settings))
        if not (access_token or cookies.get(refresh_cookie_name(self.settings))):
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

        claims = read_access_claims(self.settings, access_token) if access_token else None
        if claims is None:
            # No usable access cookie: nothing here is authenticated by it, and a
            # protected route answers 401.
            await self.app(scope, receive, send)
            return
        sent = headers.get(CSRF_HEADER) or ""
        if not sent or not compare_digest(sent, csrf_token_for(self.settings, claims.family_id)):
            await refusal(CSRF_FAILED, "CSRF_FAILED")(scope, receive, send)
            return
        await self.app(scope, receive, send)
