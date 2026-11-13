"""The one Settings class of the Partner API (technical-architecture.md CF-03, CF-04).

Every setting is read from the environment or from backend/.env. The variable name is
the field name in upper case, as before. Secrets are typed SecretStr, so printing or
logging the settings object never reveals them, and no API returns them.

Part 1 of R4c carries over the settings identity needs from the old Partner
app/core/config.py, with the old names and defaults. Changes:
- ENVIRONMENT also accepts "staging" (section 15.2).
- ACCESS_TOKEN_MINUTES defaults to 15 (section 6.1, was 30).
- JWT_SECRET_KEY needs at least 64 characters (section 5.2, was 32), and the
  .env.example placeholder is refused.
- DATABASE_URL has no built-in default and uses psycopg 3 (postgresql+psycopg://).
- PROFESSIONAL_HANDOFF_PUBLIC_KEY replaces OCTABUILD_HANDOFF_PUBLIC_KEY; the old name
  is still read when the new one is not set, for one release.
- New: DATABASE_SCHEMA and PROFESSIONAL_SCHEMA (where Professional's requester view
  lives).
The settings of bookings, dispatch, tracking, media and weather come with part 2.
"""

import re
from functools import lru_cache
from pathlib import Path
from secrets import compare_digest
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# The only schema this service owns (sections 1.2 and 16.2).
PARTNER_SCHEMA = "partner"
# Where Professional publishes the requester view Partner reads (section 11.1).
PROFESSIONAL_SCHEMA = "professional"

ENVIRONMENTS = ("development", "test", "staging", "production")
ENVIRONMENT_ALIASES = {"dev": "development", "testing": "test", "prod": "production"}

