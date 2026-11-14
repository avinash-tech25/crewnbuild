import { GPS_POOR_ACCURACY_METERS, formatDistance, formatEta, formatSince } from '../../../shared/constants/tracking.js'
import { Alert } from '../../../shared/ui/ui.jsx'

/**
 * What the customer can see of this technician right now, on their own job card.
 *
 * There is nothing to start or stop here: while a technician is available or holds
 * a job, `useTechnicianLocation` (owned by the dashboard) is already sending their
 * position about every three seconds, and the customer's map follows it from the
 * moment the job is accepted until work starts. This panel only reports it.
 */
export default function LiveLocationStatus({ location, navigation }) {
  const tracking = Boolean(location?.tracking)
  const accuracy = location?.gps?.accuracy
  const sentAt = location?.gps?.sentAt

  return (
    <div className="rounded-2xl border border-oc-line bg-oc-sunken p-3" data-testid="live-location-status">
      <div className="flex flex-wrap items-center gap-2">
        {tracking ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-emerald-800">
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {sentAt ? 'Sharing live location' : 'Finding your location…'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-800">
            Location not shared
          </span>
        )}
      </div>

      {tracking && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="font-bold uppercase tracking-wide text-oc-muted">Sent</dt>
            <dd className="font-semibold text-oc-ink">{location.gps.sentCount || 0} updates</dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-wide text-oc-muted">Last</dt>
            <dd className="font-semibold text-oc-ink">{sentAt ? formatSince(sentAt) : 'waiting for GPS'}</dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-wide text-oc-muted">Accuracy</dt>
            <dd className="font-semibold text-oc-ink">
              {accuracy === null || accuracy === undefined ? '—' : `±${Math.round(accuracy)} m`}
            </dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-wide text-oc-muted">To the job</dt>
            <dd className="font-semibold text-oc-ink">
              {navigation?.has_destination
                ? `${formatDistance(navigation.distance_remaining_meters)} · ${formatEta(navigation.eta_seconds)}`
                : 'awaiting their pin'}
            </dd>
          </div>
        </dl>
      )}

      {!tracking && (
        <p className="mt-2 text-xs text-oc-muted">
          The customer cannot see you approaching, and the job will not mark itself as arrived. Allow location access
          for this site and keep the app open.
        </p>
      )}

      {tracking && accuracy !== null && accuracy !== undefined && accuracy > GPS_POOR_ACCURACY_METERS && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          Your position is only accurate to about {Math.round(accuracy)} m. Turn on precise location, or step outside,
          for the customer to see where you really are.
        </p>
      )}

      <div className="mt-2 space-y-2 empty:mt-0">
        {location?.error && <Alert tone="error">{location.error}</Alert>}
        {location?.warning && <Alert tone="info">{location.warning}</Alert>}
      </div>
    </div>
  )
}
