"""The one Settings class of the Professional API (technical-architecture.md CF-03, CF-04).

Every setting is read from the environment or from backend/.env. The variable name is
the field name in upper case, as before. Secrets are typed SecretStr, so printing or
logging the settings object never reveals them, and no API returns them.

Field names and defaults are carried over from the four old settings classes
(app/core/config.py, app/payment_gateway/config.py, app/subscription/config.py and
app/weather/config.py) so existing .env files keep working. Changes:
- ENVIRONMENT also accepts "staging" (section 15.2).
- ACCESS_TOKEN_MINUTES defaults to 15 (section 6.1, was 30).
- JWT_SECRET_KEY needs at least 64 characters (section 5.2, was 32).
- SMTP_PASSWORD, RESEND_API_KEY, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET and
  AWS_SECRET_ACCESS_KEY are now SecretStr like the other secrets.
- DATABASE_URL has no built-in default; it uses psycopg 3 (postgresql+psycopg://).
- New: DATABASE_SCHEMA, GLOBAL_ADMIN_PHONE, TEST_OWNER_OTP_CODE, TEST_BUILDER_OTP_CODE,
  TEST_ADMIN_OTP_CODE.
- Removed (never read by any code): UPLOAD_DIRECTORY, ACCOUNT_DELETION_PROCESSING_DAYS,
  AWS_PRESIGNED_URL_EXPIRY_SECONDS, CCTV_DISCOVERY_ENABLED. Old .env files that still set
  them load fine (extra="ignore").
"""

from functools import lru_cache
from pathlib import Path
from secrets import compare_digest
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

from app.integrations.whatsapp.response_field_path import parse_path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# The only schema this service owns (sections 1.2 and 16.2).
PROFESSIONAL_SCHEMA = "professional"

ENVIRONMENTS = ("development", "test", "staging", "production")
ENVIRONMENT_ALIASES = {"dev": "development", "testing": "test", "prod": "production"}
# Where the fixed-code test sign-in may be switched on (seed_test_accounts.py).
TEST_OTP_ENVIRONMENTS = ("development", "test", "staging")

MIN_JWT_SECRET_LENGTH = 64
OTP_CODE_LENGTH = 6
# Every .env.example placeholder starts with this (CF-02).
PLACEHOLDER_PREFIX = "change-me"
# Placeholders published in the old repository's templates and test setup. They are
# refused by value: anyone who has read that repository could forge tokens with them.
KNOWN_INSECURE_JWT_SECRETS = (
    "change-this-secret",
    "test-secret-key-not-for-production",
)