MIN_JWT_SECRET_LENGTH = 64
PLACEHOLDER_PREFIX = "change-me"
# Placeholders published in the old repository's templates and code: refused by value.
KNOWN_INSECURE_JWT_SECRETS = (
    "change-this-partner-secret",
    "change-this-secret",
    "test-secret-key-not-for-production",
)
SCHEMA_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class InsecureConfigurationError(RuntimeError):
    """Raised at startup when a setting is unsafe. The message names the setting and the
    fix, never the value."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    # ---- App ----
    app_name: str = "Partner API"
    environment: str = ""
    debug: bool = False

    # ---- Database ----
    database_url: SecretStr = Field(default=SecretStr(""), repr=False)
    database_schema: str = PARTNER_SCHEMA
    professional_schema: str = PROFESSIONAL_SCHEMA

    # ---- Sessions ----
    jwt_secret_key: SecretStr = Field(default=SecretStr(""), repr=False)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    # A technician session's absolute lifetime; refreshing never extends it.
    refresh_token_days: int = 30
    # A technician session not refreshed for this long ends early.
    session_idle_days: int = 30
    # A booking (requester) session's whole lifetime.
    requester_session_minutes: int = 60
    # A second tab presenting a just-rotated refresh token within this many seconds is
    # told it was superseded instead of being treated as stolen.
    refresh_reuse_grace_seconds: int = 10
    # Secure is on by default; AUTH_COOKIE_SECURE=false only for plain-http LAN testing.
    auth_cookie_secure: bool = True
    auth_cookie_samesite: str = "lax"
    frontend_origin: str = "http://localhost:5373"

    # ---- Local time (times are stored in UTC and shown in this zone, DB-08) ----
    local_timezone: str = "Asia/Kolkata"
    local_utc_offset_minutes: int = 330

    # ---- The Book Technician hand-off from Professional ----
    # ES256 (P-256) PUBLIC key, PEM, matching Professional's PARTNER_HANDOFF_PRIVATE_KEY.
    # A public key can only verify: Partner can never mint a hand-off. A "\n"-escaped
    # single line is accepted. Empty means hand-offs are refused; production refuses to
    # start without it.
    professional_handoff_public_key: str = ""
    # The old name, read only when the new one is not set (for one release).
    octabuild_handoff_public_key: str = ""
    # A hand-off must not live longer than this (Professional issues 60-second tokens).
    handoff_max_seconds: int = 60

    # ---- Technician sign-in throttle (counted in this process, as before) ----
    login_failure_window_seconds: int = 900
    login_max_failures_per_email: int = 10
    login_max_failures_per_client: int = 50

    # ---- E-mail codes ----
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = Field(default=SecretStr(""), repr=False)
    smtp_from_name: str = "CREWNBUILD"
    smtp_use_tls: bool = True
    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 30
    otp_max_sends_per_hour: int = 5
    password_reset_token_minutes: int = 10

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: object) -> object:
        if isinstance(value, str):
            name = value.strip().lower()
            return ENVIRONMENT_ALIASES.get(name, name)
        return value

    @field_validator("professional_handoff_public_key", "octabuild_handoff_public_key", mode="before")
    @classmethod
    def normalize_handoff_public_key(cls, value: object) -> object:
        # A PEM is several lines; one escaped line ("\n") is easier to put in .env.
        if isinstance(value, str):
            return value.strip().replace("\\n", "\n")
        return value

    @field_validator("smtp_password", mode="before")
    @classmethod
    def normalize_smtp_password(cls, value: object) -> object:
        # A Google app password is shown as four groups of four; the spaces are not part of it.
        if isinstance(value, str):
            return "".join(value.split())
        return value

    def is_production(self) -> bool:
        return self.environment == "production"

    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_user and self.smtp_password.get_secret_value())


def is_placeholder(value: str) -> bool:
    return value.strip().lower().startswith(PLACEHOLDER_PREFIX)


def validate_environment(configured: Settings) -> None:
    if configured.environment not in ENVIRONMENTS:
        raise InsecureConfigurationError(
            "ENVIRONMENT must be set explicitly to development, test, staging or production "
            "(in backend/.env or the process environment)."
        )


def validate_database(configured: Settings) -> None:
    raw_url = configured.database_url.get_secret_value().strip()
    if not raw_url:
        raise InsecureConfigurationError(
            "DATABASE_URL is not set. Copy .env.example to .env and set the crewnbuild_partner "
            "connection (postgresql+psycopg://...)."
        )
    try:
        url = make_url(raw_url)
    except Exception:
        raise InsecureConfigurationError("DATABASE_URL is not a valid database address.") from None
    if url.drivername != "postgresql+psycopg":
        raise InsecureConfigurationError("DATABASE_URL must use the psycopg 3 driver (postgresql+psycopg://).")
    if configured.database_schema != PARTNER_SCHEMA:
        raise InsecureConfigurationError(f"DATABASE_SCHEMA must be {PARTNER_SCHEMA}.")
    if not SCHEMA_NAME.match(configured.professional_schema):
        raise InsecureConfigurationError("PROFESSIONAL_SCHEMA must be a plain schema name.")
    if configured.is_production():
        if configured.professional_schema != PROFESSIONAL_SCHEMA:
            raise InsecureConfigurationError(f"Production requires PROFESSIONAL_SCHEMA={PROFESSIONAL_SCHEMA}.")
        password = url.password or ""
        if not password or is_placeholder(password) or (url.username == "postgres" and password == "postgres"):  # noqa: S105 refuses the default
            raise InsecureConfigurationError("Production requires DATABASE_URL with real credentials.")


def validate_jwt_secret(configured: Settings) -> None:
    # Checked in every environment: a reachable development server with a forgeable
    # token secret is just as exposed.
    value = configured.jwt_secret_key.get_secret_value()
    if not value.strip():
        raise InsecureConfigurationError(
            "JWT_SECRET_KEY is not set. Set a strong random secret of at least "
            f"{MIN_JWT_SECRET_LENGTH} characters in backend/.env (never commit it)."
        )
    if is_placeholder(value) or any(
        compare_digest(value.encode("utf-8"), known.encode("utf-8")) for known in KNOWN_INSECURE_JWT_SECRETS
    ):
        raise InsecureConfigurationError(
            "JWT_SECRET_KEY is still a placeholder. Replace it with a strong random secret of at least "
            f"{MIN_JWT_SECRET_LENGTH} characters in backend/.env."
        )
    if len(value) < MIN_JWT_SECRET_LENGTH:
        raise InsecureConfigurationError(
            f"JWT_SECRET_KEY is too short. Use a strong random secret of at least {MIN_JWT_SECRET_LENGTH} characters."
        )


def validate_session_cookies(configured: Settings) -> None:
    samesite = (configured.auth_cookie_samesite or "").strip().lower()
    if samesite not in {"lax", "strict", "none"}:
        raise InsecureConfigurationError("AUTH_COOKIE_SAMESITE must be lax, strict or none.")
    if samesite == "none" and not configured.auth_cookie_secure:
        raise InsecureConfigurationError("AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true.")
    if configured.is_production() and not configured.auth_cookie_secure:
        raise InsecureConfigurationError("Production requires AUTH_COOKIE_SECURE=true.")


def load_handoff_public_key(pem: str) -> object:
    """Professional's hand-off verification key: an EC P-256 PUBLIC key (ES256). A private
    key or a shared secret is refused: Partner must not be able to sign."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    if "PRIVATE" in pem.upper():
        raise ValueError("a private key, not a public key")
    key = load_pem_public_key(pem.encode("utf-8"))
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("not a P-256 public key")
    return key


