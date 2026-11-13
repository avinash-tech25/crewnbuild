"""The HttpOnly cookies that carry a Professional sign-in session (technical-architecture.md
6.2).

Names depend on AUTH_COOKIE_SECURE:

    secure (https, every deployed environment)   __Host-pro_at, __Host-pro_rt
    not secure (local http only)                 pro_at, pro_rt

Browsers refuse a `__Host-` cookie that is not Secure, so on plain http the prefix is
dropped and local sign-in keeps working. `__Host-` also forces Path=/ and no Domain.
Partner uses other names (`par_`), so the two apps never read each other's cookies on
one host.

The OAuth transaction cookie is sent only to the OAuth routes, so it cannot use
`__Host-` (which requires Path=/); it uses `__Secure-` when secure.
"""

from datetime import UTC, datetime
from typing import Any

from starlette.requests import HTTPConnection
from starlette.responses import Response

from app.core.config import Settings

API_PREFIX = "/api/v1"
OAUTH_COOKIE_PATH = f"{API_PREFIX}/auth/oauth"


def access_cookie_name(settings: Settings) -> str:
    return "__Host-pro_at" if settings.auth_cookie_secure else "pro_at"


def refresh_cookie_name(settings: Settings) -> str:
    return "__Host-pro_rt" if settings.auth_cookie_secure else "pro_rt"


def oauth_state_cookie_name(settings: Settings) -> str:
    return "__Secure-pro_oauth" if settings.auth_cookie_secure else "pro_oauth"


def _cookie_options(settings: Settings) -> dict[str, Any]:
    return {
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite.strip().lower(),
        "path": "/",
    }


def set_session_cookies(
    response: Response, settings: Settings, access_token: str, refresh_token: str, refresh_expires_at: datetime
) -> None:
    options = _cookie_options(settings)
    response.set_cookie(
        access_cookie_name(settings), access_token, max_age=settings.access_token_minutes * 60, **options
    )
    refresh_seconds = max(int((refresh_expires_at - datetime.now(UTC)).total_seconds()), 0)
    response.set_cookie(refresh_cookie_name(settings), refresh_token, max_age=refresh_seconds, **options)


def clear_session_cookies(response: Response, settings: Settings) -> None:
    options = _cookie_options(settings)
    response.delete_cookie(access_cookie_name(settings), **options)
    response.delete_cookie(refresh_cookie_name(settings), **options)


def access_token_from(connection: HTTPConnection, settings: Settings) -> str | None:
    return connection.cookies.get(access_cookie_name(settings)) or None


def refresh_token_from(connection: HTTPConnection, settings: Settings) -> str | None:
    return connection.cookies.get(refresh_cookie_name(settings)) or None


def set_oauth_state_cookie(response: Response, settings: Settings, value: str, max_age: int) -> None:
    response.set_cookie(
        oauth_state_cookie_name(settings),
        value,
        max_age=max_age,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path=OAUTH_COOKIE_PATH,
    )


def clear_oauth_state_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        oauth_state_cookie_name(settings),
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path=OAUTH_COOKIE_PATH,
    )


def oauth_state_from(connection: HTTPConnection, settings: Settings) -> str | None:
    return connection.cookies.get(oauth_state_cookie_name(settings)) or None
