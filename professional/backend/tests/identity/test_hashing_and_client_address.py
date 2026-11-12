"""Password hashing (Argon2id, legacy bcrypt) and the proxy-aware client address (ported
from the old tests/auth/test_client_address.py)."""

import bcrypt
import pytest
from starlette.requests import Request

from app.core.client_address import trusted_networks, visitor_address
from app.core.config import Settings
from app.core.security.password_hashing import hash_secret, needs_rehash, password_is_strong, verify_secret

DEFAULT = "127.0.0.1,::1"


def test_argon2id_hashes_verify_and_need_no_rehash() -> None:
    stored = hash_secret("Strong#Pass123")
    assert stored.startswith("$argon2id$")
    assert verify_secret("Strong#Pass123", stored)
    assert not verify_secret("strong#pass123", stored)
    assert not needs_rehash(stored)


def test_legacy_bcrypt_hashes_verify_and_need_a_rehash() -> None:
    legacy = bcrypt.hashpw(b"Strong#Pass123", bcrypt.gensalt(rounds=4)).decode()
    assert verify_secret("Strong#Pass123", legacy)
    assert not verify_secret("wrong", legacy)
    assert needs_rehash(legacy)


@pytest.mark.parametrize("stored", ["", None, "plain-text", "$1$md5"])
def test_unknown_hash_formats_never_verify(stored: str | None) -> None:
    assert not verify_secret("anything", stored)


def test_password_rule_is_unchanged() -> None:
    assert password_is_strong("Strong#Pass123")
    for weak in ("Short#1a", "nouppercase#123", "NOLOWERCASE#123", "NoDigits#Here", "NoSymbol1234a"):
        assert not password_is_strong(weak)


def request(peer: str | None = "127.0.0.1", **headers: str) -> Request:
    raw = [(name.replace("_", "-").lower().encode(), value.encode()) for name, value in headers.items()]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/phone/login/send-code",
        "headers": raw,
        "client": (peer, 50000) if peer else None,
        "query_string": b"",
    }
    return Request(scope)


def test_default_trusts_only_this_machine() -> None:
    assert Settings.model_fields["trusted_proxy_ips"].default == DEFAULT


def test_visitors_behind_nginx_are_told_apart() -> None:
    first = visitor_address(request(x_forwarded_for="198.51.100.10", x_real_ip="198.51.100.10"), DEFAULT)
    second = visitor_address(request(x_forwarded_for="203.0.113.20", x_real_ip="203.0.113.20"), DEFAULT)
    assert (first, second) == ("198.51.100.10", "203.0.113.20")


def test_a_forged_forwarded_header_cannot_choose_the_address() -> None:
    forged = request(x_forwarded_for="1.2.3.4, 198.51.100.10", x_real_ip="198.51.100.10")
    assert visitor_address(forged, DEFAULT) == "198.51.100.10"


@pytest.mark.parametrize(
    "headers",
    [{"x_forwarded_for": "1.2.3.4"}, {"x_real_ip": "1.2.3.4"}, {"x_forwarded_for": "1.2.3.4", "x_real_ip": "5.6.7.8"}],
)
def test_headers_from_an_untrusted_peer_are_ignored(headers: dict[str, str]) -> None:
    assert visitor_address(request(peer="198.51.100.99", **headers), DEFAULT) == "198.51.100.99"


def test_chain_of_trusted_proxies_is_skipped_from_the_right() -> None:
    chain = request(peer="10.0.0.5", x_forwarded_for="1.2.3.4, 198.51.100.10, 10.0.0.4")
    assert visitor_address(chain, "10.0.0.0/8") == "198.51.100.10"


def test_malformed_forwarded_entry_falls_back_to_x_real_ip_then_peer() -> None:
    assert visitor_address(request(x_forwarded_for="not-an-ip", x_real_ip="198.51.100.10"), DEFAULT) == "198.51.100.10"
    assert visitor_address(request(x_forwarded_for="not-an-ip"), DEFAULT) == "127.0.0.1"


def test_empty_setting_and_missing_client() -> None:
    assert visitor_address(request(x_forwarded_for="198.51.100.10"), "") == "127.0.0.1"
    assert visitor_address(request(peer=None), DEFAULT) is None


def test_invalid_trusted_entries_are_ignored_not_trusted() -> None:
    assert [str(network) for network in trusted_networks("127.0.0.1, nonsense, 10.0.0.0/8,")] == [
        "127.0.0.1/32",
        "10.0.0.0/8",
    ]
