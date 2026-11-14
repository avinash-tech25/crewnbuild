# Coverage: the old Partner web app in the new one (R7 part 7)

Every page and address of the old Partner app (`Kuwait-Version/Partner/frontend`, read from its `src/app/router/AppRouter.jsx` and `src/pages/`) and where it is now in `partner/frontend`. Addresses are unchanged.

## MISSING

None. Every old address and page is ported.

Not in the old Partner app, so not here either:

- **Payment of a completed booking (House Owner).** The old Partner app had no payment screen. Paying a technician for a completed booking is in the Professional app (House Owner dashboard, `TechnicianPaymentsSection`, ported in R7 part 2), against the Professional backend's payments API.
- **Messages.** The phone bottom bar shows "Messages — Soon", switched off, as before. There is no feature behind it.

## Totals

| | Count |
| --- | --- |
| Old routes | 13 (including `/onboarding/*` and `*`) |
| Kept in the new route table | 13 |
| Old page and section files (`src/pages/**`) | 44 |
| Ported | 44 |
| Placeholders | 0 |

## Routes

| Old address | New page (src/) | Access | Status |
| --- | --- | --- | --- |
| `/` | `features/site/pages/LandingPage.jsx` | public | ported |
| `/login` | `features/auth/pages/LoginPage.jsx` | guests only (a signed-in technician goes to `/dashboard`) | ported, tested |
| `/forgot-password` | `features/auth/pages/ForgotPasswordPage.jsx` | guests only | ported, tested |
| `/register` | `features/auth/pages/RegisterPage.jsx` | public | ported, tested |
| `/onboarding` | `features/onboarding/pages/OnboardingPage.jsx` (face, Aadhaar, profile steps) | registration (onboarding) session | ported, tested |
| `/onboarding/*` | redirect to `/onboarding` | — | ported |
| `/dashboard` | `features/technician/pages/TechnicianDashboardPage.jsx` | technician session, onboarding complete | ported, tested |
| `/weather` | `features/weather/pages/WeatherPage.jsx` | technician session | ported, tested (access) |
| `/book-technician` | `features/booking/pages/BookTechnicianPage.jsx` | booking (requester) session from the Professional hand-off | ported, tested |
| `/book-technician/:typeSlug` | `features/booking/pages/ServiceListPage.jsx` | booking session | ported |
| `/book-technician/:typeSlug/:serviceSlug` | `features/booking/pages/BookServicePage.jsx` | booking session | ported, tested |
| `/book-technician/bookings/:bookingId` | `features/booking/pages/BookingTrackerPage.jsx` | booking session | ported, tested |
| `*` | `features/site/pages/NotFoundPage.jsx` | public | ported, tested |

The two principals never mix: technician pages are guarded by `RequireTechnician` (technician session only; a registration session goes to `/onboarding`), booking pages by `useRequesterSession` (booking session only, from the hand-off or `GET /requester/session`). A signed-in technician who opens a booking page without a hand-off sees "Start from your CREWNBUILD dashboard" (tested).

## Page and section files

