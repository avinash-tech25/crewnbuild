# CREWNBUILD — Technical Architecture and Design

Nov 12, 2026 · @Trysol Global services Pvt Ltd

## 1. Summary

This is the target technical design for CREWNBUILD: two FastAPI services and two React apps on one PostgreSQL database, `crewnbuild`, with schemas `professional` and `partner`. It restructures code, folders, security and data to industry standard **without changing any feature**: every screen, flow, rule and API behaviour described in the PRD and SRS works the same afterwards.

### 1.1 What changes and what does not

| Changes | Stays the same |
| --- | --- |
| Folder structure of all four apps (feature modules, clear layers) | Every feature, screen and user flow |
| Table names (conventional, consistent) and primary keys (UUID everywhere) | The data itself: every row is carried over |
| Foreign keys on every relationship, with explicit delete rules | Business rules (dispatch, awards, stock, billing, subscriptions) |
| Authentication hardening and one central authorisation layer | Sign-in methods: password, WhatsApp OTP, Google, Microsoft, hand-off |
| Protected routing and rendering in both React apps | Routes and pages users see |
| Secrets handling: `.env.example` with placeholders only, all exposed secrets rotated | Settings names (except where noted) |
| API under `/api/v1`, one error format, UUID IDs in responses | Endpoint paths after the prefix, and request and response fields |

### 1.2 Design principles

1. **Two services, two schemas, one owner each.** A service writes only its own schema; Partner reads two `professional` tables through a database view.
2. **Secure by default.** Every route is private unless marked public; every write checks role, permission and ownership on the server.
3. **Layers do one job.** Router → service → repository → model. Routers hold no business logic; repositories hold no rules.
4. **One way to do each thing.** One settings class, one error format, one auth dependency, one route guard, one naming convention.
5. **UUID identities.** Every table has a UUID primary key; IDs in URLs and responses are UUIDs, never sequential numbers.
6. **Stateless API processes.** Sessions, files and jobs live in PostgreSQL, object storage and a scheduler, so any number of API processes can run.
7. **No secret in Git.** Secrets come from the environment or a secret manager; the repository holds only placeholders.

### 1.3 Stack in one line

FastAPI (Python 3.12) · React 18 with Vite · PostgreSQL (database `crewnbuild`, schemas `professional` and `partner`) · Alembic · SQLAlchemy 2 · Redux Toolkit · React Router 6 · Tailwind CSS.

## 2. Target architecture

CREWNBUILD stays two independent services on one database: Professional (API + web app, schema `professional`) and Partner (API + web app, schema `partner`). Inside each API, every request passes the same ordered checks before it reaches data.

&#91;embedded content: Request path · same checks in both APIs\]

A request that fails a check stops there with a clear status; only a request that passes all of them runs business logic.

| Unit | Technology | Dev port | Production address | Owns |
| --- | --- | --- | --- | --- |
| Professional web | React + Vite, static build | 5173 | `app.<domain>` | Public site, role dashboards |
| Professional API | FastAPI | 8000 | `api.<domain>/professional/api/v1` | Schema `professional` |
| Partner web | React + Vite, static build | 5373 | `partner.<domain>` | Technician app, requester booking |
| Partner API | FastAPI | 8200 | `api.<domain>/partner/api/v1` | Schema `partner` |
| Schedulers | Python, one per service | n/a | Internal | Sweeps, monitors, dispatch |
| Database | PostgreSQL | 5432 | Private network only | Database `crewnbuild` |
| Files | Amazon S3 | n/a | Private buckets | Uploads and photos |

- **AR-01** The services never call each other over HTTP. They link only through the signed Book Technician hand-off the read-only requester view Partner reads (11.1), and the read-only booking view Professional reads for payments and account deletion (11.2).
- **AR-02** Each service is built, configured, migrated and deployed on its own.
- **AR-03** The database is never reachable from the internet; only the API and scheduler units connect to it.

## 3. Technology stack

The stack stays as it is today; this design adds a few standard libraries for security, logging and testing and pins every version.

| Layer | Technology | Notes |
| --- | --- | --- |
| Backend language | Python 3.12 | Same for both services |
| Web framework | FastAPI 0.115 on Starlette, Pydantic v2 | `extra="forbid"` on every request model |
| ASGI server | Uvicorn workers under Gunicorn (production), Uvicorn alone (development) | One process per CPU core |
| ORM and migrations | SQLAlchemy 2 (typed `Mapped[...]` models), Alembic | One Alembic chain per service, version table in its own schema |
| Database | PostgreSQL 16 or later, database `crewnbuild`, schemas `professional` and `partner` | PostgreSQL 18 adds a built-in `uuidv7()`; on older versions the app generates UUIDv7 |
| DB driver | psycopg 3 (`postgresql+psycopg://`) | Replaces `psycopg2-binary`, which is not meant for production |
| Password hashing | Argon2id (`argon2-cffi`), bcrypt still verified for existing hashes | Re-hash to Argon2id at next sign-in |
| Tokens | PyJWT; HS256 for each service's own access tokens, EdDSA (Ed25519) for the cross-service hand-off | Replaces unmaintained `python-jose` |
| Encryption at rest | `cryptography` (Fernet / AES-GCM) with key versioning | Aadhaar, face captures, bank numbers, camera credentials |
| Rate limiting | Database-backed limiter (or Redis if added) | Shared across all API processes |
| HTTP client | httpx with timeouts and retries | All outside services |
| Files | Amazon S3 (both services), presigned URLs for private files | Partner moves off local disk |
| Logging | structlog, JSON lines, request ID on every line | No personal data in logs |
| Frontend | React 18.3, Vite 5, React Router 6, Redux Toolkit 2, Tailwind 3, axios | Same in both apps |
| Frontend forms and data | React Hook Form + Zod validation; RTK Query for server data | Gradual adoption, screen by screen |
| Maps | Leaflet + react-leaflet (Partner) | Configurable tile source |
| Tests | pytest + httpx (backend), Vitest + Testing Library (frontend unit), Playwright (end to end) | Professional backend scripts move into pytest |
| Quality gates | Ruff, mypy, ESLint, Prettier, gitleaks, pip-audit, npm audit | Run in pre-commit and CI |

## 4. Repository and folder structure

One repository, `crewnbuild` (was `Kuwait-Version`), holds two products side by side: `professional` (was `Octabuild`) and `partner`, each with its own `backend` and `frontend`. Inside each app, code is grouped by feature module, and every module has the same files in the same layers.

### 4.1 Repository layout

```text
crewnbuild/                              was Kuwait-Version
├── professional/                        was Octabuild
│   ├── backend/                         FastAPI, schema professional (was Octabuild/backend)
│   └── frontend/                        React (was "Octabuild/frontend 7/frontend")
├── partner/                             name unchanged
│   ├── backend/                         FastAPI, schema partner
│   └── frontend/                        React
├── infrastructure/
│   ├── database/
│   │   └── create_database_and_roles.sql   Database crewnbuild, two roles, two schemas (section 18)
│   ├── docker/                          One Dockerfile per backend and frontend
│   ├── docker-compose.yml               Local stack: PostgreSQL, both backends, both frontends
│   └── nginx/                           Reverse proxy, TLS, security headers
├── docs/                                PRD, SRS, this document, runbooks, QA notes (was OTP_QA_HANDOVER)
├── scripts/
│   └── setup_local_environment.ps1      One-command local setup on Windows (section 18)
├── .github/workflows/                   CI: lint, type check, tests, secret scan, single Alembic head
├── .gitignore                           Ignores .env, .venv, node_modules, dist, uploads (section 5.3)
├── .editorconfig, .gitattributes        Same line endings and indentation for everyone
├── .pre-commit-config.yaml              Ruff, ESLint, Prettier, gitleaks
└── README.md                            What the project is and how to run it
```

### 4.2 Backend layout (both APIs)

```text
professional/backend/                    (partner/backend/ has the same shape)
├── requirements.txt                     Pinned runtime packages
├── requirements-dev.txt                 Test and lint tools
├── pyproject.toml                       Ruff, mypy and pytest settings
├── alembic.ini
├── alembic/
│   ├── env.py                           Schema professional only; version table professional.alembic_version
│   └── versions/
│       └── 20261114_0001_initial_professional_schema.py   One clean baseline (section 16)
├── .env.example                         Placeholders only (section 5)
├── app/
│   ├── main.py                          create_app(): middleware, routers, startup checks
│   ├── core/
│   │   ├── config.py                    One Settings class, validated at startup
│   │   ├── logging.py                   JSON logs with request IDs
│   │   ├── errors.py                    Error types and the one error response
│   │   ├── middleware.py                Request ID, security headers, CSRF, rate limit
│   │   └── security/                    password_hashing.py, access_tokens.py, session_cookies.py,
│   │                                    csrf_protection.py, field_encryption.py
│   ├── database/
│   │   ├── base.py                      Base model, naming convention, UUID and timestamp mixins
│   │   └── session.py                   Engine, one session per request, SCHEMA = "professional"
│   ├── auth/
│   │   ├── dependencies.py              current_principal, require_roles, require_permission
│   │   ├── permissions.py               Permission names and the role-to-permission map
│   │   └── ownership_policies.py        Shared "is this record yours" checks
│   ├── api/v1/router.py                 Includes every module router in a fixed order
│   ├── modules/
│   │   └── <module>/                    e.g. projects/, store/, billing/
│   │       ├── router.py                HTTP only: parse, call service, return schema
│   │       ├── schemas.py               Pydantic request and response models
│   │       ├── service.py               Business rules and transactions
│   │       ├── repository.py            Database queries only
│   │       ├── models.py                The module's tables
│   │       └── policies.py              Who may do what to which record
│   ├── integrations/                    razorpay/, whatsapp/, email/, s3_storage/, oauth_providers/, ...
│   ├── jobs/                            subscription_renewal_sweep.py, weather_alert_monitor.py, run_scheduler.py
│   └── seeds/                           run_all_seeds.py, seed_admin_account.py, seed_master_catalog.py,
│                                        seed_subscription_plan_prices.py (idempotent, safe to re-run)
└── tests/                               test_*.py, conftest.py (uses crewnbuild_test)
```

### 4.3 Backend modules

