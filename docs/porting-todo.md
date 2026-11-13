# Porting to-do: open stubs and temporary behaviour

Every stub or temporary behaviour the restructure has left in place and that is still open, one line each, grouped by the step that closes it. A step removes its rows when it closes them. Paths are under `professional/backend/app/` unless they name another place. The R4b modules are all ported (docs/coverage-professional.md); finished rows have been removed.

## R4c: Partner

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 2 | accounts | `modules/accounts/repository.py` → `count_open_partner_bookings` | Reads `partner.v_professional_bookings` only when the view exists; until Partner's baseline creates and grants it, no booking counts as open | R4c (Partner baseline with the view) |
| 63 | billing | `modules/billing/booking_payment_repository.py` → `booking_source` | Booking payments read `partner.v_professional_bookings` only when the view exists; until Partner's baseline creates and grants it, the House Owner has no booking to pay | R4c (Partner baseline with the view) |
| 66 | partner identity | `partner/backend/app/modules/identity/pending_links.py` | Technician profiles, identity verification and job eligibility come with R4c part 2: sign-up creates no profile or identity rows, the profile and onboarding statuses are the empty ones, nobody is eligible for jobs, and the face and Aadhaar steps count as done exactly when registration is complete (so finished accounts can sign in) | R4c part 2 |

## R5: baseline migrations and seeds

| # | Module | File / function | What is switched off or temporary | Closed by |
| --- | --- | --- | --- | --- |
| 41 | admin | `modules/admin/models.py` → `admin_audit_logs_append_only` trigger | The append-only trigger is created with the table by `create_all` (an `after_create` DDL event); there is no migration yet | R5 (baseline migration must create the function `admin_audit_logs_refuse_change` and the trigger) |
| 45 | catalog | `app/seeds/master_catalog_seed.sql` | The master catalog is loaded by `python -m app.seeds.seed_master_catalog` (one DO block, data only). Nothing runs it automatically yet | R5 (baseline: create the catalog tables from the models, then run the file with `op.execute`, MG-06) |
| 62 | billing | `modules/billing/models.py` → `BOOKING_FOREIGN_KEY` | `booking_payment_orders.booking_id → partner.bookings` (RESTRICT) is modelled, but created only when `partner.bookings` already exists when the table is created; until then the column holds the booking id unchecked, as the old `payment_orders` did | R4c / R5 (a Professional migration after Partner's baseline adds the key) |
| 65 | billing | `app/seeds/seed_subscription_plan_prices.py` | The three plan prices are loaded by `python -m app.seeds.seed_subscription_plan_prices` (missing rows only, every environment). Nothing runs it automatically yet; until it runs, no plan can be bought | R5 (deployment runs it after the baseline, MG-03) |
| 67 | partner requesters | `partner/backend/app/modules/requesters/repository.py` | Requester sessions read `professional.v_partner_requesters`; until Professional's baseline creates the view and grants it to `crewnbuild_partner`, no House Owner or Site Engineer can start a booking session (the tests use a stand-in in schema `partner`) | R5 (Professional baseline with the view and the grant) |

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
