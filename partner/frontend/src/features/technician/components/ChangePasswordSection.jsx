import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { passwordApi } from '../../auth/passwordApi.js'
import { PASSWORD_RULE, newPasswordProblems } from '../../auth/passwordRules.js'

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

/**
 * Profile / Settings -> Security -> Change Password. Needs the current password.
 * The typed passwords live only in this component and are cleared once they are
 * not needed; nothing is stored in the browser.
 */
export default function ChangePasswordSection() {
  const [form, setForm] = useState(EMPTY)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  const problems = {
    ...(form.currentPassword ? {} : { current: 'Enter your current password.' }),
    ...newPasswordProblems(form),
  }
  const shown = touched ? problems : {}

  const submit = async (event) => {
    event.preventDefault()
    setTouched(true)
    setMessage({ tone: 'info', text: '' })
    if (Object.keys(problems).length) return
    setSaving(true)
    try {
      const result = await passwordApi.change(form)
      setForm(EMPTY)
      setTouched(false)
      setMessage({ tone: 'success', text: result?.message || 'Your password has been changed.' })
    } catch (error) {
      // The typed current password was wrong or is spent: never keep it around.
      setForm((current) => ({ ...current, currentPassword: '' }))
      setTouched(false)
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'Your password could not be changed.') })
    } finally {
      setSaving(false)
    }
  }

  const field = (name, label, key, autoComplete) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        type="password"
        autoComplete={autoComplete}
        value={form[name]}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        aria-invalid={Boolean(shown[key])}
        data-testid={`password-${name}`}
      />
      {shown[key] && <span className="mt-1 block text-xs font-bold text-red-700" role="alert">{shown[key]}</span>}
    </label>
  )

  return (
    <section className="card p-6" aria-labelledby="security-title" data-testid="security">
      <h2 id="security-title" className="flex items-center gap-2 font-display text-lg font-extrabold text-oc-ink">
        <ShieldCheck className="h-5 w-5 text-oc-green" /> Security
      </h2>
      <h3 className="mt-3 font-display text-sm font-extrabold uppercase tracking-wide text-oc-ink">Change Password</h3>
      <p className="mt-1 text-xs text-oc-muted">{PASSWORD_RULE}</p>
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate data-testid="change-password-form">
        {message.text && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          {field('currentPassword', 'Current password', 'current', 'current-password')}
          {field('newPassword', 'New password', 'new', 'new-password')}
          {field('confirmPassword', 'Confirm new password', 'confirm', 'new-password')}
        </div>
        <p className="text-xs text-oc-muted">Other devices where you are already signed in stay signed in until their session ends.</p>
        <button type="submit" className="btn-primary" disabled={saving} data-testid="change-password-submit">
          {saving ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} {saving ? 'Changing…' : 'Change Password'}
        </button>
      </form>
    </section>
  )
}
