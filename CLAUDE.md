# CREWNBUILD: working notes for the team (and Claude)

Two products on one PostgreSQL 18 database, `crewnbuild`, each with its own FastAPI backend,
React web app and schema. The services never call each other over HTTP; they connect only
through the signed Book Technician hand-off and two read-only views
(`docs/technical-architecture.md` sections 2 and 11).

| Service | Who uses it | Schema | API (dev) | Web (dev) |
| --- | --- | --- | --- | --- |
| Professional | House Owners, Builders, Site Engineers, Suppliers (material, labour, equipment), administrators | `professional` | 127.0.0.1:8000/api/v1 | localhost:5173 |
| Partner | Technicians; Owners / Site Engineers booking one via the hand-off | `partner` | 127.0.0.1:8200/api/v1 | localhost:5373 |

Roles (`professional/backend/app/modules/identity/models.py`): `OWNER`, `BUILDER`, `ENGINEER`
(shown as `SITE_ENGINEER` in the session), `SUPPLIER` (category material / labour /
equipment), `PROFESSIONAL` (reserved, no screens), and the administrators
`GLOBAL_SUPER_ADMIN`, `LOCATION_SUPER_ADMIN`, `MANAGER`. Partner: `TECHNICIAN`, `REQUESTER`.

## Where things live

```text
professional/backend/   app/main.py, app/core (config, security, logging), app/auth (dependencies,
                        permissions, public_routes.py), app/modules/<module>/, app/jobs, app/seeds,
                        alembic/versions, tests/<module>/
professional/frontend/  src/app (router/routes.jsx, store), src/features/<feature>/,
                        src/shared (api, auth, ui, dashboard, utils), src/i18n/locales, src/test
partner/backend, partner/frontend   same shape
infrastructure/database create_database_and_roles.sql
scripts/                migrate.py, seed.py, dev_start.ps1 / .sh, convert_legal_docs.py
docs/                   architecture, requirements, coverage, schema comparison, legal, UI system
```

## Rules

- **Layering.** A module is `router.py` (HTTP only: parse, call the service, return a schema),
  `schemas.py` (Pydantic), `service.py` (business rules and transactions), `repository.py`
  or `*_repository.py` (queries only), `models.py` (its tables). Routers never query; repositories
  hold no rules.
- **Naming.** Python snake_case, classes PascalCase singular; React components and pages
  PascalCase (`<Name>Page.jsx`), hooks `use<Thing>.js`; web folders kebab-case; tables plural
  snake_case; booleans `is_` / `has_`; instants `_at`, dates `_on`; British/Indian spelling
  (`labour`, `colour`, `cancelled`). Full table in technical-architecture.md 4.5 and 9.1.
  No old brand names (octabuild, gharbanao) in new code.
- **Keys.** Every table has `id uuid` (UUIDv7). Only UUIDs appear in URLs and API responses;
  never integer IDs, names or phone numbers.
- **Schema changes go through Alembic.** Change `models.py`, add a migration in the same change,
  read it, and prove `upgrade` / `downgrade -1` / `upgrade`. Never edit a migration already on
  `main`; keep one head per service. Run with `python scripts\migrate.py` (it runs both services
  in the required order).
- **Secrets.** None in code or in `.env.example` (names and `change-me` placeholders only).
  **Never print, open or edit a `.env` file**; new settings go in `.env.example` and the person
  running the service adds the value. gitleaks runs in pre-commit and CI.
- **Kuwait-Version** (`C:\Users\sudag\OneDrive\Desktop\Kuwait-Version`) is the old repository:
  read-only reference. Never write to it.
- **Functionality changes need approval.** Fixes, tests and docs are fine; a change to what the
  product does, a permission, a route or an API needs a yes first. Keep route guards,
  permissions and APIs unchanged unless asked.
- **Every route is guarded and tested.** Backend routes need a session unless listed in
  `app/auth/public_routes.py` (checked both ways by `tests/identity/test_route_access.py` in
  Professional, `tests/test_route_access.py` in Partner). Professional web routes declare
  `access` (`'public'` or `{ roles: [...] }`) in `src/app/router/routes.jsx`; Partner's are in
  `src/app/router/AppRouter.jsx` (tested by `access.test.jsx`). New endpoints get tests for the
  allowed role and for 401 / 403 / 404.
