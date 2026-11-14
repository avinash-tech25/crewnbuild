# Coverage: the old Professional web app in the new one (R7)

Every page and address of the old app (`Kuwait-Version/Octabuild/frontend 7/frontend`, read from its `AppRouter.jsx` and from the URL parsers of each dashboard) and where it is now. Addresses are unchanged: `/contractor/*` keeps its path though the role is `BUILDER` now. Every route has an explicit access rule (`src/app/router/routes.jsx`, FE-01, tested); a page not moved yet answers at its address, behind the access rule it will have, with a placeholder naming the part that brings it.

## Totals

| | Count |
| --- | --- |
| Old top-level routes | 37 (including `/404` and `*`) |
| Kept in the new route table | 37 |
| Ported in part 1 | 28 |
| Ported in part 2 (House Owner, weather) | 2 top-level routes (`/owner/*` with all its sections, `/weather`) |
| Ported in part 3 (Builder) | 2 top-level routes (`/contractor/*` with all its sections, `/contractors/:contractorId`) |
| Ported in part 4 (Site Engineer, live camera, Store Manager) | 3 top-level routes (`/engineer/*`, `/engineer/live-camera`, `/store-manager/*`) |
| Ported in part 5 (Supplier) | 1 top-level route (`/supplier/*` with all its sections) |
| Placeholders (later parts) | 1 top-level route: the admin console |
| Old addresses missing | 0 |

## Part 1: ported

| Old address | New page (src/) | Access |
| --- | --- | --- |
| `/` (signs the visitor out, as before) | `features/public-site/pages/HomePage.jsx` | public |
| `/about` | `features/public-site/pages/AboutPage.jsx` | public |
| `/services` | `features/public-site/pages/ServicesPage.jsx` | public |
| `/projects` | `features/public-site/pages/ProjectsPage.jsx` | public |
| `/why-us` | `features/public-site/pages/WhyChooseUsPage.jsx` | public |
| `/process` | `features/public-site/pages/ProcessPage.jsx` | public |
| `/testimonials` | `features/public-site/pages/TestimonialsPage.jsx` | public |
| `/contact` | `features/public-site/pages/ContactPage.jsx` | public |
| `/coming-soon` | `features/public-site/pages/ComingSoonPage.jsx` | public |
| `/estimate` (estimate and the 13 calculators) | `features/estimate/pages/CalculatorHubPage.jsx` | public |
| `/contact-us` | `features/support/pages/ContactUsPage.jsx` | public |
| `/contact-us/tickets`, `/contact-us/tickets/:reference` | `features/support/pages/SupportTicketsPage.jsx` (asks for sign-in itself) | public |
| `/delete-account`, `/owner/profile/delete` | `features/accounts/pages/DeleteAccountPage.jsx` | public |
| `/login` (opening it signs out, as before) | `features/auth/pages/LoginPage.jsx` (password and WhatsApp OTP) | public |
| `/signup` | `features/auth/pages/SignupPage.jsx` (e-mail code, WhatsApp check, plan step) | public |
| `/forgot-password` | `features/auth/pages/ForgotPasswordPage.jsx` | public |
| `/account-recovery` (development only) | `features/auth/pages/AccountRecoveryPage.jsx` | public |
| `/invite/:code` | `features/auth/pages/InviteLandingPage.jsx` | public |
| `/oauth/callback` (Google, Microsoft) | `features/auth/pages/OAuthCallbackPage.jsx` | public |
| `/supplier-category` | `features/onboarding/pages/SupplierCategoryPage.jsx` | SUPPLIER |
| `/engineer-category` | `features/onboarding/pages/EngineerCategoryPage.jsx` | engineers |
| `/pincode` | `features/onboarding/pages/PincodeSetupPage.jsx` | marketplace roles |
| `/complete-profile` | `features/onboarding/pages/CompleteProfilePage.jsx` | marketplace roles |
| `/subscription-checkout` | `features/billing/pages/SubscriptionCheckoutPage.jsx` | BUILDER |
| `/404`, any unknown address | `features/public-site/pages/NotFoundPage.jsx` | public |

Also in part 1: the Partner hand-off (`features/partner-booking/`, message names `PARTNER_BOOKING_READY` and `OCTABUILD_HOUSE_OWNER_HANDOFF` unchanged) and `<Can>` / `usePermission` for role-aware buttons.

