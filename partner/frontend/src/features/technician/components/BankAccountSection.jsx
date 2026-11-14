import { useCallback, useEffect, useState } from 'react'
import { Landmark, Pencil, Plus, RotateCw, Save } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { bankAccountApi } from '../bankAccountApi.js'
import { BANK_STATUS, EMPTY_BANK_FORM, bankFormProblems, bankPayload, maskAccountNumber } from '../bankAccountRules.js'

/**
 * The payout bank account, under Profile. Added after signup, never during it.
 *
 * The full account number exists in this component only while it is being typed.
 * After a save the form is emptied, and what is shown is the server's masked
 * answer (••••••1234): the server never returns the full number, so it cannot be
 * shown again. Editing asks for the number again for the same reason.
 */
export default function BankAccountSection() {
  const [account, setAccount] = useState(undefined) // undefined: loading, null: none yet
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_BANK_FORM)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setAccount(await bankAccountApi.load())
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Your bank details could not be loaded.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const startEditing = () => {
    setForm(account
      ? { ...EMPTY_BANK_FORM, account_holder_name: account.account_holder_name, bank_name: account.bank_name, ifsc: account.ifsc_code }
      : EMPTY_BANK_FORM)
    setTouched(false)
    setMessage({ tone: 'info', text: '' })
    setEditing(true)
  }

  const cancel = () => {
    setForm(EMPTY_BANK_FORM) // the typed number goes with the form
    setEditing(false)
  }

  const problems = bankFormProblems(form)
  const shown = touched ? problems : {}

  const save = async (event) => {
    event.preventDefault()
    setTouched(true)
    if (Object.keys(problems).length) return
    setSaving(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const saved = await bankAccountApi.save(bankPayload(form))
      setAccount(saved)
      setForm(EMPTY_BANK_FORM)
      setEditing(false)
      setMessage({ tone: 'success', text: 'Bank account saved.' })
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'Your bank details could not be saved.') })
    } finally {
      setSaving(false)
    }
  }

  const field = (name, label, props = {}) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        value={form[name]}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        aria-invalid={Boolean(shown[name])}
        data-testid={`bank-${name}`}
        {...props}
      />
      {shown[name] && <span className="mt-1 block text-xs font-bold text-red-700" role="alert">{shown[name]}</span>}
    </label>
  )

  return (
    <section className="card p-6" aria-labelledby="bank-account-title" data-testid="bank-account">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bank-account-title" className="flex items-center gap-2 font-display text-lg font-extrabold text-oc-ink">
          <Landmark className="h-5 w-5 text-oc-green" /> Bank Account
        </h2>
        {account && !editing && (
          <button type="button" className="btn-ghost px-4 py-2" onClick={startEditing} data-testid="bank-edit">
            <Pencil className="h-4 w-4" /> Edit Bank Account
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-oc-muted">The account your payouts will be sent to.</p>

      <div className="mt-4 space-y-4">
        {message.text && <Alert tone={message.tone}>{message.text}</Alert>}

        {account === undefined && !loadError && (
          <p className="flex items-center gap-2 text-sm text-oc-muted" data-testid="bank-loading"><Spinner className="h-4 w-4" /> Loading your bank details…</p>
        )}

        {loadError && (
          <div className="space-y-2">
            <Alert tone="error">{loadError}</Alert>
            <button type="button" className="btn-ghost px-3 py-2" onClick={load}><RotateCw className="h-4 w-4" /> Try again</button>
          </div>
        )}

        {account === null && !editing && (
          <div className="rounded-xl border border-dashed border-oc-line p-5 text-center" data-testid="bank-empty">
            <p className="text-sm text-oc-muted">You have not added a bank account yet.</p>
            <button type="button" className="btn-primary mt-3" onClick={startEditing} data-testid="bank-add">
              <Plus className="h-4 w-4" /> Add Bank Account
            </button>
          </div>
        )}

        {account && !editing && <BankAccountDetails account={account} />}

        {editing && (
          <form onSubmit={save} className="space-y-4" noValidate data-testid="bank-form">
            <div className="grid gap-4 sm:grid-cols-2">
              {field('account_holder_name', 'Account holder name', { autoComplete: 'name', maxLength: 120 })}
              {field('bank_name', 'Bank name', { autoComplete: 'off', maxLength: 120 })}
              {field('account_number', 'Account number', { inputMode: 'numeric', autoComplete: 'off', maxLength: 22, spellCheck: false })}
              {field('confirm_account_number', 'Confirm account number', { inputMode: 'numeric', autoComplete: 'off', maxLength: 22, spellCheck: false })}
              {field('ifsc', 'IFSC', {
                autoComplete: 'off', maxLength: 11, spellCheck: false, className: 'field-input uppercase',
                onChange: (event) => setForm((current) => ({ ...current, ifsc: event.target.value.toUpperCase() })),
              })}
            </div>
            {account && <p className="text-xs text-oc-muted">For your security the saved account number is never shown. Enter it again to save changes. Changed details will need to be verified again.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={saving} data-testid="bank-save">
                {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} {saving ? 'Saving…' : 'Save Bank Account'}
              </button>
              <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function BankAccountDetails({ account }) {
  const status = BANK_STATUS[account.verification_status] || BANK_STATUS.UNVERIFIED
  return (
    <div className="space-y-3" data-testid="bank-details">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Account holder" value={account.account_holder_name} />
        <Row label="Bank name" value={account.bank_name} />
        <Row label="Account number" value={<span className="tracking-wider" data-testid="bank-masked">{maskAccountNumber(account.account_number_last4)}</span>} />
        <Row label="IFSC" value={account.ifsc_code} />
      </dl>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${status.tone}`} data-testid="bank-status">{status.label}</span>
        <span className="text-oc-muted">{status.note}</span>
      </p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="rounded-xl border border-oc-line px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-oc-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-oc-ink">{value}</dd>
    </div>
  )
}
