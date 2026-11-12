# CREWNBUILD Platform — Software Requirements Specification

Nov 12, 2026 · @Trysol Global services Pvt Ltd

## 1. Introduction

CREWNBUILD is an existing construction platform built as two microservices that share one PostgreSQL database, `crewnbuild`. The **Professional** service (formerly Octabuild) owns schema `professional`; the **Partner** service (technician booking) owns schema `partner`. This document states what the platform must do, how its data is organised, and which changes are required.

### 1.1 Purpose

- Give developers, testers and reviewers one agreed statement of the platform's requirements.
- Record the target database layout: database `crewnbuild`, schemas `professional` and `partner`.
- List the corrections found in the technical review of 12 Nov 2026 as numbered change requirements (section 12).

### 1.2 Scope

| In scope | Out of scope |
|---|---|
| Professional service: backend API and web app | Native mobile apps (only store links exist) |
| Partner service: backend API and web app | A separate Partner admin console (none exists today) |
| Shared database `crewnbuild` and its two schemas | Live (non-test) payment processing until CR-05 is done |
| Integration between the two services | Countries other than India |

### 1.3 Requirement wording

- **Must** = mandatory. **Should** = expected unless a reason is recorded. **May** = optional.
- IDs: `FR-P-xx` Professional functional, `FR-T-xx` Partner functional, `IR-xx` integration, `DR-xx` data, `NFR-xx` non-functional, `CR-xx` change requirement.

### 1.4 Terms

| Term | Meaning |
|---|---|
| Professional service | The FastAPI backend and React web app formerly called Octabuild (API title `CREWNBUILD API`) |
| Partner service | The FastAPI backend and React web app for booking technicians (API title `Partner API`) |
| House Owner | Role `OWNER`: a person building a house |
| Builder | Role `CONTRACTOR`: a construction company |
| Site Engineer / Store Manager | Role `ENGINEER`, told apart by engineer category |
| Supplier | Role `SUPPLIER`: material, labor or equipment supplier |
| Technician | A Partner account: painter, plumber, electrician or carpenter |
| Requester | A House Owner or Site Engineer booking a technician through the hand-off |
| Hand-off | The signed, one-time token Professional issues so a user can open Partner without a password |

## 2. System overview and architecture

CREWNBUILD runs as two independent services, each with its own web app, API, deployment and migrations. The only shared resource is the `crewnbuild` database, split into one schema per service.

> [Figure: Architecture diagram "Two services, one database: each service owns its own schema" — Professional users → Professional web app (React 18 + Vite, port 5173) → Professional API (FastAPI, port 8000, 373 endpoints) → schema professional (98 tables, formerly octabuild); Technicians → Partner web app (React 18 + Vite, port 5373) → Partner API (FastAPI, port 8200, 89 endpoints) → schema partner (22 tables, unchanged); hand-off token from Professional web app to Partner web app; Partner API has read-only access to users, engineer_profiles; both schemas in PostgreSQL database: crewnbuild]

CREWNBUILD architecture · 2 services, 1 database, 2 schemas

Requesters cross from the Professional app to the Partner app by a signed hand-off token. The only data link is Partner's read-only access to two `professional` tables.

| Component | Technology | Port (dev) | Owns |
|---|---|---|---|
| Professional web app | React 18.3, Vite 5.4, Redux Toolkit, Tailwind 3.4, React Router 6.30 | 5173 | Public site, sign-up, role dashboards |
| Professional API | Python 3.12, FastAPI 0.115, SQLAlchemy 2, Alembic 1.14, Uvicorn | 8000 | Schema `professional` |
| Partner web app | React 18.3, Vite 5.4, Redux Toolkit, Tailwind 3.4, Leaflet 1.9 | 5373 | Technician app, requester booking and tracking |
| Partner API | Python 3.12, FastAPI 0.115, SQLAlchemy 2, Alembic 1.14, Uvicorn | 8200 | Schema `partner` |
| Database | PostgreSQL, database `crewnbuild` | 5432 | Schemas `professional` and `partner` |

### 2.1 Architecture rules

- **AR-01** Each service is built, deployed, configured and migrated on its own. A release of one must not require a release of the other, except for changes listed in IR-05.
- **AR-02** Each API is layered: routes → services → repositories → ORM models, with Pydantic schemas validating input (`extra="forbid"`).
- **AR-03** Router registration order is fixed, because the first matching route answers.
- **AR-04** The services do not call each other over HTTP. They connect only through the browser hand-off and the read-only database access in section 7.
- **AR-05** Real-time features use WebSockets: Professional `/events/ws` and `/messages/ws/{id}`; Partner `/dispatch/ws/technician` and `/tracking/ws/bookings/{id}`.
- **AR-06** Middleware order in both APIs: CSRF protection inside CORS, so error answers stay readable by the browser.

## 3. Users and roles

The platform serves eight Professional roles and two Partner identities. Professional roles live in `professional.users.role`. Partner keeps its own accounts in `partner.users` and never stores passwords for requesters.

| Role | Service | Signs in with | Main capabilities |
|---|---|---|---|
| House Owner (`OWNER`) | Professional | E-mail + password, WhatsApp OTP, Google, Microsoft | Create projects, invite builders, negotiate awards, follow progress, shop, list property, book technicians |
| Builder (`CONTRACTOR`) | Professional | Same | Paid subscription, accept projects, manage engineers and suppliers, daily costs, portfolio |
| Site Engineer (`ENGINEER`, site category) | Professional | Same | Daily site records, material, labor and equipment requests, store requests, CCTV, book technicians |
| Store Manager (`ENGINEER`, store category) | Professional | Same | Stock, issue requests, buy from suppliers, record payments |
| Supplier (`SUPPLIER`) | Professional | Same | Catalog listings, bulk pricing, purchase requests, labor and equipment supply |
| Professional (`PROFESSIONAL`) | Professional | Same | No dashboard today. Decision needed (CR-14) |
| Administrators (`GLOBAL_SUPER_ADMIN`, `LOCATION_SUPER_ADMIN`, `MANAGER`) | Professional | E-mail + password | Users, verification, catalog, ads, coupons, reports, support, audit |
| Technician | Partner | E-mail + password | Onboarding, offers, jobs, work bill, earnings, bank account |
| Requester (House Owner or Site Engineer) | Partner | Hand-off from Professional | Book, track, give start code, rate |

