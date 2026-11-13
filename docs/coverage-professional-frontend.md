# Coverage: the old Professional web app in the new one (R7)

Every page and address of the old app (`Kuwait-Version/Octabuild/frontend 7/frontend`, read from its `AppRouter.jsx` and from the URL parsers of each dashboard) and where it is now. Addresses are unchanged: `/contractor/*` keeps its path though the role is `BUILDER` now. Every route has an explicit access rule (`src/app/router/routes.jsx`, FE-01, tested); a page not moved yet answers at its address, behind the access rule it will have, with a placeholder naming the part that brings it.

## Totals

| | Count |
| --- | --- |
| Old top-level routes | 37 (including `/404` and `*`) |
| Kept in the new route table | 37 |
| Ported in part 1 | 28 |
| Placeholders (later parts) | 9 top-level routes, covering the five dashboards, the admin console, weather, live camera and the builder profile |
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

## Later parts: placeholders now

| Old address | Sections the old dashboard had (same URLs) | Access | Part |
| --- | --- | --- | --- |
| `/owner/*` | `/owner`, `/owner/projects`, `/owner/projects/:projectId` and `/:section` (`requests`, `suppliers`, `builders`, `escrow`), `/owner/buy-sell`, `/owner/messages`, `/owner/profile` | OWNER | 2 |
| `/weather` | | every signed-in role (builders after checkout) | 2 |
| `/contractor/*` | `/contractor`, `/projects`, `/portfolio`, `/subscription`, `/requests`, `/my-site-engineers`, `/find-clients`, `/buy-sell`, `/product-catalog`, `/messages`, `/profile-settings` | BUILDER (after checkout) | 3 |
| `/contractors/:contractorId` | | OWNER, BUILDER, SUPPLIER | 3 |
| `/engineer/*` | `/engineer`, `/my-projects`, `/my-supplies`, `/store-requests`, `/find-opportunities`, `/calendar`, `/daily-logs`, `/messages`, `/notifications`, `/profile` | ENGINEER (not Store Manager) | 4 |
| `/engineer/live-camera` | | ENGINEER (not Store Manager) | 4 |
| `/store-manager/*` | `/store-manager`, `/catalog`, `/buy`, `/payments`, `/requests`, `/approvals`, `/builders`, `/messages`, `/notifications`, `/profile` | STORE\_MANAGER | 4 |
| `/supplier/*` | `/supplier`, `/my-projects`, `/find-clients`, `/requests`, `/products`, `/orders`, `/messages`, `/profile`, `/labor-services`, `/assignments`, `/equipment`, `/equipment-assignments` (the storefront is a view inside) | SUPPLIER | 5 |
| `/admin/*` | `/admin`, `/users`, `/projects`, `/leads`, `/verification`, `/reports`, `/notifications`, `/admins`, `/ads`, `/audit`, `/catalog`, `/coupons`, `/subscription-payments`, `/account-deletion`, `/support`, `/mobile` | GLOBAL\_SUPER\_ADMIN, LOCATION\_SUPER\_ADMIN, MANAGER | 6 |

## Access, as before and as now

- A signed-out visitor at a protected address goes to `/login` and, after signing in, back to that address (new: the old app always went to the dashboard), unless a step comes first (pincode, builder checkout).
- An account of another role goes to its own home, as before.
- While the server is still confirming the session a protected address shows only a loader.
