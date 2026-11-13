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
- PROFESSIONAL_HANDOFF_PUBLIC_KEY replaces OCTABUILD_HANDOFF_PUBLIC_KEY (the old name is
  not read: no deployment of this repository ever set it).
- New: DATABASE_SCHEMA and PROFESSIONAL_SCHEMA (where Professional's requester view
  lives).
The settings of bookings, dispatch, tracking, media and weather come with part 2.
"""

import re
from decimal import Decimal
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
    # An open websocket re-checks its session (live, not revoked or expired, account
    # still allowed) this often.
    websocket_session_recheck_seconds: float = 30.0

    # ---- Local time (times are stored in UTC and shown in this zone, DB-08) ----
    local_timezone: str = "Asia/Kolkata"
    local_utc_offset_minutes: int = 330

    # ---- The Book Technician hand-off from Professional ----
    # ES256 (P-256) PUBLIC key, PEM, matching Professional's PARTNER_HANDOFF_PRIVATE_KEY.
    # A public key can only verify: Partner can never mint a hand-off. A "\n"-escaped
    # single line is accepted. Empty means hand-offs are refused; production refuses to
    # start without it.
    professional_handoff_public_key: str = ""
    # A hand-off must not live longer than this (Professional issues 60-second tokens).
    handoff_max_seconds: int = 60

    # ---- Technician sign-in throttle (counted in this process, as before) ----
    login_failure_window_seconds: int = 900
    login_max_failures_per_email: int = 5
    login_max_failures_per_client: int = 20
    # Proxies whose X-Forwarded-For / X-Real-IP name the visitor (IPs or CIDRs).
    trusted_proxy_ips: str = "127.0.0.1,::1"
    # Largest request body accepted (R6, 14.3): JSON and forms, and multipart uploads.
    max_json_body_bytes: int = Field(default=1024 * 1024, ge=1024)
    max_upload_body_bytes: int = Field(default=8 * 1024 * 1024, ge=1024)

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

    # ---- Part 2: onboarding, bookings, dispatch, tracking (the old Partner settings) ----
    upload_directory: str = "uploads"
    pincode_directory_url: str = "https://api.postalpincode.in/pincode"

    # --- Start Work OTP (0012) -------------------------------------------------------
    # The code the customer gives the technician on site; the job can start only with it.
    start_otp_ttl_minutes: int = 30
    start_otp_max_attempts: int = 5
    start_otp_regenerate_cooldown_seconds: int = 30
    start_otp_max_codes_per_hour: int = 10

    # --- Identity data (face capture, Aadhaar) ---------------------------------
    # A Fernet key (urlsafe base64, 32 bytes). Encrypts the temporary face capture
    # and the Aadhaar number at rest. Generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    data_encryption_key: SecretStr = Field(default=SecretStr(""), repr=False)
    # The version stored beside every ciphertext written with DATA_ENCRYPTION_KEY (DB-11).
    data_encryption_key_version: int = 1
    # Earlier keys, still able to decrypt what they wrote: "version:key,version:key".
    data_encryption_previous_keys: SecretStr = Field(default=SecretStr(""), repr=False)
    # Face captures are kept only for review and removed after a decision or
    # after this many days, whichever comes first.
    face_capture_directory: str = "private/face_captures"
    face_capture_retention_days: int = 7
    # Whether a technician's face and Aadhaar must be VERIFIED (by a reviewer or
    # a provider) before jobs are offered. With no verification provider
    # configured, submitted-and-pending is the most that can be true, so the
    # default accepts PENDING; set true once verification is in place.
    require_verified_identity_for_jobs: bool = False

    # --- Earnings ------------------------------------------------------------------
    # Platform commission, in percent of a completed job's quoted price (0-100,
    # at most two decimals). Snapshotted onto each earning when it is recorded,
    # so changing it only affects jobs completed afterwards. Development default:
    # 0 -- no commission is assumed until the business sets one.
    partner_commission_rate_percent: Decimal = Decimal("0")

    # --- Job photos (customer problem photos, before/after work) -----------------
    # Private: encrypted with DATA_ENCRYPTION_KEY and written here, never under the
    # public upload directory. Read back only through authorised API endpoints.
    job_media_directory: str = "private/job_media"
    # What an upload may be before processing, and what a stored image may be.
    job_media_max_input_bytes: int = 5 * 1024 * 1024
    # Longest side after processing; larger photos are scaled down.
    job_media_max_dimension: int = 2560
    # Decompression-bomb guard: an image claiming more pixels than this is refused
    # before it is decoded.
    job_media_max_pixels: int = 40_000_000
    job_media_max_customer_photos: int = 5
    job_media_max_before_photos: int = 6
    job_media_max_after_photos: int = 6
    # Work bill: lines on one bill, photos per material line, bill attachments.
    # The photos use the private job-photo storage above.
    work_bill_max_items: int = 50
    work_bill_max_material_photos: int = 3
    work_bill_max_attachments: int = 6

    # --- Dispatch: who is searched ----------------------------------------------------
    # Rings searched for eligible technicians: the initial radius, then +step, up to
    # the maximum (km). The search widens only while fewer than a batch have been
    # found, so a job is not handed across the city while somebody nearby is free.
    technician_search_radius_km: float = 5.0
    technician_search_radius_step_km: float = 5.0
    technician_max_search_radius_km: float = 15.0
    # Eligible technicians scored per search (nearest first, then re-ranked).
    dispatch_candidate_pool_size: int = 20

    # --- Dispatch: how offers go out ---------------------------------------------------
    # Best-ranked technicians offered one booking at the same time. Small on purpose:
    # everyone who loses the race was interrupted for nothing.
    dispatch_batch_size: int = 3
    # Seconds a technician has to answer before the offer lapses and the next batch goes.
    dispatch_offer_timeout_seconds: int = 30
    # Batches per dispatch round before a booking stops as EXPIRED (the requester may retry).
    max_dispatch_attempts: int = 3
    # The dispatch sweeper (DispatchService.sweep, run by the scheduler unit,
    # app/jobs/run_scheduler.py): expires unanswered offers, re-dispatches stuck bookings and
    # purges abandoned positions, once for every process. false turns the job off.
    dispatch_worker_enabled: bool = True
    dispatch_sweep_interval_seconds: float = 3.0
    # A SEARCHING booking with no outstanding offer for this long is picked up by
    # the sweeper (e.g. the process died between committing it and dispatching).
    dispatch_stuck_search_seconds: int = 10
    # Travel-time estimates for ranking: "none" ranks on straight-line distance and
    # says so; "osrm" asks OSRM's table service once per batch (OSRM_BASE_URL).
    dispatch_eta_provider: str = "none"
    dispatch_eta_timeout_seconds: float = 2.0

    # --- Dispatch: ranking (modules/bookings/dispatch_ranking.py) ---------------------------
    # Weights are normalised by their sum, so they need not add up to exactly 1.
    dispatch_weight_distance: float = 0.30
    dispatch_weight_rating: float = 0.20
    dispatch_weight_availability: float = 0.15
    dispatch_weight_acceptance: float = 0.10
    dispatch_weight_completion: float = 0.10
    dispatch_weight_cancellation: float = 0.05
    dispatch_weight_experience: float = 0.05
    dispatch_weight_fairness: float = 0.05
    # Years of experience at which the experience score is full.
    dispatch_experience_cap_years: int = 15
    # Jobs accepted today (India time) at which the fairness score reaches zero.
    dispatch_fairness_daily_cap: int = 8
    # How far back acceptance, completion and cancellation rates are measured.
    dispatch_stats_lookback_days: int = 90
    # Bayesian smoothing: a newcomer is treated as if they had this many past
    # events at the prior rate, so one bad (or good) job does not decide a ranking.
    dispatch_prior_weight: float = 5.0
    dispatch_rating_prior: float = 4.0

    # --- Technician live location ---------------------------------------------------------
    # How often the technician's app reports while available or on a job (the app
    # reads it from every location answer, so it is changed here only).
    location_update_interval_seconds: float = 3.0
    # Older than this, a position is stale: no location-sensitive job is offered and
    # the customer's map says "Location updating..." instead of showing it as live.
    location_stale_threshold_seconds: int = 15
    # A stationary technician's row is rewritten at most this often (must be below the
    # stale threshold); a move of at least LOCATION_PERSIST_MIN_MOVE_METERS is written at
    # once. Every fix is still delivered live; this only limits database writes.
    location_persist_heartbeat_seconds: int = 9
    location_persist_min_move_meters: float = 25.0
    # A fix implying faster travel than this since the previous one is rejected as a
    # jump, checked only against a fix younger than the window (0 disables the check).
    location_max_speed_kmph: float = 180.0
    location_jump_check_window_seconds: int = 300
    # A device timestamp further than this from server time is refused.
    location_max_clock_skew_seconds: int = 120
    # A position nobody has refreshed for this long is deleted by the sweeper: the
    # app was closed without signing out, and Partner keeps no note of where
    # somebody who is not working is.
    location_purge_after_seconds: int = 3600

    # --- Realtime across worker processes ----------------------------------------------
    # Websocket messages are relayed between uvicorn workers with PostgreSQL
    # LISTEN/NOTIFY (modules/realtime/hub.py). Needed whenever more than one
    # worker runs; harmless with one.
    realtime_cross_process: bool = True
    realtime_channel: str = "partner_realtime"

    @property
    def search_radii_meters(self) -> list[float]:
        """The rings searched, nearest first, in metres."""
        first = max(self.technician_search_radius_km, 0.1)
        last = max(self.technician_max_search_radius_km, first)
        step = max(self.technician_search_radius_step_km, 0.1)
        radii, radius = [], first
        while radius < last:
            radii.append(radius * 1000.0)
            radius += step
        radii.append(last * 1000.0)
        return radii

    # --- What counts as a position at all ------------------------------------------
    # A browser with no satellite or Wi-Fi fix falls back to looking up the IP
    # address, and returns the middle of whatever city the ISP sits in with an
    # accuracy of tens of kilometres. That is not where anybody is -- it is a guess
    # dressed as a coordinate, and accepting one put a Karimnagar booking in
    # Hyderabad and left the technician standing exactly on top of the customer.
    # A fix less precise than this is refused, everywhere a position is taken.
    max_location_accuracy_meters: float = 1000.0

    # --- Location search on the booking map ----------------------------------------
    # Nominatim, OpenStreetMap's own geocoder -- the same project as the map tiles,
    # free and keyless. Its usage policy asks for an identifying User-Agent and at
    # most one request a second, which is why the browser never calls it directly:
    # every lookup goes through Partner, which throttles and caches them. Point this
    # at your own Nominatim (or a hosted one) before any real traffic.
    geocoder_base_url: str = "https://nominatim.openstreetmap.org"
    geocoder_user_agent: str = "CREWNBUILD-Partner/1.0"
    geocoder_timeout_seconds: float = 8.0
    # Results are restricted to these ISO country codes; empty means worldwide.
    geocoder_country_codes: str = "in"
    geocoder_max_results: int = 20

    # --- Live tracking (after a technician accepts) --------------------------------
    # OSRM gives the road route, its length and its driving time. The public demo
    # server is rate limited and carries no uptime promise: point this at your own
    # OSRM instance for production. Nothing breaks when it is unreachable -- the
    # distance falls back to a straight-line estimate, marked as approximate.
    osrm_base_url: str = "https://router.project-osrm.org"
    osrm_timeout_seconds: float = 12.0
    # A route is replanned only when the technician is at least this far off it,
    # and never more often than the interval below, so a position every few
    # seconds does not become an OSRM request every few seconds.
    route_refresh_deviation_meters: float = 200.0
    route_refresh_min_interval_seconds: float = 20.0
    # Speed assumed when no road route is available, to still show a rough ETA.
    tracking_fallback_speed_kmph: float = 22.0

    # --- Arriving ------------------------------------------------------------------
    # A journey becomes ARRIVED when the technician is actually this close to the
    # address, measured between real coordinates. Nothing else sets it: a button
    # that says "arrived" tells the customer somebody is outside when they may be
    # half a kilometre away, which is what used to happen.
    arrival_threshold_meters: float = 40.0
    # ...and only on a fix precise enough to believe. A single wide-accuracy sample
    # (indoors, a cold GPS start) can land anywhere inside its error circle, so it
    # never flips the status; the journey simply stays ON THE WAY a little longer.
    arrival_max_accuracy_meters: float = 50.0
    # The furthest a technician may be when marking arrival by hand, for a booking
    # where that is still possible at all. Generous enough for a large site, far
    # too small to cover "I am nearly there".
    arrival_manual_threshold_meters: float = 150.0

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: object) -> object:
        if isinstance(value, str):
            name = value.strip().lower()
            return ENVIRONMENT_ALIASES.get(name, name)
        return value

    @field_validator("professional_handoff_public_key", mode="before")
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

    @field_validator("partner_commission_rate_percent")
    @classmethod
    def check_commission_rate(cls, value: Decimal) -> Decimal:
        # Refused when the Settings are built, as in the old app (also re-checked at startup).
        if not value.is_finite() or value < 0 or value > 100 or int(value.as_tuple().exponent) < -2:
            raise ValueError("PARTNER_COMMISSION_RATE_PERCENT must be between 0 and 100 with at most two decimals.")
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


def validate_no_placeholders(configured: Settings) -> None:
    """Production refuses to start with any setting still holding a .env.example
    placeholder (R6, CF-04): every secret and every plain value, and the password inside
    DATABASE_URL. The message names the setting, never its value."""
    for name in type(configured).model_fields:
        value = getattr(configured, name)
        text_value = value.get_secret_value() if isinstance(value, SecretStr) else value
        if isinstance(text_value, str) and is_placeholder(text_value):
            raise InsecureConfigurationError(f"Production requires a real {name.upper()}; it is still a placeholder.")
    try:
        password = make_url(configured.database_url.get_secret_value()).password or ""
    except Exception:
        password = ""
    if is_placeholder(str(password)):
        raise InsecureConfigurationError("Production requires a real database password in DATABASE_URL.")


def validate_production(configured: Settings) -> None:
    if not configured.is_production():
        return
    if configured.debug:
        raise InsecureConfigurationError("Production requires DEBUG=false.")
    validate_no_placeholders(configured)
    origin = (configured.frontend_origin or "").strip()
    if not origin.startswith("https://") or is_local_origin(origin):
        raise InsecureConfigurationError("Production requires FRONTEND_ORIGIN to be the deployed https:// address.")


def validate_commission_rate(configured: Settings) -> None:
    # Money never goes through binary floating point: the value is a Decimal.
    rate = configured.partner_commission_rate_percent
    if not rate.is_finite() or rate < 0 or rate > 100 or int(rate.as_tuple().exponent) < -2:
        raise InsecureConfigurationError(
            "PARTNER_COMMISSION_RATE_PERCENT must be between 0 and 100 with at most two decimals."
        )


def data_encryption_keys(configured: Settings) -> dict[int, str]:
    """Every configured Fernet key by version: the current one and the earlier ones. Empty
    when no key is set (identity, bank and job-photo features then answer 503)."""
    keys: dict[int, str] = {}
    for entry in configured.data_encryption_previous_keys.get_secret_value().split(","):
        version, _, key = entry.strip().partition(":")
        if key.strip():
            keys[int(version)] = key.strip()
    current = configured.data_encryption_key.get_secret_value().strip()
    if current:
        keys[configured.data_encryption_key_version] = current
    return keys


def validate_data_encryption(configured: Settings) -> None:
    from cryptography.fernet import Fernet

    if is_placeholder(configured.data_encryption_key.get_secret_value()):
        configured.data_encryption_key = SecretStr("")
    if configured.data_encryption_key_version < 1:
        raise InsecureConfigurationError("DATA_ENCRYPTION_KEY_VERSION must be 1 or more.")
    try:
        keys = data_encryption_keys(configured)
        for key in keys.values():
            Fernet(key.encode("utf-8"))
    except (ValueError, TypeError):
        raise InsecureConfigurationError(
            "DATA_ENCRYPTION_KEY (or DATA_ENCRYPTION_PREVIOUS_KEYS) is not a valid Fernet key."
        ) from None
    if configured.is_production() and not configured.data_encryption_key.get_secret_value():
        raise InsecureConfigurationError("Production requires DATA_ENCRYPTION_KEY for identity data.")


def validate_dispatch_settings(configured: Settings) -> None:
    """Combinations that would silently break dispatch or tracking (the old checks)."""
    if configured.location_persist_heartbeat_seconds >= configured.location_stale_threshold_seconds:
        raise InsecureConfigurationError(
            "LOCATION_PERSIST_HEARTBEAT_SECONDS must be below LOCATION_STALE_THRESHOLD_SECONDS."
        )
    if configured.location_update_interval_seconds * 2 > configured.location_stale_threshold_seconds:
        raise InsecureConfigurationError(
            "LOCATION_STALE_THRESHOLD_SECONDS must allow at least two missed LOCATION_UPDATE_INTERVAL_SECONDS."
        )
    if configured.dispatch_batch_size < 1 or configured.max_dispatch_attempts < 1:
        raise InsecureConfigurationError("DISPATCH_BATCH_SIZE and MAX_DISPATCH_ATTEMPTS must be at least 1.")
    if configured.dispatch_candidate_pool_size < configured.dispatch_batch_size:
        raise InsecureConfigurationError("DISPATCH_CANDIDATE_POOL_SIZE must be at least DISPATCH_BATCH_SIZE.")
    if configured.dispatch_offer_timeout_seconds < 5:
        raise InsecureConfigurationError("DISPATCH_OFFER_TIMEOUT_SECONDS must be at least 5.")
    if configured.dispatch_eta_provider not in ("none", "osrm"):
        raise InsecureConfigurationError("DISPATCH_ETA_PROVIDER must be 'none' or 'osrm'.")
    weights = (
        configured.dispatch_weight_distance,
        configured.dispatch_weight_rating,
        configured.dispatch_weight_availability,
        configured.dispatch_weight_acceptance,
        configured.dispatch_weight_completion,
        configured.dispatch_weight_cancellation,
        configured.dispatch_weight_experience,
        configured.dispatch_weight_fairness,
    )
    if any(weight < 0 for weight in weights) or sum(weights) <= 0:
        raise InsecureConfigurationError("Dispatch ranking weights must be non-negative and not all zero.")


def check_settings(configured: Settings) -> Settings:
    """Every startup check, in order. Raises InsecureConfigurationError on the first problem."""
    validate_environment(configured)
    validate_database(configured)
    validate_jwt_secret(configured)
    validate_session_cookies(configured)
    validate_handoff_public_key(configured)
    validate_optional_secrets(configured)
    validate_commission_rate(configured)
    validate_data_encryption(configured)
    validate_dispatch_settings(configured)
    validate_production(configured)
    return configured


@lru_cache
def get_settings() -> Settings:
    return check_settings(Settings())
