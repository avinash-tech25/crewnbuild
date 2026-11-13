"""The HttpOnly cookies that carry Partner sessions (technical-architecture.md 6.2).

Two pairs, because a browser can hold both at once and they must never overwrite each
other: a technician session (dashboard or registration) and a booking (requester)
session started from Professional. Names depend on AUTH_COOKIE_SECURE:

                     secure (https)              not secure (local http only)
    technician       __Host-par_at, __Host-par_rt         par_at, par_rt
    requester        __Host-par_req_at, __Host-par_req_rt par_req_at, par_req_rt

Browsers refuse a `__Host-` cookie that is not Secure, so on plain http the prefix is
dropped. `__Host-` also forces Path=/ and no Domain. Professional uses `pro_` names, so
the two apps never read each other's cookies on one host.

As before, the cookies are browser-session cookies (no Max-Age): the server enforces the
real lifetimes (the access token's expiry, the session's idle and absolute expiry).
"""

from dataclasses import dataclass
from typing import Any

from starlette.requests import HTTPConnection
from starlette.responses import Response

from app.core.config import Settings

API_PREFIX = "/api/v1"
TECHNICIAN = "technician"
REQUESTER = "requester"
_NAMES = {TECHNICIAN: ("par_at", "par_rt"), REQUESTER: ("par_req_at", "par_req_rt")}


def _name(settings: Settings, base: str) -> str:
    return f"__Host-{base}" if settings.auth_cookie_secure else base


def access_cookie_name(settings: Settings, principal: str) -> str:
    return _name(settings, _NAMES[principal][0])


def refresh_cookie_name(settings: Settings, principal: str) -> str:
    return _name(settings, _NAMES[principal][1])


def all_cookie_names(settings: Settings) -> list[str]:
    return [_name(settings, base) for pair in _NAMES.values() for base in pair]


def _cookie_options(settings: Settings) -> dict[str, Any]:
    return {
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite.strip().lower(),
        "path": "/",
    }


def set_session_cookies(
    response: Response, settings: Settings, principal: str, access_token: str, refresh_token: str
) -> None:
    options = _cookie_options(settings)
    response.set_cookie(access_cookie_name(settings, principal), access_token, **options)
    response.set_cookie(refresh_cookie_name(settings, principal), refresh_token, **options)


def clear_session_cookies(response: Response, settings: Settings, principal: str) -> None:
    options = _cookie_options(settings)
    response.delete_cookie(access_cookie_name(settings, principal), **options)
    response.delete_cookie(refresh_cookie_name(settings, principal), **options)


def access_token_from(connection: HTTPConnection, settings: Settings, principal: str) -> str | None:
    """Cookie-only: an Authorization header is never read (the old Bearer path is gone)."""
    return connection.cookies.get(access_cookie_name(settings, principal)) or None


def refresh_token_from(connection: HTTPConnection, settings: Settings, principal: str) -> str | None:
    return connection.cookies.get(refresh_cookie_name(settings, principal)) or None


@dataclass(frozen=True)
class ClientInfo:
    """What is recorded about the browser a session was started from."""

    user_agent: str | None
    ip_address: str | None


def client_info(connection: HTTPConnection) -> ClientInfo:
    return ClientInfo(
        user_agent=connection.headers.get("user-agent"),
        ip_address=connection.client.host if connection.client else None,
    )
