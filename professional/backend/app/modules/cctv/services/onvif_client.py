"""A deliberately small, hardened ONVIF client (httpx + Python standard library).

It speaks exactly six ONVIF operations and nothing else:

    Device service   GetSystemDateAndTime   (unauthenticated clock check)
                     GetDeviceInformation   (identity, and the authentication test)
                     GetCapabilities        (where the Media service lives)
    Media service    GetVideoSources
                     GetProfiles
                     GetStreamUri           (server-side only; never leaves the backend)

Safety properties, all enforced here rather than trusted to callers:

  * The host is always the device's validated, configured IP literal. A service
    address returned by the device contributes its PATH (and port) only; its
    host is ignored, so a device cannot redirect the backend elsewhere.
  * Credentials never appear in a URL. The password is sent only as a
    WS-UsernameToken PasswordDigest, or through HTTP Digest when the device
    demands it; it lives in memory only for the duration of the call.
  * No redirects are followed, no proxy/environment settings are honoured
    (trust_env=False), TLS certificates are verified, and every call has
    connect and read timeouts.
  * Responses are size-capped, refused if they declare a DOCTYPE or ENTITY
    (no DTD, no entity expansion), and parsed with the standard library parser.
  * Failures are raised as OnvifFailure(result, reason) where both values are
    fixed codes -- never an exception message, URL or response body.

Nothing is assumed about a particular manufacturer: no path, port, token,
channel number or model is hard-coded. The one fixed path is the ONVIF Core
Specification's default device-service entry point, used only when the device
record does not name its own.
"""

import base64
import hashlib
import secrets
import ssl
import unicodedata
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

import httpx

from app.modules.cctv.services import network_policy
from app.modules.cctv.services.credentials import PlainCredentials

# --- result codes -------------------------------------------------------------
RESULT_NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE"
RESULT_SERVICE_UNREACHABLE = "SERVICE_UNREACHABLE"
RESULT_AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
RESULT_DEVICE_PROTOCOL_ERROR = "DEVICE_PROTOCOL_ERROR"
RESULT_DEVICE_VERIFIED = "DEVICE_VERIFIED"
RESULT_UNSUPPORTED_PROTOCOL = "UNSUPPORTED_PROTOCOL"
# Two further outcomes the required six cannot express honestly:
#   the device answered correctly, but also answered WITHOUT credentials, so a
#   successful sign-in proves nothing -> never reported as DEVICE_VERIFIED;
#   the device reports a different serial number than the one on record.
RESULT_AUTHENTICATION_NOT_ENFORCED = "AUTHENTICATION_NOT_ENFORCED"
RESULT_DEVICE_IDENTITY_MISMATCH = "DEVICE_IDENTITY_MISMATCH"

RESULT_CODES = (
    RESULT_NETWORK_UNREACHABLE,
    RESULT_SERVICE_UNREACHABLE,
    RESULT_AUTHENTICATION_FAILED,
    RESULT_DEVICE_PROTOCOL_ERROR,
    RESULT_DEVICE_VERIFIED,
    RESULT_UNSUPPORTED_PROTOCOL,
    RESULT_AUTHENTICATION_NOT_ENFORCED,
    RESULT_DEVICE_IDENTITY_MISMATCH,
)

# ONVIF Core Specification default device service entry point.
DEFAULT_DEVICE_SERVICE_PATH = "/onvif/device_service"

MAX_RESPONSE_BYTES = 1_048_576
READ_TIMEOUT_SECONDS = 8.0
MAX_TOKEN_LENGTH = 128  # cctv_channels token columns are varchar(128)
MAX_TEXT_LENGTH = 120  # identity columns are varchar(120)
MAX_DIMENSION = 16384
MAX_VIDEO_SOURCES = 256
MAX_PROFILES = 512
MAX_CLOCK_OFFSET = timedelta(days=7)

