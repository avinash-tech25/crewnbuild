import { useCallback, useEffect, useState } from 'react'
import { Camera, Check, ClipboardList, ImageOff } from 'lucide-react'
import { Spinner, formatDate } from '../../../shared/ui/ui.jsx'
import { usePrivatePhotos } from '../../../shared/hooks/usePrivatePhotos.js'
import { fetchBookingExecution, fetchBookingPhoto } from '../bookingApi.js'
import { LIVE_PROGRESS_STATUSES, progressView, stageLabel } from '../jobProgress.js'

const REFRESH_MS = 8000

/**
 * The requester's read-only view of the job while it is done: where it is, the
 * checklist the technician is working through, and the job's photos.
 *
 * It reads the existing GET /requester/bookings/{id}/execution and nothing else,
 * refreshing on the tracker page's own cadence while the technician is on site
 * (there is no progress event on the tracking socket, and none is added here).
 * The technician's working notes in that response are not shown. Photos come
 * through the authorised content endpoint as blobs, never by a public address.
 */
export default function JobProgressPanel({ bookingId, status }) {
  const [execution, setExecution] = useState(null)
  const [unavailable, setUnavailable] = useState(false)

  const load = useCallback(async () => {
    try {
      setExecution(await fetchBookingExecution(bookingId))
      setUnavailable(false)
    } catch {
      // Progress is extra on this page: without it the booking still shows.
      setUnavailable(true)
    }
  }, [bookingId])

  // Again whenever the booking moves on (accepted, arrived, completed...).
  useEffect(() => { load() }, [load, status])

  useEffect(() => {
    if (!LIVE_PROGRESS_STATUSES.includes(status)) return undefined
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [status, load])

  const view = progressView(execution)
  const photoIds = view ? view.photos.flatMap((group) => group.items.map((item) => item.id)) : []
  const loadBlob = useCallback((mediaId, signal) => fetchBookingPhoto(bookingId, mediaId, signal), [bookingId])
  const urls = usePrivatePhotos(loadBlob, photoIds)

  if (unavailable && !view) return null

  return (
    <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="job-progress-title" data-testid="job-progress">
      <div className="flex flex-wrap items-center gap-4">
        <ProgressRing done={view?.done ?? 0} total={view?.total ?? 0} percent={view?.percent ?? 0} />
        <div className="min-w-0 flex-1">
          <h2 id="job-progress-title" className="font-display text-lg font-extrabold text-oc-ink">Job progress</h2>
          <p className="text-sm font-bold text-oc-green" data-testid="job-progress-stage">{stageLabel(status)}</p>
          {LIVE_PROGRESS_STATUSES.includes(status) && (
            <p className="mt-0.5 text-xs text-oc-muted">Updates on its own every few seconds while this page is open.</p>
          )}
        </div>
      </div>

      {!view ? (
        <div className="flex justify-center py-6 text-oc-green"><Spinner className="h-6 w-6" /></div>
      ) : (
        <>
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-oc-muted">
              <ClipboardList className="h-4 w-4 text-oc-green" /> Service checklist
            </h3>
            {view.steps.length === 0 ? (
              <p className="mt-2 text-sm text-oc-muted">This job has no checklist.</p>
            ) : (
              <ol className="mt-2 divide-y divide-oc-line rounded-2xl border border-oc-line">
                {view.steps.map((step) => (
                  <li key={step.id} className="flex items-start gap-3 px-3 py-2.5" data-testid="progress-step">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${step.completed ? 'bg-oc-green text-white' : 'border-2 border-oc-line text-transparent'}`}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${step.completed ? 'text-oc-ink' : 'text-oc-muted'}`}>{step.title}</span>
                      {step.completed && step.completedAt && <span className="block text-xs text-oc-muted">Done {formatDate(step.completedAt)}</span>}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${step.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-oc-sunken text-oc-muted'}`}
                    >
                      {step.completed ? 'Completed' : 'Pending'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {view.photos.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-oc-muted">
                <Camera className="h-4 w-4 text-oc-green" /> Photos
              </h3>
              {view.photos.map((group) => (
                <div key={group.kind} data-testid={`progress-photos-${group.kind.toLowerCase()}`}>
                  <p className="mb-1.5 text-sm font-bold text-oc-ink">{group.label}</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {group.items.map((item) => (
                      <li key={item.id} className="aspect-square overflow-hidden rounded-xl border border-oc-line bg-oc-sunken">
                        {urls[item.id] === 'error' ? (
                          <span className="grid h-full w-full place-items-center text-oc-muted" title="This photo could not be loaded"><ImageOff className="h-5 w-5" /></span>
                        ) : urls[item.id] ? (
                          <img src={urls[item.id]} alt={`${group.label} photo`} className="h-full w-full object-cover" data-testid="progress-photo" />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-oc-green"><Spinner className="h-4 w-4" /></span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ProgressRing({ done, total, percent }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative grid h-16 w-16 shrink-0 place-items-center" data-testid="job-progress-count" aria-label={`${done} of ${total} checklist steps done`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} stroke="#e5efe9" strokeWidth="6" fill="none" />
        <circle
          cx="32" cy="32" r={radius} stroke="#126b45" strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <span className="font-display text-sm font-extrabold text-oc-ink">{done}/{total}</span>
    </div>
  )
}
