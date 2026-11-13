/**
 * The neutral screen a protected route shows while the server confirms the session
 * (section 8.1): nothing private, nothing that could flash and disappear.
 */
export default function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-oc-paper" role="status" aria-label="Loading">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-oc-green/20 border-t-oc-green" />
    </div>
  )
}