class InsecureConfigurationError(RuntimeError):
    """Raised at startup when a setting is unsafe. The message names the setting and
    the fix, never the value."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- App ----
    app_name: str = "CREWNBUILD API"
    # No default: ENVIRONMENT must name the deployment (validate_environment).
    environment: str = ""
    debug: bool = False

    # ---- Database ----
    database_url: SecretStr = Field(default=SecretStr(""), repr=False)
    database_schema: str = PROFESSIONAL_SCHEMA

    # ---- Sessions ----
    jwt_secret_key: SecretStr = Field(default=SecretStr(""), repr=False)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    # Absolute lifetime of a sign-in session; refreshing never extends it.
    refresh_token_days: int = 30
    # A session not refreshed for this long ends before its absolute lifetime.
    session_idle_days: int = 30
    # A second tab presenting a just-rotated refresh token within this many seconds is
    # told it was superseded instead of being treated as stolen.
    refresh_reuse_grace_seconds: int = 10
    # Secure is on by default; AUTH_COOKIE_SECURE=false only for plain-http LAN testing.
    auth_cookie_secure: bool = True
    auth_cookie_samesite: str = "lax"
    # Open chat and dashboard websockets re-check their session this often.
    websocket_session_recheck_seconds: float = 30.0
    frontend_origin: str = "http://localhost:5173"
    # Section 6.5: the account's own list of sign-ins in Profile Settings, with "end
    # this session". Off by default, so behaviour is unchanged until it is switched on.
    session_list_enabled: bool = False
    # Reverse proxies (comma-separated IPs or CIDRs) whose forwarded-for headers the
    # per-address limits believe. Empty ignores forwarded headers entirely.
    trusted_proxy_ips: str = "127.0.0.1,::1"
    # Largest request body accepted (R6, 14.3): JSON and forms, and multipart uploads.
    max_json_body_bytes: int = Field(default=1024 * 1024, ge=1024)
    max_upload_body_bytes: int = Field(default=12 * 1024 * 1024, ge=1024)
    # Failed password sign-ins (section 6.4), counted in PostgreSQL across processes.
    login_failure_window_seconds: int = Field(default=900, ge=60)
    login_max_failures_per_account: int = Field(default=5, ge=1)
    login_max_failures_per_address: int = Field(default=20, ge=1)

    # ---- Book Technician hand-off to Partner ----
    # How long the one-time hand-off token stays usable.
    partner_handoff_seconds: int = 60
    # ES256 (P-256) private key, PEM, that signs the hand-off and nothing else. Partner
    # holds only the public key. A "\n"-escaped single line is accepted. Empty means
    # Book Technician answers 503; production refuses to start.
    partner_handoff_private_key: SecretStr = Field(default=SecretStr(""), repr=False)

    # ---- Seeded accounts (app/seeds/) ----
    # The Global Super Admin's 10-digit Indian mobile number (+91 implied).
    global_admin_phone: str = ""
    # Fixed-code WhatsApp test sign-in. Only in development, test or staging;
    # production refuses to start when it is on.
    test_otp_login_enabled: bool = False
    test_owner_otp_code: SecretStr = Field(default=SecretStr(""), repr=False)
    test_builder_otp_code: SecretStr = Field(default=SecretStr(""), repr=False)
    test_admin_otp_code: SecretStr = Field(default=SecretStr(""), repr=False)
    # Development only: the separate /account-recovery page.
    dev_account_recovery_enabled: bool = False

    # ---- Google and Microsoft sign-in ----
    google_client_id: str = ""
    google_client_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    # Under /api/v1 since R4b; the provider consoles must list the new address.
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/google/callback"
    microsoft_client_id: str = ""
    microsoft_client_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    microsoft_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/microsoft/callback"

    # ---- E-mail ----
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = Field(default=SecretStr(""), repr=False)
    smtp_from_name: str = "CREWNBUILD"
    smtp_use_tls: bool = True
    resend_api_key: SecretStr = Field(default=SecretStr(""), repr=False)
    # Support address shown on the account deletion pages (else CONTACT_DESTINATION_EMAIL,
    # else SMTP_USER). No deletion e-mail is sent to it.
    account_deletion_notify_email: str = ""

    # ---- WhatsApp (Dovesoft direct API) ----
    whatsapp_enabled: bool = False
    whatsapp_transport: str = "direct"
    whatsapp_api_url: str = ""
    whatsapp_api_key: SecretStr = Field(default=SecretStr(""), repr=False)
    whatsapp_waba_number: str = ""
    whatsapp_default_lang: str = "en"
    whatsapp_debug: bool = False
    whatsapp_timeout_seconds: float = 10.0
    # Development only: the code flow runs unchanged but nothing is sent, and the code
    # is returned to a loopback request as `dev_otp`.
    whatsapp_dev_otp_preview: bool = False
    # The +91 WhatsApp check on the sign-up screen, apart from WHATSAPP_ENABLED.
    whatsapp_signup_otp_enabled: bool = False
    whatsapp_otp_template: str = ""
    whatsapp_welcome_template: str = ""
    whatsapp_otp_url_button: bool = False
    whatsapp_auth_header: str = ""
    whatsapp_auth_scheme: str = ""
    whatsapp_sender_header: str = ""
    whatsapp_success_field: str = ""
    whatsapp_success_value: str = ""

    # ---- Amazon S3 ----
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: SecretStr = Field(default=SecretStr(""), repr=False)
    aws_session_token: SecretStr = Field(default=SecretStr(""), repr=False)
    # Only for an S3-compatible service; blank for real AWS S3.
    aws_endpoint_url: str = ""
    aws_default_locality: str = "IN"
    aws_user_images_bucket_in: str = ""
    aws_supplier_data_bucket_in: str = ""
    aws_site_images_bucket_in: str = ""
    aws_site_videos_bucket_in: str = ""

    # ---- Local time and daily records ----
    local_timezone: str = "Asia/Kolkata"
    local_utc_offset_minutes: int = 330
    daily_work_cutoff: str = "24:00"

    # ---- Live cameras (CCTV) ----
    # Fernet key that encrypts camera credentials. Empty or invalid: credential
    # operations fail closed with 503.
    camera_credentials_key: SecretStr = Field(default=SecretStr(""), repr=False)
    cctv_allowed_networks: str = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
    cctv_connect_timeout_seconds: float = 3.0
    cctv_reconnect_min_interval_seconds: int = 10
    cctv_reconnect_max_per_minute: int = 6
    cctv_denied_audit_max_per_minute: int = 30
    cctv_playback_session_ttl_seconds: int = 120
    cctv_max_open_sessions_per_user: int = 4
    cctv_max_open_sessions_per_channel: int = 8
    cctv_media_gateway_api_url: str = ""
    cctv_media_gateway_webrtc_url: str = ""
    cctv_media_gateway_hls_url: str = ""
    cctv_media_gateway_api_secret: SecretStr = Field(default=SecretStr(""), repr=False)

    # ---- Translation and Vastu (OpenAI-compatible API) ----
    openai_api_key: SecretStr = Field(default=SecretStr(""), repr=False)
    openai_translation_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    translation_cache_directory: str = "translation_cache"
    vastu_vision_model: str = ""
    vastu_gemini_base_url: str = ""
    vastu_analysis_timeout_seconds: float = 120.0
    vastu_analysis_max_attempts: int = 2
    vastu_analysis_deadline_seconds: float = 180.0
    vastu_min_confidence: float = 0.8
    vastu_direction_margin_degrees: float = 5.0
    vastu_pdf_render_long_side_px: int = 2400
    vastu_pdf_min_scale: float = 1.0
    vastu_pdf_max_scale: float = 8.0
    vastu_analysis_max_per_hour_per_ip: int = 10

    # ---- Contact form and support page ----
    contact_destination_email: str = ""
    contact_max_per_hour_per_ip: int = 5
    support_email: str = ""
    support_phone: str = ""
    support_whatsapp: str = ""
    support_hours: str = ""
    support_response_time: str = ""
    support_max_tickets_per_hour: int = 5

    # ---- Razorpay (was PaymentGatewaySettings) ----
    razorpay_mode: str = "test"
    razorpay_key_id: str = ""
    razorpay_key_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    razorpay_webhook_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    razorpay_api_base_url: str = "https://api.razorpay.com/v1"
    razorpay_timeout_seconds: float = 10.0
    # Local simulated checkout while no keys exist; production refuses to start with it.
    razorpay_allow_mock: bool = False

    # ---- Builder subscriptions (was SubscriptionSettings) ----
    subscription_grace_days: int = Field(default=0, ge=0, le=60)
    subscription_reminder_days: int = Field(default=3, ge=0, le=60)
    subscription_sweep_interval_minutes: int = Field(default=60, ge=0, le=1440)

    # ---- Weather (was WeatherSettings) ----
    weather_api_provider: str = "open-meteo"
    weather_api_key: SecretStr = Field(default=SecretStr(""), repr=False)
    weather_api_base_url: str = ""
    weather_geocoding_base_url: str = "https://geocoding-api.open-meteo.com/v1"
    weather_air_quality_base_url: str = "https://air-quality-api.open-meteo.com/v1"
    weather_reverse_geocoding_base_url: str = "https://nominatim.openstreetmap.org"
    weather_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    weather_max_retries: int = Field(default=2, ge=0, le=5)
    weather_cache_minutes: int = Field(default=25, ge=1, le=1440)
    weather_max_stale_minutes: int = Field(default=180, ge=5, le=2880)
    weather_forecast_days: int = Field(default=14, ge=1, le=16)
    weather_monitoring_enabled: bool = True
    weather_monitoring_interval_minutes: int = Field(default=30, ge=0, le=1440)
    weather_severe_check_interval_minutes: int = Field(default=10, ge=1, le=1440)
    weather_notify_min_severity: str = "WATCH"
    weather_reopen_window_hours: int = Field(default=6, ge=0, le=72)
    weather_email_alerts_enabled: bool = False
    weather_threshold_overrides: str = ""

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: object) -> object:
        # Some Windows development environments expose DEBUG=release globally.
        if isinstance(value, str) and value.strip().lower() in {"release", "production", "prod"}:
            return False
        return value

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: object) -> object:
        if isinstance(value, str):
            name = value.strip().lower()
            return ENVIRONMENT_ALIASES.get(name, name)
        return value

    @field_validator("smtp_password", mode="before")
    @classmethod
    def normalize_smtp_password(cls, value: object) -> object:
        # A Google app password is shown as four groups of four; the spaces are not
        # part of it.
        if isinstance(value, str):
            return "".join(value.split())
        return value

    @field_validator("partner_handoff_private_key", mode="before")
    @classmethod
    def normalize_partner_handoff_private_key(cls, value: object) -> object:
        # A PEM is several lines; one escaped line ("\n") is easier to put in .env.
        if isinstance(value, str):
            return value.strip().replace("\\n", "\n")
        return value

    def is_production(self) -> bool:
        return self.environment == "production"

    def is_development(self) -> bool:
        return self.environment == "development"


def is_placeholder(value: str) -> bool:
    return value.strip().lower().startswith(PLACEHOLDER_PREFIX)


# Optional secrets: empty means the feature that needs it answers 503 (or stays off),
# exactly as before. A value still holding the .env.example placeholder is treated as
# empty outside production and refused in production (CF-04).
OPTIONAL_SECRET_FIELDS = (
    "google_client_secret",
    "microsoft_client_secret",
    "smtp_password",
    "resend_api_key",
    "whatsapp_api_key",
    "aws_secret_access_key",
    "aws_session_token",
    "camera_credentials_key",
    "cctv_media_gateway_api_secret",
    "openai_api_key",
    "razorpay_key_secret",
    "razorpay_webhook_secret",
    "weather_api_key",
)
# Public identifiers that come in a pair with a secret above; a placeholder is treated
# the same way.
OPTIONAL_PLACEHOLDER_FIELDS = (
    "google_client_id",
    "microsoft_client_id",
    "aws_access_key_id",
    "razorpay_key_id",
    "global_admin_phone",
)


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
            "DATABASE_URL is not set. Copy .env.example to .env and set the crewnbuild_professional "
            "connection (postgresql+psycopg://...)."
        )
    try:
        url = make_url(raw_url)
    except Exception:
        raise InsecureConfigurationError("DATABASE_URL is not a valid database address.") from None
    if url.drivername != "postgresql+psycopg":
        raise InsecureConfigurationError("DATABASE_URL must use the psycopg 3 driver (postgresql+psycopg://).")
    if configured.database_schema != PROFESSIONAL_SCHEMA:
        raise InsecureConfigurationError(f"DATABASE_SCHEMA must be {PROFESSIONAL_SCHEMA}.")
    if configured.is_production():
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


def validate_development_flags(configured: Settings) -> None:
    """Development switches (CF-04). The on-screen OTP preview and the account recovery
    page stay development-only, as before; the test sign-in is allowed in development,
    test and staging; nothing of the kind is allowed in production."""
    if configured.whatsapp_dev_otp_preview and not configured.is_development():
        raise InsecureConfigurationError("WHATSAPP_DEV_OTP_PREVIEW=true is only allowed with ENVIRONMENT=development.")
    if configured.dev_account_recovery_enabled and not configured.is_development():
        raise InsecureConfigurationError(
            "DEV_ACCOUNT_RECOVERY_ENABLED=true is only allowed with ENVIRONMENT=development."
        )
    if configured.test_otp_login_enabled and configured.environment not in TEST_OTP_ENVIRONMENTS:
        raise InsecureConfigurationError(
            "TEST_OTP_LOGIN_ENABLED=true is only allowed with ENVIRONMENT=development, test or staging."
        )
    if configured.razorpay_allow_mock and configured.is_production():
        raise InsecureConfigurationError("RAZORPAY_ALLOW_MOCK=true is not allowed with ENVIRONMENT=production.")


def validate_test_otp_codes(configured: Settings) -> None:
    if not configured.test_otp_login_enabled:
        return
    for name, secret in (
        ("TEST_OWNER_OTP_CODE", configured.test_owner_otp_code),
        ("TEST_BUILDER_OTP_CODE", configured.test_builder_otp_code),
        ("TEST_ADMIN_OTP_CODE", configured.test_admin_otp_code),
    ):
        code = secret.get_secret_value().strip()
        if len(code) != OTP_CODE_LENGTH or not code.isdigit():
            raise InsecureConfigurationError(
                f"TEST_OTP_LOGIN_ENABLED=true requires {name} to be {OTP_CODE_LENGTH} digits."
            )


def load_partner_handoff_private_key(pem: str) -> object:
    """The hand-off signing key, which must be an EC P-256 private key (ES256)."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    key = load_pem_private_key(pem.encode("utf-8"), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("not a P-256 private key")
    return key


