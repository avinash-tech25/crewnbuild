import secrets
from typing import Any

import pytest

from app.core.config import InsecureConfigurationError, Settings, check_settings

PRODUCTION_DATABASE_URL = "postgresql+psycopg://crewnbuild_professional:real-password@db:5432/crewnbuild"


def production_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "production",
        "database_url": PRODUCTION_DATABASE_URL,
        "jwt_secret_key": secrets.token_urlsafe(64),
        "auth_cookie_secure": True,
        "frontend_origin": "https://app.example.in",
        "partner_handoff_private_key": make_handoff_private_key(),
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def make_handoff_private_key() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode("ascii")


def test_valid_production_settings_start() -> None:
    check_settings(production_settings())


def test_environment_must_be_named() -> None:
    with pytest.raises(InsecureConfigurationError, match="ENVIRONMENT"):
        check_settings(production_settings(environment=""))


def test_staging_is_an_accepted_environment() -> None:
    check_settings(production_settings(environment="staging"))


@pytest.mark.parametrize(
    "flag",
    ["razorpay_allow_mock", "whatsapp_dev_otp_preview", "test_otp_login_enabled", "dev_account_recovery_enabled"],
)
def test_production_refuses_every_development_flag(flag: str) -> None:
    with pytest.raises(InsecureConfigurationError, match=flag.upper()):
        check_settings(production_settings(**{flag: True}))


def test_test_otp_login_is_allowed_in_staging_with_six_digit_codes() -> None:
    check_settings(
        production_settings(
            environment="staging",
            test_otp_login_enabled=True,
            test_owner_otp_code="123456",
            test_builder_otp_code="234567",
            test_admin_otp_code="345678",
        )
    )


def test_test_otp_login_needs_six_digit_codes() -> None:
    with pytest.raises(InsecureConfigurationError, match="TEST_OWNER_OTP_CODE"):
        check_settings(production_settings(environment="staging", test_otp_login_enabled=True))


def test_short_jwt_secret_is_refused() -> None:
    with pytest.raises(InsecureConfigurationError, match="too short"):
        check_settings(production_settings(jwt_secret_key="x" * 63))


def test_placeholder_jwt_secret_is_refused_everywhere() -> None:
    with pytest.raises(InsecureConfigurationError, match="placeholder"):
        check_settings(production_settings(environment="development", jwt_secret_key="change-me-" + "x" * 60))


def test_production_requires_the_handoff_key() -> None:
    with pytest.raises(InsecureConfigurationError, match="PARTNER_HANDOFF_PRIVATE_KEY"):
        check_settings(production_settings(partner_handoff_private_key=""))


def test_production_refuses_placeholder_database_password() -> None:
    url = "postgresql+psycopg://crewnbuild_professional:change-me@db:5432/crewnbuild"
    with pytest.raises(InsecureConfigurationError, match="DATABASE_URL"):
        check_settings(production_settings(database_url=url))


def test_database_url_must_use_psycopg_3() -> None:
    url = "postgresql+psycopg2://crewnbuild_professional:real-password@db:5432/crewnbuild"
    with pytest.raises(InsecureConfigurationError, match="psycopg 3"):
        check_settings(production_settings(database_url=url))


def test_production_refuses_a_placeholder_optional_secret() -> None:
    with pytest.raises(InsecureConfigurationError, match="RAZORPAY_KEY_SECRET"):
        check_settings(production_settings(razorpay_key_secret="change-me"))


def test_placeholder_optional_secret_counts_as_unset_outside_production() -> None:
    configured = check_settings(
        production_settings(environment="development", razorpay_key_id="change-me", razorpay_key_secret="change-me")
    )
    assert configured.razorpay_key_id == ""
    assert configured.razorpay_key_secret.get_secret_value() == ""


def test_secrets_never_appear_in_repr() -> None:
    configured = production_settings()
    assert configured.jwt_secret_key.get_secret_value() not in repr(configured)
    assert "real-password" not in repr(configured)
