import { useCallback, useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import PincodeAreaFields from '../../../shared/ui/PincodeAreaFields.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { TECHNICIAN_TYPES, technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { completeProfile, fetchTechnicianCatalog } from '../../technician/technicianApi.js'
import WorkPreferencesFields from '../../technician/components/WorkPreferencesFields.jsx'
import { newTechnicianForm, toPayload, validateForm } from '../../technician/workPreferences.js'

// The backend's rule (the Professional app's password rule); the backend check is the one that counts.
const PASSWORD_RULE = 'Password must have 10 to 72 characters with upper, lower, number, and symbol.'
const PASSWORDS_DIFFER = 'The passwords do not match.'

function passwordIsStrong(password) {
  return password.length >= 10 && new TextEncoder().encode(password).length <= 72
    && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^\w\s]/.test(password)
}

/** Minimal technician details and the sign-in password, step 6. Completing it activates the account. */
export default function ProfileStep({ user, preferredType, onDone }) {
  const lockedType = user?.technician_type || ''
  const [form, setForm] = useState({
    name: user?.name || '',
    technician_type: lockedType || preferredType || '',
    address: user?.address || '',
    pincode: user?.pincode || '',
    area: user?.area || '',
    experience_years: user?.experience_years ?? 0,
    is_available: true,
  })
  // Kept apart from the details form: only the password itself is sent, and only once.
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const update = useCallback((changes) => setForm((current) => ({ ...current, ...changes })), [])

  // Services, radius and hours for the chosen trade. Choosing another trade loads
  // its services and starts its selection afresh (every service ticked). The
  // services picker is not shown at this step; Profile is where it is narrowed.
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [preferences, setPreferences] = useState(() => newTechnicianForm())
  useEffect(() => {
    if (!form.technician_type) return undefined
    let cancelled = false
    setCatalog(null)
    setCatalogError('')
    fetchTechnicianCatalog(form.technician_type)
      .then((services) => {
        if (cancelled) return
        setCatalog(services)
        setPreferences((current) => ({ ...current, serviceIds: services.map((service) => service.id) }))
      })
      .catch((error) => { if (!cancelled) setCatalogError(apiErrorMessage(error, 'The services could not be loaded.')) })
    return () => { cancelled = true }
  }, [form.technician_type])

  const submit = async (event) => {
    event.preventDefault()
    // If the services could not be loaded, registration still goes ahead without
    // preferences: the account then keeps the no-restriction defaults, editable later.
    const preferencesProblem = catalogError ? '' : catalog ? validateForm(preferences, catalog) : 'Wait for your services to load.'
    if (preferencesProblem) {
      setMessage(preferencesProblem)
      return
    }
    if (!passwordIsStrong(password)) {
      setMessage(PASSWORD_RULE)
      return
    }
    if (password !== confirmPassword) {
      setMessage(PASSWORDS_DIFFER)
      return
    }
    setBusy(true)
    setMessage('')
    try {
      onDone(await completeProfile({
        ...form,
        experience_years: Number(form.experience_years || 0),
        password,
        ...(catalogError ? {} : { work_preferences: toPayload(preferences, catalog) }),
      }))
    } catch (error) {
      setMessage(apiErrorMessage(error, 'Your details could not be saved. Check the form and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Alert tone="error">{message}</Alert>

      <fieldset>
        <legend className="field-label">I work as a</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TECHNICIAN_TYPES.map((type) => {
            const selected = form.technician_type === type.code
            const disabled = Boolean(lockedType) && lockedType !== type.code
            return (
              <label
                key={type.code}
                className={`flex flex-col items-center rounded-2xl border p-2 text-center transition ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${
                  selected ? 'border-oc-green bg-oc-mint ring-2 ring-oc-green/30' : 'border-oc-line bg-white hover:border-oc-green/60'
                }`}
              >
                <input type="radio" name="technician_type" value={type.code} checked={selected} disabled={disabled}
                  onChange={() => update({ technician_type: type.code })} className="sr-only" required />
                <img src={type.heroImage} alt="" className="h-20 w-auto" />
                <span className="mt-1 text-xs font-extrabold text-oc-ink">{type.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="field-label">Full name</span>
        <input className="field-input" required autoComplete="name" value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label className="block">
        <span className="field-label">Address</span>
        <input className="field-input" required autoComplete="street-address" placeholder="House / shop number, street" value={form.address} onChange={(event) => update({ address: event.target.value })} />
      </label>
      <PincodeAreaFields pincode={form.pincode} area={form.area} onChange={update} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Experience (years)</span>
          <input className="field-input" type="number" min={0} max={60} value={form.experience_years} onChange={(event) => update({ experience_years: event.target.value })} />
        </label>
        <label className="flex cursor-pointer items-center gap-3 self-end rounded-xl border border-oc-line bg-white px-3.5 py-2.5">
          <input type="checkbox" className="h-4 w-4 accent-oc-green" checked={form.is_available} onChange={(event) => update({ is_available: event.target.checked })} />
          <span className="text-sm font-bold text-oc-ink">Available for jobs now</span>
        </label>
      </div>

      {form.technician_type && (
        <WorkPreferencesFields
          catalog={catalog}
          catalogError={catalogError && `${catalogError} You can still create your account and choose your services later in Profile.`}
          form={preferences}
          onChange={setPreferences}
          tradeLabel={technicianTypeByCode(form.technician_type)?.label}
          showServices={false}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Create password</span>
          <input className="field-input" type="password" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Confirm password</span>
          <input className="field-input" type="password" required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-oc-muted">You will sign in with your email and this password. Use 10 or more characters with upper and lower case letters, a number and a symbol.</p>

      <button type="submit" className="btn-primary w-full py-3" disabled={busy || !form.technician_type || !form.area || (catalog === null && !catalogError)}>
        {busy ? <Spinner className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />} Create my Partner account
      </button>
    </form>
  )
}
