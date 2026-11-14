/**
 * The supplier's category step: Create Account -> Supplier Category -> Pincode ->
 * Dashboard.
 *
 * Only a new supplier sign-up is sent here (postSignupPath); login never is.
 * Continue saves the choice (PATCH /auth/supplier-category). Nothing moves on
 * until the server confirms it: the saved account then replaces the one in the
 * store, and the guard below hands over to the same landing rule as every other
 * entry path (postAuthPath).
 */
import { useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Navigate } from 'react-router-dom'
import { ArrowRight, BrickWall, HardHat, Loader2, Store, Tractor } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { optionLabel, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { saveSupplierCategory, verifySession } from '../../auth/authApi.js'
import { SUPPLIER_CATEGORY_CHOICES, clearPendingSupplierCategory, readPendingSupplierCategory, submitSupplierCategory } from '../pendingSupplierCategory.js'
import { postAuthPath, supplierCategoryMissing } from '../../../shared/auth/accountPaths.js'

const CATEGORY_ICONS = {
  'Material Supplier': BrickWall,
  'Equipment Supplier': Tractor,
  'Labor Supplier': HardHat,
}

export default function SupplierCategoryPage() {
  const { t } = useLanguage()
  const { user } = useSelector((state) => state.auth)
  const dispatch = useDispatch()
  // Empty until the supplier chooses; a save that failed restores their choice.
  const [category, setCategory] = useState(() => readPendingSupplierCategory(user?.id))
  const [categoryError, setCategoryError] = useState('')
  const [saving, setSaving] = useState(false)
  // One save per click: set before the request leaves, cleared only if it fails.
  const submitting = useRef(false)

  // Nothing to choose (the server says a category is saved): straight on.
  if (!supplierCategoryMissing(user)) return <Navigate to={postAuthPath(user)} replace />

  const choose = (value) => {
    setCategory(value)
    setCategoryError('')
  }

  const adoptAccount = (account) => dispatch(setAuthenticatedUser({ user: account }))

  const submit = async (event) => {
    event.preventDefault()
    if (submitting.current) return
    if (!category) {
      setCategoryError(t('cp.val.supplierCategory'))
      return
    }
    submitting.current = true
    setSaving(true)
    setCategoryError('')
    try {
      const saved = await submitSupplierCategory(user.id, category, saveSupplierCategory)
      adoptAccount(saved.user)
      return
    } catch (error) {
      // 409: already saved (another tab, a reply that never arrived). Nothing to
      // ask again: the server's account says so, and the guard above moves on.
      if (error.response?.status === 409) {
        try {
          const session = await verifySession()
          if (!supplierCategoryMissing(session.user)) {
            clearPendingSupplierCategory(user.id)
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
    setCategoryError(t('ps.supplierCategorySaveFailed'))
  }

  return (
    <main className="grid min-h-screen place-items-center overflow-y-auto bg-oc-sunken p-4">
      <form onSubmit={submit} noValidate className="w-full max-w-xl rounded-2xl border border-oc-line bg-white p-5 shadow-2xl">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-oc-mint text-oc-green">
          <Store className="h-5 w-5" />
        </span>
        <h1 className="mt-3 font-display text-lg font-extrabold leading-snug text-oc-ink">
          {t('ps.selectSupplierCategory')}
        </h1>

        <fieldset className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <legend className="sr-only">{t('ps.supplierCategory')}</legend>
          {SUPPLIER_CATEGORY_CHOICES.map((value) => {
            const Icon = CATEGORY_ICONS[value]
            const selected = category === value
            return (
              <label
                key={value}
                className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center text-sm font-extrabold text-oc-deep transition focus-within:ring-2 focus-within:ring-oc-green ${selected ? 'border-oc-green bg-oc-mint' : 'border-oc-line bg-white hover:bg-oc-mint'}`}
              >
                <input
                  type="radio"
                  name="supplier_category"
                  value={value}
                  checked={selected}
                  onChange={() => choose(value)}
                  disabled={saving}
                  className="sr-only"
                />
                <Icon className="h-6 w-6 text-oc-green" />
                {optionLabel(t, SUPPLIER_TYPE_KEYS, value)}
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