def validate_partner_handoff_key(configured: Settings) -> None:
    pem = configured.partner_handoff_private_key.get_secret_value()
    if not pem or is_placeholder(pem):
        if configured.is_production():
            raise InsecureConfigurationError(
                "Production requires PARTNER_HANDOFF_PRIVATE_KEY (an ES256 / P-256 private key in PEM form)."
            )
        # Outside production an unset key means Book Technician answers 503, as before.
        configured.partner_handoff_private_key = SecretStr("")
        return
    try:
        load_partner_handoff_private_key(pem)
    except (ValueError, TypeError):
        raise InsecureConfigurationError(
            "PARTNER_HANDOFF_PRIVATE_KEY is not a valid ES256 (P-256) private key in PEM form."
        ) from None


def validate_optional_secrets(configured: Settings) -> None:
    """A placeholder copied from .env.example must never be used as a real value."""
    for field_name in OPTIONAL_SECRET_FIELDS:
        secret: SecretStr = getattr(configured, field_name)
        if is_placeholder(secret.get_secret_value()):
            if configured.is_production():
                raise InsecureConfigurationError(
                    f"{field_name.upper()} is still a placeholder. Set the real value or leave it empty."
                )
            setattr(configured, field_name, SecretStr(""))
    for field_name in OPTIONAL_PLACEHOLDER_FIELDS:
        if is_placeholder(getattr(configured, field_name)):
            if configured.is_production():
                raise InsecureConfigurationError(
                    f"{field_name.upper()} is still a placeholder. Set the real value or leave it empty."
                )
            setattr(configured, field_name, "")


