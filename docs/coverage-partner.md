# Coverage: the old Partner backend in Partner

Every route and table of the old Partner backend (`Kuwait-Version/Partner/backend`) and where it is now. Old routes were listed from the route decorators and router prefixes of the old source (read, never imported); new routes from the new app's `app.routes`. New routes are under `/api/v1`. Every new route also has a test that it answers 401 without a session unless it is reviewed public (`tests/test_route_access.py`, discovered from the app, websockets included); the Tests column lists the other test files that call it.

## MISSING

None.

## Totals

| | Count |
| --- | --- |
| Old routes (HTTP and WebSocket) | 89 |
| New routes (HTTP and WebSocket) | 89 |
| Old routes ported | 89 |
| Old routes retired by decision | 0 |
| Old routes missing | 0 |
| New routes with no old counterpart | 0 |
| Old Partner tables | 22 |
| New Partner tables | 22 |
| Old Partner tables removed | 0 |
| Old tables of the other schema read directly | 2 (now read through one view) |
| New views Partner publishes | 1 (`partner.v_professional_bookings`, for Professional) |

## 1. Routes

### app.main

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/health` | `/api/v1/health` | test_health.py |
| GET | `/health/db` | `/api/v1/health/db` | test_health.py |

### app.requester.routes.requester_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| POST | `/requester/session` | `/api/v1/requester/session` | bookings/test_dispatch.py, bookings/test_job_execution.py, onboarding/test_onboarding.py, requesters/test_requester_session.py |
| GET | `/requester/session` | `/api/v1/requester/session` | bookings/test_dispatch.py, bookings/test_job_execution.py, onboarding/test_onboarding.py, requesters/test_requester_session.py |
| POST | `/requester/refresh` | `/api/v1/requester/refresh` | requesters/test_requester_session.py |
| POST | `/requester/logout` | `/api/v1/requester/logout` | requesters/test_requester_session.py |
| GET | `/requester/me` | `/api/v1/requester/me` | onboarding/test_onboarding_auth.py, requesters/test_requester_session.py |
| GET | `/requester/me/registered-location` | `/api/v1/requester/me/registered-location` | technicians/test_profile_and_places.py |
| POST | `/requester/bookings` | `/api/v1/requester/bookings` | bookings/test_dispatch.py, bookings/test_job_execution.py, bookings/test_nearby_dispatch.py, bookings/test_ratings.py, bookings/test_work_bills.py, onboarding/test_service_catalog.py, onboarding/test_service_checklists.py, technicians/test_earnings.py, technicians/test_work_preferences.py |
| GET | `/requester/bookings` | `/api/v1/requester/bookings` | bookings/test_dispatch.py, bookings/test_job_execution.py, bookings/test_nearby_dispatch.py, bookings/test_ratings.py, bookings/test_work_bills.py, onboarding/test_service_catalog.py, onboarding/test_service_checklists.py, technicians/test_earnings.py, technicians/test_work_preferences.py |
| GET | `/requester/bookings/{request_id}` | `/api/v1/requester/bookings/{request_id}` | bookings/test_dispatch.py, bookings/test_job_execution.py, bookings/test_nearby_dispatch.py, bookings/test_production_dispatch.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, onboarding/test_service_catalog.py, onboarding/test_service_checklists.py |
| POST | `/requester/bookings/{request_id}/cancel` | `/api/v1/requester/bookings/{request_id}/cancel` | bookings/test_cancelled_jobs.py, bookings/test_job_execution.py, technicians/test_earnings.py, tracking/test_tracking.py |
| POST | `/requester/bookings/{request_id}/retry` | `/api/v1/requester/bookings/{request_id}/retry` | technicians/test_work_preferences.py |
| GET | `/requester/bookings/{request_id}/execution` | `/api/v1/requester/bookings/{request_id}/execution` | bookings/test_job_execution.py, bookings/test_start_work_otp.py, bookings/test_work_bills.py, onboarding/test_service_checklists.py |
| POST | `/requester/bookings/{request_id}/media` | `/api/v1/requester/bookings/{request_id}/media` | bookings/test_job_execution.py |
| DELETE | `/requester/bookings/{request_id}/media/{media_id}` | `/api/v1/requester/bookings/{request_id}/media/{media_id}` | bookings/test_job_execution.py, bookings/test_work_bills.py |
| GET | `/requester/bookings/{request_id}/media/{media_id}/content` | `/api/v1/requester/bookings/{request_id}/media/{media_id}/content` | bookings/test_job_execution.py |
| GET | `/requester/bookings/{request_id}/start-otp` | `/api/v1/requester/bookings/{request_id}/start-otp` | bookings/test_start_work_otp.py |
| POST | `/requester/bookings/{request_id}/start-otp/regenerate` | `/api/v1/requester/bookings/{request_id}/start-otp/regenerate` | bookings/test_start_work_otp.py |
| GET | `/requester/bookings/{request_id}/rating` | `/api/v1/requester/bookings/{request_id}/rating` | bookings/test_ratings.py |
| POST | `/requester/bookings/{request_id}/rating` | `/api/v1/requester/bookings/{request_id}/rating` | bookings/test_ratings.py |
| GET | `/requester/bookings/{request_id}/bill` | `/api/v1/requester/bookings/{request_id}/bill` | bookings/test_work_bills.py |
| GET | `/requester/bookings/{request_id}/bill/media/{media_id}/content` | `/api/v1/requester/bookings/{request_id}/bill/media/{media_id}/content` | bookings/test_work_bills.py |

### app.shared.bookings.routes.dispatch_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| POST | `/technicians/me/location` | `/api/v1/technicians/me/location` | bookings/test_nearby_dispatch.py, bookings/test_production_dispatch.py, bookings/test_start_work_otp.py, tracking/test_tracking.py |
| GET | `/technicians/me/presence` | `/api/v1/technicians/me/presence` | bookings/test_nearby_dispatch.py, bookings/test_production_dispatch.py |
| DELETE | `/technicians/me/location` | `/api/v1/technicians/me/location` | bookings/test_nearby_dispatch.py, bookings/test_production_dispatch.py, bookings/test_start_work_otp.py, tracking/test_tracking.py |
| GET | `/technicians/me/offers` | `/api/v1/technicians/me/offers` | bookings/test_dispatch.py, bookings/test_job_execution.py, bookings/test_nearby_dispatch.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, technicians/test_earnings.py |
| POST | `/technicians/me/offers/{request_id}/accept` | `/api/v1/technicians/me/offers/{request_id}/accept` | bookings/test_dispatch.py, bookings/test_production_dispatch.py, bookings/test_job_execution.py |
| POST | `/technicians/me/offers/{request_id}/decline` | `/api/v1/technicians/me/offers/{request_id}/decline` | bookings/test_dispatch.py, bookings/test_production_dispatch.py, bookings/test_job_execution.py |
| GET | `/locations/search` | `/api/v1/locations/search` | tracking/test_location_search.py |
| GET | `/locations/describe` | `/api/v1/locations/describe` | technicians/test_profile_and_places.py |
| WS | `/dispatch/ws/technician` | `/api/v1/dispatch/ws/technician` | bookings/test_cancelled_jobs.py, bookings/test_nearby_dispatch.py, bookings/test_production_dispatch.py |

### app.shared.catalog.routes.catalog_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/requester/services` | `/api/v1/requester/services` | onboarding/test_onboarding.py, onboarding/test_service_catalog.py, technicians/test_work_preferences.py |
| GET | `/requester/services/{trade}/{slug}` | `/api/v1/requester/services/{trade}/{slug}` | onboarding/test_onboarding.py, onboarding/test_service_catalog.py |

