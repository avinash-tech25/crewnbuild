import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchStartOtp, regenerateStartOtp } from '../bookingApi.js'
import { groupedCode } from '../../technician/startOtp.js'

const REFRESH_MS = 10000

function timeOf(value) {
  if (!value) return ''
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * The customer's Start Work code, on their own booking, once the technician has
 * arrived. The technician asks for it and enters it; work cannot start without it.
 *
 * Refreshed on its own while shown, so an expired code is replaced without the
 * customer doing anything. The code is never stored in the browser.
 */
export function StartWorkOtpCard({ bookingId }) {
  const [otp, setOtp] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setOtp(await fetchStartOtp(bookingId))
      setError('')
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Your Start Work code could not be loaded.'))
    }
  }, [bookingId])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const getNewCode = async () => {
    setBusy(true)
    setError('')
    try {
      setOtp(await regenerateStartOtp(bookingId))
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'A new code could not be made. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card overflow-hidden border-oc-green/50 ring-2 ring-oc-green/20" aria-labelledby="start-otp-title" data-testid="start-otp-card">
      <div className="flex items-center gap-2 bg-oc-mint px-5 py-2.5 text-oc-deep">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Technician has arrived</span>
      </div>
      <div className="space-y-4 p-5 text-center sm:p-6">
        <h2 id="start-otp-title" className="flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-oc-muted">
          <KeyRound className="h-4 w-4 text-oc-green" /> Start Work OTP
        </h2>

        {!otp && !error && <div className="flex justify-center py-4 text-oc-green"><Spinner className="h-6 w-6" /></div>}

        {otp?.state === 'READY' && (
          <>
            <p className="font-display text-4xl font-extrabold tracking-[0.25em] text-oc-deep sm:text-5xl" data-testid="start-otp-code" aria-live="polite">
              {groupedCode(otp.code)}
            </p>
            <p className="mx-auto max-w-sm text-sm text-oc-ink">Share this code with the technician only when you are ready for work to begin.</p>
            {otp.expires_at && <p className="text-xs text-oc-muted" data-testid="start-otp-expiry">Valid until {timeOf(otp.expires_at)}. A new code appears here automatically after that.</p>}
          </>
        )}
        {otp?.state === 'LOCKED' && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900" data-testid="start-otp-locked">
            The code was entered wrongly too many times, so it no longer works. Get a new code and give it to the technician.
          </p>
        )}
        {otp?.state === 'RATE_LIMITED' && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">{otp.message}</p>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800" data-testid="start-otp-card-error">{error}</p>}

        {otp?.can_regenerate && (
          <button type="button" className="btn-ghost mx-auto" onClick={getNewCode} disabled={busy} data-testid="start-otp-regenerate">
            {busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} Get a new code
          </button>
        )}
      </div>
    </section>
  )
}

/** After the code has been used: the job has started. */
export function WorkStartedNote() {
  return (
    <section className="card flex items-center gap-3 p-4" data-testid="start-otp-started">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><CheckCircle2 className="h-5 w-5" /></span>
      <div>
        <p className="font-display text-base font-extrabold text-oc-ink">Work started</p>
        <p className="text-sm text-oc-muted">The technician verified your Start Work code. Follow the progress below.</p>
      </div>
    </section>
  )
}