| Professional module | Holds | Partner module | Holds |
| --- | --- | --- | --- |
| `identity` | Sign-up, sign-in, OTP, OAuth, sessions | `identity` | Technician sign-up, sign-in, sessions, password reset |
| `accounts` | Profiles, location, categories, account deletion | `onboarding` | Aadhaar, face capture, identity review |
| `admin` | Users, administrators, verification, audit, announcements | `technicians` | Profile, availability, work preferences, earnings, payout account |
| `catalog` | Categories, brands, products, variants, media | `requesters` | Hand-off exchange, requester session, profile |
| `projects` | Projects, requests, awards, teams, assignments | `catalog` | Services and checklist templates |
| `site_operations` | Daily records, labour, material, machinery, expenses, payments | `bookings` | Create, cancel, retry, list bookings |
| `marketplace` | Supplier listings, price tiers, cart, purchase orders, discovery | `dispatch` | Ranking, offers, presence, location, sweeper |
| `labour_supply`, `equipment_supply` | Services, requests, attendance, usage | `job_execution` | Checklist, media, start codes, work bills, ratings |
| `store` | Stock, issues, receipts, store payments | `tracking` | Destination, route, ETA, tracking socket |
| `property` | Listings, images, enquiries | `locations` | Pincode, place search, reverse lookup |
| `messaging` | Chat, notifications, live events | `weather` | Technician and public weather |
| `cctv` | Devices, channels, playback, gateway auth | `realtime` | WebSocket hub, PostgreSQL NOTIFY relay |
| `billing` | Booking payments, subscriptions, coupons, webhooks |  |  |
| `support` | Tickets, contact, user reports |  |  |
| `content` | Ads, translation, Vastu, estimates, calculators |  |  |
| `weather`, `files` | Forecasts and alerts; uploads |  |  |

### 4.4 Frontend layout (both apps)

```text
professional/frontend/                   (partner/frontend/ has the same shape)
├── package.json, package-lock.json
├── index.html, vite.config.js, tailwind.config.js, eslint.config.js
├── .env.example                         VITE_* placeholders only (no secrets ever)
└── src/
    ├── main.jsx
    ├── app/
    │   ├── App.jsx, AppProviders.jsx
    │   ├── store.js                     Redux Toolkit store: feature slices + RTK Query API
    │   ├── router/
    │   │   ├── routes.jsx               One route table with access rules (section 8)
    │   │   └── guards/                  RequireAccess, GuestOnly, RequireSubscriptionCheckout
    │   └── layouts/                     PublicLayout, AuthLayout, DashboardLayout
    ├── features/
    │   └── <feature>/                   e.g. booking/, store-manager/
    │       ├── <feature>Api.js          RTK Query endpoints for this feature
    │       ├── <feature>Slice.js        Redux Toolkit slice (only for client state)
    │       ├── pages/                   One file per screen, named <Name>Page.jsx
    │       ├── components/              Pieces used only by this feature
    │       ├── hooks/                   use<Something>.js
    │       └── routes.jsx               This feature's routes, merged into the route table
    ├── shared/
    │   ├── api/                         baseApi.js (cookies, CSRF header, single-flight refresh), websocketClient.js
    │   ├── auth/                        authSlice.js, useAuth.js, usePermission.js, Can.jsx
    │   ├── ui/                          Button, Modal, DataTable, FormField, EmptyState, ErrorState
    │   └── utils/                       formatCurrency.js, formatIndiaDateTime.js, ...
    ├── i18n/, theme/, assets/
```

Professional features: `auth`, `onboarding`, `owner`, `builder`, `site-engineer`, `store-manager`, `supplier`, `admin`, `projects`, `catalog`, `shop`, `labour`, `equipment`, `property`, `messaging`, `notifications`, `cctv`, `weather`, `billing`, `support`, `public-site`. Partner features: `auth`, `onboarding`, `technician-dashboard`, `offers`, `jobs`, `work-bill`, `earnings`, `booking`, `tracking`, `weather`.

### 4.5 Naming in code

| Item | Convention | Example |
| --- | --- | --- |
| Python modules, functions, variables | snake\_case | `purchase_order_service.py`, `create_booking()` |
| Python classes | PascalCase, singular | `PurchaseOrder`, `BookingOffer` |
| React components and pages | PascalCase file per component | `BookingTrackerPage.jsx` |
| Hooks and utilities | camelCase, hooks start with `use` | `useBookingTracking.js` |
| Folders | kebab-case (web), snake\_case (Python) | `store-manager/`, `site_operations/` |
| Environment variables | UPPER\_SNAKE\_CASE; web ones start `VITE_` | `DATABASE_URL`, `VITE_API_BASE_URL` |

### 4.6 Human-readable names

A name says what the thing is or does, in plain words, so a new colleague understands it without opening it.

| Rule | Avoid | Use |
| --- | --- | --- |
| Name a file for what it holds | `utils.py`, `helpers.js`, `common.py` | `phone_number_formatting.py`, `formatCurrency.js` |
| No private abbreviations (only `id`, `url`, `api`, `otp`, `csv`) | `svc`, `repo2`, `cfg`, `sm`, `tmp_fix` | `service`, `repository`, `config`, `storeManager` |
| Functions are verb + noun | `handle()`, `process_data()`, `doIt()` | `create_booking()`, `send_signup_code()`, `fetchMyBookings()` |
| Booleans read as yes/no questions | `flag`, `check`, `status_ok` | `is_verified`, `has_active_subscription` |
| One React component per file, file name = component name | `components.jsx` holding ten components | `OfferCard.jsx`, `BookingTrackerPage.jsx` |
| Screens end in `Page`, hooks start with `use`, slices end in `Slice`, API files end in `Api` | `Tracker.jsx`, `jobs.js` | `BookingTrackerPage.jsx`, `useJobOffers.js`, `authSlice.js`, `bookingApi.js` |
| Tests name the behaviour | `test1.py`, `check_stuff.py` | `test_technician_cannot_accept_two_jobs.py` |
| No old brand or country names | `gharbano_user`, `octabuild-access`, `CountryOfResidenceField`, `Kuwait` | `crewnbuild_user`, `__Host-pro_at`, removed |

Examples of current files and their new names:

| Current | New |
| --- | --- |
| `Octabuild/backend/app/shared/auth/routes/auth_routes.py` | `professional/backend/app/modules/identity/router.py` |
| `Octabuild/backend/app/payment_gateway/router.py` | `professional/backend/app/modules/billing/booking_payments_router.py` |
| `Octabuild/backend/app/subscription/sweep.py` | `professional/backend/app/jobs/subscription_renewal_sweep.py` |
| `Partner/backend/app/models/octabuild_account.py` | `partner/backend/app/modules/requesters/professional_requester_view.py` |
| `Partner/backend/app/shared/bookings/` (dispatch, ranking, worker) | `partner/backend/app/modules/dispatch/` (`offer_ranking.py`, `dispatch_sweeper.py`) |
| `Octabuild/frontend 7/frontend/src/services/storeManager.js` | `professional/frontend/src/features/store-manager/storeManagerApi.js` |
| `Octabuild/frontend 7/frontend/src/redux/authSlice.js` | `professional/frontend/src/shared/auth/authSlice.js` |
| `Partner/frontend/src/services/dispatch.js` | `partner/frontend/src/features/offers/offersApi.js` |
| `Partner/frontend/src/services/booking.js` | `partner/frontend/src/features/booking/bookingApi.js` |

### 4.7 Clean-up: files to remove

None of the items below is copied into the new repository. Nothing a running feature needs is in this list; anything worth keeping stays in the archived old repository.

| Item | Where | Action |
| --- | --- | --- |
| `.claude/` | Repository root | Delete; add to `.gitignore` |
| `OTP_QA_HANDOVER/` | Repository root | Move notes still useful to `docs/qa/`; delete the rest |
| `venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/` | Both backends | Delete; local environments are `.venv/` and ignored |
| `node_modules/`, `dist/` | Both frontends | Delete from Git; ignored |
| Old test scripts in `tests/` (plain scripts, pytest-style files without pytest) | Professional backend | Delete; a clean suite is written in section 17 |
| Old pytest suite, Playwright `tests/ui/`, scattered `*.test.js` | Partner backend and both frontends | Delete; replaced by the section 17 suites |
| `seed_otp_test_accounts.py`, `seed_verification_demo.py` | Professional backend | Delete: test and demo accounts must never reach production |
| `seed_admins.py`, `sql_scripts/master_catalog_seed.sql` | Professional backend | Keep, moved to `app/seeds/` with clear names; admin password read from the environment |
| `uploads/`, translation cache folder, `.certs/` | Backends, Partner frontend | Delete from Git; ignored (files go to S3, certificates are local) |
| `alembic/versions/*` (54 Professional, 15 Partner revisions) | Both backends | Replaced by one baseline each (section 16) |
| `three`, `@react-three/fiber`, `@react-three/drei` | Professional `package.json` | Remove: never imported |
| `reviews`, `escrow_milestones` tables | Professional models | Keep: both are in use (CONNECTIONS.md, R8); renamed in section 10 |
| Arabic translations, country picker, Kuwait checks | Professional frontend and backend | Remove: India only |
| Empty folders, commented-out code, unused imports, `print()` debugging | Everywhere | Remove; Ruff and ESLint flag them in CI |
| Personal editor settings (`.vscode/*` except shared `extensions.json`) | Everywhere | Ignore |

## 5. Configuration and secrets

Both `.env.example` files currently expose real values, so every secret in them must be treated as leaked: rotate it, then make `.env.example` a placeholder-only template. Real values live only in local `.env` files (never committed) and, in production, in a secret manager.

### 5.1 Incident response for the exposed files

1. **Rotate every exposed secret** (5.2), starting with database passwords, JWT keys and payment keys. Rotating the JWT key signs everyone out once; that is expected.
2. **Re-encrypt data** protected by an exposed encryption key: Aadhaar data, face captures and bank account numbers (`DATA_ENCRYPTION_KEY`), camera credentials (`CAMERA_CREDENTIALS_KEY`). Decrypt with the old key, encrypt with the new one, store the key version beside each value.
3. **Replace both `.env.example` files** with the placeholder templates in 5.4.
4. **Remove secrets from Git history** with `git filter-repo` (any `.env` and the old `.env.example` versions), force-push, and have everyone re-clone. With the new repository this applies only to the archived old one, which must stay private; the new repository starts clean.
5. **Block it from happening again:** `.gitignore` rules (5.3), gitleaks in pre-commit and CI, and push protection on the Git host.
6. **Check provider logs** (Razorpay, AWS, WhatsApp, OpenAI, SMTP) for use of the old keys since the first commit.

### 5.2 Secrets to rotate

| Service | Secret | After rotating |
| --- | --- | --- |
| Both | Database passwords (one role per service) | Update `DATABASE_URL` |
| Both | `JWT_SECRET_KEY` (each service its own, at least 64 random bytes) | All sessions end |
| Professional / Partner | Hand-off key pair (`PARTNER_HANDOFF_PRIVATE_KEY` / `PROFESSIONAL_HANDOFF_PUBLIC_KEY (was OCTABUILD_HANDOFF_PUBLIC_KEY)`) | New Ed25519 pair; public key to Partner |
| Professional | `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Update webhook in Razorpay dashboard |
| Professional | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Prefer an IAM role in production instead of keys |
| Professional | `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET` | Regenerate in each provider console |
| Professional | `WHATSAPP_API_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, vision model key, CCTV gateway secret | Regenerate with each provider |
| Professional | `CAMERA_CREDENTIALS_KEY` | Re-encrypt `cctv_device_credentials` |
| Partner | `DATA_ENCRYPTION_KEY` | Re-encrypt identity and payout data |
| Both | `SMTP_PASSWORD`, `WEATHER_API_KEY` | Update mailbox and provider |

