# CREWNBUILD Platform — Product Requirements Document

Nov 12, 2026 · @Trysol Global services Pvt Ltd

## 1. Product summary

CREWNBUILD is India's construction operating system: one platform where a house owner, builder, site engineer, store manager and suppliers run a building project together, and where anyone on site can book a verified technician on demand. It is live as two products on one database, `crewnbuild`: **CREWNBUILD Professional** (schema `professional`) and **CREWNBUILD Partner** (schema `partner`).

### 1.1 The problem

- **Fragmented coordination.** Owners, builders, engineers and suppliers agree work, prices and deliveries over calls and chat, so nobody has one record of what was agreed.
- **No cost visibility.** Owners cannot see daily labour, material and equipment spend until the money is gone.
- **Material leakage.** Site stores lose track of what was ordered, received and issued to each site.
- **Unreliable small jobs.** Finding a trustworthy painter, plumber, electrician or carpenter quickly, at a known price, is hard.

### 1.2 The product answer

| Problem | What CREWNBUILD provides | Product |
|---|---|---|
| Fragmented coordination | Projects, requests, award negotiation, teams, chat and notifications in one place | Professional |
| No cost visibility | Daily site records, owner analysis, live cameras and weather alerts per site | Professional |
| Material leakage | Master catalog, supplier listings, cart and purchase requests, Store Manager stock ledger | Professional |
| Unreliable small jobs | Fixed-price technician booking, nearby dispatch, live tracking, start code, work bill, ratings | Partner |

### 1.3 Related documents

- CREWNBUILD Platform — Software Requirements Specification: technical requirements, data rules, migration steps and change requirements (CR-01 to CR-18) that this PRD refers to.
- The four technical documents (Octabuild and Partner, backend and frontend) dated 12 Nov 2026.

## 2. Goals and non-goals

The next release takes the existing platform to production: the `crewnbuild` database layout in place, real payments switched on, trust gaps closed, and every built feature reachable from the apps.

### 2.1 Goals

| # | Goal | Why it matters | Measured by |
|---|---|---|---|
| G1 | Move to database `crewnbuild` with schemas `professional` and `partner`, no data loss | One clear, owned data layout for both products | Row counts match; both health checks green |
| G2 | Take real money: live Razorpay for technician bookings, builder subscriptions and store purchases | Revenue | First live payment receipted (M5, M6) |
| G3 | Only verified technicians reach a customer's home | Safety and trust | Share of offers sent to verified technicians (M9) |
| G4 | No silent data loss between products | Bookings, ratings and earnings are records people rely on | Account deletion keeps Partner history (CR-01) |
| G5 | Every built backend feature is usable from the apps or retired | Users get what was built; less dead code | Endpoints without a caller (CR-11) |
| G6 | Ready for more than one server | Growth without duplicate offers or lost photos | Two-worker test passes (CR-08) |

### 2.2 Non-goals for this release

- Native iOS and Android apps (store links exist; the apps are separate work).
- Countries outside India, and the Arabic interface left over from Kuwait.
- Payment inside Partner: booking payment stays in Professional (decision in CR-03).
- New construction modules beyond those already built.
- A full Partner admin console; only the identity-review screen is in scope (CR-04).

## 3. Personas

Seven personas use the platform; the House Owner and the Builder carry the business, since one pays for the project and the other pays a subscription.

| Persona | Product | Role in system | Main need | Pays? |
|---|---|---|---|---|
| House Owner | Professional + Partner | `OWNER` | Find a builder, agree a price, see where the money goes, see the site, book repairs | Project spend; technician bookings |
| Builder | Professional | `CONTRACTOR` | Win projects, run teams and suppliers, track daily cost, show a portfolio | Subscription (PROFESSIONAL or BUSINESS) |
| Site Engineer | Professional + Partner | `ENGINEER` (site category) | Record each day's work, order material, labour and equipment, book technicians | No |
| Store Manager | Professional | `ENGINEER` (store category) | Keep stock right, issue to sites, buy shortfalls, record payments | Supplier purchases |
| Supplier | Professional | `SUPPLIER` (material, labor or equipment) | List products and services, receive and fulfil requests | No (receives payment) |
| Technician | Partner | Partner account | Steady nearby jobs, clear prices, quick payout | Commission deducted from earnings |
| Administrator | Professional | `GLOBAL_SUPER_ADMIN`, `LOCATION_SUPER_ADMIN`, `MANAGER` | Keep the marketplace safe, curate the catalog, run ads and coupons, answer support | No |