SOAP_12 = "http://www.w3.org/2003/05/soap-envelope"
SOAP_11 = "http://schemas.xmlsoap.org/soap/envelope/"
NS_DEVICE = "http://www.onvif.org/ver10/device/wsdl"
NS_MEDIA = "http://www.onvif.org/ver10/media/wsdl"
NS_SCHEMA = "http://www.onvif.org/ver10/schema"
# Recorded-playback discovery only. The Search and Recording services locate the
# recordings and their real time spans; no recording is ever mutated.
NS_SEARCH = "http://www.onvif.org/ver10/search/wsdl"
NS_RECORDING = "http://www.onvif.org/ver10/recording/wsdl"
NS_WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
NS_WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
PASSWORD_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
NONCE_ENCODING = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"

ACTION_GET_SYSTEM_DATE_AND_TIME = f"{NS_DEVICE}/GetSystemDateAndTime"
ACTION_GET_DEVICE_INFORMATION = f"{NS_DEVICE}/GetDeviceInformation"
ACTION_GET_CAPABILITIES = f"{NS_DEVICE}/GetCapabilities"
ACTION_GET_VIDEO_SOURCES = f"{NS_MEDIA}/GetVideoSources"
ACTION_GET_PROFILES = f"{NS_MEDIA}/GetProfiles"
ACTION_GET_STREAM_URI = f"{NS_MEDIA}/GetStreamUri"
ACTION_GET_SERVICES = f"{NS_DEVICE}/GetServices"
MAX_SERVICES = 64
MAX_RECORDINGS = 256
SEARCH_POLL_ROUNDS = 6

_AUTH_FAULT_MARKERS = ("notauthorized", "failedauthentication", "invalidsecurity", "unauthorized", "senderunauthorized")
_UNSUPPORTED_FAULT_MARKERS = ("actionnotsupported", "notimplemented", "servicenotsupported")


class OnvifFailure(Exception):
    """A device operation failed. `result` and `reason` are fixed codes only."""

    def __init__(self, result: str, reason: str):
        super().__init__(f"{result}:{reason}")
        self.result = result
        self.reason = reason


@dataclass(frozen=True)
class DeviceInformation:
    manufacturer: str | None
    model: str | None
    firmware_version: str | None
    serial_number: str | None


@dataclass(frozen=True)
class VideoSource:
    token: str
    width: int | None
    height: int | None


@dataclass(frozen=True)
class RecordingSpan:
    """One recording's real, closed time span, as the device reports it (UTC).

    `source_token` is the VideoSourceConfiguration token the recording is fed
    from, so a recording can be matched to a saved channel without trusting any
    channel number.
    """

    recording_token: str
    source_token: str | None
    earliest: datetime | None
    latest: datetime | None


@dataclass(frozen=True)
class MediaProfile:
    token: str
    name: str | None
    source_token: str | None
    source_name: str | None
    encoding: str | None
    width: int | None
    height: int | None
    # The profile's VideoEncoderConfiguration token. Media1 can describe only
    # JPEG, MPEG4 and H264, so a device streaming H.265 may send the encoder
    # configuration with no Encoding or Resolution; the token still shows the
    # profile carries video.
    encoder_token: str | None = None


# --- XML helpers --------------------------------------------------------------


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _children(element, name: str) -> list:
    return [child for child in list(element) if _local(child.tag) == name]


def _child(element, name: str):
    for child in list(element):
        if _local(child.tag) == name:
            return child
    return None


def _descendant(element, name: str):
    for node in element.iter():
        if node is not element and _local(node.tag) == name:
            return node
    return None


def _clean_text(value: str | None, max_length: int = MAX_TEXT_LENGTH) -> str | None:
    """Device-reported text, stripped of control characters and bounded."""
    if value is None:
        return None
    text = "".join(ch for ch in value.strip() if unicodedata.category(ch) not in ("Cc", "Cf"))
    return text[:max_length] or None


def _text(element, name: str, max_length: int = MAX_TEXT_LENGTH) -> str | None:
    child = _child(element, name) if element is not None else None
    return _clean_text(child.text if child is not None else None, max_length)


def _token(value: str | None) -> str | None:
    """A device token is used verbatim in later requests, so it must be exact and bounded."""
    if value is None:
        return None
    token = value.strip()
    if not token or len(token) > MAX_TOKEN_LENGTH or any(unicodedata.category(ch) in ("Cc", "Cf") for ch in token):
        return None
    return token