The connections audit (`docs/CONNECTIONS.md`, section 9) confirmed which values are real: the AWS key pair, two Gmail app passwords, the OpenAI/Gemini key, `CAMERA_CREDENTIALS_KEY`, the camera gateway secret, the database password, Partner's `DATA_ENCRYPTION_KEY`, and one JWT secret that both backends share. After rotation each backend gets its own JWT secret. The Razorpay, Google, Microsoft and WhatsApp values are empty and need no rotation. The hand-off keys (`PARTNER_HANDOFF_PRIVATE_KEY`, `PROFESSIONAL_HANDOFF_PUBLIC_KEY`) are missing from both templates and must be added.

### 5.3 Rules

- **CF-01** `.env` and `.env.*` are ignored by Git, except `.env.example`:

```text
.env
.env.*
!.env.example
*.pem
*.key
.certs/
```

- **CF-02** `.env.example` holds names, safe defaults and `change-me` placeholders only. A reviewer rejects any pull request that puts a real-looking value in it.
- **CF-03** One pydantic-settings `Settings` class per service; secrets typed `SecretStr` and never logged or returned.
- **CF-04** In `ENVIRONMENT=production` the service refuses to start if a secret is missing, shorter than its minimum, or still a placeholder, or if a development flag (`RAZORPAY_ALLOW_MOCK`, `WHATSAPP_DEV_OTP_PREVIEW`, `TEST_OTP_LOGIN_ENABLED`, `DEV_ACCOUNT_RECOVERY_ENABLED`) is on.
- **CF-05** Web apps hold no secrets. Every `VITE_*` value is public once built (URLs, origins, map tiles only).
- **CF-06** Production secrets come from a secret manager (for example AWS Secrets Manager or SSM Parameter Store) injected as environment variables at start.
- **CF-07** Each secret has an owner and a rotation date; keys used for encryption carry a version so old data can be re-encrypted.

### 5.4 Template: `professional/backend/.env.example`

```text
# ---- App ----
APP_NAME=CREWNBUILD API
ENVIRONMENT=development
DEBUG=false

# ---- Database (crewnbuild / schema professional) ----
DATABASE_URL=postgresql+psycopg://crewnbuild_professional:change-me@localhost:5432/crewnbuild
DATABASE_SCHEMA=professional

# ---- Sessions ----
JWT_SECRET_KEY=change-me-generate-64-random-bytes
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=30
AUTH_COOKIE_SECURE=false
FRONTEND_ORIGIN=http://localhost:5173

# ---- Partner hand-off (Ed25519 private key, PEM, one line with \n) ----
PARTNER_HANDOFF_PRIVATE_KEY=change-me
PARTNER_HANDOFF_SECONDS=60

# ---- Integrations ----
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=change-me
RAZORPAY_KEY_SECRET=change-me
RAZORPAY_WEBHOOK_SECRET=change-me
RAZORPAY_ALLOW_MOCK=true
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=change-me
AWS_SECRET_ACCESS_KEY=change-me
GOOGLE_CLIENT_ID=change-me
GOOGLE_CLIENT_SECRET=change-me
MICROSOFT_CLIENT_ID=change-me
MICROSOFT_CLIENT_SECRET=change-me
WHATSAPP_ENABLED=false
WHATSAPP_API_KEY=change-me
SMTP_HOST=localhost
SMTP_PASSWORD=change-me
OPENAI_API_KEY=change-me
CAMERA_CREDENTIALS_KEY=change-me
```

### 5.5 Template: `partner/backend/.env.example`

```text
APP_NAME=Partner API
ENVIRONMENT=development
DATABASE_URL=postgresql+psycopg://crewnbuild_partner:change-me@localhost:5432/crewnbuild
DATABASE_SCHEMA=partner
PROFESSIONAL_SCHEMA=professional
JWT_SECRET_KEY=change-me-generate-64-random-bytes
REQUESTER_SESSION_MINUTES=60
FRONTEND_ORIGIN=http://localhost:5373
PROFESSIONAL_HANDOFF_PUBLIC_KEY=change-me
DATA_ENCRYPTION_KEY=change-me
PARTNER_COMMISSION_RATE_PERCENT=10
S3_BUCKET_JOB_MEDIA=change-me
SMTP_HOST=localhost
SMTP_PASSWORD=change-me
```

Web templates: `VITE_API_BASE_URL`, `VITE_PARTNER_URL`, `VITE_APP_STORE_URL`, `VITE_PLAY_STORE_URL` (Professional); `VITE_API_BASE_URL`, `VITE_PROFESSIONAL_ORIGIN`, `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_ATTRIBUTION`, `VITE_MAP_DEFAULT_CENTER` (Partner). `OCTABUILD_HANDOFF_PUBLIC_KEY` and `VITE_OCTABUILD_ORIGIN` are renamed to the `PROFESSIONAL_` names; the old names are read as fallbacks for one release. `PARTNER_COMMISSION_RATE_PERCENT=10` is a placeholder, not a decided rate.

## 6. Authentication

Both services use the same model: a short-lived signed access token and a rotating opaque refresh token, both in HttpOnly cookies, backed by a server-side session row that can be revoked at any time. The sign-in methods stay exactly as today.

### 6.1 Principals and sign-in methods

| Principal | Service | Sign-in methods | Session length |
| --- | --- | --- | --- |
| Professional user (all roles) | Professional | E-mail + password; WhatsApp OTP (+91); Google; Microsoft (authorisation code + PKCE) | Access 15 min, refresh 30 days, idle 30 days |
| Administrator | Professional | E-mail + password (OTP second step recommended, see 6.5) | Access 15 min, refresh 12 h |
| Technician | Partner | E-mail + password; e-mail code at sign-up and password reset | Access 15 min, refresh 30 days |
| Requester | Partner | Hand-off token from Professional only (no password) | 60 min fixed, never extended |

Access tokens drop from 30 to 15 minutes; refresh is silent, so users see no difference.

### 6.2 Tokens and cookies

| Item | Rule |
| --- | --- |
| Access token | JWT, HS256, signed with the service's own key. Claims: `sub` (user UUID), `sid` (session UUID), `role`, `typ=access`, `iat`, `exp`, `iss` (`professional` or `partner`), `aud`. Nothing personal (no e-mail, phone or name). |
| Refresh token | 256-bit random opaque string; only its SHA-256 hash is stored in the session row. Rotated on every use. |
| Reuse detection | A refresh token used again after a 10-second grace revokes the whole session family. |
| Cookie names | `__Host-pro_at`, `__Host-pro_rt` (Professional); `__Host-ptr_at`, `__Host-ptr_rt`, `__Host-ptr_req` (Partner). Distinct names, so the two apps never clash on one host. |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` (the `__Host-` prefix enforces this). Development without HTTPS drops the prefix. |
| CSRF | Every state-changing request carries `X-CSRF-Token`, matched against the session's CSRF secret, plus an allowed `Origin`. The token is returned by sign-in, refresh and `GET /auth/session` and kept in memory only. |
| Storage in the browser | No token in `localStorage` or `sessionStorage`. Only a non-secret "who is signed in" hint may be stored to pick the first screen. |

### 6.3 Flows

1. **Password sign-in:** verify Argon2id (or legacy bcrypt, then re-hash) in constant time → check account status → create session → set cookies → return user summary and CSRF token.
2. **WhatsApp OTP sign-in:** send-code always answers the same way whether or not the number exists (no account discovery); codes are 6 digits, hashed, single use, 5 minutes, at most 5 attempts.
3. **OAuth:** state and PKCE verifier in a signed, short-lived cookie; state single use; account linked through `user_oauth_identities`.
4. **Refresh:** one refresh in flight per tab (single-flight in the web client); on failure the app signs out cleanly.
5. **Sign-out:** revokes the session row and clears cookies; "sign out everywhere" revokes all the user's sessions; a password change revokes all other sessions.
6. **Partner hand-off:** Professional signs an EdDSA token (`sub`, `role`, `jti`, `aud=partner`, `exp` ≤ 60 s) → Professional web sends it by `postMessage` to the exact Partner origin → Partner checks the sender origin, signature, audience, expiry and that `jti` is unused → creates a 60-minute requester session.

### 6.4 Protection against abuse

| Control | Limit |
| --- | --- |
| Failed password sign-ins | 5 per account per 15 min, 20 per IP per 15 min, then a growing delay |
| OTP sends | Per number and per IP per hour (existing limits), shared across processes |
| Password rules | At least 10 characters, checked against a common-password list; no forced rotation |
| Account status | `SUSPENDED` or deleted accounts are refused at sign-in, refresh and every WebSocket re-check |
| WebSocket | Authenticated from the session cookie at connect; session re-checked every `WEBSOCKET_SESSION_RECHECK_SECONDS`; closed on revocation |

### 6.5 Hardening beyond today (recommended, behind settings)

- A second step for administrators (TOTP or e-mail OTP) before admin permissions are granted.
- Session list in Profile Settings so users can see and end their own sessions.

Both are off by default, so existing behaviour does not change until they are switched on.

## 7. Authorisation

Every request passes three checks on the server, in order: **who** you are (role), **what** you may do (permission), and **which records** you may touch (ownership policy). The web app hides what you cannot do, but the server is the only thing trusted.

### 7.1 Roles

| Role code | Service | Kind |
| --- | --- | --- |
| `OWNER` | Professional | House Owner |
| `BUILDER` (`was CONTRACTOR; set directly in the new baseline`) | Professional | Builder |
| `SITE_ENGINEER` | Professional | Engineer with site category |
| `STORE_MANAGER` | Professional | Engineer with store category |
| `SUPPLIER` (sub-type `MATERIAL`, `LABOUR`, `EQUIPMENT`) | Professional | Supplier |
| `PROFESSIONAL` | Professional | Reserved, no screens (open decision) |
| `GLOBAL_SUPER_ADMIN`, `LOCATION_SUPER_ADMIN`, `MANAGER` | Professional | Administrators, with a scope |
| `TECHNICIAN` | Partner | Technician account |
| `REQUESTER` | Partner | Owner or Site Engineer via hand-off |

Site Engineer and Store Manager become explicit roles in the token, computed from today's `ENGINEER` role plus engineer category, so no screen has to work it out again.

### 7.2 Permissions (Professional, examples by area)

| Area | Permission | OWNER | BUILDER | SITE\_ENGINEER | STORE\_MANAGER | SUPPLIER |
| --- | --- | --- | --- | --- | --- | --- |
| Projects | `project:create` | Yes | No | No | No | No |
| Projects | `project:read` | Own | Assigned | Assigned | Builder's | Assigned |
| Awards | `award:negotiate` | Own projects | Own awards | No | No | No |
| Daily records | `site_record:write` | No | No | Assigned projects | No | No |
| Daily records | `site_record:adjust` | No | Own projects, closed records | No | No | No |
| Store | `store:manage` | No | No | No | Own store | No |
| Store | `store_request:create` | No | No | Assigned projects | No | No |
| Catalog | `listing:manage` | No | No | No | No | Own listings |
| Orders | `purchase_order:respond` | No | No | No | No | Own orders |
| Subscriptions | `subscription:purchase` | No | Self | No | No | No |
| Cameras | `cctv:view` | Own projects | Awarded projects | Assigned projects | No | No |
| Technician booking | `handoff:create` | Yes | No | Yes | No | No |

Administrator permissions stay as named permissions in `admin_profiles.permissions` (for example `users:suspend`, `catalog:write`, `ads:publish`, `coupons:write`), limited by the administrator's scope (global or location).

### 7.3 Partner access

| Action | TECHNICIAN (onboarding) | TECHNICIAN (active, verified) | REQUESTER |
| --- | --- | --- | --- |
| Submit face, Aadhaar, profile | Yes | No | No |
| Offers, jobs, bill, earnings, payout account | No | Own only | No |
| Book, cancel, retry, rate | No | No | Own bookings |
| Track a booking | No | Own job (navigation view) | Own bookings |
| Read job and bill photos | No | Own jobs | Own bookings |

### 7.4 How it is enforced in FastAPI

```python
# auth/dependencies.py
async def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token = read_access_cookie(request)               # 401 if missing or expired
    claims = decode_access_token(token)                # checks signature, exp, iss, aud
    session = sessions_repo.get_active(db, claims.sid) # 401 if revoked or idle
    return Principal(user_id=claims.sub, role=claims.role, session_id=session.id)

