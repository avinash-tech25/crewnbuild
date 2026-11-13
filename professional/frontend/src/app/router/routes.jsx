import { lazy } from 'react'
import { ADMIN_ROLES, SIGNED_IN_ROLES } from '../../shared/auth/roles.js'
import { ENGINEER_CATEGORY_PATH, STORE_MANAGER_PATH, SUBSCRIPTION_CHECKOUT_PATH, SUPPLIER_CATEGORY_PATH } from '../../shared/auth/accountPaths.js'
import PlannedPage from './PlannedPage.jsx'

/**
 * The one route table (technical-architecture.md 8.2). Every address of the old app is
 * here, with its access rule (FE-01: a route without one fails the tests). Pages are
 * lazy-loaded, so one role's code is not downloaded by another (FE-02). Pages not moved
 * yet answer with a placeholder naming the part that brings them, behind the access rule
 * they will have. URLs are as before: /contractor/* keeps its path though the role is
 * BUILDER now.
 */

const page = (load) => lazy(load)

const HomePage = page(() => import('../../features/public-site/pages/HomePage.jsx'))
const AboutPage = page(() => import('../../features/public-site/pages/AboutPage.jsx'))
const ServicesPage = page(() => import('../../features/public-site/pages/ServicesPage.jsx'))
const ProjectsPage = page(() => import('../../features/public-site/pages/ProjectsPage.jsx'))
const WhyChooseUsPage = page(() => import('../../features/public-site/pages/WhyChooseUsPage.jsx'))
const ProcessPage = page(() => import('../../features/public-site/pages/ProcessPage.jsx'))
const TestimonialsPage = page(() => import('../../features/public-site/pages/TestimonialsPage.jsx'))
const ContactPage = page(() => import('../../features/public-site/pages/ContactPage.jsx'))
const ComingSoonPage = page(() => import('../../features/public-site/pages/ComingSoonPage.jsx'))
const NotFoundPage = page(() => import('../../features/public-site/pages/NotFoundPage.jsx'))
const CalculatorHubPage = page(() => import('../../features/estimate/pages/CalculatorHubPage.jsx'))
const ContactUsPage = page(() => import('../../features/support/pages/ContactUsPage.jsx'))
const SupportTicketsPage = page(() => import('../../features/support/pages/SupportTicketsPage.jsx'))
const DeleteAccountPage = page(() => import('../../features/accounts/pages/DeleteAccountPage.jsx'))
const LoginPage = page(() => import('../../features/auth/pages/LoginPage.jsx'))
const SignupPage = page(() => import('../../features/auth/pages/SignupPage.jsx'))
const ForgotPasswordPage = page(() => import('../../features/auth/pages/ForgotPasswordPage.jsx'))
const AccountRecoveryPage = page(() => import('../../features/auth/pages/AccountRecoveryPage.jsx'))
const InviteLandingPage = page(() => import('../../features/auth/pages/InviteLandingPage.jsx'))
const OAuthCallbackPage = page(() => import('../../features/auth/pages/OAuthCallbackPage.jsx'))
const SupplierCategoryPage = page(() => import('../../features/onboarding/pages/SupplierCategoryPage.jsx'))
const EngineerCategoryPage = page(() => import('../../features/onboarding/pages/EngineerCategoryPage.jsx'))
const PincodeSetupPage = page(() => import('../../features/onboarding/pages/PincodeSetupPage.jsx'))
const CompleteProfilePage = page(() => import('../../features/onboarding/pages/CompleteProfilePage.jsx'))
const SubscriptionCheckoutPage = page(() => import('../../features/billing/pages/SubscriptionCheckoutPage.jsx'))

const ENGINEERS = ['ENGINEER', 'SITE_ENGINEER', 'STORE_MANAGER']
const MARKETPLACE = ['OWNER', 'BUILDER', 'SUPPLIER', ...ENGINEERS]
// The /engineer dashboard is every engineer but a Store Manager, as before.
const ENGINEER_DASHBOARD = ['ENGINEER', 'SITE_ENGINEER']
// The routes' roles are the screens' roles (accessRole): every signed-in one.
const EVERY_SIGNED_IN = [...new Set([...SIGNED_IN_ROLES.filter((role) => role !== 'ENGINEER'), ...ENGINEERS])]

const planned = (title, part) => () => <PlannedPage title={title} part={part} />

