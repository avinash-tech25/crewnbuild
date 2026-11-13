# CREWNBUILD

CREWNBUILD is a construction platform built as two products on one PostgreSQL database, `crewnbuild`:

- **Professional**: the construction operating system for house owners, builders, site engineers, store managers, suppliers and administrators. It has a FastAPI backend and a React web app and uses schema `professional`.
- **Partner**: on-demand technician booking (painter, plumber, electrician, carpenter). It has a FastAPI backend and a React web app and uses schema `partner`.

The two services never call each other over HTTP. They connect in three ways only: the signed Book Technician hand-off, a read-only view of requesters, and a read-only view of bookings. See `docs/technical-architecture.md`, sections 2 and 11.

> **Status: restructure in progress.** This repository replaces the old `Kuwait-Version` repository. Both backends are ported (R4) and each has its Alembic baseline (R5); the frontends follow in R7.

## Repository layout

```text
crewnbuild/
├── professional/
│   ├── backend/        FastAPI, schema professional
│   └── frontend/       React + Vite
├── partner/
│   ├── backend/        FastAPI, schema partner
│   └── frontend/       React + Vite
├── infrastructure/
│   ├── database/       create_database_and_roles.sql
│   ├── docker/         Dockerfiles (to come)
│   └── nginx/          Reverse proxy settings (to come)
├── docs/               Architecture, requirements and connection map
├── scripts/            migrate.py (both services, in order) and seed.py
└── .github/workflows/  CI
```

## Documents

| Document | What it holds |
| --- | --- |
| `docs/technical-architecture.md` | The target design. It wins over the other documents. |
| `docs/software-requirements.md` | What the platform must do (SRS) |
| `docs/product-requirements.md` | Product goals, personas and features (PRD) |
| `docs/CONNECTIONS.md` | Every connection in the old code and the restructure risk list |

## Running locally

**You need:** Git, Python 3.12, Node.js 20 LTS or later, and **PostgreSQL 18** (the tables use its `uuidv7()`). The full steps are in `docs/technical-architecture.md` section 18.

1. **Install PostgreSQL 18** and make sure `psql` is on your PATH.

2. **Create the database, roles and schemas** (once per machine). Copy the script, replace both `change-me` passwords with your own, and run it as the PostgreSQL superuser:

   ```powershell
   Copy-Item infrastructure\database\create_database_and_roles.sql $env:TEMP\create_crewnbuild.sql
   notepad $env:TEMP\create_crewnbuild.sql          # set your two passwords
   psql -U postgres -f $env:TEMP\create_crewnbuild.sql
   ```

   It creates the databases `crewnbuild` and `crewnbuild_test`, the roles `crewnbuild_professional` and `crewnbuild_partner`, and one schema per service. Each service creates its own tables; neither role can create databases.

3. **Install each backend** and create its settings file from the template. Put the password you chose for that service's role in its `DATABASE_URL`, and never commit a `.env` file:

   ```powershell
   cd professional\backend
   python -m venv .venv; .venv\Scripts\Activate.ps1
   pip install -r requirements.txt -r requirements-dev.txt
   Copy-Item .env.example .env        # then fill in local values
   deactivate; cd ..\..

   cd partner\backend
   python -m venv .venv; .venv\Scripts\Activate.ps1
   pip install -r requirements.txt -r requirements-dev.txt
   Copy-Item .env.example .env        # then fill in local values
   deactivate; cd ..\..
   ```

4. **Create the tables** of both services, from the repository root. The two schemas refer to each other, so the order matters (Professional 0001, Partner, then Professional 0002), and the script runs exactly that order with each backend's own `.env`:

   ```powershell
   python scripts\migrate.py           # safe to run again
   python scripts\migrate.py --check   # models and database match
   ```

   `python scripts\migrate.py --down` removes everything again, in reverse order. Running `alembic upgrade head` in `professional\backend` alone stops at revision 0002 with a message to migrate Partner first, and applies nothing; Partner on its own refuses to start before Professional (MG-01).

5. **Load the reference data** (master catalog, subscription plan prices, Partner service catalog and checklists). Every seed is idempotent:

   ```powershell
   python scripts\seed.py                        # add --with-test-accounts for the OTP test accounts (never production)
   cd professional\backend; .venv\Scripts\python -m app.seeds.seed_admin_account; cd ..\..   # the first administrator
   ```

6. **Start both backends** (one terminal each):

   ```powershell
   cd professional\backend; .venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000
   cd partner\backend;      .venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 127.0.0.1 --port 8200
   ```

   And each service's scheduler (the periodic jobs: renewal notices, weather alerts, dispatch timeouts, purges), one terminal each:

   ```powershell
   cd professional\backend; .venv\Scripts\python -m app.jobs.run_scheduler
   cd partner\backend;      .venv\Scripts\python -m app.jobs.run_scheduler
   ```

   Check `http://localhost:8000/api/v1/health/db` and `http://localhost:8200/api/v1/health/db`: both report `"schema_at_head": true` and no missing tables.

7. **Frontends** (after R7): `npm ci` and `npm run dev` in `professionalrontend` (port 5173) and `partnerrontend` (port 5373), each with a `.env.local` copied from its `.env.example`.

**Tests** use the database `crewnbuild_test` only, create their tables there and drop them afterwards: run `pytest` in each backend.

## Secrets

- `.env.example` files hold names and `change-me` placeholders only.
- Real values live in local `.env` files, which Git ignores, and in a secret manager in production.
- gitleaks scans every commit, both in pre-commit and in CI.

To set up the pre-commit hooks once per clone:

```powershell
pip install pre-commit
pre-commit install
```