- **FR-P-01** Every Professional endpoint must enforce the role and ownership rules of its module; admin endpoints must check a named permission.
- **FR-P-02** A Store Manager must be told apart from a Site Engineer by engineer category, and must not reach Site Engineer screens (and the reverse).
- **FR-T-01** Only Professional users with role `OWNER`, or `ENGINEER` with the Site Engineer category, may become Partner requesters. Store Managers must be refused.

## 4. Data architecture

One PostgreSQL database, `crewnbuild`, holds two schemas: `professional` (98 tables, all former `octabuild` tables) and `partner` (22 tables, unchanged). Each service owns and migrates only its own schema.

### 4.1 Database and schemas

| Item | Target value | Was |
|---|---|---|
| Database name | `crewnbuild` | not fixed (`octabuild` / `octabuild_test` in scripts) |
| Professional schema | `professional` | `octabuild` |
| Partner schema | `partner` | `partner` (no change) |
| Professional migration table | `professional.alembic_version` | `public.alembic_version` |
| Partner migration table | `partner.alembic_version` | not documented |
| Test database | `crewnbuild_test` | `octabuild_test` |

### 4.2 Data rules

- **DR-01** All application tables must live in `professional` or `partner`. Schema `public` must hold no application table.
- **DR-02** Each service must keep its own Alembic version table inside its own schema, so the two chains never overwrite each other.
- **DR-03** Professional must create, alter and write only `professional.*`. Partner must create, alter and write only `partner.*`.
- **DR-04** Partner may read exactly two Professional tables: `professional.users` and `professional.engineer_profiles`. Its `before_flush` guard must refuse any write to `professional.*`, and its Alembic `env.py` must ignore that schema.
- **DR-05** Each service should connect with its own database role: `crewnbuild_professional` owns `professional`; `crewnbuild_partner` owns `partner` and has only `SELECT` (plus `REFERENCES` on `users.id`) on the two Professional tables.
- **DR-06** All raw SQL must qualify table names with the schema (`professional.users`, `partner.service_requests`). Code must not rely on `search_path`.
- **DR-07** Timestamps are stored as naive UTC and shown in India time (Asia/Kolkata, +05:30). CCTV tables keep `TIMESTAMPTZ`; new tables should follow the naive-UTC rule.
- **DR-08** User IDs are UUIDs in both services. Most other Professional keys are integer identities; Partner keys are UUIDs.
- **DR-09** Every new constraint and index must have an explicit name (24 Professional and 4 Partner unique constraints are unnamed today).
- **DR-10** The cross-schema link `partner.service_requests.requested_by_user_id` → `professional.users.id` must not cascade deletes (see CR-01).

### 4.3 Schema `professional` (98 tables)

| Area | Tables |
|---|---|
| Users and identity (12) | `account_deletion_requests`, `admin_profiles`, `auth_sessions`, `builder_profiles`, `email_verifications`, `oauth_identities`, `owner_profiles`, `phone_otp_send_events`, `phone_verifications`, `supplier_profiles`, `users`, `verification_records` |
| Administration and audit (8) | `advertisement_daily_stats`, `advertisements`, `audit_events`, `reports`, `support_ticket_messages`, `support_tickets`, `labour_logs`, `material_logs` |
| Projects and construction (24) | `award_offers`, `builder_engineer_invitations`, `builder_engineer_memberships`, `builder_offline_suppliers`, `builder_workers`, `daily_site_records`, `engineer_profiles`, `escrow_milestones`, `estimates`, `project_awards`, `project_engineer_assignments`, `project_material_inventory`, `project_media`, `project_supplier_assignments`, `project_timelines`, `projects`, `requests`, `reviews`, `site_expenses`, `site_labour_entries`, `site_machinery_usages`, `site_material_purchases`, `site_material_usages`, `site_payments` |
| Catalog, suppliers and shop (11) | `cart_items`, `master_brands`, `master_categories`, `master_product_images`, `master_product_variants`, `master_products`, `master_subcategories`, `master_units`, `material_order_items`, `supplier_bulk_pricing`, `supplier_products` |
| Store Manager (7) | `store_builder_requests`, `store_items`, `store_payment_records`, `store_purchase_receipts`, `store_site_request_lines`, `store_site_requests`, `store_stock_movements` |
| Labor and equipment supply (6) | `equipment_items`, `equipment_requests`, `equipment_usage_logs`, `labor_daily_records`, `labor_requests`, `labor_services` |
| Messaging and notifications (4) | `conversation_participants`, `conversations`, `messages`, `notifications` |
| Files (1) | `uploaded_files` |
| Property listings (2) | `property_listing_images`, `property_listings` |
| Live cameras (8) | `cctv_audit_events`, `cctv_channels`, `cctv_device_credentials`, `cctv_devices`, `cctv_discovery_results`, `cctv_playback_sessions`, `cctv_project_access`, `cctv_rate_limit_events` |
| Payments and subscriptions (10) | `builder_subscriptions`, `daily_record_adjustments`, `payment_orders`, `payment_receipts`, `payment_transactions`, `subscription_coupon_redemptions`, `subscription_coupons`, `subscription_payments`, `subscription_plan_prices`, `subscription_webhook_events` |
| Weather (5) | `weather_alert_acknowledgements`, `weather_alerts`, `weather_geocode_cache`, `weather_site_locations`, `weather_snapshots` |

Totals: 98 tables, 1,161 columns, 124 CHECK constraints, 250 named indexes. Column-level detail stays in the Professional backend technical document.

### 4.4 Schema `partner` (22 tables)

| Area | Tables |
|---|---|
| Accounts and identity (5) | `users`, `auth_sessions`, `email_otps`, `identity_verifications`, `technician_profiles` |
| Technician preferences and payouts (5) | `technician_services`, `technician_working_hours`, `technician_locations`, `technician_bank_accounts`, `technician_earnings` |
| Catalog (2) | `services`, `service_step_templates` |
| Bookings and dispatch (3) | `service_requests`, `service_request_assignments`, `service_request_tracking` |
| Job execution (7) | `service_request_steps`, `service_request_media`, `service_request_start_otps`, `service_request_bills`, `service_request_bill_items`, `service_request_ratings`, `service_request_rating_tags` |