## Part 2: ported (House Owner, weather)

| Old address | New page (src/) | Access |
| --- | --- | --- |
| `/owner` (overview: services, technicians, materials, activity, deadlines, project status, budgets, technician payments) | `features/owner/pages/OwnerDashboardPage.jsx` | OWNER |
| `/owner/projects` (list, create, edit, delete, analysis) | same page, `features/owner/components/OwnerProjectViews.jsx` | OWNER |
| `/owner/projects/:projectId` and `/dashboard`, `/requests`, `/suppliers`, `/builders`, `/escrow` (find builders, requests, assign builder and negotiation, site activity, project analysis, live camera, overview, escrow, payments, suppliers and material orders, the self-construction site engineer) | same page, `features/owner/components/OwnerProjectWorkspace.jsx` | OWNER |
| `/owner/buy-sell` | same page, `features/property/components/PropertyBuySellHub.jsx` | OWNER |
| `/owner/messages` | same page, `features/messaging/components/MessageThread.jsx` | OWNER |
| `/owner/profile` | same page, `features/owner/components/OwnerSections.jsx` | OWNER |
| `/weather` | `features/weather/pages/WeatherPage.jsx` | every signed-in role (builders after checkout) |

The owner dashboard brought the shared pieces later dashboards reuse: the dashboard shell
(`shared/dashboard/`), messaging, notifications and the live-events socket, requests and
awards, property, shop and cart, catalog, cameras, site work, and the API modules for
projects, requests, messages, notifications, property, engineers, cameras, cart, catalog,
supplier products, material requests, the cost tool, labour, equipment and technician
payments.

## Part 3: ported (Builder)

The role is `BUILDER`; the addresses keep `/contractor`, as the old app had them.

| Old address | New page (src/) | Access |
| --- | --- | --- |
| `/contractor` (overview: figures, projects by category, recent requests, quick actions, progress, requests by status, budgets) | `features/builder/pages/BuilderDashboardPage.jsx` | BUILDER (after checkout) |
| `/contractor/projects` (current, previous, upcoming; project workspace with site activity, team, suppliers, analysis, live camera) | same page, `features/builder/components/BuilderProjectViews.jsx` | BUILDER |
| `/contractor/portfolio` (Professional plan; locked Premium feature otherwise, as before) | same page, `features/billing/subscription/BuilderPortfolioSection.jsx` | BUILDER |
| `/contractor/subscription` (plan and billing, plans, coupons, payment history) | same page, `features/billing/subscription/BuilderSubscriptionPanel.jsx` | BUILDER |
| `/contractor/requests` (House Owner, Supplier and Store Manager requests; quotations, awards) | same page, `features/builder/components/BuilderRequestViews.jsx` | BUILDER |
| `/contractor/my-site-engineers` (My Partners: site engineers, find site engineers, suppliers, pending requests) | same page, `features/builder/components/BuilderTeamSections.jsx` | BUILDER |
| `/contractor/find-clients` (nearby projects, owners and suppliers; send request with an optional quotation) | same page, `features/builder/components/BuilderFindClients.jsx` | BUILDER |
| `/contractor/buy-sell` | same page, `features/property/components/PropertyBuySellHub.jsx` | BUILDER |
| `/contractor/product-catalog` | same page, `features/shop/components/ProductCatalogPage.jsx` | BUILDER |
| `/contractor/messages` | same page, `features/messaging/components/MessageThread.jsx` | BUILDER |
| `/contractor/profile-settings` | same page, `features/builder/components/BuilderProfileSettings.jsx` | BUILDER |
| `/contractors/:contractorId` (a builder's public profile; the same component is the profile pop-up) | `features/builder/components/BuilderProfileDetails.jsx` | OWNER, BUILDER, SUPPLIER (builders after checkout) |

Plan-gated features show exactly as before: the portfolio, project CSV reports, cost
corrections and HD camera video come from the server's answer (`GET /subscriptions/me`
and the 403 with `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED`), with the same
locked cards and badges.

## Part 4: ported (Site Engineer, live camera, Store Manager)

`/engineer/*` and `/engineer/live-camera` are for every engineer but a Store Manager, and
`/store-manager/*` for Store Managers only, as before. Of the engineer categories, only a
Site Engineer may book a technician (the hand-off permission) or be hired and assigned as
a project's site engineer; the server enforces both, and Book Technician is shown only to
a Site Engineer.

