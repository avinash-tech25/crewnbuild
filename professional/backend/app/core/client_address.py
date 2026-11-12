"""The visitor's address for per-address limits, proxy-aware.

Behind nginx every request reaches the API from the proxy, so the connecting address
alone would count every visitor as one. The forwarded headers name the visitor, but
anyone can send them, so they are believed only when the connection itself comes from
a configured trusted proxy (TRUSTED_PROXY_IPS). Anything else is counted under the
address that actually connected.

X-Forwarded-For is read from the right: each proxy appends the address it saw, so the
right-most entry that is not a trusted proxy is the one the trusted chain vouches for.
Ported unchanged from the old app/shared/auth/services/client_address.py.
"""

import ipaddress
import logging
from functools import lru_cache

from starlette.requests import Request

logger = logging.getLogger(__name__)

Network = ipaddress.IPv4Network | ipaddress.IPv6Network
Address = ipaddress.IPv4Address | ipaddress.IPv6Address


@lru_cache(maxsize=8)
def trusted_networks(raw: str) -> tuple[Network, ...]:
    """TRUSTED_PROXY_IPS parsed once per value. An entry that is not an IP or a CIDR is
    skipped (and logged), never trusted."""
    networks: list[Network] = []
    for entry in (raw or "").split(","):
        cleaned = entry.strip()
        if not cleaned:
            continue
        try:
            networks.append(ipaddress.ip_network(cleaned, strict=False))
        except ValueError:
            logger.warning("TRUSTED_PROXY_IPS: ignoring %r, which is not an IP address or network", cleaned)
    return tuple(networks)


def parse_ip(value: str | None) -> Address | None:
    try:
        return ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None


def is_trusted(address: Address | None, networks: tuple[Network, ...]) -> bool:
    return address is not None and any(address in network for network in networks)


def visitor_address(request: Request, trusted_proxy_ips: str) -> str | None:
    """The address a per-address limit counts this request under."""
    peer = request.client.host if request.client else None
    networks = trusted_networks(trusted_proxy_ips)
    if not is_trusted(parse_ip(peer), networks):
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        for hop in reversed(hops):
            hop_ip = parse_ip(hop)
            if hop_ip is None:
                break
            if not is_trusted(hop_ip, networks):
                return str(hop_ip)
        else:
            first = parse_ip(hops[0]) if hops else None
            if first is not None:
                return str(first)

    real_ip = parse_ip(request.headers.get("x-real-ip"))
    if real_ip is not None:
        return str(real_ip)
    return peer
