import BrandLoader from './BrandLoader.jsx'

/**
 * The whole-screen Crew&Build loader: shown while a lazy page loads (the router's Suspense
 * fallback) and while a protected route waits for the server to confirm the session
 * (section 8.1): nothing private, nothing that could flash and disappear.
 */
export default function FullPageLoader() {
  return <BrandLoader variant="page" />
}