| Old address | New page (src/) | Access |
| --- | --- | --- |
| `/engineer` (overview: budgets, costs, daily spend, site activity, recent activity, materials) | `features/engineer/pages/EngineerDashboardPage.jsx` | engineers but Store Manager |
| `/engineer/my-projects`, `/calendar`, `/daily-logs` (projects, site log and daily cost register) | same page, `features/engineer/components/EngineerSections.jsx`, `features/site-work/` | engineers but Store Manager |
| `/engineer/my-supplies` (suppliers, orders, labour, equipment) | same page, `features/engineer/components/EngineerSupplierHub.jsx` | engineers but Store Manager |
| `/engineer/store-requests` | same page, `features/engineer/components/EngineerStoreRequestsSection.jsx` | engineers but Store Manager |
| `/engineer/find-opportunities` (join team, requests, builders, opportunities) | same page | engineers but Store Manager |
| `/engineer/messages`, `/notifications`, `/profile` | same page | engineers but Store Manager |
| `/engineer/live-camera` (live and recorded, first-time recorder verification) | `features/cameras/pages/EngineerLiveCameraPage.jsx` | engineers but Store Manager |
| `/store-manager` (overview) | `features/store/pages/StoreManagerDashboardPage.jsx` | STORE\_MANAGER |
| `/store-manager/catalog`, `/buy`, `/payments`, `/requests`, `/approvals`, `/builders`, `/messages`, `/notifications`, `/profile` | same page, `features/store/components/` | STORE\_MANAGER |

Camera passwords: typed into a password field, sent once in the request body, cleared
from the form after every attempt, and never put in the store, browser storage or a URL
(tested). Store purchases are priced by the server and paid through the existing Razorpay
client; the simulated checkout appears only when the server chooses it, which it does
only outside production with `RAZORPAY_ALLOW_MOCK=true`.

## Part 5: ported (Supplier)

The sections follow the supplier's category, as before: a Material Supplier has Products
(the storefront) and Orders; a Labor Supplier has Labor Services and Assignments; an
Equipment Supplier has Equipment Inventory and Assignments. A section another category
does not have sends back to the dashboard. Listings and orders are the supplier's own:
the screens call only the supplier's endpoints and never send a supplier id; the server
enforces it.

| Old address | New page (src/) | Access |
| --- | --- | --- |
| `/supplier` (overview by category) | `features/supplier/pages/SupplierDashboardPage.jsx` | SUPPLIER |
| `/supplier/products` (storefront: listings, add from the catalog, edit, publish, delete, bulk pricing) | same page, `features/storefront/components/SupplierStorefront.jsx`, `features/supplier/components/SupplierCatalogPicker.jsx` | SUPPLIER (Material) |
| `/supplier/orders` (Site Engineer, Store Manager and owner orders) | same page, `features/supplier/components/SupplierMaterialRequests.jsx`, `SupplierPurchaseRequests.jsx` | SUPPLIER (Material) |
| `/supplier/labor-services`, `/supplier/assignments` | same page, `features/labour/components/SupplierLaborSections.jsx` | SUPPLIER (Labor) |
| `/supplier/equipment`, `/supplier/equipment-assignments` | same page, `features/equipment/components/SupplierEquipmentSections.jsx` | SUPPLIER (Equipment) |
| `/supplier/my-projects`, `/find-clients`, `/requests`, `/messages`, `/profile` | same page, `features/supplier/components/` | SUPPLIER |

## Later parts: placeholders now

| Old address | Sections the old dashboard had (same URLs) | Access | Part |
| --- | --- | --- | --- |
| `/admin/*` | `/admin`, `/users`, `/projects`, `/leads`, `/verification`, `/reports`, `/notifications`, `/admins`, `/ads`, `/audit`, `/catalog`, `/coupons`, `/subscription-payments`, `/account-deletion`, `/support`, `/mobile` | GLOBAL\_SUPER\_ADMIN, LOCATION\_SUPER\_ADMIN, MANAGER | 6 |

## Access, as before and as now

- A signed-out visitor at a protected address goes to `/login` and, after signing in, back to that address (new: the old app always went to the dashboard), unless a step comes first (pincode, builder checkout).
- An account of another role goes to its own home, as before.
- While the server is still confirming the session a protected address shows only a loader.
