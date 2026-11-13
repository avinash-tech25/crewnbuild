"""The hand-off check (read_professional_handoff), with no database: ES256 only, issuer
professional, audience partner, a jti, at most 60 seconds, and no role read from it."""

import uuid

import jwt
import pytest
from conftest import make_settings
from helpers import key_pair, professional_handoff, sign_handoff

from app.core.security.access_tokens import read_professional_handoff


@pytest.fixture(scope="module")
def keys() -> tuple[str, str]:
    return key_pair()


def check(public_pem: str, token: str) -> tuple[uuid.UUID, str] | None:
    return read_professional_handoff(make_settings(professional_handoff_public_key=public_pem), token)


def test_a_token_signed_by_professional_is_accepted(keys: tuple[str, str]) -> None:
    """End to end: Professional's own create_partner_handoff_token, in its own environment."""
    private_pem, public_pem = keys
    account = uuid.uuid4()
    token = professional_handoff(private_pem, account)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["iss"] == "professional" and claims["aud"] == "partner" and "role" not in claims
    assert claims["exp"] - claims["iat"] <= 60
    accepted = check(public_pem, token)
    assert accepted is not None and accepted[0] == account and accepted[1] == claims["jti"]
    # Signed with another key pair: refused.
    assert check(key_pair()[1], token) is None


def test_what_is_refused(keys: tuple[str, str]) -> None:
    private_pem, public_pem = keys
    account = uuid.uuid4()
    assert check(public_pem, sign_handoff(private_pem, account)) is not None
    refused = {
        "old issuer": sign_handoff(private_pem, account, iss="octabuild"),
        "other audience": sign_handoff(private_pem, account, aud="professional"),
        "other type": sign_handoff(private_pem, account, type="access"),
        "no jti": sign_handoff(private_pem, account, jti=None),
        "no iat": sign_handoff(private_pem, account, iat=None),
        "longer than 60 s": sign_handoff(private_pem, account, lifetime=61),
        "expired": sign_handoff(private_pem, account, lifetime=-5),
        "HS256 with a shared secret": sign_handoff(private_pem, account, _algorithm="HS256", _key="s" * 64),
        "not a uuid subject": sign_handoff(private_pem, account, sub="not-a-uuid"),
    }
    for reason, token in refused.items():
        assert check(public_pem, token) is None, reason
    # Without a configured public key every hand-off is refused.
    assert read_professional_handoff(make_settings(), sign_handoff(private_pem, account)) is None


def test_a_role_claim_is_never_read(keys: tuple[str, str]) -> None:
    private_pem, public_pem = keys
    account = uuid.uuid4()
    assert check(public_pem, sign_handoff(private_pem, account, role="ADMIN")) is not None
