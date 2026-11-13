"""The startup checks of the Partner settings."""

import pytest
from conftest import make_settings
from helpers import key_pair

from app.core.config import InsecureConfigurationError

ESCAPED_NEWLINE = chr(92) + "n"


def one_line(pem: str) -> str:
    """The PEM as one .env line, its line breaks written as backslash-n."""
    return pem.replace(chr(10), ESCAPED_NEWLINE)


PRODUCTION = {
    "environment": "production",
    "auth_cookie_secure": True,
    "frontend_origin": "https://partner.example.in",
    "database_url": "postgresql+psycopg://crewnbuild_partner:a-real-password@db:5432/crewnbuild",
    "professional_schema": "professional",
    "data_encryption_key": "kQJ3n3QqKq9vV4hYb8bS1oY3m3h3o9Jf0Jz0X8m6m1Y=",
}


def refused(**values: object) -> str:
    with pytest.raises(InsecureConfigurationError) as error:
        make_settings(**values)
    return str(error.value)


def test_the_jwt_secret_and_database_are_checked() -> None:
    assert "too short" in refused(jwt_secret_key="x" * 63)
    assert "placeholder" in refused(jwt_secret_key="change-me-generate-64-random-bytes" + "x" * 40)
    assert "placeholder" in refused(jwt_secret_key="change-this-partner-secret")
    assert "psycopg 3" in refused(database_url="postgresql+psycopg2://a:b@localhost/crewnbuild_test")
    assert "DATABASE_SCHEMA" in refused(database_schema="professional")
    assert "plain schema name" in refused(professional_schema="professional; drop")
    assert "ENVIRONMENT" in refused(environment="")


def test_the_handoff_key_must_be_a_p256_public_key() -> None:
    private_pem, public_pem = key_pair()
    assert make_settings(professional_handoff_public_key=one_line(public_pem)).professional_handoff_public_key
    assert "not a valid ES256" in refused(professional_handoff_public_key=private_pem)
    assert "not a valid ES256" in refused(
        professional_handoff_public_key="-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----"
    )
    # A placeholder outside production means hand-offs are refused, not a crash.
    assert make_settings(professional_handoff_public_key="change-me").professional_handoff_public_key == ""


def test_production_refusals() -> None:
    _, public_pem = key_pair()
    assert make_settings(**PRODUCTION, professional_handoff_public_key=public_pem).is_production()
    assert "PROFESSIONAL_HANDOFF_PUBLIC_KEY" in refused(**PRODUCTION)
    production = {**PRODUCTION, "professional_handoff_public_key": public_pem}
    assert "AUTH_COOKIE_SECURE" in refused(**{**production, "auth_cookie_secure": False})
    assert "FRONTEND_ORIGIN" in refused(**{**production, "frontend_origin": "http://localhost:5373"})
    assert "PROFESSIONAL_SCHEMA" in refused(**{**production, "professional_schema": "partner"})
    assert "DATA_ENCRYPTION_KEY" in refused(**{**production, "data_encryption_key": ""})
    assert "Fernet" in refused(data_encryption_key="not-a-key")
    assert "real credentials" in refused(
        **{**production, "database_url": "postgresql+psycopg://crewnbuild_partner:change-me@db/crewnbuild"}
    )


def test_the_old_public_key_name_is_not_read(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import Settings, check_settings

    _, public_pem = key_pair()
    monkeypatch.delenv("PROFESSIONAL_HANDOFF_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("OCTABUILD_HANDOFF_PUBLIC_KEY", one_line(public_pem))
    assert check_settings(Settings(_env_file=None)).professional_handoff_public_key == ""


# ---- R6: production refuses every placeholder, naming the setting only ----


@pytest.mark.parametrize(
    ("field", "value"),
    [("smtp_user", "change-me"), ("geocoder_user_agent", "change-me-agent"), ("smtp_password", "change-me")],
)
def test_production_refuses_any_placeholder(field: str, value: str) -> None:
    _, public_pem = key_pair()
    message = refused(**PRODUCTION, professional_handoff_public_key=public_pem, **{field: value})
    assert field.upper() in message and value not in message.replace(field.upper(), "")
    assert make_settings(**{field: value})  # away from production it does not stop the process


@pytest.mark.parametrize(
    ("overrides", "named"), [({"debug": True}, "DEBUG"), ({"auth_cookie_secure": False}, "AUTH_COOKIE_SECURE")]
)
def test_production_refuses_debug_and_insecure_cookies(overrides: dict, named: str) -> None:
    _, public_pem = key_pair()
    assert named in refused(**{**PRODUCTION, "professional_handoff_public_key": public_pem, **overrides})