### app.shared.locations.routes.location_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/locations/pincode/{pincode}` | `/api/v1/locations/pincode/{pincode}` | onboarding/test_onboarding.py |

### app.shared.tracking.routes.tracking_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/tracking/bookings/{booking_id}/sharing` | `/api/v1/tracking/bookings/{booking_id}/sharing` | bookings/test_start_work_otp.py, tracking/test_tracking.py |
| GET | `/tracking/bookings/{booking_id}` | `/api/v1/tracking/bookings/{booking_id}` | tracking/test_tracking.py |
| PUT | `/tracking/bookings/{booking_id}/destination` | `/api/v1/tracking/bookings/{booking_id}/destination` | tracking/test_tracking.py |
| WS | `/tracking/ws/bookings/{booking_id}` | `/api/v1/tracking/ws/bookings/{booking_id}` | tracking/test_tracking.py |

### app.shared.weather.routes.weather_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/technicians/me/weather` | `/api/v1/technicians/me/weather` | weather/test_weather.py |
| GET | `/technicians/me/weather/places` | `/api/v1/technicians/me/weather/places` | weather/test_weather.py |
| GET | `/technicians/me/weather/describe` | `/api/v1/technicians/me/weather/describe` | technicians/test_profile_and_places.py |
| GET | `/weather/public` | `/api/v1/weather/public` | weather/test_weather.py |
| GET | `/weather/public/places` | `/api/v1/weather/public/places` | weather/test_weather.py |
| GET | `/weather/public/describe` | `/api/v1/weather/public/describe` | weather/test_weather.py |

