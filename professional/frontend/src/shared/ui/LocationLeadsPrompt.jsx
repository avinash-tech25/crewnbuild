import { useEffect, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import PincodeAreaHint from './PincodeAreaHint.jsx'
import { INDIA_PINCODE_LENGTH, usePincodeAreaLookup } from '../hooks/usePincodeAreaLookup.js'
import { updateUserLocation } from '../../features/onboarding/locationApi.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { needsLocationPincode } from '../auth/accountPaths.js'
import { limitRefusal } from '../../features/billing/subscription/planLimits.js'

// Every marketplace role (House Owner, Builder, Supplier, Engineer) sets its
// pincode here: leads, nearby builders, suppliers and engineers are all matched
// on it. The same rule decides when the /pincode step follows signup or login.
export const DISMISSED_KEY = 'crewnbuild_location_prompt_dismissed'

function readDismissed(userId) {
  try {
    return window.sessionStorage.getItem(`${DISMISSED_KEY}:${userId}`) === '1'
  } catch {
    return false
  }
}

/**
 * Whether the location prompt applies to this account and whether it is open.
 *
 * It opens by itself when a marketplace account in India has no pincode saved
 * — which is every account that chose "Later" on the pincode step. "Later"
 * hides it for the rest of the browser session; the leads screen can always
 * reopen it.
 */
export function useLocationLeadsPrompt(user) {
  const eligible = Boolean(user?.id)
    && String(user.country_of_residence || 'India').trim().toLowerCase() === 'india'
  const needsLocation = needsLocationPincode(user)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (needsLocation && !readDismissed(user.id)) setOpen(true)
  }, [needsLocation, user?.id])

  const dismissPrompt = () => {
    try {
      if (user?.id) window.sessionStorage.setItem(`${DISMISSED_KEY}:${user.id}`, '1')
    } catch {
      /* noop */
    }
    setOpen(false)
  }

  return { eligible, open, openPrompt: () => setOpen(true), dismissPrompt, finishPrompt: () => setOpen(false) }
}

export function LocationLeadsButton({ pincode, onClick }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-deep shadow-sm transition hover:bg-oc-mint"
    >
      <MapPin className="h-3.5 w-3.5 text-oc-green" />
      {pincode ? t('location.leadsFor', { pincode }) : t('location.setLocation')}
      {pincode && <span className="text-oc-green underline underline-offset-2">{t('location.change')}</span>}
    </button>
  )
}

/**
 * "Please enter your pincode/location to get relevant leads."
 *
 * Validates the six digits, lists every post office branch under the pincode
 * with its city, district and state, and saves the chosen one. `onSaved`
 * receives the updated account; the dashboard then loads its leads through its
 * existing lead request. `pincodeChoices`: a Free/Pro builder's own lead
 * locations, offered to switch between (the server refuses a pincode that would
 * be a location beyond the plan's).
 */
export default function LocationLeadsPrompt({ open, currentPincode = '', onDismiss, onSaved, pincodeChoices = [] }) {
  const { t, td, translateMessage } = useLanguage()
  const [pincode, setPincode] = useState(currentPincode || '')
  const [selectedBranch, setSelectedBranch] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const lookupState = usePincodeAreaLookup(open ? pincode : '', undefined, 'India')

  useEffect(() => {
    if (open) setPincode(currentPincode || '')
  }, [open, currentPincode])

  useEffect(() => {
    setSelectedBranch(null)
    setSaveError('')
  }, [pincode])

  // A pincode with a single branch has nothing to choose between.
  useEffect(() => {
    if (lookupState.status === 'success' && lookupState.branches.length === 1) {
      setSelectedBranch(lookupState.branches[0])
    }
  }, [lookupState])

  if (!open) return null

  const canSave = lookupState.status === 'success' && Boolean(selectedBranch) && !saving

  const saveLocation = async (event) => {
    event.preventDefault()
    if (!canSave) {
      if (lookupState.status === 'success') setSaveError(t('location.prompt.selectBranch'))
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const updatedUser = await updateUserLocation(lookupState.areaDetails.pincode, selectedBranch.name)
      await onSaved(updatedUser)
    } catch (error) {
      const detail = error.response?.data?.detail
      // A pincode beyond the plan's locations: the existing location-limit message.
      const refusal = limitRefusal(error)
      // `translateMessage` covers the handful of server messages that have a
      // key; `td` catches the rest, which would otherwise be shown as the
      // English the backend wrote them in.
      setSaveError(refusal?.kind === 'locations'
        ? t(`subscription.limit.reached.locations.${refusal.planCode}`, { limit: refusal.limit })
        : typeof detail === 'string' ? td(translateMessage(detail)) : t('location.prompt.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="location-leads-title">
      <form onSubmit={saveLocation} className="relative w-full max-w-xl rounded-2xl border border-oc-line bg-white p-5 shadow-2xl">
        {/* No onDismiss: the step is required (a paid builder sign-up pays only after it). */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('location.prompt.later')}
            className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-oc-muted transition hover:bg-oc-sunken hover:text-oc-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-oc-mint text-oc-green">
          <MapPin className="h-5 w-5" />
        </span>
        <h2 id="location-leads-title" className="mt-3 pe-8 font-display text-lg font-extrabold leading-snug text-oc-ink">
          {t('location.prompt.title')}
        </h2>
        <p className="mt-1 text-xs font-medium text-oc-muted">{t('location.prompt.sub')}</p>

        <label className="mt-4 block">
          <span className="block text-[11px] font-extrabold uppercase tracking-wide text-oc-deep">{t('location.prompt.pincode')}</span>
          <span className="mt-1.5 flex h-11 items-center gap-2.5 rounded-xl border border-oc-line bg-white px-3 focus-within:border-oc-green">
            <MapPin className="h-4 w-4 text-oc-muted" />
            <input
              autoFocus
              value={pincode}
              onChange={(event) => setPincode(event.target.value)}
              inputMode="numeric"
              maxLength={INDIA_PINCODE_LENGTH + 2}
              placeholder={t('ui.shared.sixDigitPincode')}
              className="w-full bg-transparent text-sm font-bold tracking-wider text-oc-ink outline-none placeholder:font-medium placeholder:tracking-normal placeholder:text-oc-muted/70"
            />
          </span>
        </label>
        {pincodeChoices.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {pincodeChoices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setPincode(choice)}
                aria-pressed={pincode === choice}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-extrabold shadow-sm transition ${pincode === choice ? 'border-oc-green bg-oc-mint text-oc-deep' : 'border-oc-line bg-white text-oc-deep hover:bg-oc-mint'}`}
              >
                <MapPin className="h-3.5 w-3.5 text-oc-green" />{choice}
              </button>
            ))}
          </div>
        )}
        <PincodeAreaHint lookupState={lookupState} selectedBranch={selectedBranch} onSelectBranch={(branch) => { setSelectedBranch(branch); setSaveError('') }} />

        {saveError && <p role="alert" className="mt-2 text-[11px] font-bold text-warm">{saveError}</p>}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-oc-line bg-white px-4 text-sm font-extrabold text-oc-muted transition hover:bg-oc-sunken"
            >
              {t('location.prompt.later')}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSave}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('location.prompt.saving') : t('location.prompt.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
