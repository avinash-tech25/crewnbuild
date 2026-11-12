# CREWNBUILD

CREWNBUILD is a construction platform built as two products on one PostgreSQL database, `crewnbuild`:

- **Professional**: the construction operating system for house owners, builders, site engineers, store managers, suppliers and administrators. It has a FastAPI backend and a React web app and uses schema `professional`.
- **Partner**: on-demand technician booking (painter, plumber, electrician, carpenter). It has a FastAPI backend and a React web app and uses schema `partner`.

The two services never call each other over HTTP. They connect in three ways only: the signed Book Technician hand-off, a read-only view of requesters, and a read-only view of bookings. See `docs/technical-architecture.md`, sections 2 and 11.

> **Status: restructure in progress.** This repository replaces the old `Kuwait-Version` repository. Steps R1 to R3 of `docs/technical-architecture.md` section 16.1 have set up the layout, settings templates and database script. The application code arrives in step R4 and later, so the apps below cannot run yet.

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
├── scripts/            Local setup scripts (to come)
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

**You need:** Git, Python 3.12, Node.js 20 LTS or later, and PostgreSQL 18 or later. The full steps are in `docs/technical-architecture.md` section 18. Always migrate Professional before Partner.

1. **Create the database, roles and schemas** (once per machine). First replace the `change-me` passwords in the script, then run:

   ```powershell
   psql -U postgres -f infrastructure\database\create_database_and_roles.sql
   ```

2. **Create the settings files** from the templates. Fill in local values only, and never commit the `.env` files:

   ```powershell
   Copy-Item professional\backend\.env.example professional\backend\.env
   Copy-Item partner\backend\.env.example partner\backend\.env
   Copy-Item professional\frontend\.env.example professional\frontend\.env.local
   Copy-Item partner\frontend\.env.example partner\frontend\.env.local
   ```

3. **Start the backends and frontends** as described in section 18 once the code is in place. The backends run on ports 8000 and 8200, the frontends on 5173 and 5373.

## Secrets

- `.env.example` files hold names and `change-me` placeholders only.
- Real values live in local `.env` files, which Git ignores, and in a secret manager in production.
- gitleaks scans every commit, both in pre-commit and in CI.

To set up the pre-commit hooks once per clone:

```powershell
pip install pre-commit
pre-commit install
```