def _parse_utc(child) -> datetime | None:
    """A device ISO-8601 UTC timestamp element -> aware datetime, or None."""
    text = (child.text or "").strip() if child is not None and child.text else ""
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _dimension(element, name: str) -> int | None:
    text = _text(element, name, 16) if element is not None else None
    try:
        value = int(text) if text is not None else None
    except ValueError:
        return None
    return value if value is not None and 1 <= value <= MAX_DIMENSION else None


def parse_soap(data: bytes):
    """Parse a device response into its SOAP Body element, or raise OnvifFailure."""
    if not data or not data.strip():
        raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "EMPTY_RESPONSE")
    lowered = data.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        # No DTDs and no entity declarations: removes entity expansion and
        # external entity resolution entirely, before the parser ever runs.
        raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "XML_DTD_REFUSED")
    try:
        parser = ElementTree.XMLParser()  # noqa: S314 - DTDs and entities are refused above, before parsing
        parser.feed(data)
        root = parser.close()
    except ElementTree.ParseError:
        raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "NOT_XML") from None
    if _local(root.tag) != "Envelope" or root.tag.split("}", 1)[0].lstrip("{") not in (SOAP_12, SOAP_11):
        raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "NOT_SOAP")
    body = _child(root, "Body")
    if body is None:
        raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "SOAP_BODY_MISSING")
    return body


def _fault_failure(fault) -> OnvifFailure:
    codes = " ".join((node.text or "") for node in fault.iter() if _local(node.tag) in ("Value", "faultcode")).lower()
    if any(marker in codes for marker in _AUTH_FAULT_MARKERS):
        return OnvifFailure(RESULT_AUTHENTICATION_FAILED, "SOAP_FAULT_NOT_AUTHORIZED")
    if any(marker in codes for marker in _UNSUPPORTED_FAULT_MARKERS):
        return OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "SOAP_FAULT_NOT_SUPPORTED")
    return OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "SOAP_FAULT")


def _connect_error_failure(error: BaseException) -> OnvifFailure:
    seen = 0
    current: BaseException | None = error
    while current is not None and seen < 8:
        if isinstance(current, ConnectionRefusedError):
            return OnvifFailure(RESULT_SERVICE_UNREACHABLE, "CONNECTION_REFUSED")
        if isinstance(current, ssl.SSLError):
            return OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "TLS_FAILED")
        current = current.__cause__ or current.__context__
        seen += 1
    return OnvifFailure(RESULT_NETWORK_UNREACHABLE, "CONNECT_FAILED")


# --- client -------------------------------------------------------------------


