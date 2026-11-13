"""HTTP hardening (technical-architecture.md 14.3, 14.4), added in R6:

* SecurityHeadersMiddleware: every answer, refusals and errors included, carries
      Content-Security-Policy  default-src 'none'; frame-ancestors 'none'; base-uri 'none';
                               form-action 'none'   (an API answers data, never a page)
      X-Content-Type-Options   nosniff
      X-Frame-Options          DENY
      Referrer-Policy          strict-origin-when-cross-origin
      Permissions-Policy       camera=(), geolocation=(), microphone=()
      Strict-Transport-Security max-age=31536000; includeSubDomains   (production only)
  The interactive API docs (development only) load their scripts from a CDN, so they get
  no CSP. The web apps' own policy (the one in section 14.3) is set where they are served.
* BodySizeLimitMiddleware: a request body over MAX_JSON_BODY_BYTES (or, for a
  multipart upload, MAX_UPLOAD_BODY_BYTES) is refused with 413 before the route reads it,
  whether Content-Length announces it or a chunked body grows past it.
"""

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings

API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
HSTS = "max-age=31536000; includeSubDomains"
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
TOO_LARGE = "The request is too large."


def security_headers(settings: Settings, path: str) -> list[tuple[bytes, bytes]]:
    headers = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"permissions-policy", b"camera=(), geolocation=(), microphone=()"),
    ]
    if not (settings.is_development() and path.startswith(DOCS_PATHS)):
        headers.append((b"content-security-policy", API_CONTENT_SECURITY_POLICY.encode()))
    if settings.is_production():
        headers.append((b"strict-transport-security", HSTS.encode()))
    return headers


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        extra = security_headers(self.settings, scope.get("path", ""))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {name.lower() for name, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    (name, value) for name, value in extra if name not in present
                ]
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.json_limit = settings.max_json_body_bytes
        self.upload_limit = settings.max_upload_body_bytes

    def limit_for(self, headers: Headers) -> int:
        content_type = headers.get("content-type", "").lower()
        return self.upload_limit if content_type.startswith("multipart/form-data") else self.json_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        limit = self.limit_for(headers)
        declared = headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self.refuse(send)
            return
        received = 0

        async def counted_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Raised inside the route's body read; FastAPI passes an HTTPException
                    # through, so the answer is this 413 (with CORS and the request ID).
                    raise HTTPException(status_code=413, detail=TOO_LARGE)
            return message

        await self.app(scope, counted_receive, send)

    @staticmethod
    async def refuse(send: Send) -> None:
        body = b'{"detail":"' + TOO_LARGE.encode() + b'"}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
