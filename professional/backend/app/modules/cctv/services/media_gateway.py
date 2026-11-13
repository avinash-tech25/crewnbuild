"""The local media gateway: configuration detection and its control API.

The gateway pulls a camera's RTSP stream and serves it to browsers as LL-HLS or
WebRTC. The backend talks to it only through its control API, which must be on
this machine (a loopback address) and is authenticated with
CCTV_MEDIA_GATEWAY_API_SECRET. The gateway checks that secret -- and every
viewer's playback token -- by calling back into this backend
(playback.authorize_gateway_request), so its own configuration holds no secret.

A source registered here contains the camera login, because RTSP carries it in
the URL. That URL is built in memory by playback.py, handed straight to the
control API and never stored, logged, returned or included in an error.
"""

import ipaddress
from secrets import compare_digest
from urllib.parse import urlsplit

import httpx

from app.modules.cctv.runtime import settings

GATEWAY_API_USER = "crewnbuild-backend"
MIN_API_SECRET_LENGTH = 32
API_TIMEOUT_SECONDS = 5.0

TRANSPORT_LL_HLS = "LL_HLS"
TRANSPORT_WEBRTC = "WEBRTC"
PROTOCOL_FOR_TRANSPORT = {TRANSPORT_LL_HLS: "hls", TRANSPORT_WEBRTC: "webrtc"}

# How long the gateway may take to open a camera stream on the first request,
# and how long it keeps the camera connection after the last viewer leaves.
SOURCE_ON_DEMAND_START_TIMEOUT = "10s"
SOURCE_ON_DEMAND_CLOSE_AFTER = "10s"


class GatewayError(Exception):
    """A control API call failed. `reason` is a fixed code, never a response body."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _base_url(value: str | None, *, loopback_only: bool) -> str | None:
    """A bare http(s)://host:port base URL, or None when unusable."""
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        parts.port  # noqa: B018 - raises ValueError for an invalid port
    except ValueError:
        return None
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        return None
    if loopback_only and parts.hostname != "localhost":
        try:
            if not ipaddress.ip_address(parts.hostname).is_loopback:
                return None
        except ValueError:
            return None
    return raw.rstrip("/")


def api_base_url() -> str | None:
    return _base_url(settings.cctv_media_gateway_api_url, loopback_only=True)


def _api_secret() -> str | None:
    secret = settings.cctv_media_gateway_api_secret.get_secret_value().strip()
    return secret if len(secret) >= MIN_API_SECRET_LENGTH else None


def playback_base_url(transport: str) -> str | None:
    if transport == TRANSPORT_LL_HLS:
        return _base_url(settings.cctv_media_gateway_hls_url, loopback_only=False)
    if transport == TRANSPORT_WEBRTC:
        return _base_url(settings.cctv_media_gateway_webrtc_url, loopback_only=False)
    return None


def configured(transport: str | None = None) -> bool:
    """True when the control API and the browser URL for `transport` (or for any
    transport, when None) are usable. Reveals nothing about the values."""
    if api_base_url() is None or _api_secret() is None:
        return False
    transports = (transport,) if transport else (TRANSPORT_LL_HLS, TRANSPORT_WEBRTC)
    return any(playback_base_url(item) is not None for item in transports)


def playback_url(transport: str, gateway_path: str) -> str:
    base = playback_base_url(transport)
    if base is None:
        raise GatewayError("GATEWAY_TRANSPORT_NOT_CONFIGURED")
    suffix = "index.m3u8" if transport == TRANSPORT_LL_HLS else "whep"
    return f"{base}/{gateway_path}/{suffix}"


def api_credentials_valid(user: str | None, password: str | None) -> bool:
    """The gateway's callback for its own control API requests."""
    secret = _api_secret()
    if secret is None or not user or not password:
        return False
    return compare_digest(user.encode("utf-8"), GATEWAY_API_USER.encode("utf-8")) and compare_digest(
        password.encode("utf-8"), secret.encode("utf-8")
    )


def _client() -> httpx.Client:
    return httpx.Client(timeout=API_TIMEOUT_SECONDS, follow_redirects=False, trust_env=False)


def _call(method: str, path: str, json_body: dict | None = None) -> int:
    base, secret = api_base_url(), _api_secret()
    if base is None or secret is None:
        raise GatewayError("GATEWAY_NOT_CONFIGURED")
    try:
        with _client() as client:
            response = client.request(method, f"{base}{path}", json=json_body, auth=(GATEWAY_API_USER, secret))
    except httpx.TimeoutException:
        raise GatewayError("GATEWAY_TIMEOUT") from None
    except httpx.HTTPError:
        raise GatewayError("GATEWAY_UNREACHABLE") from None
    if response.status_code in (401, 403):
        raise GatewayError("GATEWAY_AUTH_FAILED")
    return response.status_code


def add_path(gateway_path: str, source_url: str, *, rtsp_scale: str | None = None) -> None:
    """Register one playback path whose source is the camera stream.

    `rtsp_scale` is used only by recorded playback: it makes the gateway send an
    RTSP `Scale` header to the recorder, which replays faster than real time
    (true DVR-side 1.5x/2x/3x). Live playback never sets it, so its behaviour is
    unchanged."""
    config = {
        "source": source_url,
        "rtspTransport": "tcp",
        "sourceOnDemand": True,
        "sourceOnDemandStartTimeout": SOURCE_ON_DEMAND_START_TIMEOUT,
        "sourceOnDemandCloseAfter": SOURCE_ON_DEMAND_CLOSE_AFTER,
    }
    if rtsp_scale is not None:
        config["rtspScale"] = rtsp_scale
    status_code = _call("POST", f"/v3/config/paths/add/{gateway_path}", config)
    if status_code != 200:
        raise GatewayError(f"GATEWAY_HTTP_{status_code}")


def remove_path(gateway_path: str) -> bool:
    """Remove a playback path. True if removed, False if it was already gone."""
    status_code = _call("DELETE", f"/v3/config/paths/delete/{gateway_path}")
    if status_code == 404:
        return False
    if status_code != 200:
        raise GatewayError(f"GATEWAY_HTTP_{status_code}")
    return True