Role `PROFESSIONAL` exists in the database but has no persona or screens yet (open question Q1).

## 4. Core user journeys

Five journeys carry most of the platform's value; each must work end to end before release.

### J1. Owner starts a project and hires a builder

1. Owner signs up with WhatsApp OTP, sets pincode and completes the profile.
2. Owner creates a project (budget, area, floors, photos) and can run the public estimate first.
3. Owner finds nearby builders and sends requests; builders accept or reject.
4. Owner assigns one builder; both negotiate the award by offers until one is confirmed.
5. Owner assigns a Site Engineer and follows progress, daily cost analysis, photos, weather and cameras.

### J2. Site Engineer runs a day on site

1. Engineer opens the daily record and logs labour, material use, purchases, machinery, expenses and payments.
2. Engineer requests material from assigned suppliers, workers from labor suppliers and equipment from equipment suppliers.
3. Engineer asks the Store Manager for stock from the site store.
4. At the daily cut-off the record locks; the builder may make an audited adjustment.

### J3. Store Manager keeps the store

1. Store Manager approves a Site Engineer request and issues it, in parts if stock is short.
2. For the shortfall, the Store Manager sees the builder's suppliers that sell it, checks out and pays with Razorpay.
3. Goods arrive in parts; each receipt adds stock once, and every change is in the ledger.
4. Payments are recorded with a permanent transaction ID.

### J4. Builder subscribes

1. Builder picks a plan at sign-up, applies a coupon and pays.
2. The plan badge shows on the builder's profile cards.
3. Reminders arrive before expiry; the builder renews from any device, even after closing the browser mid-payment.

### J5. Owner or Site Engineer books a technician

1. In Professional, the user taps **Book Technician**; Partner opens already signed in through the hand-off.
2. User picks a trade and service at a fixed price, pins the address, adds problem photos and books.
3. Nearby verified technicians get the offer; the first to accept takes the job.
4. User tracks the technician live, gives the start code on arrival, and follows checklist and photos.
5. Technician submits the work bill and completes; user pays (CR-03) and rates the job.
6. Technician sees the earning, net of commission, in Partner.

## 5. Features — CREWNBUILD Professional

Most Professional features are live; this release changes six of them and finishes the screens for three. Priority: **P0** must ship in this release, **P1** should, **P2** may wait. Status: **Live** works today, **Change** works but must change, **Finish** backend exists but the app does not use it.