Totals with the two read-only Professional tables: 24 mapped tables, 262 columns, 75 CHECK constraints.

### 4.5 Cross-schema references

| From (partner) | To (professional) | Access | Required delete rule |
|---|---|---|---|
| `service_requests.requested_by_user_id` | `users.id` | Foreign key | `RESTRICT`. Today: `CASCADE` (CR-01) |
| Requester lookups | `users` (id, name, email, phone, role, status, address, pincode, location) | Read only | n/a |
| Site Engineer check | `engineer_profiles` (id, user_id, specialization) | Read only | n/a |
| (none today) | `payment_orders.booking_id` → `partner.service_requests.id` | Not linked | Decision needed (CR-03) |

Partner's mapping of `professional.users.email` must be nullable, because Professional made e-mail optional in migration 0032 (CR-02).

## 5. Functional requirements — Professional service

The Professional service exposes 373 distinct HTTP and WebSocket endpoints in 39 modules, and its web app has one dashboard per role. Each row below is a must-level requirement. Endpoint lists stay in the Professional backend technical document.

### 5.1 Accounts and access

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-P-03 | Sign-up | Users sign up with e-mail (verified by code) or an Indian mobile number verified on WhatsApp. E-mail is optional at sign-up and verified later in Profile Settings. | `/auth/signup`, `/auth/email/*`, `/auth/phone/*` |
| FR-P-04 | Sign-in | Users sign in by e-mail + password, WhatsApp code, Google or Microsoft (PKCE). Every method creates the same server-side session. | `/auth/login`, `/auth/phone/login/*`, `/auth/oauth/*` |
| FR-P-05 | Sessions | Access token 30 min, refresh 30 days, idle 30 days. Refresh tokens rotate; reuse after 10 s revokes the family. Sign-out revokes the session and clears cookies. | `/auth/refresh`, `/auth/logout`, `/auth/session` |
| FR-P-06 | Password reset | Reset by e-mailed code, then a new password. | `/auth/password/*` |
| FR-P-07 | Profile completion | Each role completes its profile, pincode and post-office branch. Suppliers and engineers choose their category once. | `/auth/complete-profile`, `/auth/location`, `/auth/*-category` |
| FR-P-08 | Account deletion | Signed-in users delete their account from Profile Settings. Visitors may file a request on the public page. History is kept for admins. | `/account/delete`, `/account-deletion-requests` |
| FR-P-09 | Administration | Admins manage users, administrators, verification, reports, leads, announcements and ads within their country scope. Every admin action is written to `audit_events` in the same transaction. | `/admin/*` (67 endpoints) |

### 5.2 Projects and construction

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-P-10 | Projects | House Owners create, edit and delete draft projects, with photos and timelines. | `/projects/*`, `/timelines/*` |
| FR-P-11 | Project requests | Owners, builders, engineers and suppliers send, accept, reject and withdraw requests. Owners assign one builder and one Site Engineer. | `/project-requests/*` |
| FR-P-12 | Awards | Owner and builder negotiate an award by offers until one is confirmed, declined or cancelled. | `/projects/{id}/award`, `/awards/*`, `/award-offers/*` |
| FR-P-13 | Daily site records | Site Engineers record labour, material use and purchases, expenses, machinery and payments per day. Records lock after the daily cut-off. Builders may make audited adjustments. | `/cost-tool/*` |
| FR-P-14 | Teams | Builders invite engineers by code or request; engineers join, apply to opportunities and are assigned per project, including specialist categories. | `/engineers/*`, `/projects/{id}/specialist-*` |
| FR-P-15 | Estimates | Anyone can calculate a construction estimate. Owners may save one to a project. | `/estimates/calculate`, `/estimates` |

### 5.3 Marketplace and supply

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-P-16 | Master catalog | Admins maintain categories, subcategories, brands, units, products, variants and media. Users browse their country's catalog. Prices never live in the master catalog. | `/admin/catalog/*`, `/catalog/*` |
| FR-P-17 | Supplier listings | Suppliers list catalog products at their own price, with optional bulk-price tiers validated for range, overlap and duplicates. | `/supplier-products/*` |
| FR-P-18 | Cart and buy requests | A cart belongs to one project. Checkout turns one supplier's lines into a purchase request the supplier accepts or rejects. | `/cart/*`, `/material-requests/*`, `/supplier/*` |
| FR-P-19 | Labor supply | Labor suppliers publish trades and capacity; engineers request workers; daily attendance is recorded per date. | `/labor/*`, `/labor-requests/*` |
| FR-P-20 | Equipment supply | Equipment suppliers list rent or buy items; engineers request them; daily usage is logged. | `/equipment/*`, `/equipment-requests/*` |
| FR-P-21 | Store Manager | Store Managers keep stock with a movement ledger, approve and issue Site Engineer requests in parts, buy shortfalls from the builder's suppliers through Razorpay, receive goods in parts and record payments with a permanent transaction ID. | `/store-manager/*`, `/store/*`, `/store-builder-requests/*` |
| FR-P-22 | Property listings | Users list property as drafts, publish, withdraw or mark sold, and receive enquiries. | `/property-listings/*` |
| FR-P-23 | Discovery | Users find nearby builders, suppliers, engineers and projects by pincode. | `/contractors/*`, `/suppliers/*`, `/engineers/find` |