def require_roles(*roles: Role):
    def check(p: Principal = Depends(current_principal)) -> Principal:
        if p.role not in roles:
            raise Forbidden("ROLE_NOT_ALLOWED")
        return p
    return check

def require_permission(permission: str):
    def check(p: Principal = Depends(current_principal)) -> Principal:
        if permission not in permissions_for(p):
            raise Forbidden("PERMISSION_DENIED")
        return p
    return check

# modules/projects/router.py
@router.post("/awards/{award_id}/confirm", response_model=AwardOut)
def confirm_award(award_id: UUID, body: AwardAmountIn,
                  p: Principal = Depends(require_permission("award:negotiate")),
                  service: AwardService = Depends()):
    return service.confirm(p, award_id, body)     # service calls policies.can_negotiate(p, award)
```

- **AZ-01** Every router is mounted with `current_principal` by default; public endpoints are listed in one `PUBLIC_ROUTES` set and reviewed.
- **AZ-02** Ownership checks live in each module's `policies.py` and are called by the service before any read or write of a specific record.
- **AZ-03** A record the caller may not see answers **404**, not 403, so IDs cannot be probed.
- **AZ-04** Repository queries for lists always filter by the caller's scope (owner, assigned project, store, supplier, admin country).
- **AZ-05** Every administrator write and every denied attempt on an admin or camera endpoint is written to the audit log in the same transaction.
- **AZ-06** A test per endpoint asserts which roles get 200 and which get 401, 403 or 404 (section 17).

## 8. Frontend: protected routing and rendering

Both React apps decide what to render from a session the server has just confirmed, never from stored data alone. Until that check answers, a protected route renders a neutral loading screen, so no private page flashes before sign-out or redirect.

### 8.1 Session bootstrap

1. On load, the app calls `GET /api/v1/auth/session` (Professional) or `GET /api/v1/auth/me` / `GET /api/v1/requester/session` (Partner).
2. The answer sets `auth.status` to `authenticated` or `anonymous`, and stores the user summary, role, permissions and CSRF token in memory (Redux).
3. While `auth.status` is `checking`, guards render `<FullPageLoader/>` only.
4. A 401 on any later call triggers one shared refresh; if that fails, the store is cleared and the user lands on sign-in with a `returnTo` path.
5. On sign-out, the store is cleared, open WebSockets close, cached server data is reset, and pages restored from the browser's back/forward cache reload.

### 8.2 Route table with access rules

```jsx
// app/router/routes.jsx (Professional, excerpt)
export const routes = [
  { path: '/', element: <HomePage/>, access: 'public' },
  { path: '/login', element: <LoginPage/>, access: 'guest' },
  { path: '/owner/*', element: <OwnerDashboard/>, access: { roles: ['OWNER'] } },
  { path: '/contractor/*', element: <BuilderDashboard/>, access: { roles: ['BUILDER'], checkout: true } },
  { path: '/engineer/*', element: <SiteEngineerDashboard/>, access: { roles: ['SITE_ENGINEER'] } },
  { path: '/store-manager/*', element: <StoreManagerDashboard/>, access: { roles: ['STORE_MANAGER'] } },
  { path: '/supplier/*', element: <SupplierDashboard/>, access: { roles: ['SUPPLIER'] } },
  { path: '/admin/*', element: <AdminDashboard/>, access: { roles: ADMIN_ROLES } },
  { path: '/weather', element: <WeatherPage/>, access: { roles: SIGNED_IN_ROLES, checkout: true } },
];