| Old file (`src/pages/`) | New file (`src/features/`) | Status |
| --- | --- | --- |
| `auth/AuthLayout.jsx` | `auth/components/AuthLayout.jsx` | ported |
| `auth/LoginPage.jsx` | `auth/pages/LoginPage.jsx` | ported |
| `auth/ForgotPasswordPage.jsx` | `auth/pages/ForgotPasswordPage.jsx` | ported |
| `auth/RegisterPage.jsx` | `auth/pages/RegisterPage.jsx` | ported |
| `auth/OnboardingPage.jsx` | `onboarding/pages/OnboardingPage.jsx` | ported |
| `auth/onboarding/FaceStep.jsx` | `onboarding/components/FaceStep.jsx` | ported |
| `auth/onboarding/AadhaarStep.jsx` | `onboarding/components/AadhaarStep.jsx` | ported |
| `auth/onboarding/ProfileStep.jsx` | `onboarding/components/ProfileStep.jsx` | ported |
| `auth/onboarding/OnboardingStepper.jsx` | `onboarding/components/OnboardingStepper.jsx` | ported |
| `site/LandingPage.jsx` | `site/pages/LandingPage.jsx` | ported |
| `site/NotFound.jsx` | `site/pages/NotFoundPage.jsx` | ported |
| `technician/TechnicianDashboard.jsx` | `technician/pages/TechnicianDashboardPage.jsx` | ported |
| `technician/OfferCard.jsx` | `technician/components/OfferCard.jsx` | ported |
| `technician/JobCard.jsx` | `technician/components/JobCard.jsx` | ported |
| `technician/StartWorkOtp.jsx` | `technician/components/StartWorkOtp.jsx` | ported |
| `technician/JobExecution.jsx` | `technician/components/JobExecution.jsx` | ported |
| `technician/JobChecklist.jsx` | `technician/components/JobChecklist.jsx` | ported |
| `technician/JobPhotos.jsx` | `technician/components/JobPhotos.jsx` | ported |
| `technician/ServiceNotes.jsx` | `technician/components/ServiceNotes.jsx` | ported |
| `technician/JobNavigation.jsx` | `technician/components/JobNavigation.jsx` | ported |
| `technician/JobTimeline.jsx` | `technician/components/JobTimeline.jsx` | ported |
| `technician/JobTimer.jsx` | `technician/components/JobTimer.jsx` | ported |
| `technician/LiveLocationStatus.jsx` | `technician/components/LiveLocationStatus.jsx` | ported |
| `technician/WorkBill.jsx` | `technician/components/WorkBill.jsx` | ported |
| `technician/BillItemForm.jsx` | `technician/components/BillItemForm.jsx` | ported |
| `technician/EarningsPanel.jsx` | `technician/components/EarningsPanel.jsx` | ported |
| `technician/ProfilePanel.jsx` | `technician/components/ProfilePanel.jsx` | ported |
| `technician/WorkPreferencesSection.jsx` | `technician/components/WorkPreferencesSection.jsx` | ported |
| `technician/WorkPreferencesFields.jsx` | `technician/components/WorkPreferencesFields.jsx` | ported |
| `technician/BankAccountSection.jsx` | `technician/components/BankAccountSection.jsx` | ported |
| `technician/ChangePasswordSection.jsx` | `technician/components/ChangePasswordSection.jsx` | ported |
| `technician/VerifiedSuccess.jsx` | `technician/components/VerifiedSuccess.jsx` | ported |
| `technician/TechnicianWeatherIndicator.jsx` | `weather/components/TechnicianWeatherIndicator.jsx` | ported |
| `technician/WeatherPage.jsx` | `weather/pages/WeatherPage.jsx` | ported |
| `booking/BookTechnicianPage.jsx` | `booking/pages/BookTechnicianPage.jsx` | ported |
| `booking/ServiceListPage.jsx` | `booking/pages/ServiceListPage.jsx` | ported |
| `booking/BookServicePage.jsx` | `booking/pages/BookServicePage.jsx` | ported |
| `booking/BookingTrackerPage.jsx` | `booking/pages/BookingTrackerPage.jsx` | ported |
| `booking/BookingShell.jsx` | `booking/components/BookingShell.jsx` | ported |
| `booking/bookingUi.jsx` | `booking/components/BookingUi.jsx` | ported |
| `booking/MyBookings.jsx` | `booking/components/MyBookings.jsx` | ported |
| `booking/JobProgressPanel.jsx` | `booking/components/JobProgressPanel.jsx` | ported |
| `booking/StartWorkOtpCard.jsx` | `booking/components/StartWorkOtpCard.jsx` | ported |
| `booking/RateTechnicianCard.jsx` | `booking/components/RateTechnicianCard.jsx` | ported |

## Tests (`npx vitest run`: 7 files, 61 tests)

| File | What it covers |
| --- | --- |
| `shared/api/apiClient.test.js` | each principal's own CSRF token on writes, single-flight refresh, a refused refresh ends only that principal's session, CSRF recovery, nothing in browser storage |
| `shared/api/endpointNames.test.js` | endpoint names unique; every requester endpoint on the booking client and no technician one |
| `app/router/access.test.jsx` | guards for both principals, session check on load and refresh, sign-in, wrong password, registration, 404 |
| `features/onboarding/onboarding.test.jsx` | camera asked only on Start after consent; face capture sent once with consent, nothing stored; Aadhaar sent once in the body then cleared, checksum refusal; password reset |
| `features/technician/dashboard.test.jsx` | live location only while available, never offline, stopped and forgotten on going offline and on sign-out; job requests (no customer detail, accept, decline, nothing before the server says reachable); start with the customer's code in the body, wrong code; before photo upload in the body, shown from memory; bank account masked, new number sent once; earnings from the server |
| `features/booking/booking.test.jsx` | hand-off by postMessage from the opener only (other origin/window ignored), refused hand-off; booking with the service id and pin, no price; Start Work code and new code; rating; no booking session |
| `features/technician/jobWorkAndProfile.test.jsx` | checklist step and service notes saved on the server; work bill line added, totals from the server, submit and remove only after confirming; work preferences saved as one replacement, none ticked refused; change password sent once and cleared, wrong current password, mismatch checked first; weather page (job location, current, next hours, alerts of WATCH and above; asks for a place without a job location); new-request sound (unavailable, Enable sound then rings for a waiting request, silent with none) |
