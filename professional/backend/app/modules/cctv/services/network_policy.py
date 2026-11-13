"""What a camera device address, port and stream path are allowed to be.

Every host, port and path a user supplies passes through here before it is
stored, and the host is checked again immediately before any connection is
attempted, so a device saved under a looser policy cannot be used after the
policy is tightened.

The rules exist to stop the backend being turned into a tool against its own
network (SSRF): a device address must be an IP literal inside a configured
network, and can never be loopback, link-local, multicast, unspecified,
reserved, or one of this machine's own addresses. Host names are not accepted,
which also removes DNS rebinding. A stream path is a path, never a URL: no
scheme, no host, no user-info and no credential parameters.
"""

import ipaddress
import re
import socket
import threading
import time
import unicodedata
from urllib.parse import unquote

from fastapi import status

from app.modules.cctv.runtime import settings
from app.modules.cctv.services import cctv_error, field_error

HOST_MAX_LENGTH = 253
STREAM_PATH_MAX_LENGTH = 512
LOCAL_ADDRESS_CACHE_SECONDS = 60

# Characters a stream path may contain. No '@', '#', '\\', quotes, spaces,
# brackets or shell metacharacters.
_STREAM_PATH_CHARACTERS = re.compile(r"^/[A-Za-z0-9._~\-/?&=+,;:%]*$")
_PERCENT_ESCAPE = re.compile(r"%(?![0-9A-Fa-f]{2})")
# Some recorders put the login in the stream path ("...&user=admin&password=...").
# Such a path would carry a credential in the clear, so it is refused outright.
_CREDENTIAL_PARAMETER = re.compile(
    r"(?:^|[/?&;])(user|username|usr|login|pass|passwd|password|pwd|auth|token|key|secret)=",
    re.IGNORECASE,
)


def allowed_networks() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    networks = []
    for entry in (settings.cctv_allowed_networks or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # A policy that cannot be read is not a policy: refuse everything.
            raise cctv_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "CCTV_NETWORK_POLICY_MISCONFIGURED",
                "The camera network policy is not configured correctly.",
            ) from None
    return networks


_local_lock = threading.Lock()
_local_cache: dict = {"at": 0.0, "addresses": frozenset()}


def local_machine_addresses() -> frozenset:
    """This computer's own addresses, so a device can never point back at it.

    Uses the host name's resolved addresses plus the source address the system
    would route through. The latter "connects" a UDP socket to a documentation
    address, which sends no packet.
    """
    now = time.monotonic()
    with _local_lock:
        if now - _local_cache["at"] < LOCAL_ADDRESS_CACHE_SECONDS:
            return _local_cache["addresses"]
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            addresses.add(ipaddress.ip_address(str(info[4][0]).split("%")[0]))
    except (OSError, ValueError):
        pass
    for family, probe in ((socket.AF_INET, ("192.0.2.1", 9)), (socket.AF_INET6, ("2001:db8::1", 9))):
        try:
            with socket.socket(family, socket.SOCK_DGRAM) as probe_socket:
                probe_socket.connect(probe)
                addresses.add(ipaddress.ip_address(str(probe_socket.getsockname()[0]).split("%")[0]))
        except (OSError, ValueError):
            pass
    frozen = frozenset(addresses)
    with _local_lock:
        _local_cache["at"] = now
        _local_cache["addresses"] = frozen
    return frozen


def validate_device_host(value: str | None, field: str = "host") -> str:
    """Return the canonical IP literal, or raise a 422 that names the field only."""
    raw = (value or "").strip()
    if not raw:
        raise field_error(field, "Enter the device IP address.")
    if (
        len(raw) > HOST_MAX_LENGTH
        or "://" in raw
        or any(character in raw for character in "/@\\%[]#?")
        or any(character.isspace() for character in raw)
    ):
        raise field_error(field, "Enter only the device IP address, without a scheme, port, path or user name.")
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        raise field_error(field, "Enter the device IP address. Host names are not accepted.") from None

    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if (
        address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    ):
        raise field_error(field, "This address cannot be used for a camera device.", "CCTV_NETWORK_POLICY_REJECTED")
    if address in local_machine_addresses():
        raise field_error(
            field, "This computer's own address cannot be used for a camera device.", "CCTV_NETWORK_POLICY_REJECTED"
        )
    if not any(address in network for network in allowed_networks() if network.version == address.version):
        raise field_error(
            field, "This address is outside the networks permitted for camera devices.", "CCTV_NETWORK_POLICY_REJECTED"
        )
    return address.compressed.lower()


def validate_port(value, field: str, *, required: bool = True) -> int | None:
    if value is None:
        if required:
            raise field_error(field, "Enter the port number.")
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 65535:
        raise field_error(field, "Enter a port between 1 and 65535.")
    return value


def validate_stream_path(value: str | None, field: str) -> str | None:
    """A stream path such as `/Streaming/Channels/101`. Never a URL."""
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    if len(raw) > STREAM_PATH_MAX_LENGTH:
        raise field_error(field, f"The stream path must be at most {STREAM_PATH_MAX_LENGTH} characters.")
    decoded = unquote(raw)
    if (
        not raw.startswith("/")
        or "://" in raw
        or "//" in raw
        or not _STREAM_PATH_CHARACTERS.fullmatch(raw)
        or _PERCENT_ESCAPE.search(raw)
        or "@" in decoded
        or "\\" in decoded
        or "://" in decoded
        or any(unicodedata.category(character) in ("Cc", "Cf") for character in decoded)
        or any(segment in ("..", ".") for segment in decoded.split("?", 1)[0].split("/"))
    ):
        raise field_error(field, "Enter only the stream path, starting with '/'. Full URLs are not accepted.")
    if _CREDENTIAL_PARAMETER.search(decoded):
        raise field_error(field, "The stream path must not contain a user name, password or token.")
    return raw


SERVICE_PATH_MAX_LENGTH = 255
_SERVICE_PATH_CHARACTERS = re.compile(r"^/[A-Za-z0-9._~\-/]*$")


def validate_service_path(value: str | None, field: str) -> str | None:
    """An ONVIF service path such as `/onvif/device_service`: letters, digits and
    `._~-/` only -- no query, no scheme, no host, no user-info, no traversal."""
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    if (
        len(raw) > SERVICE_PATH_MAX_LENGTH
        or not _SERVICE_PATH_CHARACTERS.fullmatch(raw)
        or "//" in raw
        or any(segment in ("..", ".") for segment in raw.split("/"))
    ):
        raise field_error(field, "Enter only the ONVIF service path, starting with '/'.")
    return raw


TCP_OPEN = "OPEN"
TCP_REFUSED = "REFUSED"
TCP_TIMEOUT = "TIMEOUT"
TCP_UNREACHABLE = "UNREACHABLE"


def tcp_probe(host: str, port: int, timeout: float) -> str:
    """Classify a TCP connection attempt to an already-validated address.

    REFUSED means something answered and rejected the port (the host is up);
    TIMEOUT / UNREACHABLE mean nothing answered. Nothing is sent or read.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return TCP_OPEN
    except ConnectionRefusedError:
        return TCP_REFUSED
    except TimeoutError:
        return TCP_TIMEOUT
    except (OSError, ValueError):
        return TCP_UNREACHABLE


def tcp_port_reachable(host: str, port: int, timeout: float) -> bool:
    """Whether a TCP connection to an already-validated address is accepted.

    Nothing is sent and nothing is read: this says the port is open, not that a
    camera answered or that any credential is valid.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ValueError):
        return False