| ID | Feature | User story | Priority | Status |
|---|---|---|---|---|
| P-01 | Sign-up and sign-in | As any user, I sign up with WhatsApp OTP or e-mail and sign in by password, OTP, Google or Microsoft, so I can start without friction. | P0 | Change: sign-in must not reveal registered numbers (CR-12) |
| P-02 | Role profiles | As a user, I complete my role's profile, pincode area and category once, so others can find and trust me. | P0 | Live |
| P-03 | Projects | As an owner, I create and edit a project with budget, area, floors and photos, so builders know what I need. | P0 | Live |
| P-04 | Requests and awards | As an owner and a builder, we send requests and negotiate an award by offers until one is confirmed, so the price is agreed in writing. | P0 | Live |
| P-05 | Teams | As a builder, I invite engineers, assign them and specialists to projects, and assign suppliers to engineers. | P0 | Change: duplicate supplier route (CR-07) |
| P-06 | Daily site records | As a site engineer, I record each day's labour, material, purchases, machinery, expenses and payments, so the owner sees real cost. | P0 | Live |
| P-07 | Owner analysis | As an owner, I see spend by category and progress per project, so I spot overruns early. | P0 | Live |
| P-08 | Master catalog | As an admin, I curate categories, subcategories, brands, products, variants and images, so every supplier lists the same product the same way. | P1 | Finish: subcategory edit, category, subcategory and brand images (CR-11) |
| P-09 | Supplier listings and shop | As a supplier, I list catalog products at my price with bulk tiers; as a buyer, I add to a project cart and send a purchase request. | P0 | Live |
| P-10 | Labor and equipment supply | As an engineer, I request workers and equipment from my assigned suppliers and log daily attendance and usage. | P1 | Live |
| P-11 | Store Manager | As a store manager, I keep stock with a ledger, issue to sites in parts, buy shortfalls with Razorpay and record payments. | P0 | Live |
| P-12 | Builder subscriptions | As a builder, I buy a plan with a coupon and renew before expiry, so I keep my badge and limits. | P0 | Change: live payments (CR-05); recover-payment screen (CR-11) |
| P-13 | Technician booking payment | As an owner or site engineer, I pay for a completed technician booking and get a receipt. | P0 | Change: link to Partner bookings (CR-03), live payments (CR-05) |
| P-14 | Live cameras | As a project member, I verify the site recorder once and watch live and recorded video. | P1 | Finish: device management screens (CR-11) |
| P-15 | Weather | As a site team, we see forecasts and get alerts for each site and my own location. | P1 | Live |
| P-16 | Messaging and notifications | As any user, I chat one to one and get notifications, live. | P0 | Live |
| P-17 | Property listings | As a seller, I list a property and receive enquiries; as a buyer, I browse published listings. | P2 | Live |
| P-18 | Reports | As a user, I report an account or project; as an admin, I resolve it. | P1 | Finish: reporting screen (CR-11) |
| P-19 | Support and contact | As a visitor or user, I raise a ticket with an attachment and follow replies. | P1 | Live |
| P-20 | Ads and coupons | As an admin, I run ads on named screens and coupons for subscriptions, with stats. | P2 | Live |
| P-21 | Calculators and Vastu | As a visitor, I use construction, finance and Vastu calculators, including floor-plan analysis. | P2 | Live |
| P-22 | Languages | As a user, I use the app in English, Hindi, Telugu, Tamil, Kannada or Malayalam. | P1 | Change: fill missing Indian-language keys; remove Arabic (CR-13) |
| P-23 | Account deletion | As a user, I delete my account; as a visitor, I request deletion from the public page. | P0 | Change: keep Partner history (CR-01); finish public request (CR-11) |
| P-24 | Administration | As an admin, I manage users, verification, administrators, audit log and announcements within my scope. | P0 | Live |

## 6. Features — CREWNBUILD Partner

Partner's booking, dispatch and job flow is live; this release makes identity verification mandatory and finishes two requester features. Priority and status as in section 5.

### 6.1 Technician

| ID | Feature | User story | Priority | Status |
|---|---|---|---|---|
| T-01 | Registration and sign-in | As a technician, I register with my e-mail and a code and sign in with a password. | P0 | Change: decide on e-mail-code sign-in (CR-10) |
| T-02 | Identity verification | As a technician, I submit Aadhaar and a face capture; as a reviewer, I approve or reject them in a screen, so only verified people get jobs. | P0 | Change: verification required; reviewer screen (CR-04) |
| T-03 | Work preferences | As a technician, I choose my services, a radius of 2, 5, 10 or 15 km and weekly working hours, so I only get jobs I want. | P0 | Live |
| T-04 | Availability and location | As a technician, I go Available, Paused or Offline, and share my location while available. | P0 | Live |
| T-05 | Live offers | As a technician, I hear and see a new offer at once and accept or decline it within 30 seconds. | P0 | Live |
| T-06 | Navigation | As a technician, I see the route and distance to the customer. | P0 | Live |
| T-07 | Job execution | As a technician, I enter the customer's start code, tick the checklist, take before and after photos, keep notes and run a timer. | P0 | Live |
| T-08 | Work bill | As a technician, I add materials and extra labour with photos and attachments and submit the bill. | P0 | Live |
| T-09 | Hand back a job | As a technician, I can hand back a job before arrival, and it is re-dispatched. | P1 | Live |
| T-10 | Earnings and payout account | As a technician, I see each job's gross, commission and net, and keep one payout bank account. | P0 | Live |
| T-11 | Weather | As a technician, I see weather for my job or location. | P2 | Live |

### 6.2 Requester (House Owner or Site Engineer)