### 5.4 Communication, monitoring and payments

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-P-24 | Messaging | One-to-one chat with delivery, read and edit state, live over WebSocket. | `/messages/*`, `WS /messages/ws/{id}` |
| FR-P-25 | Notifications and live events | In-app notifications by category; a live-events socket tells screens to reload. REST stays the source of truth. | `/notifications/*`, `WS /events/ws` |
| FR-P-26 | Live cameras | Project members verify DVR/NVR credentials, then view live and recorded video through the media gateway with short-lived tokens. Camera addresses and passwords are never sent to the browser. | `/cctv/*` |
| FR-P-27 | Weather | Forecasts and alerts per project site and per user location; a public weather view; alert e-mails. | `/weather/*` |
| FR-P-28 | Builder subscriptions | Builders buy PROFESSIONAL or BUSINESS plans (monthly, six months, annual) with coupons; renewal reminders and expiry notices are sent. | `/subscriptions/*`, `/admin/coupons/*` |
| FR-P-29 | Technician booking payments | House Owners pay for technician bookings through Razorpay, with server-side verification and receipts. | `/payments/*` |
| FR-P-30 | Support and contact | Visitors and users raise support tickets with attachments and replies; a contact form sends e-mail. | `/support/*`, `/contact` |
| FR-P-31 | Reports | Users report an account or project; admins resolve reports. | `/reports/*`, `/admin/reports/*` |
| FR-P-32 | Ads | Admins run adverts on named screens; views and clicks are counted per day. | `/ads/*`, `/admin/ads/*` |
| FR-P-33 | Translation | Interface text in English, Hindi, Telugu, Tamil, Kannada, Malayalam; user-typed text translated by machine with a cache. | `/translate` |
| FR-P-34 | Vastu analysis | Public upload of a floor plan (image or PDF) analysed by a vision model, rate limited. | `/vastu/plan-analysis` |
| FR-P-35 | Book Technician | Owners and Site Engineers open Partner from Professional through the hand-off (section 7). | `/auth/partner-handoff` |

### 5.5 Web app (Professional)

- React 18 + Vite 5 single-page app on port 5173, with Redux Toolkit, Tailwind and React Router 6.
- One dashboard per role: `/owner`, `/contractor`, `/engineer`, `/store-manager`, `/supplier`, `/admin`, plus `/weather` for all signed-in roles.
- Routes check a verified server session and role. Builders must finish the paid sign-up before reaching their dashboard.
- Public site: marketing pages, calculators, contact, support tickets, delete account.

## 6. Functional requirements — Partner service

The Partner service exposes 89 endpoints (87 HTTP, 2 WebSocket). Technicians use it to find and complete jobs; requesters arrive from Professional to book, track and rate them.

### 6.1 Technician

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-T-02 | Registration | Technicians register with e-mail verified by a one-time code and set a password. Failed sign-ins are throttled per e-mail and per client. | `/auth/signup/*`, `/auth/login` |
| FR-T-03 | Sessions | Same model as Professional: HttpOnly cookies, rotating refresh token, `X-CSRF-Token` on writes, server-side revocation. | `/auth/refresh`, `/auth/logout`, `/auth/me` |
| FR-T-04 | Password | Reset by e-mailed code; change requires the current password and ends every other session. | `/auth/password-reset/*`, `/technicians/me/password` |
| FR-T-05 | Onboarding | Technicians submit a face capture, Aadhaar details and profile (trade, experience, pincode area). Aadhaar and face data are encrypted; face captures are purged after the retention period. | `/onboarding/*` |
| FR-T-06 | Profile and availability | Technicians edit their profile and photo and set AVAILABLE, PAUSED or OFFLINE. Leaving AVAILABLE withdraws pending offers. | `/technicians/me`, `/technicians/me/availability` |
| FR-T-07 | Work preferences | Technicians choose services from their trade, a personal radius (2, 5, 10 or 15 km) and weekly working hours in India time. | `/technicians/me/work-preferences`, `/technicians/me/catalog` |
| FR-T-08 | Location | The app posts the technician's position every few seconds. Positions are checked for accuracy, speed jumps and clock skew, kept in one row per technician and purged after an hour. | `POST/DELETE /technicians/me/location` |
| FR-T-09 | Offers | Live offers arrive over WebSocket with a sound, and a system notification when the tab is hidden. The first valid acceptance wins; others get a 409 with a reason code. | `/technicians/me/offers/*`, `WS /dispatch/ws/technician` |
| FR-T-10 | Job execution | Technicians navigate to the customer, mark en route and arrived, enter the customer's start code, tick checklist steps, take before and after photos, keep notes and run a timer. | `/technicians/me/jobs/*`, `/tracking/bookings/{id}/sharing` |
| FR-T-11 | Hand back | A technician may hand back a job only in ACCEPTED or EN_ROUTE; the booking returns to SEARCHING and is dispatched again. | `/technicians/me/jobs/{id}/cancel` |
| FR-T-12 | Work bill | Technicians add material and extra-labour lines with photos and attachments, then submit. The bill is informational; totals must equal service price + materials + labour. | `/technicians/me/jobs/{id}/bill/*` |
| FR-T-13 | Earnings and payouts | Each completed priced job records gross, commission (`PARTNER_COMMISSION_RATE_PERCENT`) and net. Technicians keep one masked payout bank account (IFSC checked). | `/technicians/me/earnings*`, `/technicians/me/bank-account` |
| FR-T-14 | Weather | Technicians see weather for their current job, a chosen place or their device position. | `/technicians/me/weather*` |

### 6.2 Requester

| ID | Module | Requirement | Main API |
|---|---|---|---|
| FR-T-15 | Booking session | A requester session is created only from a valid hand-off token, lasts 60 min and is never extended. | `/requester/session`, `/requester/refresh`, `/requester/logout` |
| FR-T-16 | Service catalog | Requesters browse services by trade (painter, plumber, electrician, carpenter), each with price, inclusions and kind (SERVICE or CONSULTATION). | `/requester/services*` |
| FR-T-17 | Book | Requesters pin the service address on a map (search and reverse lookup), describe the problem, add problem photos and book. The price is fixed at booking time. | `/requester/bookings`, `/locations/*` |
| FR-T-18 | Track | Requesters see the technician's live position, route and ETA, and confirm the destination. | `/tracking/bookings/*`, `WS /tracking/ws/bookings/{id}` |
| FR-T-19 | Start code | Requesters read or regenerate the one-time start-work code and give it to the technician. | `/requester/bookings/{id}/start-otp*` |
| FR-T-20 | Progress, bill and rating | Requesters follow checklist progress, view photos and the work bill, and rate a completed job 1–5 stars with predefined tags, once. | `/requester/bookings/{id}/execution`, `/bill`, `/rating` |
| FR-T-21 | Cancel and retry | Requesters cancel until the technician arrives, and retry a booking that ended NO_TECHNICIAN_FOUND or EXPIRED. | `/requester/bookings/{id}/cancel`, `/retry` |

### 6.3 Booking lifecycle and dispatch