- **Files** stay under 1 MB (pre-commit). User-facing text goes through i18n keys
  (`src/i18n/locales/en.js`; other languages fall back to English).

## Security checklist

- [ ] Sign-in sets HttpOnly session cookies (`__Host-` names in production); nothing secret in
      `localStorage` / `sessionStorage`.
- [ ] Every state-changing request carries `X-CSRF-Token` (kept in memory only) and an allowed
      `Origin`; the CSRF middleware checks it.
- [ ] Role, permission and ownership are decided in the backend (`require_roles`,
      `require_permission`, the module's ownership checks). A record the caller may not see
      answers 404. List queries filter by the caller's scope. The frontend only hides.
- [ ] No personal data in URLs, browser storage or logs: no names or phone numbers in
      addresses, no passwords, tokens, OTPs, Aadhaar or bank numbers in logs. Aadhaar and bank
      details are encrypted and shown masked (last four digits).
- [ ] Contact details (phone, e-mail, street address) stay private until an accepted request
      links the two accounts (`app/modules/projects/people.py`).
- [ ] Pydantic validation on input; SQL only through SQLAlchemy parameters.
- [ ] Outbound calls (AI, weather, geocoding, cameras) have timeouts; keys never leave the server
      and never appear in logs.

## UI rules

Read **[docs/ui-design-system.md](docs/ui-design-system.md)** before UI work. In short: use the
shared components (`ListCard` / `CardGrid`, `DetailDialog`, `EntityPill`, `Skeleton`,
`DisclaimerNote`), the Tailwind tokens (`brand`, `oc-*`, the named `z-*` scale, `max-w-page`),
AA contrast, visible focus rings, `prefers-reduced-motion`, and no layout shift (skeletons
instead of empty areas, the same page container across tab switches).

## Commands (Windows PowerShell, from the repository root)

```powershell
python scripts\migrate.py              # both schemas, in order; --check compares models and DB
python scripts\seed.py                 # reference data, idempotent (--with-test-accounts: dev only)
.\scripts\dev_start.ps1                # start both APIs, schedulers and web apps; status | stop | restart

# Tests: crewnbuild_test only, they create and drop their own tables. ONE suite at a time.
cd professional\backend;  .venv\Scripts\python -m pytest -q                 # or a path: tests\assistant
cd partner\backend;       .venv\Scripts\python -m pytest -q
cd professional\frontend; npx vitest run --maxWorkers=4                     # rerun once on a load flake
cd partner\frontend;      npx vitest run --maxWorkers=4

# Lint and build
cd professional\backend;  .venv\Scripts\python -m ruff check app tests; .venv\Scripts\python -m ruff format --check app tests
cd professional\backend;  .venv\Scripts\python -m mypy app      # existing errors remain; add none
cd professional\frontend; npm run lint; npm run build
```

**Commits.** Run the affected tests, lint and build first. Never push to `main` (protected;
changes go through a reviewed pull request); branch as `feature/<area>-<what>` or
`fix/<area>-<what>`. Commit and push only when asked. Never commit `.env`, `.venv`,
`node_modules`, `dist`, uploads or logs. Tests never touch `crewnbuild` or `crewnbuild_legacy`.

## Further reading (do not copy them here)

- `docs/technical-architecture.md`: the target design; it wins over the other documents.
- `docs/product-requirements.md`: product goals, personas, features (PRD).
- `docs/software-requirements.md`: what the platform must do (SRS).
- `docs/coverage-professional.md`, `docs/coverage-professional-frontend.md`,
  `docs/coverage-partner.md`, `docs/coverage-partner-frontend.md`: what is ported and tested.
- `docs/schema-comparison.md`: old and new schemas side by side.
- `docs/legal/README.md`: Terms, Privacy, Disclaimer pipeline and versions.
- `docs/ui-design-system.md`: tokens, components, sizes, motion.
- `README.md`: first-time setup.
