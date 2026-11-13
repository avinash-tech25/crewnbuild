import { CheckCircle2, MapPin } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

const FAILURE_MESSAGE_KEYS = {
  invalid: 'location.invalid',
  unknown: 'location.unknown',
  unmapped: 'location.unmapped',
  unavailable: 'location.unavailable',
  error: 'location.notFound',
}

function sameBranch(branch, selectedBranch) {
  return Boolean(selectedBranch) && branch.name === selectedBranch.name && branch.pincode === selectedBranch.pincode
}

/**
 * The result of a pincode lookup under its input.
 *
 * With `onSelectBranch`, a resolved Indian pincode lists every post office
 * branch registered under it — postal location, city, district and state — and
 * the one picked is reported back. Without it, the single resolved area line is
 * shown exactly as before.
 */
export default function PincodeAreaHint({ lookupState, selectedBranch = null, onSelectBranch }) {
  const { t, td } = useLanguage()
  // The gate is "has the lookup something to say", not "is there an English
  // sentence on the state". It used to be the latter, which meant the five
  // English strings the hook set were load-bearing: removing them would have
  // silently stopped this component rendering at all. The hook now names its
  // refusals with `messageKey` and keeps `message` for the resolved area alone,
  // so either one being present is the signal to render.
  if (!lookupState?.message && !lookupState?.messageKey) return null

  if (lookupState.status === 'loading') {
    return <p className="mt-1 text-[11px] font-semibold text-forest-700">{t('location.fetching')}</p>
  }
  if (lookupState.status === 'incomplete') {
    return <p className="mt-1 text-[11px] font-semibold text-graphite/55">{t('location.incomplete')}</p>
  }
  if (FAILURE_MESSAGE_KEYS[lookupState.status]) {
    return <p role="alert" className="mt-1 text-[11px] font-semibold text-warm">{t(FAILURE_MESSAGE_KEYS[lookupState.status])}</p>
  }
  if (lookupState.status === 'info') {
    return <p className="mt-1 text-[11px] font-semibold text-graphite/55">{lookupState.messageKey ? t(lookupState.messageKey) : td(lookupState.message)}</p>
  }

  const branches = lookupState.branches || []
  if (!onSelectBranch || !branches.length) {
    // The resolved area: a place name the postal API returned, not interface
    // copy, so it is machine-translated for display rather than looked up.
    return <p className="mt-1 text-[11px] font-semibold text-forest-700">{td(lookupState.message)}</p>
  }

  return (
    <div className="mt-2">
      <p className="text-[11px] font-bold text-graphite/70">
        {t('location.branchesFound', { count: branches.length, pincode: branches[0].pincode })}
      </p>
      <div role="radiogroup" aria-label={t('location.branch')} className="mt-1.5 grid max-h-64 gap-1.5 overflow-y-auto pr-0.5">
        {branches.map((branch) => {
          const selected = sameBranch(branch, selectedBranch)
          return (
            <button
              key={`${branch.pincode}-${branch.name}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelectBranch(branch)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                selected ? 'border-oc-green bg-oc-mint/70 ring-1 ring-oc-green/40' : 'border-oc-line bg-white hover:border-oc-green/50 hover:bg-oc-mint/30'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-extrabold text-oc-ink">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-oc-green" />
                  <span className="truncate">{td(branch.name)}</span>
                </span>
                {selected
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-oc-green" />
                  /* "Sub Post Office", "Branch Post Office" — the postal API's
                     own wording, with no key to look it up by. */
                  : branch.branch_type && <span className="shrink-0 text-[10px] font-bold text-oc-muted">{td(branch.branch_type)}</span>}
              </span>
              {/* Place names, all four of them straight from the postal API. */}
              <span className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-oc-muted sm:grid-cols-4">
                <span><span className="font-bold text-oc-deep">{t('location.branch')}:</span> {td(branch.name)}</span>
                <span><span className="font-bold text-oc-deep">{t('location.city')}:</span> {branch.city ? td(branch.city) : '—'}</span>
                <span><span className="font-bold text-oc-deep">{t('location.district')}:</span> {td(branch.district)}</span>
                <span><span className="font-bold text-oc-deep">{t('location.state')}:</span> {td(branch.state)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