| From | To | Trigger |
|---|---|---|
| SEARCHING | OFFERED | Sweeper sends a batch of offers |
| SEARCHING | NO_TECHNICIAN_FOUND | Nobody eligible within 15 km |
| OFFERED | OFFERED | Batch expires, next batch sent |
| OFFERED | EXPIRED | 3 batches sent, nobody accepted |
| OFFERED | ACCEPTED | First valid acceptance |
| ACCEPTED | EN_ROUTE | Technician starts travel |
| EN_ROUTE | ARRIVED | Within arrival threshold, or marked manually |
| ARRIVED | IN_PROGRESS | Correct start code |
| IN_PROGRESS | COMPLETED | Technician completes the job |
| ACCEPTED / EN_ROUTE | SEARCHING | Technician hands the job back |
| Any state before ARRIVED | CANCELLED | Requester cancels |

- **FR-T-22** Illegal transitions must be refused with `409 INVALID_STATE_TRANSITION`.
- **FR-T-23** Eligibility: active account, finished registration, identity verified (see CR-04), matching trade and chosen service, inside the personal radius and working hours, AVAILABLE, with a fresh location.
- **FR-T-24** Dispatch searches 5 km, then 10 km, then 15 km; ranks by distance, rating, availability, acceptance, completion, cancellation, experience and daily fairness; offers to batches of 3 for 30 s; records every offer.
- **FR-T-25** A technician may hold only one active job (ACCEPTED, EN_ROUTE, ARRIVED or IN_PROGRESS).

### 6.4 Web app (Partner)

- React 18 + Vite 5 on port 5373 (`strictPort`), with an HTTPS mode for phone camera and GPS, and a `/partner-api` proxy to the backend.
- Technician routes: `/login`, `/register`, `/forgot-password`, `/onboarding`, `/dashboard`, `/weather`.
- Requester routes: `/book-technician`, `/book-technician/:typeSlug`, `/book-technician/:typeSlug/:serviceSlug`, `/book-technician/bookings/:bookingId`.
- English only. Maps use Leaflet with a configurable tile source.

## 7. Inter-service integration

The two services talk in exactly three ways: a signed browser hand-off, Partner's read-only access to two `professional` tables, and the technician-booking payment (still to be defined, CR-03). There are no service-to-service HTTP calls.

### 7.1 Hand-off flow (Book Technician)

1. A signed-in House Owner or Site Engineer clicks **Book Technician** in the Professional web app.
2. The app calls `POST /auth/partner-handoff`; Professional signs a one-time token valid for `PARTNER_HANDOFF_SECONDS` (about one minute) with `PARTNER_HANDOFF_PRIVATE_KEY`.
3. The app opens the Partner web app (`VITE_PARTNER_URL`) and sends the token with `postMessage`.
4. Partner accepts the message only from an origin in `VITE_OCTABUILD_ORIGIN` and posts it to `POST /requester/session`.
5. Partner verifies the signature with `OCTABUILD_HANDOFF_PUBLIC_KEY`, records the token ID (`handoff_jti`, unique) so it works once, reads the user from `professional.users`, and sets a 60-minute requester session.

### 7.2 Integration requirements