def validate_whatsapp(configured: Settings) -> None:
    """Only when the sign-up check is switched on: it must be able to send."""
    if not configured.whatsapp_signup_otp_enabled:
        return
    if not configured.whatsapp_enabled:
        raise InsecureConfigurationError("WHATSAPP_SIGNUP_OTP_ENABLED=true requires WHATSAPP_ENABLED=true.")
    if (configured.whatsapp_transport or "").strip().lower() != "direct":
        raise InsecureConfigurationError("WHATSAPP_TRANSPORT must be direct (the Dovesoft direct API).")
    missing = [
        name
        for name, value in (
            ("WHATSAPP_API_URL", configured.whatsapp_api_url),
            ("WHATSAPP_API_KEY", configured.whatsapp_api_key.get_secret_value()),
            ("WHATSAPP_WABA_NUMBER", configured.whatsapp_waba_number),
            ("WHATSAPP_OTP_TEMPLATE", configured.whatsapp_otp_template),
            ("WHATSAPP_AUTH_HEADER", configured.whatsapp_auth_header),
            ("WHATSAPP_SUCCESS_FIELD", configured.whatsapp_success_field),
        )
        if not (value or "").strip()
    ]
    if missing:
        raise InsecureConfigurationError(
            "WHATSAPP_SIGNUP_OTP_ENABLED=true requires " + ", ".join(missing) + " in backend/.env."
        )
    if not configured.whatsapp_api_url.strip().startswith("https://"):
        raise InsecureConfigurationError("WHATSAPP_API_URL must be an https:// address.")
    if parse_path(configured.whatsapp_success_field) is None:
        raise InsecureConfigurationError(
            "WHATSAPP_SUCCESS_FIELD must be a field path of keys and [indexes], such as messages[0].message_status."
        )
    if configured.is_production() and configured.whatsapp_debug:
        raise InsecureConfigurationError("Production requires WHATSAPP_DEBUG=false.")


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
    validate_development_flags(configured)
    validate_database(configured)
    validate_jwt_secret(configured)
    validate_session_cookies(configured)
    validate_test_otp_codes(configured)
    validate_partner_handoff_key(configured)
    validate_optional_secrets(configured)
    validate_whatsapp(configured)
    validate_production(configured)
    return configured


@lru_cache
def get_settings() -> Settings:
    return check_settings(Settings())