### app.technician.routes.auth_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| POST | `/auth/signup/send-code` | `/api/v1/auth/signup/send-code` | identity/test_technicians.py, onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py |
| POST | `/auth/signup/verify-code` | `/api/v1/auth/signup/verify-code` | identity/test_technicians.py, onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py |
| POST | `/auth/login` | `/api/v1/auth/login` | identity/test_technicians.py, onboarding/test_onboarding_auth.py, technicians/test_work_preferences.py |
| POST | `/auth/refresh` | `/api/v1/auth/refresh` | identity/test_technicians.py |
| POST | `/auth/logout` | `/api/v1/auth/logout` | identity/test_technicians.py |
| POST | `/auth/password-reset/send-code` | `/api/v1/auth/password-reset/send-code` | identity/test_technicians.py |
| POST | `/auth/password-reset/verify-code` | `/api/v1/auth/password-reset/verify-code` | identity/test_technicians.py |
| POST | `/auth/password-reset/reset` | `/api/v1/auth/password-reset/reset` | identity/test_technicians.py |
| GET | `/auth/me` | `/api/v1/auth/me` | bookings/test_ratings.py, bookings/test_start_work_otp.py, identity/test_technicians.py, onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py, requesters/test_requester_session.py, technicians/test_bank_account.py, technicians/test_work_preferences.py |

### app.technician.routes.onboarding_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| POST | `/onboarding/face` | `/api/v1/onboarding/face` | onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py |
| POST | `/onboarding/aadhaar` | `/api/v1/onboarding/aadhaar` | onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py |
| POST | `/onboarding/profile` | `/api/v1/onboarding/profile` | onboarding/test_onboarding.py, onboarding/test_onboarding_auth.py, technicians/test_work_preferences.py |

### app.technician.routes.technician_routes

