import { Home, MapPin, RefreshCw, ShieldAlert } from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'

/**
 * Frame for every booking page. Renders the page only once the the Professional app
 * House Owner or Site Engineer has been verified by the Partner backend.
 *
 * `wide` lets a page use nearly the full window instead of the site's usual
 * content width -- the service list does, so its cards reach the edges. Every
 * other booking page leaves it off and looks exactly as before.
 */
export default function BookingShell({ session, children, wide = false }) {
  const { status, requester, message, reconnect } = session
  const frame = wide ? 'mx-auto w-full max-w-[1800px] px-4 sm:px-6' : 'container-x'

  return (
    <div className="min-h-screen bg-oc-paper">
      <header className="sticky top-0 z-20 border-b border-oc-line bg-white/90 backdrop-blur-md">
        <div className={`${frame} flex h-16 items-center gap-3`}>
          {/* The landing page's logo and wordmark (the same two files). */}
          <Logo to="/book-technician" wordmark />
          {requester && (
            <div className="ml-auto flex items-center gap-2 text-right">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-oc-deep text-xs font-extrabold text-white">
                {(requester.name || 'OB').slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-sm font-extrabold text-oc-ink">{requester.name}</span>
                <span className="flex items-center justify-end gap-1 text-xs text-oc-muted">
                  {requester.role_label} · <MapPin className="h-3 w-3" /> {requester.pincode ? `PIN ${requester.pincode}` : 'No PIN code on profile'}
                </span>
              </span>
            </div>
          )}
        </div>
      </header>

      <main className={`${frame} py-8`}>
        {status === 'checking' && (
          <div className="flex flex-col items-center gap-3 py-24 text-oc-green" role="status">
            <Spinner className="h-8 w-8" />
            <p className="text-sm font-bold text-oc-muted">Confirming your CREWNBUILD account…</p>
          </div>
        )}

        {status === 'no-opener' && (
          <div className="card mx-auto max-w-lg p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-oc-mint text-oc-green"><Home className="h-6 w-6" /></span>
            <h1 className="mt-4 text-2xl font-extrabold text-oc-deep">Start from your CREWNBUILD dashboard</h1>
            <p className="mt-2 text-sm text-oc-muted">
              Technician booking is for CREWNBUILD House Owners and Site Engineers. Sign in to CREWNBUILD, open your dashboard and click
              <strong className="text-oc-ink"> Book Technician</strong>. This page will open with your account ready.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="card mx-auto max-w-lg space-y-4 p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><ShieldAlert className="h-6 w-6" /></span>
            <h1 className="text-2xl font-extrabold text-oc-deep">We couldn't confirm your account</h1>
            <Alert tone="error">{message}</Alert>
            <button type="button" className="btn-ghost" onClick={reconnect}><RefreshCw className="h-4 w-4" /> Try again</button>
          </div>
        )}

        {status === 'ready' && requester && children}
      </main>
    </div>
  )
}
