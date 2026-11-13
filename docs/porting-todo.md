# Porting to-do: open stubs and temporary behaviour

Every stub or temporary behaviour the restructure has left in place and that is still open, one line each, grouped by the step that closes it. A step removes its rows when it closes them. Paths are under `professional/backend/app/` unless they name another place. The R4b modules are all ported (docs/coverage-professional.md), and so is Partner (R4c, docs/coverage-partner.md). R5 gave each service its Alembic baseline (`scripts/migrate.py`, `scripts/seed.py`), and R6 its security layer and scheduler unit; finished rows have been removed.

## R7: legacy logs retired

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 59 | marketplace | `modules/marketplace/order_service.py` → `fulfil_line` | A listing name longer than 80 characters fails the legacy material log on fulfilment (500), as before (old bug kept) | R7 (legacy logs retired) |

## R8: data copy

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 15 | accounts | `modules/files/file_ownership.py` → `FILE_ADDRESS` | Stored file addresses are now `/files/<uuid>`; data copied from the old database still holds `/files/<int>` | R8 (data copy rewrites file addresses) |
| 51 | property | `requests` split | The old `requests` rows of kind PROPERTY_BUYER_TO_SELLER (with `property_listing_id`) go to `property_enquiries` in the data copy; the app reads and answers them there already | R8 (data copy) |

## Deployment

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 14 | identity | `core/config.py` → `google_redirect_uri`, `microsoft_redirect_uri` | Callbacks moved to `/api/v1/auth/oauth/<provider>/callback`; the Google and Microsoft consoles still list the old address | Deployment (update both provider consoles) |
| 32 | content | `modules/content/translation_service.py` → `_cache_directory` | Translations are cached on the API server's disk (`TRANSLATION_CACHE_DIRECTORY`), per process host, not shared | Deployment step (shared volume or a cache table) |
| 61 | cctv | `modules/cctv/services/media_gateway.py` → `GATEWAY_API_USER` | The media gateway login name is now `crewnbuild-backend` (was the old name); update the real gateway settings at deployment | Deployment (gateway settings) |
| 69 | partner onboarding | `partner/backend/app/modules/technicians/identity_service.py` → `face_capture_root` | Face captures awaiting review are written, encrypted, to FACE_CAPTURE_DIRECTORY on the API server's disk (as before), so every API process must share that directory; they are never served | Deployment (a shared volume, or move them to S3) |
| 73 | partner bookings | `partner/backend/app/modules/bookings/job_media_storage.py`; `modules/technicians/upload_service.py` | Job photos (encrypted, JOB_MEDIA_DIRECTORY) and technician profile images (UPLOAD_DIRECTORY) are on the API server's disk, as before, so every API process must share those directories | Deployment (a shared volume, or move them to S3) |
| 74 | both | `app/jobs/run_scheduler.py` | The scheduled jobs run only in the scheduler unit: deploy one `python -m app.jobs.run_scheduler` per service (a second copy is a standby). Without it no renewal notices, weather alerts, dispatch timeouts or purges happen | Deployment (scheduler units, section 15.1) |
| 75 | both | `core/config.py` → `TRUSTED_PROXY_IPS` | Per-address limits and audit addresses read X-Forwarded-For only from these proxies; set it to the load balancer / nginx addresses (the default trusts only this machine) | Deployment (proxy addresses) |
| 76 | both | `requirements.txt` | Audited on 2026-11-13 with pip-audit (no known vulnerabilities after the upgrade to FastAPI 0.162.6 / Starlette 1.10.0, python-multipart 0.0.33, Pillow 13.0.0); nothing re-checks it automatically yet: `pip-audit` (and `npm audit` for the frontends) must run in CI | CI (dependency audit job) |
| 77 | both | web servers | The APIs send their own security headers; the web apps' Content-Security-Policy of section 14.3 (Razorpay, map tiles, S3 images) is set where the frontends are served | Deployment (nginx / CDN, with R7) |
| 78 | both | `core/config.py` → `DATABASE_URL` | Section 14.2 asks for `sslmode=require` on production database connections; not enforced by the startup checks | Deployment (database URL) |