| Method | Old path | New path | Tests |
| --- | --- | --- | --- |
| GET | `/technicians/me/dashboard` | `/api/v1/technicians/me/dashboard` | bookings/test_cancelled_jobs.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, onboarding/test_onboarding_auth.py, technicians/test_work_preferences.py |
| PATCH | `/technicians/me` | `/api/v1/technicians/me` | technicians/test_profile_and_places.py |
| PATCH | `/technicians/me/availability` | `/api/v1/technicians/me/availability` | bookings/test_production_dispatch.py, technicians/test_work_preferences.py |
| GET | `/technicians/me/catalog` | `/api/v1/technicians/me/catalog` | technicians/test_work_preferences.py |
| GET | `/technicians/me/work-preferences` | `/api/v1/technicians/me/work-preferences` | technicians/test_work_preferences.py |
| PUT | `/technicians/me/work-preferences` | `/api/v1/technicians/me/work-preferences` | technicians/test_work_preferences.py |
| POST | `/technicians/me/profile-image` | `/api/v1/technicians/me/profile-image` | technicians/test_profile_and_places.py |
| PUT | `/technicians/me/password` | `/api/v1/technicians/me/password` | identity/test_technicians.py |
| GET | `/technicians/me/earnings/summary` | `/api/v1/technicians/me/earnings/summary` | technicians/test_earnings.py |
| GET | `/technicians/me/earnings` | `/api/v1/technicians/me/earnings` | technicians/test_earnings.py |
| GET | `/technicians/me/bank-account` | `/api/v1/technicians/me/bank-account` | technicians/test_bank_account.py |
| PUT | `/technicians/me/bank-account` | `/api/v1/technicians/me/bank-account` | technicians/test_bank_account.py |
| GET | `/technicians/me/jobs` | `/api/v1/technicians/me/jobs` | bookings/test_cancelled_jobs.py, bookings/test_dispatch.py, bookings/test_job_execution.py, bookings/test_nearby_dispatch.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, onboarding/test_onboarding_auth.py |
| GET | `/technicians/me/jobs/{request_id}/execution` | `/api/v1/technicians/me/jobs/{request_id}/execution` | bookings/test_cancelled_jobs.py, bookings/test_job_execution.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, bookings/test_work_bills.py |
| PATCH | `/technicians/me/jobs/{request_id}/steps/{step_id}` | `/api/v1/technicians/me/jobs/{request_id}/steps/{step_id}` | bookings/test_job_execution.py |
| PUT | `/technicians/me/jobs/{request_id}/notes` | `/api/v1/technicians/me/jobs/{request_id}/notes` | bookings/test_job_execution.py, bookings/test_start_work_otp.py |
| POST | `/technicians/me/jobs/{request_id}/media` | `/api/v1/technicians/me/jobs/{request_id}/media` | bookings/test_job_execution.py, bookings/test_work_bills.py |
| DELETE | `/technicians/me/jobs/{request_id}/media/{media_id}` | `/api/v1/technicians/me/jobs/{request_id}/media/{media_id}` | bookings/test_job_execution.py, bookings/test_work_bills.py |
| GET | `/technicians/me/jobs/{request_id}/media/{media_id}/content` | `/api/v1/technicians/me/jobs/{request_id}/media/{media_id}/content` | bookings/test_job_execution.py, bookings/test_work_bills.py |
| GET | `/technicians/me/jobs/{request_id}/bill` | `/api/v1/technicians/me/jobs/{request_id}/bill` | bookings/test_work_bills.py |
| POST | `/technicians/me/jobs/{request_id}/bill/items` | `/api/v1/technicians/me/jobs/{request_id}/bill/items` | bookings/test_start_work_otp.py |
| PUT | `/technicians/me/jobs/{request_id}/bill/items/{item_id}` | `/api/v1/technicians/me/jobs/{request_id}/bill/items/{item_id}` | bookings/test_work_bills.py |
| DELETE | `/technicians/me/jobs/{request_id}/bill/items/{item_id}` | `/api/v1/technicians/me/jobs/{request_id}/bill/items/{item_id}` | bookings/test_work_bills.py |
| PUT | `/technicians/me/jobs/{request_id}/bill/notes` | `/api/v1/technicians/me/jobs/{request_id}/bill/notes` | bookings/test_work_bills.py |
| POST | `/technicians/me/jobs/{request_id}/bill/submit` | `/api/v1/technicians/me/jobs/{request_id}/bill/submit` | bookings/test_work_bills.py |
| POST | `/technicians/me/jobs/{request_id}/bill/items/{item_id}/photos` | `/api/v1/technicians/me/jobs/{request_id}/bill/items/{item_id}/photos` | bookings/test_work_bills.py |
| POST | `/technicians/me/jobs/{request_id}/bill/attachments` | `/api/v1/technicians/me/jobs/{request_id}/bill/attachments` | bookings/test_work_bills.py |
| DELETE | `/technicians/me/jobs/{request_id}/bill/media/{media_id}` | `/api/v1/technicians/me/jobs/{request_id}/bill/media/{media_id}` | bookings/test_work_bills.py |
| GET | `/technicians/me/jobs/{request_id}/bill/media/{media_id}/content` | `/api/v1/technicians/me/jobs/{request_id}/bill/media/{media_id}/content` | bookings/test_work_bills.py |
| POST | `/technicians/me/jobs/{request_id}/start` | `/api/v1/technicians/me/jobs/{request_id}/start` | bookings/test_start_work_otp.py |
| POST | `/technicians/me/jobs/{request_id}/cancel` | `/api/v1/technicians/me/jobs/{request_id}/cancel` | bookings/test_cancelled_jobs.py, bookings/test_job_execution.py, bookings/test_production_dispatch.py |
| POST | `/technicians/me/jobs/{request_id}/{action}` | `/api/v1/technicians/me/jobs/{request_id}/{action}` | bookings/test_cancelled_jobs.py, bookings/test_job_execution.py, bookings/test_ratings.py, bookings/test_start_work_otp.py, bookings/test_work_bills.py |