| ID | Feature | User story | Priority | Status |
|---|---|---|---|---|
| T-12 | Hand-off sign-in | As an owner or site engineer, I open Partner from Professional without another password. | P0 | Change: works for phone-only users (CR-02) |
| T-13 | Service catalog | As a requester, I pick a trade and a fixed-price service or consultation. | P0 | Live |
| T-14 | Book with location and photos | As a requester, I pin the address, describe the problem and add photos. | P0 | Finish: problem-photo upload (CR-09) |
| T-15 | Live tracking | As a requester, I watch the technician's position and ETA. | P0 | Live |
| T-16 | Start code | As a requester, I give a one-time code so work starts only when I am there. | P0 | Live |
| T-17 | Progress, bill and rating | As a requester, I follow progress, see the work bill and rate the job once. | P0 | Live |
| T-18 | Cancel and retry | As a requester, I cancel before arrival, or retry when nobody was found. | P0 | Live |
| T-19 | Pay for the job | As a requester, I pay for the completed booking and get a receipt. | P0 | Change: link to Professional payments (CR-03) |
| T-20 | Sign out | As a requester on a shared phone, I end my booking session. | P1 | Finish: sign-out button (CR-09) |
| T-21 | My bookings and history | As a requester, my bookings and ratings stay even if I later delete my Professional account. | P0 | Change: no cascade delete (CR-01) |

## 7. Platform and data requirements

Both products run on one PostgreSQL database, `crewnbuild`, with one schema each. Every Octabuild table moves into `professional`; `partner` is unchanged.

| Item | Requirement |
|---|---|
| Database | `crewnbuild` (test: `crewnbuild_test`) |
| Schema `professional` | All 98 former `octabuild` tables. Written only by the Professional API. |
| Schema `partner` | 22 tables. Written only by the Partner API. |
| Shared reads | Partner reads only `professional.users` and `professional.engineer_profiles`, read-only. |
| Cross-product link | A Partner booking keeps the Professional user ID of who booked it; deleting that user must not delete the booking (CR-01). |
| Migrations | Each product migrates only its own schema and keeps its own version table inside it. |
| Access | One database user per product: `crewnbuild_professional`, `crewnbuild_partner`. |
| Architecture | Two independent services (API + web app each). They link only by the signed Book Technician hand-off and Partner's read-only access. |
| Security | HttpOnly cookie sessions with rotation and CSRF protection; personal data (Aadhaar, face, bank, camera passwords) encrypted; API docs hidden in production (CR-06). |
| Scale | Background jobs run once across servers; Partner photos on shared storage (CR-08). |
| Market | India only: INR, +91, Indian pincodes, India time. |

The migration steps, SQL and verification list are in section 11 of the Software Requirements Specification.

## 8. Success metrics

Every metric is computed from tables already in `crewnbuild`, so no new tracking is needed to start. Fixed targets are set where the answer is absolute; growth targets are left for the product owner to set after the first month of baseline (Q4).

| ID | Metric | Definition | Source tables | Target |
|---|---|---|---|---|
| M1 | Migration integrity | Rows per table after the move ÷ rows before | All tables | 100% |
| M2 | Owner activation | Owners who create a project within 7 days of sign-up ÷ owner sign-ups | `professional.users`, `projects` | Set after baseline |
| M3 | Award conversion | Projects with a confirmed award ÷ projects with at least one accepted request | `projects`, `requests`, `project_awards` | Set after baseline |
| M4 | Daily record coverage | Active project days with a daily record ÷ active project days | `daily_site_records` | Set after baseline |
| M5 | Subscription revenue | Sum of paid live subscription payments per month | `subscription_payments` | First live payment, then set |
| M6 | Booking payment rate | Completed bookings with a paid order ÷ completed bookings | `partner.service_requests`, `payment_orders` | Set after baseline |
| M7 | Booking fill rate | Bookings that reach ACCEPTED ÷ bookings created | `partner.service_requests` | Set after baseline |
| M8 | Time to accept | Median of `accepted_at` − `created_at` | `partner.service_requests` | Set after baseline |
| M9 | Verified offers | Offers sent to identity-verified technicians ÷ all offers | `service_request_assignments`, `identity_verifications` | 100% |
| M10 | Job completion rate | COMPLETED ÷ ACCEPTED bookings | `partner.service_requests` | Set after baseline |
| M11 | Customer rating | Average stars per completed job | `service_request_ratings` | Set after baseline |
| M12 | Technician hand-backs | Assignments ended TECHNICIAN_CANCELLED ÷ accepted assignments | `service_request_assignments` | Set after baseline |

**Guardrails:** zero duplicate offers or reminders with two workers running (CR-08); zero Partner bookings lost to an account deletion (CR-01); zero writes from Partner into `professional`.

## 9. Release plan