class OnvifClient:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        use_tls: bool,
        device_service_path: str,
        credentials: PlainCredentials | None,
        connect_timeout: float,
        read_timeout: float = READ_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ):
        # The host must already have passed network_policy.validate_device_host;
        # it is validated again here so this class is never a way around it.
        self._host = network_policy.validate_device_host(host, "host")
        self._port = network_policy.validate_port(port, "onvif_port")
        self._scheme = "https" if use_tls else "http"
        self._device_path = (
            network_policy.validate_service_path(device_service_path, "onvif_service_path")
            or DEFAULT_DEVICE_SERVICE_PATH
        )
        self._credentials = credentials
        self._clock_offset = timedelta(0)
        self._use_http_digest = False
        self._media_port = self._port
        self._media_path: str | None = None
        # Search / Recording service addresses, filled by locate_services().
        self._services: dict[str, tuple[int, str]] = {}
        self._client = httpx.Client(
            timeout=httpx.Timeout(connect=connect_timeout, read=read_timeout, write=read_timeout, pool=connect_timeout),
            follow_redirects=False,
            trust_env=False,
            verify=True,
            transport=transport,
            headers={"User-Agent": "CREWNBUILD-CCTV/1"},
        )

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self) -> None:
        self._client.close()
        self._credentials = None

    # -- transport ------------------------------------------------------------

    def _url(self, port: int, path: str) -> str:
        host = f"[{self._host}]" if ":" in self._host else self._host
        return f"{self._scheme}://{host}:{port}{path}"

    def _security_header(self) -> str:
        if self._credentials is None:
            return ""
        nonce = secrets.token_bytes(16)
        created = (datetime.now(UTC) + self._clock_offset).strftime("%Y-%m-%dT%H:%M:%SZ")
        digest = base64.b64encode(
            hashlib.sha1(  # noqa: S324 - WS-Security PasswordDigest is defined as SHA-1
                nonce + created.encode("ascii") + self._credentials.password.get_secret_value().encode("utf-8")
            ).digest()
        ).decode("ascii")
        username = escape(self._credentials.username.get_secret_value())
        return (
            f'<s:Header><wsse:Security xmlns:wsse="{NS_WSSE}" xmlns:wsu="{NS_WSU}" s:mustUnderstand="1">'
            f"<wsse:UsernameToken><wsse:Username>{username}</wsse:Username>"
            f'<wsse:Password Type="{PASSWORD_DIGEST}">{digest}</wsse:Password>'
            f'<wsse:Nonce EncodingType="{NONCE_ENCODING}">{base64.b64encode(nonce).decode("ascii")}</wsse:Nonce>'
            f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>"
        )

    def _envelope(self, body: str, authenticated: bool) -> bytes:
        header = self._security_header() if authenticated else ""
        return (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<s:Envelope xmlns:s="{SOAP_12}" xmlns:tds="{NS_DEVICE}" xmlns:trt="{NS_MEDIA}" xmlns:tt="{NS_SCHEMA}">'
            f"{header}<s:Body>{body}</s:Body></s:Envelope>"
        ).encode()

    def _post(
        self, port: int, path: str, action: str, body: str, *, authenticated: bool = True, _retried: bool = False
    ):
        authenticated = authenticated and self._credentials is not None
        auth = None
        if authenticated and self._use_http_digest:
            auth = httpx.DigestAuth(
                self._credentials.username.get_secret_value(),
                self._credentials.password.get_secret_value(),
            )
        headers = {"Content-Type": f'application/soap+xml; charset=utf-8; action="{action}"'}
        chunks: list[bytes] = []
        try:
            with self._client.stream(
                "POST", self._url(port, path), content=self._envelope(body, authenticated), headers=headers, auth=auth
            ) as response:
                status_code = response.status_code
                challenge = response.headers.get("www-authenticate", "").lower()
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "RESPONSE_TOO_LARGE")
                    chunks.append(chunk)
        except OnvifFailure:
            raise
        except httpx.ConnectTimeout:
            raise OnvifFailure(RESULT_NETWORK_UNREACHABLE, "CONNECT_TIMEOUT") from None
        except httpx.ConnectError as error:
            raise _connect_error_failure(error) from None
        except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout):
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "READ_TIMEOUT") from None
        except httpx.HTTPError:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "HTTP_ERROR") from None
        finally:
            auth = None

        if 300 <= status_code < 400:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "REDIRECT_REFUSED")
        if status_code == 401:
            if authenticated and not self._use_http_digest and not _retried and "digest" in challenge:
                self._use_http_digest = True
                return self._post(port, path, action, body, authenticated=True, _retried=True)
            raise OnvifFailure(RESULT_AUTHENTICATION_FAILED, "HTTP_401")
        if status_code == 403:
            raise OnvifFailure(RESULT_AUTHENTICATION_FAILED, "HTTP_403")
        if status_code in (404, 405, 501):
            raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, f"HTTP_{status_code}")

        soap_body = parse_soap(b"".join(chunks))
        fault = _child(soap_body, "Fault")
        if fault is not None:
            raise _fault_failure(fault)
        if status_code >= 400:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, f"HTTP_{status_code}")
        return soap_body

    def _device(self, action: str, body: str, *, authenticated: bool = True):
        return self._post(self._port, self._device_path, action, body, authenticated=authenticated)

    def _media(self, action: str, body: str):
        if self._media_path is None:
            raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "MEDIA_SERVICE_UNKNOWN")
        return self._post(self._media_port, self._media_path, action, body)

    # -- operations -----------------------------------------------------------

    def sync_clock(self) -> None:
        """Align WS-Security timestamps with the device clock. Best effort:
        a device that refuses the unauthenticated clock call is still usable."""
        try:
            body = self._device(ACTION_GET_SYSTEM_DATE_AND_TIME, "<tds:GetSystemDateAndTime/>", authenticated=False)
        except OnvifFailure as failure:
            if failure.result in (RESULT_NETWORK_UNREACHABLE, RESULT_SERVICE_UNREACHABLE):
                raise
            return
        utc = _descendant(body, "UTCDateTime")
        date, clock = (_child(utc, "Date"), _child(utc, "Time")) if utc is not None else (None, None)
        try:
            device_now = datetime(
                int(_text(date, "Year", 4)),
                int(_text(date, "Month", 2)),
                int(_text(date, "Day", 2)),
                int(_text(clock, "Hour", 2)),
                int(_text(clock, "Minute", 2)),
                int(_text(clock, "Second", 2)),
                tzinfo=UTC,
            )
        except (TypeError, ValueError):
            return
        offset = device_now - datetime.now(UTC)
        if abs(offset) <= MAX_CLOCK_OFFSET:
            self._clock_offset = offset

    def get_device_information(self, *, authenticated: bool = True) -> DeviceInformation:
        body = self._device(ACTION_GET_DEVICE_INFORMATION, "<tds:GetDeviceInformation/>", authenticated=authenticated)
        response = _descendant(body, "GetDeviceInformationResponse")
        if response is None:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "DEVICE_INFORMATION_MISSING")
        return DeviceInformation(
            manufacturer=_text(response, "Manufacturer"),
            model=_text(response, "Model"),
            firmware_version=_text(response, "FirmwareVersion"),
            serial_number=_text(response, "SerialNumber"),
        )

    def locate_media_service(self) -> None:
        body = self._device(
            ACTION_GET_CAPABILITIES, "<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>"
        )
        capabilities = _descendant(body, "Capabilities")
        media = _child(capabilities, "Media") if capabilities is not None else None
        address = _clean_text(
            _child(media, "XAddr").text if media is not None and _child(media, "XAddr") is not None else None, 512
        )
        if not address:
            raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "MEDIA_SERVICE_MISSING")
        try:
            parts = urlsplit(address)
            port = parts.port
        except ValueError:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "MEDIA_ADDRESS_INVALID") from None
        if parts.scheme.lower() not in ("http", "https") or parts.username or parts.password:
            raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "MEDIA_ADDRESS_UNSUPPORTED")
        try:
            path = network_policy.validate_service_path(parts.path or "/", "media_service_path")
        except Exception:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "MEDIA_ADDRESS_INVALID") from None
        # Only the path and port are taken from the device. The host is always
        # the configured, policy-checked device address.
        self._media_path = path
        self._media_port = network_policy.validate_port(port, "media_port") if port else self._port

    def get_video_sources(self) -> list[VideoSource]:
        body = self._media(ACTION_GET_VIDEO_SOURCES, "<trt:GetVideoSources/>")
        response = _descendant(body, "GetVideoSourcesResponse")
        if response is None:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "VIDEO_SOURCES_MISSING")
        sources: list[VideoSource] = []
        seen: set[str] = set()
        for element in _children(response, "VideoSources")[:MAX_VIDEO_SOURCES]:
            token = _token(element.get("token"))
            if token is None or token in seen:
                continue
            seen.add(token)
            resolution = _child(element, "Resolution")
            sources.append(
                VideoSource(token=token, width=_dimension(resolution, "Width"), height=_dimension(resolution, "Height"))
            )
        return sources

    def get_profiles(self) -> list[MediaProfile]:
        body = self._media(ACTION_GET_PROFILES, "<trt:GetProfiles/>")
        response = _descendant(body, "GetProfilesResponse")
        if response is None:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "PROFILES_MISSING")
        profiles: list[MediaProfile] = []
        for element in _children(response, "Profiles")[:MAX_PROFILES]:
            token = _token(element.get("token"))
            if token is None:
                continue
            source_config = _child(element, "VideoSourceConfiguration")
            encoder = _child(element, "VideoEncoderConfiguration")
            resolution = _child(encoder, "Resolution") if encoder is not None else None
            profiles.append(
                MediaProfile(
                    token=token,
                    name=_text(element, "Name"),
                    source_token=_token(_child(source_config, "SourceToken").text)
                    if source_config is not None and _child(source_config, "SourceToken") is not None
                    else None,
                    source_name=_text(source_config, "Name") if source_config is not None else None,
                    encoding=_text(encoder, "Encoding", 16) if encoder is not None else None,
                    width=_dimension(resolution, "Width"),
                    height=_dimension(resolution, "Height"),
                    encoder_token=_token(encoder.get("token")) if encoder is not None else None,
                )
            )
        return profiles

    def get_stream_uri(self, profile_token: str) -> str | None:
        """The RTSP URI for a profile. The caller keeps it server-side."""
        token = _token(profile_token)
        if token is None:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "PROFILE_TOKEN_INVALID")
        body = self._media(
            ACTION_GET_STREAM_URI,
            "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>"
            "<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>"
            f"<trt:ProfileToken>{escape(token)}</trt:ProfileToken></trt:GetStreamUri>",
        )
        media_uri = _descendant(body, "MediaUri")
        uri = _child(media_uri, "Uri") if media_uri is not None else None
        text = (uri.text or "").strip() if uri is not None else ""
        return text or None

    # -- recorded-playback discovery (read-only) ------------------------------

    def _service(self, namespace: str) -> tuple[int, str]:
        located = self._services.get(namespace)
        if located is None:
            raise OnvifFailure(RESULT_UNSUPPORTED_PROTOCOL, "SERVICE_NOT_ADVERTISED")
        return located

    def _service_call(self, namespace: str, operation: str, inner: str = ""):
        port, path = self._service(namespace)
        body = f'<{operation} xmlns="{namespace}">{inner}</{operation}>'
        return self._post(port, path, f"{namespace}/{operation}", body)

    def locate_services(self) -> None:
        """Populate the Search and Recording service addresses from GetServices.

        Only the PATH and PORT of each service are taken from the device; the
        host is always the configured, policy-checked device address (identical
        to the rule locate_media_service already applies)."""
        body = self._device(
            ACTION_GET_SERVICES,
            "<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>",
        )
        response = _descendant(body, "GetServicesResponse")
        if response is None:
            raise OnvifFailure(RESULT_DEVICE_PROTOCOL_ERROR, "SERVICES_MISSING")
        for service in _children(response, "Service")[:MAX_SERVICES]:
            namespace = _clean_text(
                _child(service, "Namespace").text if _child(service, "Namespace") is not None else None, 128
            )
            address = _clean_text(_child(service, "XAddr").text if _child(service, "XAddr") is not None else None, 512)
            if namespace not in (NS_SEARCH, NS_RECORDING) or not address:
                continue
            try:
                parts = urlsplit(address)
                if parts.scheme.lower() not in ("http", "https") or parts.username or parts.password:
                    continue
                path = network_policy.validate_service_path(parts.path or "/", "service_path")
                port = network_policy.validate_port(parts.port, "service_port") if parts.port else self._port
            except Exception:
                continue
            self._services[namespace] = (port, path)

    def recording_spans(self) -> list[RecordingSpan]:
        """Every recording the device holds, with its real time span (UTC).

        GetRecordings is a Recording-service operation; GetRecordingInformation
        (which carries the span) is a Search-service operation -- they live on
        different service addresses, both discovered by locate_services()."""
        body = self._service_call(NS_RECORDING, "GetRecordings")
        spans: list[RecordingSpan] = []
        seen: set[str] = set()
        for item in [node for node in body.iter() if _local(node.tag) == "RecordingItem"][:MAX_RECORDINGS]:
            recording_token = _token(_text(item, "RecordingToken", MAX_TOKEN_LENGTH))
            if recording_token is None or recording_token in seen:
                continue
            seen.add(recording_token)
            earliest = latest = None
            source_token = None
            try:
                info_body = self._service_call(
                    NS_SEARCH, "GetRecordingInformation", f"<RecordingToken>{escape(recording_token)}</RecordingToken>"
                )
                info = _descendant(info_body, "RecordingInformation")
                if info is not None:
                    earliest = _parse_utc(_child(info, "EarliestRecording"))
                    latest = _parse_utc(_child(info, "LatestRecording"))
                    source = _descendant(info, "SourceId") or _descendant(info, "SourceToken")
                    source_token = _clean_text(source.text, MAX_TOKEN_LENGTH) if source is not None else None
            except OnvifFailure:
                pass
            spans.append(RecordingSpan(recording_token, source_token, earliest, latest))
        return spans