## 2. Tables

All in schema `partner`. Keys are UUIDv7 and times timestamptz, as in Professional.

| Old table | New table | Change |
| --- | --- | --- |
| `users` | `technicians` | renamed; Professional requesters are no longer in it |
| `auth_sessions` | `sessions` | renamed |
| `email_otps` | `email_otp_codes` | renamed |
| `identity_verifications` | `technician_identity_verifications` | renamed; Aadhaar ciphertext and face captures carry their key version |
| `technician_profiles` | `technician_profiles` | user_id column is technician_id |
| `technician_services` | `technician_services` | kept |
| `technician_working_hours` | `technician_working_hours` | kept |
| `technician_bank_accounts` | `technician_payout_accounts` | renamed; account number ciphertext carries its key version |
| `technician_earnings` | `technician_earnings` | service_request_id column is booking_id |
| `technician_locations` | `technician_locations` | kept |
| `services` | `catalog_services` | renamed |
| `service_step_templates` | `catalog_service_checklist_steps` | renamed; service_id column is catalog_service_id |
| `service_requests` | `bookings` | renamed; requested_by_user_id references professional.users (RESTRICT, was CASCADE) |
| `service_request_assignments` | `booking_offers` | renamed |
| `service_request_tracking` | `booking_destinations` | renamed; primary key booking_id |
| `service_request_steps` | `booking_checklist_steps` | renamed |
| `service_request_media` | `booking_media` | renamed |
| `service_request_start_otps` | `booking_start_codes` | renamed; code ciphertext carries its key version |
| `service_request_bills` | `booking_work_bills` | renamed |
| `service_request_bill_items` | `booking_work_bill_items` | renamed |
| `service_request_ratings` | `booking_ratings` | renamed |
| `service_request_rating_tags` | `booking_rating_tags` | renamed; composite primary key (rating_id, tag) |

Read from Professional's schema:

| Old | New |
| --- | --- |
| `octabuild.users` | `professional.v_partner_requesters (view, read-only)` |
| `octabuild.engineer_profiles` | `professional.v_partner_requesters (view, read-only)` |

Published for Professional: `partner.v_professional_bookings` (technical-architecture.md section 11.2), defined in `partner/backend/app/modules/bookings/professional_view.py`, SELECT granted to `crewnbuild_professional` only.