The platform launches to production after phase 2, on a single server per product; phases 3 and 4 follow, and phase 4 must finish before adding a second server. Dates are not set yet; each phase ends at a gate, not a date.

> [Figure: Release plan · 4 phases, launch gate after phase 2]

Figure text:

- Launch after phase 2; phases 3 and 4 finish and scale the product
- Phase 1 · Foundation
  - Move to database crewnbuild, schemas professional and partner; stop cascade deletes (CR-01)
  - Partner handles phone-only users (CR-02); hide Partner API docs (CR-06); remove duplicate route (CR-07)
- Gate: every row migrated (M1 = 100%), both health checks green, all test suites pass
- Phase 2 · Trust and money
  - Identity verification required, with a reviewer screen (CR-04); safe phone sign-in (CR-12)
  - Link booking payments to Partner (CR-03) and switch Razorpay to live (CR-05); decide Q2 and Q6
- Launch gate: first live payment receipted; 100% of offers to verified technicians (M9)
- Phase 3 · Complete the product
  - Requester sign-out and problem photos (CR-09); e-mail-code decision (CR-10); missing screens (CR-11)
  - Legacy clean-up and Indian-language gaps (CR-13); PROFESSIONAL role and six-month plan (CR-14, CR-15)
- Gate: no backend endpoint without a caller, except links, webhooks and health
- Phase 4 · Scale
  - Background jobs run once across servers; Partner photos on shared storage (CR-08)
  - Hosted map and routing servers; pinned packages, named constraints, test commands (CR-16, CR-17)
- Gate: two-worker test passes with zero duplicate offers or reminders

Each phase starts only when the gate above it is met. CR numbers refer to section 12 of the Software Requirements Specification.

## 10. Risks, dependencies and assumptions

The biggest risk is the database move, because both products stop while it runs; a tested rollback keeps it reversible.

### 10.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Schema rename misses a hard-coded `octabuild` reference | Errors after release | Search code, seeds and tests for `octabuild`; rehearse on `crewnbuild_test`; rollback plan |
| Live payments go wrong | Lost or double charges | Server-side verification and webhooks already in place; one paid order per booking; start with a small pilot |
| Too few verified technicians once verification is required | Low booking fill rate (M7) | Reviewer screen and review time per technician agreed before switching on (CR-04) |
| Duplicate dispatch with several servers | Two technicians sent to one job | Single-run background jobs (CR-08) before scaling out |
| Public map and routing servers limit traffic | Booking map and ETA fail | Hosted or self-run Nominatim and OSRM before launch |
| Account deletion cascades into Partner | Lost bookings, ratings, bills | Change the link to RESTRICT and anonymise instead (CR-01) |

### 10.2 Dependencies

- Razorpay live account and keys for Professional.
- Dovesoft WhatsApp templates approved for OTP and welcome messages.
- S3 buckets (India region) for Professional, and shared storage for Partner photos.
- Hosting for two APIs, two web apps and PostgreSQL, with HTTPS.

### 10.3 Assumptions

- The current Octabuild data moves as-is; no data is cleaned or merged during the rename.
- Booking payment stays in Professional; Partner only shows paid status.
- Platform commission is a single rate (`PARTNER_COMMISSION_RATE_PERCENT`) for all trades.

## 11. Open questions

Eight decisions are needed from the product owner; Q2 and Q6 block release because they decide how money moves.

- [ ] **Q1** Role `PROFESSIONAL`: who is it for, and does it get a dashboard, or is it removed? (CR-14)
- [ ] **Q2** Technician booking payment: who pays (owner, site engineer, or the site engineer's builder), when (before work or after completion), and does the work bill change the amount? (CR-03)
- [ ] **Q3** Should builders be able to choose the six-month plan at sign-up, as they can when renewing? (CR-15)
- [ ] **Q4** Growth targets for M2–M8 and M10–M12, set after one month of baseline.
- [ ] **Q5** Do technicians need e-mail-code sign-in, or is password sign-in enough? (CR-10)
- [ ] **Q6** Technician payouts: earnings are recorded and bank accounts saved, but nothing pays technicians yet. Manual payouts, or a payout provider? What commission rate?
- [ ] **Q7** Confirm removal of the Arabic interface and other Kuwait-era items. (CR-13)
- [ ] **Q8** Public delete-account page: should a visitor submit a request without signing in, or must they sign in? (CR-11)
