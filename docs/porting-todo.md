# Porting to-do: open stubs and temporary behaviour

Every stub or temporary behaviour the restructure has left in place and that is still open, one line each, grouped by the step that closes it. A step removes its rows when it closes them. Paths are under `professional/backend/app/` unless they name another place. The R4b modules are all ported (docs/coverage-professional.md), and so is Partner (R4c, docs/coverage-partner.md). R5 gave each service its Alembic baseline (`scripts/migrate.py`, `scripts/seed.py`); finished rows have been removed.

## R6: security layer and scheduler

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 16 | accounts | `modules/accounts/service.py` → `complete_user_profile` | Complete-profile writes `profile_image_url`, `company_logo_url` and `store_logo_url` without the own-upload check (old bug kept) | R6 (security layer) |
| 18 | identity | `modules/identity/login_throttle.py` | Password sign-in throttle counts in each process at 10 per account / 50 per address, not shared and not section 6.4's 5/20 | R6 (security layer) |
| 29 | support | `modules/support/ticket_service.py` → `within_rate_limit`; `modules/support/router.py` → `contact_within_rate_limit` | Support-ticket and contact-form limits count in each process, as before, not shared | R6 (security layer) |
| 33 | content | `modules/content/vastu/router.py` → `_within_rate_limit` | Vastu analyses are limited per process, as before, not shared | R6 (security layer) |
| 39 | weather | `jobs/weather_alert_monitor.py` | The monitor no longer starts inside the API process (section 15.1); until the scheduler unit exists it runs only when started by hand or cron (`python -m app.jobs.weather_alert_monitor`) | Must be wired by R6: scheduler unit (`jobs/run_scheduler.py`, with `pg_try_advisory_lock`, SC-01) |
| 42 | admin | `modules/admin/dependencies.py` → `require_admin` | A refused admin request (403) is not written to the audit log (AZ-05 asks for denied attempts too); only administrator writes are | R6 (security layer) |
| 64 | billing | `jobs/subscription_renewal_sweep.py` | The renewal reminders and expiry notices of builders who are signed out no longer go out from a thread inside the API (the old app ran it there every 60 minutes); until the scheduler unit exists it runs only when started by hand or cron (`python -m app.jobs.subscription_renewal_sweep`). A signed-in builder's status read still sends them | R6 (scheduler unit, with row 39) |
| 68 | partner identity | `partner/backend/app/modules/identity/auth_service.py` → `LoginThrottle` | Technician sign-in throttle counts in each process at 10 per e-mail / 50 per address, as before, not shared | R6 (security layer) |
| 71 | partner bookings | `partner/backend/app/main.py` → `DispatchWorker` | The dispatch sweeper (offer timeouts, re-offers, stuck searches, old location purge) runs in every API process every DISPATCH_SWEEP_INTERVAL_SECONDS, as before; the row locks keep it correct, but each process sweeps | R6 (scheduler unit, with row 39) |
| 72 | partner weather | `partner/backend/app/modules/weather/weather_service.py` → `_cache`, `PUBLIC_NEW_FETCHES_PER_MINUTE` | Forecasts are cached, and new public places limited to 60 a minute, in each process, as before, not shared | R6 (security layer) |

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
