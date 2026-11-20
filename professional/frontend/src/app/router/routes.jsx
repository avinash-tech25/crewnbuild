import { lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { ADMIN_ROLES, SIGNED_IN_ROLES } from '../../shared/auth/roles.js'
import { ENGINEER_CATEGORY_PATH, SUPPLIER_CATEGORY_PATH } from '../../shared/auth/accountPaths.js'

/**
 * The one route table (technical-architecture.md 8.2). Every address of the old app is
 * here, with its access rule (FE-01: a route without one fails the tests). Pages are
 * lazy-loaded, so one role's code is not downloaded by another (FE-02). URLs are as
 * before: /contractor/* keeps its path though the role is BUILDER now.
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
const TermsPage = page(() => import('../../features/legal/pages/LegalPage.jsx').then((module) => ({ default: module.TermsPage })))
const PrivacyPage = page(() => import('../../features/legal/pages/LegalPage.jsx').then((module) => ({ default: module.PrivacyPage })))
const LegalHubPage = page(() => import('../../features/legal/pages/LegalHubPage.jsx'))
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
const OwnerDashboardPage = page(() => import('../../features/owner/pages/OwnerDashboardPage.jsx'))
const WeatherPage = page(() => import('../../features/weather/pages/WeatherPage.jsx'))
const BuilderDashboardPage = page(() => import('../../features/builder/pages/BuilderDashboardPage.jsx'))
// The builder profile is a page here and a pop-up on the dashboards (same component).
const BuilderProfilePage = page(() => import('../../features/builder/components/BuilderProfileDetails.jsx'))
const EngineerDashboardPage = page(() => import('../../features/engineer/pages/EngineerDashboardPage.jsx'))
const EngineerLiveCameraPage = page(() => import('../../features/cameras/pages/EngineerLiveCameraPage.jsx'))
const SupplierDashboardPage = page(() => import('../../features/supplier/pages/SupplierDashboardPage.jsx'))
const AdminConsolePage = page(() => import('../../features/admin/pages/AdminConsolePage.jsx'))

const ENGINEERS = ['ENGINEER', 'SITE_ENGINEER']
const MARKETPLACE = ['OWNER', 'BUILDER', 'SUPPLIER', ...ENGINEERS]
// The /engineer dashboard is every engineer.
const ENGINEER_DASHBOARD = ENGINEERS
// The Store Manager role is gone: its old addresses (/store-manager/*) and the Site
// Engineer's Store Requests page open the engineer dashboard instead.
const ToEngineerDashboard = () => <Navigate to="/engineer" replace />
// The routes' roles are the screens' roles (accessRole): every signed-in one.
const EVERY_SIGNED_IN = [...new Set([...SIGNED_IN_ROLES.filter((role) => role !== 'ENGINEER'), ...ENGINEERS])]


export const routes = [
  // ---- public site (ported) ----
  // A signed-in visitor stays signed in here: only the explicit Sign out ends a session.
  { path: '/', Component: HomePage, access: 'public' },
  { path: '/about', Component: AboutPage, access: 'public' },
  { path: '/services', Component: ServicesPage, access: 'public' },
  { path: '/projects', Component: ProjectsPage, access: 'public' },
  { path: '/why-us', Component: WhyChooseUsPage, access: 'public' },
  { path: '/process', Component: ProcessPage, access: 'public' },
  { path: '/testimonials', Component: TestimonialsPage, access: 'public' },
  { path: '/contact', Component: ContactPage, access: 'public' },
  { path: '/contact-us', Component: ContactUsPage, access: 'public' },
  // Terms of Service and Privacy Policy: open to everyone, signed in or not.
  { path: '/legal', Component: LegalHubPage, access: 'public' },
  { path: '/terms', Component: TermsPage, access: 'public' },
  { path: '/privacy', Component: PrivacyPage, access: 'public' },
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
  // ---- dashboards: placeholders until their part ----
  { path: '/owner/*', Component: OwnerDashboardPage, access: { roles: ['OWNER'] } },
  { path: '/weather', Component: WeatherPage, access: { roles: EVERY_SIGNED_IN } },
  { path: '/contractor/*', Component: BuilderDashboardPage, access: { roles: ['BUILDER'] } },
  { path: '/contractors/:contractorId', Component: BuilderProfilePage, access: { roles: ['OWNER', 'BUILDER', 'SUPPLIER'] } },
  { path: '/engineer/live-camera', Component: EngineerLiveCameraPage, access: { roles: ENGINEER_DASHBOARD } },
  { path: '/engineer/store-requests', Component: ToEngineerDashboard, access: { roles: ENGINEER_DASHBOARD } },
  { path: '/engineer/store', Component: EngineerDashboardPage, access: { roles: ['SITE_ENGINEER'] } },
  { path: '/engineer/orders', Component: EngineerDashboardPage, access: { roles: ['SITE_ENGINEER'] } },
  { path: '/engineer/*', Component: EngineerDashboardPage, access: { roles: ENGINEER_DASHBOARD } },
  { path: '/store-manager/*', Component: ToEngineerDashboard, access: { roles: ENGINEER_DASHBOARD } },
  { path: '/supplier/*', Component: SupplierDashboardPage, access: { roles: ['SUPPLIER'] } },
  { path: '/admin/*', Component: AdminConsolePage, access: { roles: ADMIN_ROLES } },
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
  '/store-manager',
  '/admin',
  '/complete-profile',
  '/pincode',
  SUPPLIER_CATEGORY_PATH,
  ENGINEER_CATEGORY_PATH,
  '/weather',
]
