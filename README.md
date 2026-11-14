# CREWNBUILD

CREWNBUILD is a construction platform built as two products on one PostgreSQL database, `crewnbuild`:

- **Professional**: the construction operating system for house owners, builders, site engineers, store managers, suppliers and administrators. It has a FastAPI backend and a React web app and uses schema `professional`.
- **Partner**: on-demand technician booking (painter, plumber, electrician, carpenter). It has a FastAPI backend and a React web app and uses schema `partner`.

The two services never call each other over HTTP. They connect in three ways only: the signed Book Technician hand-off, a read-only view of requesters, and a read-only view of bookings. See `docs/technical-architecture.md`, sections 2 and 11.

> **Status: restructure in progress.** This repository replaces the old `Kuwait-Version` repository. Both backends are ported (R4) with their Alembic baselines (R5), and both web apps are ported (R7). Moving the old data (R9) is next.

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
├── scripts/            migrate.py (both services, in order), seed.py, dev_start.ps1 / dev_start.sh
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

**You need:** Git, Python 3.12, Node.js 20 LTS or later, and **PostgreSQL 18** (the tables use its `uuidv7()`). The full steps are in `docs/technical-architecture.md` section 18. Steps 1 to 5 and 7 are done once per machine; step 6 starts and stops everything each day.

The commands are for Windows PowerShell, from the repository root. On macOS or Linux use `python3.12 -m venv .venv`, `.venv/bin/python` instead of `.venv\Scripts\python`, `cp -n` instead of the guarded `Copy-Item`, and `scripts/dev_start.sh` instead of `scripts\dev_start.ps1`.

1. **Install PostgreSQL 18** and put its `bin` folder on your PATH for this terminal, if the installer did not:

   ```powershell
   $env:Path += ';C:\Program Files\PostgreSQL\18\bin'
   psql --version                                   # psql (PostgreSQL) 18.x
   ```

2. **Create the database, roles and schemas** (once per machine). Copy the script, replace both `change-me` passwords with your own, and run it as the PostgreSQL superuser:

   ```powershell
   Copy-Item infrastructure\database\create_database_and_roles.sql $env:TEMP\create_crewnbuild.sql
   notepad $env:TEMP\create_crewnbuild.sql          # set your two passwords
   psql -U postgres -f $env:TEMP\create_crewnbuild.sql
   Remove-Item $env:TEMP\create_crewnbuild.sql      # it holds your passwords
   ```

   It creates the databases `crewnbuild` and `crewnbuild_test`, the roles `crewnbuild_professional` and `crewnbuild_partner`, and one schema per service. Each service creates its own tables; neither role can create databases. Do not run it again on a machine that has it: it resets the two roles.

3. **Install each backend** with Python 3.12 (`py -3.12`: a plain `python` may be another version) and create its settings file from the template. The copy is skipped when a `.env` exists, so a filled-in one is never overwritten. Put the password you chose for that service's role in its `DATABASE_URL`, and never commit a `.env` file:

   ```powershell
   cd professional\backend
   py -3.12 -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }   # then fill in local values
   cd ..\..

   cd partner\backend
   py -3.12 -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }   # then fill in local values
   cd ..\..
   ```

4. **Create the tables** of both services. The two schemas refer to each other, so the order matters (Professional 0001, Partner, then the rest of Professional), and the script runs exactly that order with each backend's own `.env`:

   ```powershell
   python scripts\migrate.py           # safe to run again
   python scripts\migrate.py --check   # models and database match
   ```

   `python scripts\migrate.py --down` removes everything again, in reverse order. Running `alembic upgrade head` in `professional\backend` alone stops at revision 0002 with a message to migrate Partner first, and applies nothing; Partner on its own refuses to start before Professional (MG-01).

5. **Load the reference data** (master catalog, subscription plan prices, Partner service catalog and checklists). Every seed is idempotent:

   ```powershell
   python scripts\seed.py                        # add --with-test-accounts for the OTP test accounts (never production)
   ```

   Then the first administrator. Set `GLOBAL_ADMIN_PHONE` in `professional\backend\.env` to that person's 10-digit mobile first; without it the seed refuses and writes nothing:

   ```powershell
   cd professional\backend; .venv\Scripts\python -m app.seeds.seed_admin_account; cd ..\..
   ```

6. **Start and stop everything** (both backends, both schedulers, both web apps) with one script:

   ```powershell
   .\scripts\dev_start.ps1            # starts all six in the background and waits until each answers
   .\scripts\dev_start.ps1 status     # what is running
   .\scripts\dev_start.ps1 stop       # stops all six, with their child processes
   .\scripts\dev_start.ps1 restart
   ```

   macOS and Linux: `scripts/dev_start.sh` with the same commands (from Git Bash on Windows it runs the PowerShell script). If PowerShell refuses to run scripts, run `powershell -ExecutionPolicy Bypass -File scripts\dev_start.ps1` instead.

   | Part | Address |
   | --- | --- |
   | Professional web app | http://localhost:5173 |
   | Partner web app | http://localhost:5373 |
   | Professional API | http://127.0.0.1:8000/api/v1 |
   | Partner API | http://127.0.0.1:8200/api/v1 |
   | Schedulers | renewal notices, weather alerts, dispatch timeouts, purges |

   Logs are in `.dev\logs` (Git ignores it). The script refuses to start when a port is already taken, and creates each web app's `.env.local` from its `.env.example` when it is missing. Check `http://127.0.0.1:8000/api/v1/health/db` and `http://127.0.0.1:8200/api/v1/health/db`: both report `"schema_at_head": true` and no missing tables.

   To run one part by hand instead, one terminal each:

   ```powershell
   cd professional\backend; .venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   cd partner\backend;      .venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8200
   cd professional\backend; .venv\Scripts\python -m app.jobs.run_scheduler
   cd partner\backend;      .venv\Scripts\python -m app.jobs.run_scheduler
   cd professional\frontend; npm run dev
   cd partner\frontend;      npm run dev
   ```

7. **Install the web apps** (once, and after a pull that changes `package-lock.json`), before step 6:

   ```powershell
   cd professional\frontend; npm ci; cd ..\..
   cd partner\frontend;      npm ci; cd ..\..
   ```

**Tests** use the database `crewnbuild_test` only, create their tables there and drop them afterwards. Run one suite at a time:

```powershell
cd professional\backend; .venv\Scripts\python -m pytest -q; cd ..\..
cd partner\backend;      .venv\Scripts\python -m pytest -q; cd ..\..
cd professional\frontend; npm test; cd ..\..
cd partner\frontend;      npm test; cd ..\..
```

## Secrets

- `.env.example` files hold names and `change-me` placeholders only.
- Real values live in local `.env` files, which Git ignores, and in a secret manager in production.
- gitleaks scans every commit, both in pre-commit and in CI.

To set up the pre-commit hooks once per clone:

```powershell
python -m pip install pre-commit
python -m pre_commit install
```
