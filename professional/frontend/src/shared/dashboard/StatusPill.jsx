import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { translatorFrom } from '../../i18n/translate.js'

/**
 * Every status code this application shows, and the key that names it.
 *
 * There used to be a second, shorter copy of this in RequestsPanel — the same
 * nine request statuses without the five property ones — so a property listing
 * rendered inside that panel fell through to its raw code. One map, exported,
 * so a status added here is a status both screens can name.
 *
 * The keys are the stored codes lower-cased; the stored value is untouched.
 */
export const STATUS_KEYS = {
  pending: 'ui.status.pending',
  accepted: 'ui.status.accepted',
  rejected: 'ui.status.rejected',
  completed: 'ui.status.completed',
  active: 'ui.status.active',
  fulfilled: 'ui.status.fulfilled',
  approved: 'store.status.approved',
  issued: 'store.status.issued',
  // A store request's stage (what an open request waits for, or how it ended).
  partially_issued: 'store.status.partiallyIssued',
  partially_available: 'store.status.partiallyAvailable',
  procurement_pending: 'store.status.procurementPending',
  partially_fulfilled: 'store.status.partiallyFulfilled',
  cancelled: 'store.status.cancelled',
  in_progress: 'ui.status.inProgress',
  closed: 'ui.status.closed',
  open: 'ui.status.open',
  // Property listing lifecycle (stored upper-case, normalised below).
  draft: 'ui.shared.statusDraft',
  listed: 'ui.shared.statusListed',
  under_offer: 'ui.shared.statusUnderOffer',
  sold: 'ui.shared.statusSold',
  withdrawn: 'ui.shared.statusWithdrawn',
}

/**
 * A stored status code as the word for it in the reader's language.
 *
 * A code with no key of its own no longer leaks: it used to be printed raw,
 * with its first underscore swapped for a space ("under_offer" became
 * "under offer" but "not_yet_started" stayed half-joined), which is an English
 * enum shown as if it were a label. An unnamed code now reads as "unknown" in
 * the reader's own language, which is true and is not a fragment of English.
 */
export function statusLabel(status, t) {
  const normalized = String(status || 'pending').toLowerCase()
  const key = STATUS_KEYS[normalized]
  return translatorFrom(t)(key || 'ui.status.unknown')
}

const tones = {
  pending: 'bg-gold/15 text-gold',
  accepted: 'bg-brand-100 text-brand-700',
  rejected: 'bg-warm/15 text-warm',
  completed: 'bg-brand-100 text-brand-700',
  active: 'bg-brand-50 text-brand-700',
}

// An opt-in palette where each status reads at a glance -- pending amber,
// accepted green -- used by the House Owner's Recent Activity. Every other
// screen keeps `tones` above.
const softTones = {
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  fulfilled: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  partially_available: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  procurement_pending: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  partially_fulfilled: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  partially_issued: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  rejected: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  withdrawn: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  active: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
}

export default function StatusPill({ status, soft = false }) {
  const { t } = useLanguage()
  const normalizedStatus = String(status || 'pending').toLowerCase()
  const tone = soft
    ? softTones[normalizedStatus] || 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'
    : tones[normalizedStatus] || 'bg-brand-50 text-graphite/55'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>
      {statusLabel(normalizedStatus, t)}
    </span>
  )
}