export const routes = [
  // ---- public site (ported) ----
  { path: '/', Component: HomePage, access: 'public', signsOut: true },
  { path: '/about', Component: AboutPage, access: 'public' },
  { path: '/services', Component: ServicesPage, access: 'public' },
  { path: '/projects', Component: ProjectsPage, access: 'public' },
  { path: '/why-us', Component: WhyChooseUsPage, access: 'public' },
  { path: '/process', Component: ProcessPage, access: 'public' },
  { path: '/testimonials', Component: TestimonialsPage, access: 'public' },
  { path: '/contact', Component: ContactPage, access: 'public' },
  { path: '/contact-us', Component: ContactUsPage, access: 'public' },
  // My Support Tickets asks for sign-in itself, so a visitor from an acknowledgement e-mail is not bounced.
  { path: '/contact-us/tickets', Component: SupportTicketsPage, access: 'public' },
  { path: '/contact-us/tickets/:reference', Component: SupportTicketsPage, access: 'public' },
  // The account deletion address the app stores use; the page offers its own sign-in.
  { path: '/delete-account', Component: DeleteAccountPage, access: 'public' },
  { path: '/owner/profile/delete', Component: DeleteAccountPage, access: 'public' },
  { path: '/estimate', Component: CalculatorHubPage, access: 'public' },
  { path: '/coming-soon', Component: ComingSoonPage, access: 'public' },
  // ---- sign-in, sign-up, codes, OAuth (ported); opening Login signs out, as before ----
  { path: '/login', Component: LoginPage, access: 'public' },
  { path: '/signup', Component: SignupPage, access: 'public' },
  { path: '/forgot-password', Component: ForgotPasswordPage, access: 'public' },
  // Development only: the page asks the server whether it is on.
  { path: '/account-recovery', Component: AccountRecoveryPage, access: 'public' },
  { path: '/invite/:code', Component: InviteLandingPage, access: 'public' },
  { path: '/oauth/callback', Component: OAuthCallbackPage, access: 'public' },
  // ---- onboarding (ported) ----
  { path: SUPPLIER_CATEGORY_PATH, Component: SupplierCategoryPage, access: { roles: ['SUPPLIER'] } },
  { path: ENGINEER_CATEGORY_PATH, Component: EngineerCategoryPage, access: { roles: ENGINEERS } },
  { path: '/pincode', Component: PincodeSetupPage, access: { roles: MARKETPLACE } },
  { path: '/complete-profile', Component: CompleteProfilePage, access: { roles: MARKETPLACE } },
  { path: SUBSCRIPTION_CHECKOUT_PATH, Component: SubscriptionCheckoutPage, access: { roles: ['BUILDER'] } },
  // ---- dashboards: placeholders until their part ----
  { path: '/owner/*', Component: planned('House Owner dashboard', 2), access: { roles: ['OWNER'] }, part: 2 },
  { path: '/weather', Component: planned('Weather', 2), access: { roles: EVERY_SIGNED_IN, checkout: true }, part: 2 },
  { path: '/contractor/*', Component: planned('Builder dashboard', 3), access: { roles: ['BUILDER'], checkout: true }, part: 3 },
  {
    path: '/contractors/:contractorId',
    Component: planned('Builder profile', 3),
    access: { roles: ['OWNER', 'BUILDER', 'SUPPLIER'], checkout: true },
    part: 3,
  },
  { path: '/engineer/live-camera', Component: planned('Live camera', 4), access: { roles: ENGINEER_DASHBOARD }, part: 4 },
  { path: '/engineer/*', Component: planned('Site Engineer dashboard', 4), access: { roles: ENGINEER_DASHBOARD }, part: 4 },
  { path: `${STORE_MANAGER_PATH}/*`, Component: planned('Store Manager dashboard', 4), access: { roles: ['STORE_MANAGER'] }, part: 4 },
  { path: '/supplier/*', Component: planned('Supplier dashboard', 5), access: { roles: ['SUPPLIER'] }, part: 5 },
  { path: '/admin/*', Component: planned('Admin console', 6), access: { roles: ADMIN_ROLES }, part: 6 },
  // ---- not found ----
  { path: '/404', Component: NotFoundPage, access: 'public' },
  { path: '*', Component: NotFoundPage, access: 'public' },
]

// Addresses only a signed-in account can see: a page restored from the browser's
// back/forward cache after signing out is reloaded so the guard sees there is no session.
export const PROTECTED_PATH_PREFIXES = [
  '/owner',
  '/contractor',
  '/supplier',
  '/engineer',
  STORE_MANAGER_PATH,
  '/admin',
  '/complete-profile',
  '/pincode',
  SUPPLIER_CATEGORY_PATH,
  ENGINEER_CATEGORY_PATH,
  SUBSCRIPTION_CHECKOUT_PATH,
  '/weather',
]