// app/router/guards/RequireAccess.jsx
export function RequireAccess({ access, children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (access === 'public') return children;
  if (status === 'checking') return <FullPageLoader/>;
  if (access === 'guest') return status === 'authenticated' ? <Navigate to={homeFor(user)} replace/> : children;
  if (status !== 'authenticated') return <Navigate to="/login" state={{ returnTo: location.pathname }} replace/>;
  if (!access.roles.includes(user.role)) return <Navigate to="/403" replace/>;
  if (access.checkout && needsCheckout(user)) return <Navigate to={SUBSCRIPTION_CHECKOUT_PATH} replace/>;
  return children;
}
```

The URL paths stay as today (`/contractor/*` keeps its path even though the role is now called `BUILDER`).

### 8.3 Rules

| ID | Rule |
| --- | --- |
| FE-01 | Every route has an explicit `access` value; a route without one fails the build (ESLint rule or a unit test over the route table). |
| FE-02 | Each dashboard is lazy-loaded (`React.lazy`) so code for one role is not downloaded by another. |
| FE-03 | Inside a page, buttons and menu items use `<Can permission="...">` or `usePermission()`; hiding is for convenience, the API still decides. |
| FE-04 | IDs in URLs are UUIDs; pages handle 404 from the API with a "not found or no access" screen. |
| FE-05 | No token, password or personal data in `localStorage`; only theme, language and a non-secret signed-in hint. |
| FE-06 | No `dangerouslySetInnerHTML` except through one sanitiser (DOMPurify); user text is always rendered as text. |
| FE-07 | A route-level error boundary per dashboard shows a recovery screen instead of a blank page. |
| FE-08 | `postMessage` (Book Technician hand-off): the sender targets the exact Partner origin; the receiver checks `event.origin` against `VITE_PROFESSIONAL_ORIGIN` and accepts one message per window. |
| FE-09 | The production build is served with a strict Content Security Policy, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'` (section 14). |
| FE-10 | Source maps are not published to production. |

### 8.4 Partner route table

| Path | Access |
| --- | --- |
| `/` | Public |
| `/login`, `/forgot-password`, `/register` | Guest (signed-in technicians go to `/dashboard`) |
| `/onboarding` | TECHNICIAN, onboarding not finished |
| `/dashboard`, `/weather` | TECHNICIAN, active and verified (checked with the server) |
| `/book-technician`, `/book-technician/:typeSlug`, `/book-technician/:typeSlug/:serviceSlug` | REQUESTER |
| `/book-technician/bookings/:bookingId` | REQUESTER, own booking |
| `*` | Public (not found) |

## 9. Database design conventions

Every table in `crewnbuild` follows one set of rules: a UUID primary key named `id`, a foreign key with an explicit delete rule on every reference, `timestamptz` audit columns, and names that say what one row is.

### 9.1 Naming

| Object | Convention | Example |
| --- | --- | --- |
| Database | lower case | `crewnbuild` |
| Schema | one per service | `professional`, `partner` |
| Table | snake\_case, plural noun of what one row is; prefixed by domain where it groups | `projects`, `purchase_order_items`, `booking_offers` |
| Join table | both entities, plural last | `project_engineer_assignments`, `technician_services` |
| Column | snake\_case, singular; no type in the name | `status`, `quoted_amount` |
| Primary key | `id` | `bookings.id` |
| Foreign key column | `<referenced entity singular>_id`; a role name when there are two | `project_id`, `requested_by_user_id` |
| Boolean | `is_` / `has_` prefix | `is_active`, `has_insurance` |
| Time | `_at` for instants (`timestamptz`), `_on` for dates | `created_at`, `starts_on` |
| Money | `_amount` in `numeric(14,2)` rupees, or `_paise` in `bigint` for gateway amounts | `total_amount`, `amount_paise` |
| Status values | UPPER\_SNAKE\_CASE text with a CHECK, or a lookup table when admins edit the list | `'PENDING'`, `'COMPLETED'` |
| Constraint names | `pk_<table>`, `fk_<table>__<column>__<target>`, `uq_<table>__<columns>`, `ck_<table>__<rule>`, `ix_<table>__<columns>` | `fk_bookings__technician_id__technicians` |
| Spelling | British/Indian: `labour`, `colour`, `cancelled` | `labour_requests` |

The naming convention is set once on SQLAlchemy `MetaData(naming_convention=...)`, so Alembic generates every name the same way and no constraint is unnamed.

### 9.2 Keys and identity

- **DB-01** Every table has `id uuid PRIMARY KEY`. Values are UUIDv7 (time-ordered, good index locality), generated by the app, or by `uuidv7()` on PostgreSQL 18.
- **DB-02** Junction tables with no own data use a composite primary key of their two foreign keys instead of `id` (`technician_services`, `booking_rating_tags`).
- **DB-03** Human-friendly references are separate unique columns, never the key: `order_number`, `receipt_number`, `ticket_reference`, `invite_code`.
- **DB-04** Integer IDs are never shown in URLs or API responses.

### 9.3 Foreign keys and delete rules

| Relationship kind | Rule | Examples |
| --- | --- | --- |
| Child that cannot exist without its parent | `ON DELETE CASCADE` | `purchase_order_items → purchase_orders`, `booking_checklist_steps → bookings` |
| Record that must survive (money, history, audit) | `ON DELETE RESTRICT` | `payment_transactions → payment_orders`, `technician_earnings → technicians`, `bookings → professional.users` |
| Optional link to something that may go | `ON DELETE SET NULL` | `site_daily_records.created_by_user_id`, `support_tickets.user_id` |
| Reference across schemas | `RESTRICT`, granted by `REFERENCES` on the target column only | `partner.bookings.requested_by_user_id → professional.users.id` |

- **DB-05** Every `_id` column has a foreign key, unless it points to another system (Razorpay, S3) — those are named `external_` or `provider_` (`razorpay_order_id` stays as the provider's own name).
- **DB-06** Every foreign key column is indexed.
- **DB-07** Users are never hard-deleted while history depends on them: account deletion sets `deleted_at` and anonymises personal fields (name, e-mail, phone, address) instead.

### 9.4 Standard columns

| Column | Type | On |
| --- | --- | --- |
| `id` | `uuid` | Every table |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Every table |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()`, set on update | Every table that is updated |
| `deleted_at` | `timestamptz NULL` | Tables with soft delete: users, technicians, listings, projects |
| `created_by_user_id`, `updated_by_user_id` | `uuid NULL` FK | Admin-edited and shared records |
| `version` | `integer NOT NULL DEFAULT 1` | Rows edited concurrently (stock items, bookings) for optimistic locking |

- **DB-08** All timestamps are `timestamptz` stored in UTC and shown in Asia/Kolkata. Today's naive UTC columns are converted with `AT TIME ZONE 'UTC'` during migration.
- **DB-09** Text with a known limit uses `varchar(n)` with a CHECK on blank values; free text uses `text` with a length CHECK.
- **DB-10** JSON is `jsonb`, only for data with no fixed shape (specifications, score breakdowns, weather payloads).
- **DB-11** Personal and secret data columns end in `_ciphertext` and store the key version (`_key_version`).

## 10. Table map: schema `professional`

The 98 current tables become 100 target tables: 44 are renamed, 2 are split in two, none are removed, and 83 change their primary key from integer to UUID. No feature loses its data.

| Domain | Current table | Target table | Key today | Change |
| --- | --- | --- | --- | --- |
| Identity | `users` | `users` | uuid | Add `deleted_at`; role values in 7.1 |
| Identity | `auth_sessions` | `user_sessions` | uuid | Rename; add `csrf_secret_hash` |
| Identity | `oauth_identities` | `user_oauth_identities` | uuid | Rename |
| Identity | `email_verifications` | `email_verification_codes` | int | Rename, UUID |
| Identity | `phone_verifications` | `phone_verification_codes` | int | Rename, UUID |
| Identity | `phone_otp_send_events` | `otp_send_events` | int | Rename, UUID |
| Identity | `verification_records` | `user_verification_reviews` | int | Rename, UUID |
| Accounts | `owner_profiles` | `owner_profiles` | int | UUID; FK `user_id` CASCADE |
| Accounts | `builder_profiles` | `builder_profiles` | int | UUID; FK `user_id` CASCADE |
| Accounts | `engineer_profiles` | `engineer_profiles` | int | UUID; add `category` (SITE\_ENGINEER / STORE\_MANAGER) |
| Accounts | `supplier_profiles` | `supplier_profiles` | int | UUID; FK `user_id` CASCADE |
| Accounts | `admin_profiles` | `admin_profiles` | int | UUID |
| Accounts | `account_deletion_requests` | `account_deletion_requests` | int | UUID |
| Admin | `audit_events` | `admin_audit_logs` | int | Rename, UUID; `target_id` stays text |
| Admin | `reports` | `user_reports` | int | Rename, UUID |
| Admin | `advertisements` | `ads` | int | Rename, UUID |
| Admin | `advertisement_daily_stats` | `ad_daily_stats` | int | Rename, UUID; FK `ad_id` CASCADE |
| Support | `support_tickets` | `support_tickets` | int | UUID; `reference` stays the public code |
| Support | `support_ticket_messages` | `support_ticket_messages` | int | UUID; FK CASCADE |
| Projects | `projects` | `projects` | int | UUID; rename `contractor_id` → `builder_id`; add `deleted_at` |
| Projects | `project_media` | `project_photos` | int | Rename, UUID; FK `timeline_entry_id` SET NULL |
| Projects | `project_timelines` | `project_timeline_entries` | int | Rename, UUID |
| Projects | `requests` | `project_requests` + `property_enquiries` | int | Split by kind: project rows and property rows; UUID |
| Projects | `project_awards` | `project_awards` | int | UUID; FK `agreed_offer_id` |
| Projects | `award_offers` | `project_award_offers` | int | Rename, UUID |
| Projects | `project_engineer_assignments` | `project_engineer_assignments` | int | UUID |
| Projects | `project_supplier_assignments` | `project_supplier_assignments` | int | UUID; `contractor_id` → `builder_id` |
| Projects | `builder_engineer_invitations` | `team_invitations` | int | Rename, UUID |
| Projects | `builder_engineer_memberships` | `team_memberships` | int | Rename, UUID |
| Projects | `estimates` | `cost_estimates` | int | Rename, UUID |
| Projects | `reviews` | project\_reviews | int | Rename, UUID; read by nearby-contractor search (kept: in use) |
| Projects | `escrow_milestones` | project\_escrow\_milestones | int | Rename, UUID; written on project create and award (kept: in use) |
| Site operations | `daily_site_records` | `site_daily_records` | int | Rename, UUID; `contractor_id` → `builder_id` |
| Site operations | `site_labour_entries` | `site_labour_entries` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_material_usages` | `site_material_usages` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_material_purchases` | `site_material_purchases` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_machinery_usages` | `site_machinery_usages` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_expenses` | `site_expenses` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `site_payments` | `site_payments` | int | UUID; FK `daily_record_id` CASCADE |
| Site operations | `daily_record_adjustments` | `site_daily_record_adjustments` | int | Rename, UUID |
| Site operations | `project_material_inventory` | `project_material_stock` | int | Rename, UUID |
| Site operations | `builder_workers` | `builder_workers` | int | UUID |
| Site operations | `builder_offline_suppliers` | `builder_offline_suppliers` | int | UUID |
| Site operations | `labour_logs` | `legacy_labour_logs` | int | Rename, UUID; deprecated with its endpoint |
| Site operations | `material_logs` | `legacy_material_logs` | int | Rename, UUID; deprecated with its endpoint |
| Catalog | `master_categories` | `catalog_categories` | int | Rename, UUID |
| Catalog | `master_subcategories` | `catalog_subcategories` | int | Rename, UUID |
| Catalog | `master_brands` | `catalog_brands` | int | Rename, UUID |
| Catalog | `master_units` | `catalog_units` | int | Rename, UUID |
| Catalog | `master_products` | `catalog_products` | int | Rename, UUID |
| Catalog | `master_product_variants` | `catalog_product_variants` | int | Rename, UUID |
| Catalog | `master_product_images` | `catalog_product_media` | int | Rename, UUID; FK `file_id` |
| Marketplace | `supplier_products` | `supplier_listings` | int | Rename, UUID; FKs to catalog product and variant |
| Marketplace | `supplier_bulk_pricing` | `supplier_listing_price_tiers` | int | Rename, UUID |
| Marketplace | `cart_items` | `cart_items` | int | UUID; FK `listing_id` |
| Marketplace | `material_order_items` | `purchase_orders` + `purchase_order_items` | int | Split: one order per `request_code` and supplier (`order_number`), lines below it; UUID |
| Store | `store_items` | `store_items` | int | UUID; add `version` |
| Store | `store_stock_movements` | `store_stock_movements` | int | UUID |
| Store | `store_site_requests` | `store_site_requests` | int | UUID; `public_request_id` becomes `id` |
| Store | `store_site_request_lines` | `store_site_request_items` | int | Rename, UUID |
| Store | `store_purchase_receipts` | `store_goods_receipts` | int | Rename, UUID; FK `purchase_order_item_id` |
| Store | `store_payment_records` | `store_payments` | int | Rename; `transaction_uuid` becomes `id` |
| Store | `store_builder_requests` | `store_builder_requests` | int | UUID |
| Labour supply | `labor_services` | `labour_services` | int | Rename (spelling), UUID |
| Labour supply | `labor_requests` | `labour_requests` | int | Rename, UUID; `contractor_id` → `builder_id` |
| Labour supply | `labor_daily_records` | `labour_attendance_records` | int | Rename, UUID |
| Equipment supply | `equipment_items` | `equipment_listings` | int | Rename, UUID |
| Equipment supply | `equipment_requests` | `equipment_requests` | int | UUID; `contractor_id` → `builder_id` |
| Equipment supply | `equipment_usage_logs` | `equipment_usage_logs` | int | UUID |
| Messaging | `conversations` | `conversations` | int | UUID |
| Messaging | `conversation_participants` | `conversation_participants` | int | UUID; unique (conversation, user) |
| Messaging | `messages` | `messages` | int | UUID |
| Messaging | `notifications` | `notifications` | int | UUID |
| Files | `uploaded_files` | `files` | int | Rename, UUID |
| Property | `property_listings` | `property_listings` | int | UUID; add `deleted_at` |
| Property | `property_listing_images` | `property_listing_images` | int | UUID |
| Cameras | `cctv_devices`, `cctv_channels`, `cctv_device_credentials`, `cctv_discovery_results`, `cctv_playback_sessions`, `cctv_project_access`, `cctv_audit_events` | same names | uuid | Add FK to `projects`, `users` where missing |
| Cameras | `cctv_rate_limit_events` | `cctv_rate_limit_events` | bigint | UUID |
| Billing | `payment_orders` | `booking_payment_orders` | uuid | Rename; FK `booking_id` → `partner.bookings` RESTRICT |
| Billing | `payment_transactions` | `booking_payment_transactions` | uuid | Rename |
| Billing | `payment_receipts` | `booking_payment_receipts` | uuid | Rename |
| Billing | `subscription_plan_prices` | `subscription_plan_prices` | int | UUID |
| Billing | `builder_subscriptions` | `builder_subscriptions` | uuid | No change |
| Billing | `subscription_payments` | `subscription_payments` | uuid | No change |
| Billing | `subscription_coupons` | `subscription_coupons` | int | UUID |
| Billing | `subscription_coupon_redemptions` | `subscription_coupon_redemptions` | int | UUID |
| Billing | `subscription_webhook_events` | `payment_webhook_events` | int | Rename, UUID; used by both webhooks |
| Weather | `weather_site_locations`, `weather_snapshots`, `weather_alerts`, `weather_alert_acknowledgements`, `weather_geocode_cache` | same names | int | UUID |

The table lists the 7 named CCTV tables and 5 weather tables on two rows each; with them the current total is 98 and the target total is 100.

## 11. Table map: schema `partner`

Partner already uses UUID keys everywhere, so its change is naming: "service request" becomes **booking**, the generic `users` table becomes **technicians**, and Partner reads Professional users through a view instead of mapping the tables directly. All 22 tables keep their data.

| Domain | Current table | Target table | Change |
| --- | --- | --- | --- |
| Accounts | `users` | `technicians` | Rename; every Partner account is a technician; add `deleted_at` |
| Accounts | `auth_sessions` | `sessions` | Rename; `principal_type` stays `technician` / `requester`; `timestamptz` |
| Accounts | `email_otps` | `email_otp_codes` | Rename |
| Accounts | `identity_verifications` | `technician_identity_verifications` | Rename; FK `technician_id` CASCADE; ciphertext columns get `_key_version` |
| Accounts | `technician_profiles` | `technician_profiles` | `user_id` → `technician_id` |
| Technician | `technician_services` | `technician_services` | Composite PK (`technician_id`, `catalog_service_id`) |
| Technician | `technician_working_hours` | `technician_working_hours` | Composite PK (`technician_id`, `weekday`) |
| Technician | `technician_locations` | `technician_locations` | PK `technician_id` (one row per technician) |
| Technician | `technician_bank_accounts` | `technician_payout_accounts` | Rename |
| Technician | `technician_earnings` | `technician_earnings` | `service_request_id` → `booking_id` (SET NULL) |
| Catalog | `services` | `catalog_services` | Rename |
| Catalog | `service_step_templates` | `catalog_service_checklist_steps` | Rename |
| Bookings | `service_requests` | `bookings` | Rename; `requested_by_user_id` FK to `professional.users` becomes RESTRICT |
| Bookings | `service_request_assignments` | `booking_offers` | Rename |
| Bookings | `service_request_tracking` | `booking_destinations` | Rename; PK `booking_id` |
| Job execution | `service_request_steps` | `booking_checklist_steps` | Rename |
| Job execution | `service_request_media` | `booking_media` | Rename; `storage_key` points to S3 |
| Job execution | `service_request_start_otps` | `booking_start_codes` | Rename |
| Job execution | `service_request_bills` | `booking_work_bills` | Rename |
| Job execution | `service_request_bill_items` | `booking_work_bill_items` | Rename |
| Job execution | `service_request_ratings` | `booking_ratings` | Rename |
| Job execution | `service_request_rating_tags` | `booking_rating_tags` | Rename; composite PK (`rating_id`, `tag`) |

Every column named `service_request_id` becomes `booking_id`, and every `technician_id` points to `technicians.id`.

### 11.1 How Partner reads Professional users

Partner no longer maps `professional.users` and `professional.engineer_profiles` directly. Professional publishes one read-only view, owned by Professional and granted to Partner:

```sql
CREATE VIEW professional.v_partner_requesters AS
SELECT u.id, u.name, u.email, u.phone, u.status, u.address, u.pincode, u.location,
       CASE WHEN u.role = 'OWNER' THEN 'OWNER'
            WHEN u.role = 'ENGINEER' AND ep.category = 'SITE_ENGINEER' THEN 'SITE_ENGINEER'
       END AS requester_role
FROM professional.users u
LEFT JOIN professional.engineer_profiles ep ON ep.user_id = u.id
WHERE u.deleted_at IS NULL;

GRANT SELECT ON professional.v_partner_requesters TO crewnbuild_partner;
```

- The view is the contract between the services: Professional can change its tables freely as long as the view keeps its columns.
- `email` is nullable in the view and in Partner's model (phone-only users).
- Store Managers and other roles come back with `requester_role = NULL` and are refused a requester session.

* `engineer_profiles.category` is new. Today the Site Engineer check is `specialization = 'Site Engineer'`; the data copy fills `category = 'SITE_ENGINEER'` from it, and the engineer category screen writes `category` from then on.

### 11.2 How Professional reads Partner bookings

Professional also reads Partner data today, with hand-written SQL on `partner.service_requests`, `partner.services` and `partner.users`: technician booking payments (list, order, verify, receipt) and the account-deletion check for open bookings. Renaming those tables would break both silently, so Partner publishes one read-only view and Professional reads only that:

```sql
CREATE VIEW partner.v_professional_bookings AS
SELECT b.id, b.requested_by_user_id, b.requested_by_role, b.status, b.trade,
       b.quoted_amount, b.currency, b.completed_at,
       cs.service_name, t.name AS technician_name
FROM partner.bookings b
LEFT JOIN partner.catalog_services cs ON cs.id = b.catalog_service_id
LEFT JOIN partner.technicians t ON t.id = b.technician_id;

GRANT USAGE ON SCHEMA partner TO crewnbuild_professional;
GRANT SELECT ON partner.v_professional_bookings TO crewnbuild_professional;
```

- The view is created in Partner's baseline; Professional's payment and account-deletion code reads only it, never Partner's tables.
- Behaviour stays as today: only the booking's House Owner can pay, only for a `COMPLETED` booking, at `quoted_amount`; Site Engineer bookings cannot be paid; account deletion is refused while a booking is open.
- Order is fixed because each schema refers to the other: Professional baseline first, then Partner baseline (with the view); the payment foreign key `booking_payment_orders.booking_id → partner.bookings` comes in a later Professional migration that runs after Partner's baseline.

## 12. Reference DDL for core tables

These six tables show the conventions applied; every other table follows the same pattern. Alembic generates the real DDL from the SQLAlchemy models; this SQL is the reviewed target.

```sql
-- professional.users
CREATE TABLE professional.users (
    id                    uuid PRIMARY KEY,
    name                  varchar(150) NOT NULL,
    email                 varchar(255),
    email_verified_at     timestamptz,
    phone                 varchar(20)  NOT NULL,
    password_hash         varchar(255) NOT NULL,
    role                  varchar(30)  NOT NULL,
    status                varchar(20)  NOT NULL DEFAULT 'ACTIVE',
    address               text         NOT NULL,
    pincode               varchar(10)  NOT NULL,
    location              varchar(180),
    country_code          char(2)      NOT NULL DEFAULT 'IN',
    profile_image_file_id uuid REFERENCES professional.files (id) ON DELETE SET NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    deleted_at            timestamptz,
    CONSTRAINT ck_users__role   CHECK (role IN ('OWNER','BUILDER','ENGINEER','SUPPLIER','PROFESSIONAL',
                                            'GLOBAL_SUPER_ADMIN','LOCATION_SUPER_ADMIN','MANAGER')),
    CONSTRAINT ck_users__status CHECK (status IN ('ACTIVE','SUSPENDED','DELETED'))
);
CREATE UNIQUE INDEX uq_users__email ON professional.users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users__phone ON professional.users (country_code, phone) WHERE deleted_at IS NULL;
CREATE INDEX ix_users__role ON professional.users (role);
CREATE INDEX ix_users__pincode ON professional.users (pincode);

-- professional.user_sessions
CREATE TABLE professional.user_sessions (
    id                     uuid PRIMARY KEY,
    user_id                uuid NOT NULL REFERENCES professional.users (id) ON DELETE CASCADE,
    token_family_id        uuid NOT NULL,
    refresh_token_hash     char(64) NOT NULL,
    csrf_secret_hash       char(64) NOT NULL,
    replaced_by_session_id uuid REFERENCES professional.user_sessions (id) ON DELETE SET NULL,
    user_agent             varchar(400),
    ip_address             inet,
    expires_at             timestamptz NOT NULL,
    last_used_at           timestamptz NOT NULL DEFAULT now(),
    revoked_at             timestamptz,
    revoke_reason          varchar(20),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_sessions__refresh_token_hash UNIQUE (refresh_token_hash)
);
CREATE INDEX ix_user_sessions__user_id_active ON professional.user_sessions (user_id) WHERE revoked_at IS NULL;

-- professional.projects
CREATE TABLE professional.projects (
    id                    uuid PRIMARY KEY,
    owner_id              uuid NOT NULL REFERENCES professional.users (id) ON DELETE RESTRICT,
    builder_id            uuid REFERENCES professional.users (id) ON DELETE SET NULL,
    title                 varchar(180) NOT NULL,
    description           text NOT NULL,
    address               text NOT NULL,
    pincode               varchar(10) NOT NULL,
    state                 varchar(120),
    city                  varchar(120),
    building_type         varchar(60) NOT NULL DEFAULT 'RESIDENTIAL',
    construction_type     varchar(60) NOT NULL DEFAULT 'CONTRACTOR',
    budget_amount         numeric(14,2) NOT NULL DEFAULT 0,
    land_area             numeric(12,2) NOT NULL DEFAULT 0,
    floors                smallint NOT NULL DEFAULT 1,
    status                varchar(40) NOT NULL DEFAULT 'ACTIVE',
    completion_percentage smallint NOT NULL DEFAULT 0,
    starts_on             date,
    ends_on               date,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    deleted_at            timestamptz,
    CONSTRAINT ck_projects__completion CHECK (completion_percentage BETWEEN 0 AND 100),
    CONSTRAINT ck_projects__dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX ix_projects__owner_id   ON professional.projects (owner_id);
CREATE INDEX ix_projects__builder_id ON professional.projects (builder_id);
CREATE INDEX ix_projects__pincode    ON professional.projects (pincode);

-- professional.purchase_orders and purchase_order_items (split from material_order_items)
CREATE TABLE professional.purchase_orders (
    id               uuid PRIMARY KEY,
    order_number     varchar(40) NOT NULL,
    project_id       uuid NOT NULL REFERENCES professional.projects (id) ON DELETE RESTRICT,
    buyer_user_id    uuid NOT NULL REFERENCES professional.users (id) ON DELETE RESTRICT,
    supplier_user_id uuid NOT NULL REFERENCES professional.users (id) ON DELETE RESTRICT,
    status           varchar(20) NOT NULL DEFAULT 'PENDING',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_purchase_orders__order_number UNIQUE (order_number)
);
CREATE TABLE professional.purchase_order_items (
    id                uuid PRIMARY KEY,
    purchase_order_id uuid NOT NULL REFERENCES professional.purchase_orders (id) ON DELETE CASCADE,
    listing_id        uuid NOT NULL REFERENCES professional.supplier_listings (id) ON DELETE RESTRICT,
    material_name     varchar(160) NOT NULL,
    unit              varchar(40)  NOT NULL,
    unit_price_amount numeric(14,2),
    quantity          numeric(14,3) NOT NULL,
    status            varchar(20) NOT NULL DEFAULT 'PENDING',
    fulfilled_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_purchase_order_items__quantity CHECK (quantity > 0)
);
CREATE INDEX ix_purchase_order_items__purchase_order_id ON professional.purchase_order_items (purchase_order_id);

-- partner.bookings
CREATE TABLE partner.bookings (
    id                   uuid PRIMARY KEY,
    requested_by_user_id uuid NOT NULL REFERENCES professional.users (id) ON DELETE RESTRICT,
    requested_by_role    varchar(20) NOT NULL,
    technician_id        uuid REFERENCES partner.technicians (id) ON DELETE RESTRICT,
    catalog_service_id   uuid REFERENCES partner.catalog_services (id) ON DELETE RESTRICT,
    trade                varchar(20) NOT NULL,
    service_address      text NOT NULL,
    pincode              varchar(10) NOT NULL,
    service_latitude     double precision,
    service_longitude    double precision,
    quoted_amount        numeric(14,2),
    currency             char(3) NOT NULL DEFAULT 'INR',
    status               varchar(24) NOT NULL DEFAULT 'SEARCHING',
    dispatch_round       smallint NOT NULL DEFAULT 1,
    accepted_at timestamptz, en_route_at timestamptz, arrived_at timestamptz,
    started_at  timestamptz, completed_at timestamptz, cancelled_at timestamptz,
    version              integer NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_bookings__status CHECK (status IN ('SEARCHING','OFFERED','ACCEPTED','EN_ROUTE','ARRIVED',
                                      'IN_PROGRESS','COMPLETED','CANCELLED','NO_TECHNICIAN_FOUND','EXPIRED')),
    CONSTRAINT ck_bookings__requested_by_role CHECK (requested_by_role IN ('OWNER','SITE_ENGINEER')),
    CONSTRAINT ck_bookings__trade CHECK (trade IN ('PAINTER','PLUMBER','ELECTRICIAN','CARPENTER'))
);
CREATE UNIQUE INDEX uq_bookings__technician_active ON partner.bookings (technician_id)
    WHERE status IN ('ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS');
CREATE INDEX ix_bookings__requested_by_user_id ON partner.bookings (requested_by_user_id);
CREATE INDEX ix_bookings__status ON partner.bookings (status);
```

Notes: the role CHECK shows `BUILDER` as the target value (`was CONTRACTOR; the data copy script converts it`). Column renames such as `budget` → `budget_amount` are internal; API field names stay the same through the response schemas.

## 13. API standards

Both APIs keep every current endpoint and field; they gain a version prefix, one error shape, UUID IDs and consistent paging. The web apps change only their base URL and ID handling.

| ID | Standard |
| --- | --- |
| API-01 | All routes live under `/api/v1` (`/api/v1/projects/{project_id}`). The reverse proxy keeps the old unprefixed paths working for one release, then removes them. |
| API-02 | Path IDs are UUIDs, validated by FastAPI (`project_id: UUID`); a malformed ID answers 422 before any database call. |
| API-03 | Request models use `extra="forbid"`; response models are explicit, so no ORM field (hashes, ciphertext, internal flags) can leak. |
| API-04 | One error body everywhere: `{"error": {"code": "BOOKING_NOT_FOUND", "message": "…", "request_id": "…", "details": []}}`. Validation errors never echo submitted values. |
| API-05 | Status codes: 400 rule broken, 401 not signed in, 403 role not allowed, 404 missing or not yours, 409 state conflict (`INVALID_STATE_TRANSITION`, `REQUEST_ALREADY_ASSIGNED`), 422 invalid input, 429 rate limited. |
| API-06 | Lists use `?limit=` (max 100) and `?cursor=` (keyset on `created_at`, `id`), returning `{"items": [...], "next_cursor": "…"}`. Existing page parameters keep working for one release. |
| API-07 | Writes that can be retried (payments, checkout, receipts, bookings) accept an `Idempotency-Key` header; a repeat returns the first result. |
| API-08 | Times in responses are ISO 8601 with offset (`2026-11-12T13:00:00+05:30`). Money is a decimal string in rupees, or integer paise for gateway amounts. |
| API-09 | OpenAPI is generated from the code; `/docs`, `/redoc`, `/openapi.json` are served only when `ENVIRONMENT=development`. |
| API-10 | Uploads: size and type checked server-side (magic bytes, not the file name), images re-encoded, files stored privately in S3 and served by short-lived presigned URLs or an authorised endpoint. |
| API-11 | Webhooks (Razorpay) verify the HMAC signature on the raw body, record the event ID once in `payment_webhook_events`, and answer quickly. |
| API-12 | WebSockets: `/api/v1/events/ws`, `/api/v1/messages/ws/{conversation_id}` (Professional); `/api/v1/dispatch/ws/technician`, `/api/v1/tracking/ws/bookings/{booking_id}` (Partner). Cookie auth at connect; `Origin` checked; messages are small JSON with a `type`. |
| API-13 | Every response carries `X-Request-ID`; the same ID is in the logs. |

## 14. Security hardening checklist

A release goes to production only when every item below is ticked. The list follows the OWASP Top 10 areas, mapped to this platform.

### 14.1 Access control and authentication

- [ ] Every API route requires a session unless it is in the reviewed `PUBLIC_ROUTES` list (AZ-01).
- [ ] Ownership checks on every record read and write; other users' records answer 404 (AZ-02, AZ-03).
- [ ] Role and permission tests cover every endpoint (AZ-06).
- [ ] Cookies `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix; no token in browser storage.
- [ ] CSRF token and `Origin` check on every cookie-authenticated write.
- [ ] Sign-in, OTP and password-reset rate limits shared across processes.
- [ ] Sign-in and OTP answers do not reveal whether an account exists.
- [ ] Hand-off token single use, 60 s, audience-bound, EdDSA-signed; `postMessage` origin checked both ways.

### 14.2 Data protection

- [ ] All exposed secrets rotated and history purged (section 5.1).
- [ ] Aadhaar, face captures, bank numbers and camera credentials encrypted with versioned keys; only last four digits returned.
- [ ] Passwords hashed with Argon2id; legacy bcrypt re-hashed on sign-in.
- [ ] TLS 1.2+ everywhere; HSTS on both domains; database connections use `sslmode=require` in production.
- [ ] Private files in S3 with no public bucket access; presigned URLs expire in 5 minutes or less.
- [ ] Logs carry no passwords, tokens, OTPs, Aadhaar numbers, bank numbers or full phone numbers.
- [ ] Each service's database role can reach only its own schema (plus Partner's `SELECT` on the requester view).

### 14.3 Input, output and browser

- [ ] Pydantic validation with `extra="forbid"`; SQL only through SQLAlchemy parameters, never string building.
- [ ] Upload type checked by content, size limited, images re-encoded; PDFs rendered server-side only.
- [ ] Security headers on both web apps and APIs:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' https://checkout.razorpay.com;
  connect-src 'self' https://api.<domain> wss://api.<domain>; img-src 'self' data: blob: https://*.amazonaws.com https://*.tile.openstreetmap.org;
  frame-src https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(self), microphone=()
```

- [ ] CORS allows only the two web origins, with credentials; no wildcard.
- [ ] Outbound calls (geocoding, pincode, weather, AI, camera gateway) have timeouts and allow-listed hosts; camera addresses restricted to allowed networks (SSRF).

### 14.4 Operations

- [ ] API docs off in production; `DEBUG=false`; stack traces never returned.
- [ ] Dependency audit (`pip-audit`, `npm audit`) and secret scan (gitleaks) pass in CI.
- [ ] Admin actions and denied access attempts written to the audit log.
- [ ] Daily encrypted database backups, restore tested each quarter.
- [ ] Alerts on error rate, failed sign-in spikes and webhook signature failures.

## 15. Scalability, deployment and observability

API processes hold no state, so they scale by adding processes; the only singletons are the scheduled jobs, which take a database lock so exactly one copy runs at a time.

### 15.1 Runtime units

| Unit | Runs | Scales by |
| --- | --- | --- |
| `professional-api` | Gunicorn + Uvicorn workers, `/api/v1` | More workers and containers |
| `partner-api` | Gunicorn + Uvicorn workers, `/api/v1`, WebSockets | More workers; realtime relay over PostgreSQL `LISTEN/NOTIFY` |
| `professional-scheduler` | Subscription sweep (60 min), weather monitor (30 min, severe 10 min) | One active copy (advisory lock) |
| `partner-scheduler` | Dispatch sweeper (every 3 s), face-capture purge | One active copy (advisory lock) |
| `professional-web`, `partner-web` | Static builds behind a CDN or nginx | CDN |
| PostgreSQL | Database `crewnbuild` | Bigger instance, read replica for reports, PgBouncer for connections |
| Object storage | S3 buckets for both services | Managed |

- **SC-01** Jobs move out of the API processes into the scheduler units; each job wraps its run in `pg_try_advisory_lock(<job key>)` so a second copy skips.
- **SC-02** Dispatch and stock updates use row locks (`SELECT … FOR UPDATE`) or the `version` column, so two processes never assign one job twice or issue the same stock twice.
- **SC-03** Connection pool per process sized so total connections stay under PgBouncer's limit.
- **SC-04** Hot queries have indexes on their filter and sort columns (owner, project, status, created\_at); list endpoints are paged (API-06).
- **SC-05** Partner job and bill photos move from local disk to S3 so any server can serve them.
- **SC-06** Map search and routing use hosted Nominatim and OSRM instances, not the public demo servers.

* **SC-07** Professional's live chat and dashboard hints (`/messages/ws`, `/events/ws`) reach only sockets on the same process today. Before running two processes or moving jobs to the scheduler, Professional gets the same PostgreSQL `LISTEN/NOTIFY` relay that Partner already uses, so a message from any process reaches every connected user.

### 15.2 Deployment

- One Docker image per unit, built in CI, tagged with the Git commit.
- Environments: development (Docker Compose), staging (same as production, test payment keys), production.
- Migrations run as a separate release step (`alembic upgrade head` per service) before new API containers start; each migration is backward compatible with the previous release (expand, then contract).
- nginx (or a cloud load balancer) terminates TLS, adds security headers, routes `api.<domain>/professional/*` and `api.<domain>/partner/*`, and upgrades WebSockets.

### 15.3 Observability

| Signal | Tool | What |
| --- | --- | --- |
| Logs | structlog JSON to stdout, shipped to a log store | Request ID, user ID (not name), route, status, latency |
| Metrics | Prometheus endpoint per service | Request rate, errors, p95 latency, DB pool, job runs, dispatch timings |
| Traces | OpenTelemetry | API → DB → outside service spans |
| Errors | Sentry (or equivalent) | Backend and frontend exceptions, personal data scrubbed |
| Health | `/api/v1/health` (process), `/api/v1/health/db` (schema at head, tables present) | Used by the load balancer and deploys |

## 16. Rebuild plan: one clean baseline per service

The platform is not in production yet, so instead of changing old tables step by step, each service starts from **one new Alembic baseline** that creates every table with its final name, UUID key and foreign keys. A colleague who clones the repository runs `alembic upgrade head` in both backends and gets the complete database; existing development data, if wanted, is copied once by a script. The work is done in a new repository, crewnbuild: tables are created fresh, not renamed, and none of the old migrations, test files or exposed secrets enter its history.

### 16.1 Work plan

| Step | What | Done when |
| --- | --- | --- |
| R0 | **Freeze.** Everyone pushes their open work ` to the old repository; it is then archived (read-only, private) as the reference copy. Create a new, empty repository named  ``crewnbuild`. | Old repository archived; new repository created |
| R1 | **Secrets.** Rotate exposed secrets, clean both `.env.example` files, add gitleaks to the new repository (section 5). | No real value in any tracked file |
| R2 | **`Copy code into the new layout in the new repository (no old history)**`: `Kuwait-Version` → `crewnbuild`, `Octabuild` → `professional`, `Octabuild/frontend 7/frontend` → `professional/frontend`, `Partner` → `partner`. | Layout matches 4.1 |
| R3 | **Clean up** everything in 4.7. | Nothing in 4.7 left |
| R4 | **Backend restructure:** modules (4.2), human-readable file names (4.6), models with the new table names (sections 10 and 11), UUID primary-key mixin, naming convention, foreign keys with delete rules. | Both apps start; every endpoint answers as before |
| R5 | **New baselines:** copy no old `alembic/versions`, generate one baseline per service, review it by hand (16.2). | Empty database → `alembic upgrade head` builds all tables in both schemas |
| R6 | **Security layer:** authentication, permissions, ownership policies, cookies, CSRF, headers (sections 6, 7, 14). | Role access tests pass |
| R7 | **Frontend restructure:** features (4.4), Redux Toolkit store and RTK Query, route table with guards (section 8), UUID IDs, `/api/v1`. | Every route renders for the right role only |
| R8 | **Copy existing data** (optional) from the old database into `crewnbuild` (16.4). | Row counts match |
| R9 | **Accept and merge:** tests and checks in section 17; `push to main of the new repository; everyone clones it`. | Colleagues run section 18 and everything works |

### 16.2 Baseline migrations

| Service | File | Creates |
| --- | --- | --- |
| Professional | `professional/backend/alembic/versions/20261114_0001_initial_professional_schema.py` | Schema `professional`, all 100 tables, indexes, constraints, view `v_partner_requesters`, grants to `crewnbuild_partner` |
| Partner | `partner/backend/alembic/versions/20261114_0001_initial_partner_schema.py` | Schema `partner`, all 22 tables, indexes, constraints, foreign key to `professional.users`, view v\_professional\_bookings and its grant to crewnbuild\_professional |

- **MG-01** Professional is always migrated first: Partner's baseline refers to `professional.users` and the requester view. Partner's `env.py` stops with a clear message if they are missing.
- **MG-02** Each service keeps its version table in its own schema (`professional.alembic_version`, `partner.alembic_version`) and only looks at its own schema.
- **MG-03** Reference data is loaded by idempotent seed commands, not migrations: master catalog, subscription plan prices, Partner service catalog and checklist templates, first admin account.
- **MG-04** The 54 old Professional and 15 old Partner revisions are removed from the working tree; they stay in the archived old repository.
- **MG-05** Migration files are named by date and purpose, revision IDs stay under 32 characters.

* **MG-06** The master catalog tables (`master_*`, target `catalog_*`) are not created by the old migrations: only `sql_scripts/master_catalog_seed.sql` creates them, with some delete rules that differ from the models. Before generating the baseline, compare the models with the live database (`pg_dump --schema-only`) and make the models match it, choosing each delete rule by section 9.3. The baseline then builds the catalog tables like every other table.
* **MG-07** Build the baseline on an empty database, then compare its `pg_dump --schema-only` with the old live database table by table (columns, constraints, indexes); every difference must be an intended change from sections 9–12, otherwise it is a bug.

```python
# professional/backend/alembic/env.py (excerpt; partner/backend uses SCHEMA = "partner")
SCHEMA = "professional"

def include_object(obj, name, type_, reflected, compare_to):
    # Only this service's schema is compared and migrated.
    if type_ == "table":
        return obj.schema == SCHEMA
    return True

def run_migrations_online() -> None:
    with engine.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            include_schemas=True,
            include_object=include_object,
            version_table="alembic_version",
            version_table_schema=SCHEMA,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
```

```text
# alembic.ini: readable migration file names
file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s
```

### 16.3 Commands to create the baselines (done once, by the person doing R5)

```powershell
# Start from an empty database crewnbuild with the two schemas (section 18, step 2)
cd professional\backend
alembic revision --autogenerate --rev-id 0001 -m "initial professional schema"
# Review the file by hand: names, UUID keys, foreign keys, delete rules, the view and grants
alembic upgrade head

cd ..\..\partner\backend
alembic revision --autogenerate --rev-id 0001 -m "initial partner schema"
alembic upgrade head
```

### 16.4 Copying existing development data (optional)

A one-time script, `infrastructure/database/copy_legacy_data.py`, reads the old database and writes into `crewnbuild`:

1. Tables are copied parent-first, so every foreign key finds its parent.
2. Each old integer ID gets a new UUIDv7; a map (old ID → new UUID) per table rewrites every child's foreign key.
3. Rows that already have UUIDs (users, Partner tables, payments) keep them, so links between the two services stay intact.
4. `requests` is split into `project_requests` and `property_enquiries`; `material_order_items` into `purchase_orders` and `purchase_order_items`.
5. Encrypted fields are decrypted with the old key and re-encrypted with the new one.
6. Sessions, OTP codes and rate-limit events are not copied; everyone signs in again.
7. The script prints row counts for old and new tables side by side and stops on any difference.

## 17. Testing and acceptance

The old, scattered test files are deleted in the clean-up (4.7). This section is the new, organised test suite: each backend keeps its tests in `tests/` (`test_*.py`), each frontend next to the code (`*.test.jsx`). The restructure is accepted when behaviour is unchanged, access is correct and data is complete; all suites run in CI on every pull request against a fresh `crewnbuild_test`.

| Suite | Tool | Covers | Gate |
| --- | --- | --- | --- |
| Contract | pytest + httpx, recorded responses | Every endpoint of both APIs: status, fields, types (UUID IDs allowed) | No difference except agreed ones |
| Role access | pytest, generated from the route table | Every endpoint × every role: 200 / 401 / 403 / 404 as expected | 100% of endpoints covered |
| Unit | pytest; Vitest + Testing Library | Services, policies, dispatch ranking, billing maths, route guards, permission hooks | Line coverage ≥ 80% on `services` and `policies` |
| Database | pytest against PostgreSQL | Migrations up from an empty database and from a production copy; every FK valid; no unnamed constraint; no integer PK left | All checks pass |
| End to end | Playwright | The five core journeys (sign-up to award, daily record, store issue and purchase, subscription, Book Technician to rating) | All pass on staging |
| Security | gitleaks, pip-audit, npm audit, OWASP ZAP baseline on staging | Secrets, known vulnerabilities, headers, cookies | No high findings |
| Load | k6 or Locust | 200 concurrent users on core lists; 50 bookings dispatched at once; 2 API processes | p95 < 500 ms; no duplicate offers |

### 17.1 Final acceptance

- [ ] Database `crewnbuild` has only schemas `professional` and `partner` (plus system schemas); `public` has no application table.
- [ ] Every table has a UUID primary key or a composite key of UUID foreign keys; every reference has a named foreign key with a delete rule.
- [ ] Table names match sections 10 and 11; row counts match the pre-migration snapshot.
- [ ] No real secret in any tracked file or in Git history; every exposed secret rotated.
- [ ] Every protected route in both web apps redirects when signed out and blocks the wrong role.
- [ ] Contract, role, unit, database, end-to-end and security suites green.
- [ ] Both services run with two API processes and one scheduler each, with no duplicate jobs.

## 18. Setting up after a fresh clone

A colleague goes from `git clone` to both apps running with the commands below, on Windows PowerShell. Professional is always migrated before Partner.

**Needs:** Git, Python 3.12, Node.js 20 LTS or later, PostgreSQL 16 or later.

1. **Clone**

```powershell
git clone <repository-url> crewnbuild
cd crewnbuild
```

2. **Create the database, roles and schemas** (once per machine)

```powershell
psql -U postgres -f infrastructure\database\create_database_and_roles.sql
```

```sql
-- infrastructure/database/create_database_and_roles.sql
CREATE ROLE crewnbuild_professional LOGIN PASSWORD 'change-me';
CREATE ROLE crewnbuild_partner      LOGIN PASSWORD 'change-me';
CREATE DATABASE crewnbuild;
\connect crewnbuild
CREATE SCHEMA professional AUTHORIZATION crewnbuild_professional;
CREATE SCHEMA partner      AUTHORIZATION crewnbuild_partner;
GRANT USAGE ON SCHEMA professional TO crewnbuild_partner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- repeat for crewnbuild_test
```

3. **Professional backend**

```powershell
cd professional\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
Copy-Item .env.example .env        # then fill in local values
alembic upgrade head               # creates every professional table
python -m app.seeds.run_all_seeds  # catalog, plan prices, first admin
uvicorn app.main:app --reload --port 8000
```

4. **Partner backend** (new terminal)

```powershell
cd partner\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
Copy-Item .env.example .env
alembic upgrade head               # creates every partner table
python -m app.seeds.run_all_seeds  # service catalog, checklist templates
uvicorn app.main:app --reload --host 127.0.0.1 --port 8200
```

5. **Frontends** (one terminal each)

```powershell
cd professional\frontend; npm ci; Copy-Item .env.example .env.local; npm run dev   # http://localhost:5173
cd partner\frontend;      npm ci; Copy-Item .env.example .env.local; npm run dev   # http://localhost:5373
```

6. **Check:** `http://localhost:8000/api/v1/health/db` and `http://localhost:8200/api/v1/health/db` both report the schema at head with no missing tables.

`scripts/setup_local_environment.ps1` runs steps 3 to 5 in one go once `.env` files exist.

## 19. Team workflow: Git and Alembic

Every change reaches `main` through a reviewed pull request, and every database change travels as a model change plus its migration in the same pull request, so a pull always brings code and tables together.

### 19.1 Git

- `main` is protected: no direct pushes; a pull request needs one review and green CI.
- Branch names: `feature/<area>-<what>`, `fix/<area>-<what>` (e.g. `feature/partner-booking-cancel-reason`).
- Commit messages say what and why in plain words (`Add cancel reason to bookings`).
- Never commit `.env`, `.venv`, `node_modules`, `dist`, uploads, logs or editor folders; gitleaks blocks secrets before push.

### 19.2 Database changes

1. Change the model in `app/modules/<module>/models.py`.
2. Generate the migration: `alembic revision --autogenerate -m "add cancel reason to bookings"`.
3. Read the generated file; fix names, defaults, data steps; never trust autogenerate blindly.
4. Run `alembic upgrade head`, then `alembic downgrade -1` and `upgrade head` again to prove it reverses.
5. Commit the model and the migration together.

| Rule | Why |
| --- | --- |
| Never edit a migration that is already on `main` | Colleagues have already applied it; write a new one |
| Exactly one head per service; CI runs `alembic heads` and fails on two | Two people adding migrations in parallel would fork the chain |
| If your branch is behind and both added migrations: rebase, then set your file's `down_revision` to the newest revision on `main` (or `alembic merge heads`) | Keeps one straight chain |
| A Partner change that needs a Professional table change waits for the Professional pull request to merge first | Partner migrations run after Professional's |
| After every `git pull`: `alembic upgrade head` in professional, then partner; `pip install -r requirements.txt`; `npm ci` | Your local database and packages match the code |