def validate_handoff_public_key(configured: Settings) -> None:
    if not configured.professional_handoff_public_key and configured.octabuild_handoff_public_key:
        configured.professional_handoff_public_key = configured.octabuild_handoff_public_key
    configured.octabuild_handoff_public_key = ""
    pem = configured.professional_handoff_public_key
    if not pem or is_placeholder(pem):
        if configured.is_production():
            raise InsecureConfigurationError(
                "Production requires PROFESSIONAL_HANDOFF_PUBLIC_KEY (Professional's ES256 / P-256 public key, PEM)."
            )
        # Outside production an unset key means hand-offs are refused, as before.
        configured.professional_handoff_public_key = ""
        return
    try:
        load_handoff_public_key(pem)
    except (ValueError, TypeError):
        raise InsecureConfigurationError(
            "PROFESSIONAL_HANDOFF_PUBLIC_KEY is not a valid ES256 (P-256) public key in PEM form."
        ) from None
    if not 0 < configured.handoff_max_seconds <= 60:
        raise InsecureConfigurationError("HANDOFF_MAX_SECONDS must be between 1 and 60.")


def validate_optional_secrets(configured: Settings) -> None:
    """A placeholder copied from .env.example is treated as empty outside production and
    refused in production (CF-04)."""
    if is_placeholder(configured.smtp_password.get_secret_value()):
        if configured.is_production():
            raise InsecureConfigurationError(
                "SMTP_PASSWORD is still a placeholder. Set the real value or leave it empty."
            )
        configured.smtp_password = SecretStr("")


def is_local_origin(origin: str) -> bool:
    host = (urlsplit(origin).hostname or "").lower()
    return host in {"localhost", "::1"} or host.startswith("127.") or host.endswith(".localhost")


def validate_production(configured: Settings) -> None:
    if not configured.is_production():
        return
    if configured.debug:
        raise InsecureConfigurationError("Production requires DEBUG=false.")
    origin = (configured.frontend_origin or "").strip()
    if not origin.startswith("https://") or is_local_origin(origin):
        raise InsecureConfigurationError("Production requires FRONTEND_ORIGIN to be the deployed https:// address.")


def check_settings(configured: Settings) -> Settings:
    """Every startup check, in order. Raises InsecureConfigurationError on the first problem."""
    validate_environment(configured)
    validate_database(configured)
    validate_jwt_secret(configured)
    validate_session_cookies(configured)
    validate_handoff_public_key(configured)
    validate_optional_secrets(configured)
    validate_production(configured)
    return configured


@lru_cache
def get_settings() -> Settings:
    return check_settings(Settings())
