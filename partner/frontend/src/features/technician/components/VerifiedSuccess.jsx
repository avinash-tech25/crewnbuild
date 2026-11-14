import { useEffect, useRef } from 'react'
import { ArrowRight, BadgeCheck, MapPin, Power, ShieldCheck } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { assetUrl } from '../../../shared/api/apiClient.js'

/**
 * "You're verified": shown once, over the dashboard, the first time it sees the
 * account verified under the CURRENT rules (a reviewer marked both face and
 * Aadhaar VERIFIED -- isVerifiedProfessional). It adds no requirement and
 * decides nothing: it only says what the account already is.
 *
 * "Go available" is the dashboard's own availability toggle, so the same server
 * call and the same location rules apply. "Receive jobs" is claimed only when the
 * dashboard summary says this account can receive them.
 */
export default function VerifiedSuccess({ user, typeMeta, available, saving, canReceiveJobs, onGoAvailable, onContinue }) {
  const continueRef = useRef(null)
  useEffect(() => { continueRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onContinue() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onContinue])
  const trade = typeMeta?.label || 'Technician'
  const photo = user?.profile_image_url ? assetUrl(user.profile_image_url) : null

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-oc-deep/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verified-title"
      data-testid="verified-success"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-white text-center shadow-2xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_50%_0%,rgba(95,182,130,.35),transparent_65%)]" />
          <div className="relative space-y-4 px-5 pb-6 pt-8 sm:px-8">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-oc-green text-white shadow-lift">
              <ShieldCheck className="h-11 w-11" />
            </span>
            <h2 id="verified-title" className="font-display text-3xl font-extrabold tracking-tight text-oc-deep">You&apos;re verified</h2>
            <p className="text-sm text-oc-muted">Your face and Aadhaar checks have been reviewed and approved.</p>

            <div className="mx-auto flex w-fit flex-col items-center gap-2">
              <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full border-4 border-oc-mint bg-oc-sunken">
                {photo ? (
                  <img src={photo} alt={user?.name || ''} className="h-full w-full object-cover" />
                ) : (
                  typeMeta?.image && <img src={typeMeta.image} alt="" className="h-14 w-14 object-contain" />
                )}
              </span>
              <p className="font-display text-xl font-extrabold text-oc-ink">{user?.name}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-oc-mint px-3 py-1 text-sm font-extrabold text-oc-green" data-testid="verified-badge">
                <BadgeCheck className="h-4 w-4" /> Verified {trade}
              </span>
              {user?.location && (
                <p className="flex items-start gap-1 text-sm text-oc-muted">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oc-green" />
                  <span><span className="font-bold text-oc-ink">{user.location}</span><span className="block text-xs">Service location</span></span>
                </p>
              )}
            </div>

            {canReceiveJobs && (
              <p className="rounded-2xl bg-oc-mint/60 px-4 py-3 text-sm font-bold text-oc-deep">
                {available
                  ? `You are available: nearby ${trade.toLowerCase()} jobs can be offered to you.`
                  : `Set yourself available to be offered nearby ${trade.toLowerCase()} jobs.`}
              </p>
            )}

            <div className="space-y-2 pt-1">
              {!available && (
                <button type="button" className="btn-primary w-full py-3" onClick={onGoAvailable} disabled={saving} data-testid="verified-go-available">
                  {saving ? <Spinner className="h-4 w-4" /> : <Power className="h-4 w-4" />} Set your availability: go available
                </button>
              )}
              <button
                ref={continueRef}
                type="button"
                className={`${available ? 'btn-primary' : 'btn-ghost'} w-full py-3`}
                onClick={onContinue}
                data-testid="verified-continue"
              >
                Continue to my dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