- **IR-01** The hand-off key pair must be asymmetric. Only Professional holds the private key; only Partner holds the public key.
- **IR-02** A hand-off token must be single-use, short-lived and bound to one Professional user ID and role.
- **IR-03** Partner must re-check on every requester request that the Professional user still exists and is `ACTIVE`.
- **IR-04** Partner must treat `professional.users.email` as optional and must not fail for phone-only users.
- **IR-05** A schema change to `professional.users` or `professional.engineer_profiles` must be checked against Partner's read-only mapping before release.
- **IR-06** Allowed origins must be configured on both sides: Professional web 5173 and API 8000; Partner web 5373 and API 8200 (development).
- **IR-07** Cookies are scoped by host, not port. Both services must use distinct cookie names (Professional uses the `octabuild-` prefix; Partner's names must not overlap).
- **IR-08** Deleting or suspending a Professional user must not silently delete Partner records (CR-01). Partner bookings must keep the booking and anonymise personal fields instead.

## 8. Non-functional requirements

Security and privacy requirements are must-level in both services; scaling requirements apply before running more than one worker process or server.

| ID | Area | Requirement |
|---|---|---|
| NFR-01 | Authentication | Passwords hashed with bcrypt. JWT (HS256) only in HttpOnly cookies; the browser never reads tokens. Each service has its own `JWT_SECRET_KEY`. |
| NFR-02 | CSRF | Cookie-authenticated writes need an allowed `Origin` / `Referer` and a matching `X-CSRF-Token`. The CSRF token is kept in memory only. |
| NFR-03 | Sessions | Server-side sessions with refresh rotation, reuse detection, idle expiry and revocation on sign-out and password change. |
| NFR-04 | Rate limits | OTP sends, sign-in failures, contact form, support tickets, Vastu analysis, CCTV checks and start-code attempts are rate limited. |
| NFR-05 | Account enumeration | Sign-in and OTP endpoints should not reveal whether an e-mail or number is registered (CR-12). |
| NFR-06 | Personal data | Aadhaar numbers, face captures, bank account numbers and camera credentials are encrypted at rest; only last-4 digits are shown. Validation errors never echo submitted values. |
| NFR-07 | Private media | Job photos, bill photos, face captures and support attachments are served only through authorised endpoints, never as public files. |
| NFR-08 | API docs | `/docs`, `/redoc` and `/openapi.json` must be disabled in production in both services (CR-06). |
| NFR-09 | Audit | Every admin action and every CCTV access decision is written to an append-only audit table. |
| NFR-10 | Scaling: background jobs | Background threads (Partner dispatch sweeper every 3 s; Professional subscription sweep and weather monitor) must be safe when several worker processes run, by a database lock or a single scheduler (CR-08). |
| NFR-11 | Scaling: files | Partner job and bill photos must be on storage shared by all servers (S3 like Professional) before running more than one server (CR-08). |
| NFR-12 | Scaling: real-time | WebSocket messages are relayed between worker processes through PostgreSQL `LISTEN/NOTIFY` (`partner_realtime`); each socket has a bounded queue. |
| NFR-13 | Availability | `GET /health` and `GET /health/db` on both services report process and database state, including missing tables. |
| NFR-14 | Startup | Neither service creates or alters tables at startup; each logs whether its schema is at the Alembic head. |
| NFR-15 | Time | All dates and times are shown in India time (Asia/Kolkata). |
| NFR-16 | Country | India only: currency INR, +91 numbers, Indian pincodes. |
| NFR-17 | Languages | Professional: English, Hindi, Telugu, Tamil, Kannada, Malayalam, with English fallback. Partner: English. |
| NFR-18 | Browsers | Current Chrome, Edge, Safari and Firefox on desktop and mobile; Partner's technician features need a secure context (HTTPS) for camera and GPS. |
| NFR-19 | Dependencies | Backend packages must be pinned to exact versions (today `SQLAlchemy>=2.0.45` resolves to 2.1.6). Unused frontend packages (`three`, `@react-three/*`) should be removed. |

## 9. External integrations

The platform depends on 12 outside services. Each must fail gracefully: a slow or failed call returns a clear error or a cached value, never a crash.

| Service | Used by | Purpose | Mode today |
|---|---|---|---|
| Razorpay | Professional | Technician booking payments, builder subscriptions, Store Manager purchases; signature check and webhooks | TEST only, mock in development |
| Dovesoft WhatsApp | Professional | Sign-up and sign-in OTP, welcome message | Live when enabled |
| SMTP / Resend | Both | Verification codes, support, deletion and weather e-mails | Console output when SMTP is unset (Partner) |
| Amazon S3 | Professional | Profile images, supplier data, site images and videos, presigned URLs | Per-category buckets (India) |
| Google / Microsoft OAuth | Professional | Social sign-in with PKCE | Live |
| Open-Meteo (OpenWeatherMap optional) | Both | Forecasts, air quality, geocoding | Live |
| OpenStreetMap Nominatim | Both | Address search and reverse geocoding | Live, public server |
| OSRM | Partner | Driving routes and ETAs for tracking | Public demo server |
| India Post pincode API | Both | Pincode to area lookup | Live |
| OpenAI-compatible API | Professional | Machine translation with on-disk cache | `gpt-4o-mini` default |
| Gemini-compatible vision model | Professional | Vastu floor-plan analysis | Live |
| ONVIF cameras + media gateway | Professional | Camera discovery, WebRTC / LL-HLS playback | Loopback gateway |

- Production should not depend on the public Nominatim and OSRM demo servers, which limit usage; a hosted or self-run instance is expected before launch.

## 10. Configuration and environments

Both backends read `backend/.env` through pydantic-settings; both web apps read `VITE_*` variables at build time. Secrets are never committed.

### 10.1 Database settings

| Setting | Professional | Partner |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://crewnbuild_professional:<password>@<host>:5432/crewnbuild` | `postgresql+psycopg2://crewnbuild_partner:<password>@<host>:5432/crewnbuild` |
| Own schema (code constant) | `PROFESSIONAL_SCHEMA = "professional"` in `app/database/session.py` (was `octabuild`) | `PARTNER_SCHEMA = "partner"` (no change) |
| Read-only schema | none | `PROFESSIONAL_SCHEMA = "professional"` for the two mapped tables (was `octabuild`) |
| Alembic version table | `version_table_schema="professional"` | `version_table_schema="partner"` |
| Test database | `crewnbuild_test` | `crewnbuild_test` |

### 10.2 Key settings by service

| Group | Professional | Partner |
|---|---|---|
| Sessions | `JWT_SECRET_KEY`, `ACCESS_TOKEN_MINUTES`=30, `REFRESH_TOKEN_DAYS`=30, `SESSION_IDLE_DAYS`=30, `AUTH_COOKIE_*` | Same, plus `REQUESTER_SESSION_MINUTES`=60, `LOGIN_MAX_FAILURES_*` |
| Hand-off | `PARTNER_HANDOFF_PRIVATE_KEY`, `PARTNER_HANDOFF_SECONDS` | `OCTABUILD_HANDOFF_PUBLIC_KEY` (may be renamed `PROFESSIONAL_HANDOFF_PUBLIC_KEY`) |
| Origins | `FRONTEND_ORIGIN` = `http://localhost:5173` | `FRONTEND_ORIGIN` = `http://localhost:5373` |
| Encryption | `CAMERA_CREDENTIALS_KEY` | `DATA_ENCRYPTION_KEY` |
| Payments | `RAZORPAY_MODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_ALLOW_MOCK` | none |
| Messaging | `WHATSAPP_*`, `SMTP_*`, `RESEND_API_KEY` | `SMTP_*`, `OTP_*` |
| Storage | `AWS_*`, `AWS_*_BUCKET_IN` | `UPLOAD_DIRECTORY`, `JOB_MEDIA_DIRECTORY`, `FACE_CAPTURE_DIRECTORY` |
| Dispatch | none | `TECHNICIAN_SEARCH_RADIUS_KM`=5, step 5, max 15, `DISPATCH_BATCH_SIZE`=3, `DISPATCH_OFFER_TIMEOUT_SECONDS`=30, `MAX_DISPATCH_ATTEMPTS`=3, `DISPATCH_SWEEP_INTERVAL_SECONDS`=3 |
| Identity | none | `REQUIRE_VERIFIED_IDENTITY_FOR_JOBS` = `true` (target; today `false`, CR-04) |
| Web app | `VITE_API_BASE_URL`, `VITE_PARTNER_URL`, `VITE_APP_STORE_URL`, `VITE_PLAY_STORE_URL` | `VITE_API_BASE_URL`, `VITE_OCTABUILD_ORIGIN`, `VITE_MAP_*` |

### 10.3 Environments and ports

| Component | Development | Production |
|---|---|---|
| Professional API | `uvicorn app.main:app --port 8000` | HTTPS behind a reverse proxy |
| Professional web | Vite on 5173 (`strictPort`) | Static build from `dist/` |
| Partner API | `uvicorn app.main:app --host 127.0.0.1 --port 8200` | HTTPS behind a reverse proxy |
| Partner web | Vite on 5373 (`strictPort`), `/partner-api` proxy, optional HTTPS | Static build from `dist/` |
| Database | PostgreSQL, database `crewnbuild` | PostgreSQL, database `crewnbuild`, one role per service |

- Production must set `ENVIRONMENT=production`, `AUTH_COOKIE_SECURE=true` and HTTPS origins, and must not set `RAZORPAY_ALLOW_MOCK`, `WHATSAPP_DEV_OTP_PREVIEW`, `TEST_OTP_LOGIN_ENABLED` or `DEV_ACCOUNT_RECOVERY_ENABLED`.

## 11. Migration to `crewnbuild` / `professional`

The move is a rename, not a data copy: PostgreSQL keeps tables, rows, indexes and foreign keys (including Partner's link to `users`) when a database or schema is renamed. Expect a short outage while both services are stopped.

### 11.1 Steps

1. **Back up.** Stop both APIs and take a full `pg_dump` of the current database.
2. **Rename the database.** From another database (for example `postgres`), with no open connections:

   ```sql
   ALTER DATABASE <current_database> RENAME TO crewnbuild;
   ```

3. **Rename the schema** with a new Professional Alembic revision `0051_schema_professional` (25 characters, within the 32 limit). Older revisions stay unchanged, so a fresh install still builds `octabuild` first and renames it here:

   ```sql
   ALTER SCHEMA octabuild RENAME TO professional;
   ```

4. **Move the Professional version table** out of `public`, then set `version_table_schema="professional"` in Professional's `alembic/env.py`:

   ```sql
   ALTER TABLE public.alembic_version SET SCHEMA professional;
   ```

5. **Confirm Partner's version table** is `partner.alembic_version`. If it is anywhere else, move it the same way and set `version_table_schema="partner"`.
6. **Create the service roles** and grants (DR-05):

   ```sql
   CREATE ROLE crewnbuild_professional LOGIN PASSWORD '<secret>';
   CREATE ROLE crewnbuild_partner LOGIN PASSWORD '<secret>';
   ALTER SCHEMA professional OWNER TO crewnbuild_professional;
   ALTER SCHEMA partner OWNER TO crewnbuild_partner;
   GRANT USAGE ON SCHEMA professional TO crewnbuild_partner;
   GRANT SELECT ON professional.users, professional.engineer_profiles TO
   crewnbuild_partner;
   GRANT REFERENCES (id) ON professional.users TO crewnbuild_partner;
   ```

Table ownership inside each schema must also move to the matching role (`ALTER TABLE … OWNER TO …`, one statement per table).

7. **Update the code** (11.2), set both `DATABASE_URL`s to `crewnbuild`, and deploy.
8. **Verify** (11.3), then start both web apps.

### 11.2 Code changes

| Service | File or area | Change |
|---|---|---|
| Professional | `app/database/session.py` | Schema constant `octabuild` → `professional` |
| Professional | Models and repositories | Every `schema="octabuild"` and raw SQL `octabuild.` → `professional` |
| Professional | `alembic/env.py` | `version_table_schema="professional"`; include only schema `professional` |
| Professional | `sql_scripts/master_catalog_seed.sql` | Database-name guard `octabuild` / `octabuild_test` → `crewnbuild` / `crewnbuild_test` |
| Professional | `seed_*.py`, `tests/` | Development-database names the tests refuse → new names; tests use `crewnbuild_test` |
| Professional | Startup check, `/health/db` | Report tables of schema `professional` |
| Partner | `app/models/octabuild_account.py` | Schema `octabuild` → `professional` (consider renaming the file `professional_account.py`) |
| Partner | `before_flush` guard | Refuse writes to `professional.*` |
| Partner | `alembic/env.py` | Exclude schema `professional`; `version_table_schema="partner"` |
| Partner | New revision `0016_requester_fk_restrict` | Change `service_requests.requested_by_user_id` FK from `CASCADE` to `RESTRICT` (CR-01) |
| Partner | Read-only `users` mapping | `email` nullable (CR-02) |
| Both | Documentation and `.env.example` | Database `crewnbuild`; schemas `professional` and `partner` |

### 11.3 Verification

- `SELECT schema_name FROM information_schema.schemata` shows `professional` and `partner`, and no `octabuild`.
- `professional` holds 98 tables plus `alembic_version`; `partner` holds 22 tables plus `alembic_version`; `public` holds no application table.
- `alembic current` reports `0051_schema_professional` for Professional and the Partner head (`0016_requester_fk_restrict` once CR-01 is done).
- Row counts of every table match the backup.
- `GET /health/db` is green on both services, and both test suites pass against `crewnbuild_test`.
- A Book Technician hand-off, a booking and a rating complete end to end.

### 11.4 Rollback

Stop both services, run `ALTER SCHEMA professional RENAME TO octabuild;`, move the version table back to `public`, rename the database back, and redeploy the previous release. If anything else failed, restore the step 1 backup.

## 12. Change requirements

Six high-priority changes must land before production: CR-01 to CR-06. The rest improve completeness and maintainability. Each came from the 12 Nov 2026 review of the four technical documents.

| ID | Priority | Service | Change required | Done when |
|---|---|---|---|---|
| CR-01 | High | Both | Replace `ON DELETE CASCADE` on `partner.service_requests.requested_by_user_id` with `RESTRICT`. Professional account deletion must refuse while a booking is active, and anonymise Partner personal fields otherwise. | Deleting a user with bookings keeps the bookings, ratings and bills |
| CR-02 | High | Partner | Map `professional.users.email` as nullable and handle missing e-mail in requester screens and responses. | A phone-only Owner can book end to end |
| CR-03 | High | Both | Define technician-booking payment: `payment_orders.booking_id` refers to `partner.service_requests.id`; Professional reads the price from Partner (read-only grant or a Partner endpoint); decide who pays (Owner and Site Engineer) and show paid status in Partner. | A booking is paid once, at the price fixed in Partner, and the receipt names the booking |
| CR-04 | High | Partner | Set `REQUIRE_VERIFIED_IDENTITY_FOR_JOBS=true` and add a reviewer API and screen to verify face and Aadhaar, replacing the server-only script. | No unverified technician receives an offer |
| CR-05 | High | Professional | Allow live payments: widen CHECK constraints on `payment_orders`, `payment_receipts` (`is_test`) and `subscription_payments` to accept `live`. | A live-mode Razorpay payment is stored and receipted |
| CR-06 | High | Partner | Hide `/docs`, `/redoc` and `/openapi.json` outside development, as Professional does. | 404 in production |
| CR-07 | Medium | Professional | Remove the two duplicate registrations of `GET /projects/{project_id}/suppliers`. | One route in the route table (372 endpoints) |
| CR-08 | Medium | Both | Make background jobs single-run across workers (advisory lock or one scheduler) and move Partner photos to shared storage. | Two workers send no duplicate offers, reminders or alerts |
| CR-09 | Medium | Partner | Add requester sign-out and customer problem-photo upload and delete to the web app. | Both work from the booking screens |
| CR-10 | Medium | Partner | Decide on e-mail-code sign-in: build `/auth/login/send-code` and verify, or drop the unused `LOGIN` purpose and the claim in documents. | Code and documents agree |
| CR-11 | Medium | Professional | Build UI for, or retire: reports (`/reports`, `/report-categories`), public `POST /account-deletion-requests`, CCTV device management (14 endpoints), admin subcategory edit, category and subcategory images, brand logo, `/subscriptions/reconcile`. | No backend endpoint without a caller, except links, webhooks and health |
| CR-12 | Low | Professional | Phone sign-in send-code returns the same answer whether or not the number is registered. | No 404/403 difference |
| CR-13 | Low | Professional | Remove legacy items: `DELETE /account`, `/materials/create`, `/labour/create`, unused `escrow_milestones` and `reviews`, Kuwait remnants (Arabic language, country picker, "both countries" brand rule), `gharbano_*` names. | None left in code or schema |
| CR-14 | Decision | Professional | Role `PROFESSIONAL`: build its dashboard, or remove it from the role constraint. | Decision recorded |
| CR-15 | Decision | Professional | Sign-up plans allow MONTHLY and ANNUAL only, while subscriptions also allow SIX_MONTHS. Confirm or align. | Decision recorded |
| CR-16 | Low | Professional | Install pytest for pytest-style tests; add an `npm test` script to the web app. | One command runs each suite |
| CR-17 | Low | Both | Name all constraints (DR-09), pin backend packages (NFR-19), keep Alembic IDs under 32 characters (`0041_store_request_partial_issue` is exactly 32). | Checked in code review |
| CR-18 | Low | Docs | Fix the technical documents: router count (38/39/40), `AdSlot` missing call, unresolved `{weatherSiteBasesite}` paths, Partner endpoint count (82, not 80), and the `frontend 7` source folder name. | Documents regenerate cleanly |

## 13. Testing and acceptance

A release is accepted when all five suites pass against `crewnbuild_test` and the end-to-end checks below succeed. Tests that write data must refuse any database other than `crewnbuild_test`.

| Suite | Service | Tool | Run | Size today |
|---|---|---|---|---|
| Backend | Professional | Python scripts (some pytest-style) | `python tests/<area>/<file>.py` | 17 areas |
| Web unit | Professional | Node test runner | `node --test $(find src -name "*.test.js")` | 41 files |
| Backend | Partner | pytest | `python -m pytest` | Full suite |
| Web unit | Partner | Node test runner | `npm test` | 27 files |
| Web UI | Partner | Playwright, mocked API | `npm run test:ui` | 12 specs |

### 13.1 End-to-end acceptance

- [ ] Owner signs up by WhatsApp OTP, creates a project, assigns a builder through an award, and sees daily records from the Site Engineer.
- [ ] Builder buys a subscription in Razorpay test mode and receives the plan badge.
- [ ] Store Manager issues a Site Engineer request in parts, buys a shortfall and records the payment.
- [ ] Owner clicks Book Technician; the hand-off opens Partner signed in; the token fails on second use.
- [ ] Booking is offered, accepted, tracked live, started with the start code, completed with a work bill, and rated.
- [ ] Technician's earning appears with the commission deducted.
- [ ] Deleting the Owner's Professional account keeps the Partner booking (CR-01).
- [ ] Partner writes to `professional.*` are refused by the guard and by database grants.
- [ ] Running two worker processes produces no duplicate offers or reminders (CR-08).

## Appendix A. API inventory

Endpoint counts by module, from the route tables in the technical documents dated 12 Nov 2026. Full endpoint lists, request bodies and column-level schemas stay in those four documents.

### A.1 Professional (373 distinct endpoints)

| Module | Endpoints | Module | Endpoints |
|---|---|---|---|
| Authentication and sessions | 23 | Property listings | 10 |
| Account and profile | 9 | House Owner estimates | 2 |
| Account deletion | 4 | Files | 2 |
| Admin console | 29 | Reports | 3 |
| Admin master catalog | 26 | Advertisements | 4 |
| Admin deletion history | 2 | Live cameras | 23 |
| Admin support tickets | 4 | Translation | 1 |
| Master catalog (read) | 9 | Contact form | 1 |
| Notifications | 4 | Support tickets | 6 |
| Messaging (incl. WebSocket) | 6 | Vastu analysis | 1 |
| Live events (WebSocket) | 1 | Payment gateway | 8 |
| Projects | 11 | Labor supply | 17 |
| Project requests | 8 | Equipment supply | 14 |
| Awards and negotiation | 7 | Store Manager | 30 |
| Daily costs and progress | 12 | Weather | 21 |
| Engineer and builder teams | 16 | Builder subscriptions | 17 |
| Marketplace discovery | 8 | Admin coupons | 4 |
| Project suppliers | 6 (8 registered, CR-07) | Admin subscription payments | 2 |
| Supplier products | 8 | Health | 2 |
| Material requests | 5 | Shop and cart | 7 |

### A.2 Partner (89 endpoints)

| Module | Endpoints |
|---|---|
| Technician authentication and sessions | 9 |
| Technician onboarding | 3 |
| Locations (pincode) | 1 |
| Technician profile, jobs, earnings, bank, preferences | 32 |
| Requester sessions and bookings | 21 |
| Service catalog | 2 |
| Dispatch (incl. WebSocket) | 9 |
| Live tracking (incl. WebSocket) | 4 |
| Weather | 6 |
| Health | 2 |

### A.3 Source documents

- Octabuild (CREWNBUILD) Backend — Technical Document, Alembic head `0050_store_payment_txn_uuid`.
- Octabuild (CREWNBUILD) Frontend — Technical Document.
- Partner Backend — Technical Document, Alembic head `0015_auth_sessions`.
- Partner Frontend — Technical Document.
