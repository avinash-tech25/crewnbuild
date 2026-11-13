/**
 * The engineer's category step: Create Account -> Engineer Category -> Address and
 * Pincode -> Dashboard. The same arrangement as SupplierCategoryPage.
 *
 * Only a new engineer sign-up is sent here (postSignupPath); login never is.
 * Continue saves the choice (PATCH /auth/engineer-category). Nothing moves on
 * until the server confirms it: the saved account then replaces the one in the
 * store, and the guard below hands over to the same landing rule as every other
 * entry path (postAuthPath) -- the pincode step, then the Store Manager dashboard
 * for a Store Manager and the Engineer dashboard for every other category.
 */
import { useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Navigate } from 'react-router-dom'
import { ArrowRight, HardHat, Loader2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel } from '../../../i18n/optionKeys.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { saveEngineerCategory, verifySession } from '../../auth/authApi.js'
import { ENGINEER_CATEGORY_LABEL_KEYS, engineerCategoryOptions } from '../profileConstants.js'
import { clearPendingEngineerCategory, readPendingEngineerCategory, submitEngineerCategory } from '../pendingEngineerCategory.js'
import { engineerCategoryMissing, postAuthPath } from '../../../shared/auth/accountPaths.js'

export default function EngineerCategoryPage() {
  const { t } = useLanguage()
  const { user } = useSelector((state) => state.auth)
  const dispatch = useDispatch()
  const [category, setCategory] = useState(() => readPendingEngineerCategory(user?.id))
  const [categoryError, setCategoryError] = useState('')
  const [saving, setSaving] = useState(false)
  // One save per click: set before the request leaves, cleared only if it fails.
  const submitting = useRef(false)

  // Nothing to choose (the server says a category is saved): straight on.
  if (!engineerCategoryMissing(user)) return <Navigate to={postAuthPath(user)} replace />

  const adoptAccount = (account) => dispatch(setAuthenticatedUser({ user: account }))

  const submit = async (event) => {
    event.preventDefault()
    if (submitting.current) return
    if (!category) {
      setCategoryError(t('cp.val.specialization'))
      return
    }
    submitting.current = true
    setSaving(true)
    setCategoryError('')
    try {
      const saved = await submitEngineerCategory(user.id, category, saveEngineerCategory)
      adoptAccount(saved.user)
      return
    } catch (error) {
      // 409: already saved (another tab, a reply that never arrived).
      if (error.response?.status === 409) {
        try {
          const session = await verifySession()
          if (!engineerCategoryMissing(session.user)) {
            clearPendingEngineerCategory(user.id)
            adoptAccount(session.user)
            return
          }
        } catch {
          /* falls through to the retry message */
        }
      }
    }
    submitting.current = false
    setSaving(false)
    setCategoryError(t('engineer.category.saveFailed'))
  }

  return (
    <main className="grid min-h-screen place-items-center overflow-y-auto bg-oc-sunken p-4">
      <form onSubmit={submit} noValidate className="w-full max-w-2xl rounded-2xl border border-oc-line bg-white p-5 shadow-2xl">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-oc-mint text-oc-green">
          <HardHat className="h-5 w-5" />
        </span>
        <h1 className="mt-3 font-display text-lg font-extrabold leading-snug text-oc-ink">
          {t('profile.engineerCategorySelect')}
        </h1>

        <fieldset className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <legend className="sr-only">{t('profile.engineerCategory')}</legend>
          {engineerCategoryOptions.map((value) => {
            const selected = category === value
            return (
              <label
                key={value}
                className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-2 py-2 text-center text-[13px] font-extrabold text-oc-deep transition focus-within:ring-2 focus-within:ring-oc-green ${selected ? 'border-oc-green bg-oc-mint' : 'border-oc-line bg-white hover:bg-oc-mint'}`}
              >
                <input
                  type="radio"
                  name="engineer_category"
                  value={value}
                  checked={selected}
                  onChange={() => { setCategory(value); setCategoryError('') }}
                  disabled={saving}
                  className="sr-only"
                />
                {optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, value)}
              </label>
            )
          })}
        </fieldset>

        {categoryError && <p role="alert" className="mt-2 text-[11px] font-bold text-warm">{categoryError}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('dash.common.saving') : t('ps.supplierCategoryContinue')}
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />}
          </button>
        </div>
      </form>
    </main>
  )
}
