/**
 * The guided support form (CREWNBUILD Guided Support Flow brief):
 *
 *   1 account type -> 2 category -> 3 issue -> 4 details -> 5 review -> 6 done
 *
 * Only what the current step needs is on screen. The whole journey lives in one
 * `flow` object owned by the page (so a topic card or a search result can steer
 * it), and Back never clears anything. Step 6 appears only after the API has
 * confirmed the ticket.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Building2, BriefcaseBusiness, CheckCircle2, CircleHelp, DraftingCompass, HardHat,
  Handshake, Home, Layers, Loader2, Lock, MessagesSquare, Package, Paperclip, Send, Ticket, UserRound,
  Wallet, Wrench, X,
} from 'lucide-react'
import PhoneField from './PhoneField.jsx'
import {
  STEPS, buildPayload, categoriesFor, chooseAccountType, chooseCategory, chooseIssue, detailFieldsFor,
  findCategory, findIssue, goTo, initialFlow, issuesFor, labelOf, stepErrors, submissionFailure,
} from '../supportFlow.js'
import { submitSupportTicket } from '../supportApi.js'

export const ACCOUNT_TYPE_ICONS = {
  HOMEOWNER: Home,
  BUILDER: HardHat,
  ENGINEER: DraftingCompass,
  SUPPLIER: Package,
  SERVICE_PARTNER: Handshake,
  OTHER: CircleHelp,
}

export const CATEGORY_ICONS = {
  ACCOUNT: UserRound,
  PROJECTS: Building2,
  LEADS: BriefcaseBusiness,
  ORDERS: Layers,
  PAYMENTS: Wallet,
  TECHNICAL: Wrench,
  OTHER: MessagesSquare,
}

export const inputClass =
  'h-11 w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none ' +
  'transition-[border-color,box-shadow] duration-200 placeholder:font-medium placeholder:text-oc-faint ' +
  'focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)] aria-[invalid=true]:border-red-400'

const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(18,107,69,.25)]'

function FieldError({ id, message }) {
  return message ? <p id={id} className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null
}

function Label({ htmlFor, children, required, hint }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-bold text-oc-ink">
      <span>{children}{required && <span className="text-red-600" aria-hidden="true"> *</span>}</span>
      {hint && <span className="font-semibold text-oc-muted">{hint}</span>}
    </label>
  )
}

/** One selectable card in a radio group (arrow keys move, Space/Enter select). */
function ChoiceCard({ icon: Icon, label, selected, onSelect, name }) {
  return (
    <label
      className={`group relative flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition
                  focus-within:ring-4 focus-within:ring-[rgba(18,107,69,.25)]
                  ${selected
                    ? 'border-oc-green bg-oc-mint/70 shadow-[0_8px_20px_-12px_rgba(18,107,69,.6)]'
                    : 'border-[rgba(8,62,43,.12)] bg-white hover:border-oc-green/50 hover:bg-oc-paper'}`}
    >
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      {Icon && (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${selected ? 'bg-oc-green text-white' : 'bg-oc-mint text-oc-green'}`}>
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      <span className="text-[13px] font-extrabold leading-snug text-oc-ink">{label}</span>
      {selected && <CheckCircle2 size={16} className="ms-auto shrink-0 text-oc-green" aria-hidden="true" />}
    </label>
  )
}

function StepIndicator({ current }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((step) => {
        const done = step.number < current
        const active = step.number === current
        return (
          <li key={step.number} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={active ? 'step' : undefined}>
            <span className={`h-1.5 rounded-full ${done ? 'bg-oc-green' : active ? 'bg-oc-amber' : 'bg-oc-line'}`} />
            <span className={`truncate text-[10px] font-bold ${active ? 'text-oc-ink' : done ? 'text-oc-green' : 'text-oc-faint'} max-[420px]:sr-only`}>
              {step.number}. {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function ReviewRow({ label, value, onEdit }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-wide text-oc-faint">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-semibold text-oc-ink">{value || '—'}</dd>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold text-oc-green hover:bg-oc-mint ${focusRing}`}>
          Edit
        </button>
      )}
    </div>
  )
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function GuidedSupportForm({ config, flow, setFlow, signedIn, ticketsAvailable }) {
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [ticket, setTicket] = useState(null)
  const headingRef = useRef(null)
  const fileRef = useRef(null)
  // Set synchronously: `busy` only takes effect after a re-render, so a fast
  // double click would otherwise send the request twice.
  const submittingRef = useRef(false)
  const step = flow.currentStep
  const account = config.account || null

  // Each step's heading takes focus, so keyboard and screen-reader users land on
  // the new question rather than on a button that disappeared.
  // Only when the step changes: a first-render flag is spent by StrictMode's
  // double effect run, and the page then jumped to the form on load.
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [step])

  const update = (changes) => setFlow((current) => ({ ...current, ...changes }))
  const updateDetails = (changes) => setFlow((current) => ({ ...current, details: { ...current.details, ...changes } }))
  const updateField = (key, value) => setFlow((current) => ({
    ...current, details: { ...current.details, fields: { ...current.details.fields, [key]: value } },
  }))
  const updateContact = (changes) => setFlow((current) => ({ ...current, contact: { ...current.contact, ...changes } }))
  const clearError = (key) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))

  const next = () => {
    const found = stepErrors(flow, config, step)
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    setFormMessage('')
    setFlow((current) => goTo(current, step + 1))
  }
  const back = () => { setErrors({}); setFormMessage(''); setFlow((current) => goTo(current, step - 1)) }

  const submit = async () => {
    if (busy || submittingRef.current) return
    // Every step again: a value may have been changed since it was passed.
    for (let number = 1; number <= 5; number += 1) {
      const found = stepErrors(flow, config, number)
      if (Object.values(found).some(Boolean)) {
        setErrors(found)
        setFlow((current) => goTo(current, number))
        return
      }
    }
    submittingRef.current = true
    setBusy(true)
    setFormMessage('')
    try {
      const created = await submitSupportTicket(buildPayload(flow, config), flow.details.attachment)
      setTicket(created)
      setFlow((current) => goTo(current, 6))
    } catch (error) {
      // Nothing is cleared: the person's answers stay for another try.
      const failure = submissionFailure(error)
      setErrors(failure.errors)
      setFormMessage(failure.message)
      if (failure.step) setFlow((current) => goTo(current, failure.step))
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  const startAgain = () => {
    setTicket(null)
    setErrors({})
    setFormMessage('')
    setFlow(initialFlow(config))
  }

  const categories = categoriesFor(config, flow.accountType)
  const issues = issuesFor(config, flow.category)
  const detailFields = detailFieldsFor(config, flow.category, flow.issueType)
  const descriptionMax = config.description?.max_length || 2000
  const attachment = flow.details.attachment
  const fromAccount = (key) => Boolean(account && account[key])

  const titles = {
    1: ['Who are you?', 'Choose your account type so we show the right options.'],
    2: ['What is it about?', 'Choose the area your question belongs to.'],
    3: ['What is the issue?', labelOf(config.categories, flow.category)],
    4: ['Tell us more', findIssue(config, flow.category, flow.issueType)?.label || ''],
    5: ['Review and submit', 'Check the details below, then send your request.'],
    6: ['Request submitted', ''],
  }
  const [title, subtitle] = titles[step]

  return (
    <section
      aria-labelledby="support-form-title"
      className="rounded-2xl border border-[rgba(8,62,43,.08)] bg-white p-5 shadow-[0_18px_50px_-28px_rgba(8,62,43,.35)] sm:p-7"
    >
      <div className="flex items-start gap-3.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-oc-green text-white shadow-[0_10px_22px_-10px_rgba(18,107,69,.8)]">
          <Send size={21} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="support-form-title" className="text-xl font-extrabold tracking-[-.02em] text-oc-ink">Send us a request</h2>
          <p className="mt-0.5 text-[13px] font-medium text-oc-muted">Answer a few short questions and we will create a support ticket for you.</p>
        </div>
      </div>

      {!ticketsAvailable && step < 6 && (
        <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
          Online support requests are not available yet. Please use the contact options on this page.
        </p>
      )}

      <div className="mt-5"><StepIndicator current={step} /></div>

      <div className="mt-5">
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-extrabold text-oc-ink outline-none">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] font-medium text-oc-muted">{subtitle}</p>}
      </div>

      <div className="mt-4">
        {step === 1 && (
          <fieldset aria-describedby={errors.accountType ? 'err-accountType' : undefined}>
            <legend className="sr-only">Account type</legend>
            <div className="grid grid-cols-2 gap-2.5 max-[420px]:grid-cols-1">
              {config.account_types.map((type) => (
                <ChoiceCard
                  key={type.key}
                  name="support-account-type"
                  icon={ACCOUNT_TYPE_ICONS[type.key]}
                  label={type.label}
                  selected={flow.accountType === type.key}
                  onSelect={() => { clearError('accountType'); setFlow((current) => chooseAccountType(current, config, type.key)) }}
                />
              ))}
            </div>
            <FieldError id="err-accountType" message={errors.accountType} />
          </fieldset>
        )}

        {step === 2 && (
          <fieldset aria-describedby={errors.category ? 'err-category' : undefined}>
            <legend className="sr-only">Issue category</legend>
            <div className="grid grid-cols-2 gap-2.5 max-[420px]:grid-cols-1">
              {categories.map((category) => (
                <ChoiceCard
                  key={category.key}
                  name="support-category"
                  icon={CATEGORY_ICONS[category.key]}
                  label={category.label}
                  selected={flow.category === category.key}
                  onSelect={() => { clearError('category'); setFlow((current) => chooseCategory(current, category.key)) }}
                />
              ))}
            </div>
            <FieldError id="err-category" message={errors.category} />
          </fieldset>
        )}

        {step === 3 && (
          <fieldset aria-describedby={errors.issueType ? 'err-issueType' : undefined}>
            <legend className="sr-only">Specific issue</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {issues.map((issue) => (
                <ChoiceCard
                  key={issue.key}
                  name="support-issue"
                  label={issue.label}
                  selected={flow.issueType === issue.key}
                  onSelect={() => { clearError('issueType'); setFlow((current) => chooseIssue(current, config, issue.key)) }}
                />
              ))}
            </div>
            <FieldError id="err-issueType" message={errors.issueType} />
          </fieldset>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="support-subject" required>Subject</Label>
              <input
                id="support-subject"
                className={inputClass}
                maxLength={160}
                value={flow.subject}
                aria-invalid={Boolean(errors.subject)}
                aria-describedby={errors.subject ? 'err-subject' : undefined}
                onChange={(event) => { clearError('subject'); update({ subject: event.target.value, subjectEdited: true }) }}
              />
              <FieldError id="err-subject" message={errors.subject} />
            </div>

            {detailFields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`support-${field.key}`} hint="Optional">{field.label}</Label>
                <input
                  id={`support-${field.key}`}
                  type={field.type === 'date' ? 'date' : 'text'}
                  max={field.type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                  maxLength={field.max_length}
                  className={inputClass}
                  value={flow.details.fields[field.key] || ''}
                  aria-invalid={Boolean(errors[field.key])}
                  aria-describedby={errors[field.key] ? `err-${field.key}` : undefined}
                  onChange={(event) => { clearError(field.key); updateField(field.key, event.target.value) }}
                  placeholder={field.key === 'device' ? 'e.g. Android phone, Chrome' : ''}
                />
                <FieldError id={`err-${field.key}`} message={errors[field.key]} />
              </div>
            ))}

            <div>
              <Label htmlFor="support-description" required hint={`${flow.details.description.length}/${descriptionMax}`}>
                Describe the issue
              </Label>
              <textarea
                id="support-description"
                rows={5}
                maxLength={descriptionMax}
                className={`${inputClass} !h-auto min-h-[120px] resize-y py-3`}
                value={flow.details.description}
                placeholder="What happened, what you expected, and any steps we can follow to see it."
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? 'err-description' : undefined}
                onChange={(event) => { clearError('description'); updateDetails({ description: event.target.value }) }}
              />
              <FieldError id="err-description" message={errors.description} />
            </div>

            <div>
              <span className="mb-1.5 flex items-baseline justify-between text-xs font-bold text-oc-ink">
                <span>Screenshot or document</span>
                <span className="font-semibold text-oc-muted">Optional · PDF, JPG, PNG, WEBP · up to {Math.round((config.attachment?.max_bytes || 0) / 1048576)} MB</span>
              </span>
              {attachment ? (
                <div className="flex items-center gap-3 rounded-xl border border-[rgba(8,62,43,.15)] bg-oc-paper px-3 py-2.5">
                  <Paperclip size={16} className="shrink-0 text-oc-green" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-oc-ink">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => { clearError('attachment'); updateDetails({ attachment: null }); if (fileRef.current) fileRef.current.value = '' }}
                    className={`grid h-8 w-8 place-items-center rounded-lg text-oc-muted hover:bg-white hover:text-oc-ink ${focusRing}`}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className={`flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[rgba(8,62,43,.25)] bg-oc-paper px-3 text-sm font-bold text-oc-green hover:border-oc-green focus-within:ring-4 focus-within:ring-[rgba(18,107,69,.25)]`}>
                  <Paperclip size={16} aria-hidden="true" /> Attach a file
                  <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    accept={(config.attachment?.content_types || []).join(',')}
                    onChange={(event) => { clearError('attachment'); updateDetails({ attachment: event.target.files?.[0] || null }) }}
                  />
                </label>
              )}
              <FieldError id="err-attachment" message={errors.attachment} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <dl className="divide-y divide-oc-line rounded-xl border border-oc-line px-4">
              <ReviewRow label="Account type" value={labelOf(config.account_types, flow.accountType)} onEdit={() => setFlow((c) => goTo(c, 1))} />
              <ReviewRow label="Category" value={findCategory(config, flow.category)?.label} onEdit={() => setFlow((c) => goTo(c, 2))} />
              <ReviewRow label="Issue" value={findIssue(config, flow.category, flow.issueType)?.label} onEdit={() => setFlow((c) => goTo(c, 3))} />
              <ReviewRow label="Subject" value={flow.subject} onEdit={() => setFlow((c) => goTo(c, 4))} />
              {detailFields.filter((field) => flow.details.fields[field.key]).map((field) => (
                <ReviewRow key={field.key} label={field.label} value={flow.details.fields[field.key]} />
              ))}
              <ReviewRow label="Description" value={flow.details.description} onEdit={() => setFlow((c) => goTo(c, 4))} />
              {attachment && <ReviewRow label="Attachment" value={attachment.name} />}
            </dl>

            <fieldset className="space-y-3">
              <legend className="text-sm font-extrabold text-oc-ink">Your contact details</legend>
              {signedIn && (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-oc-muted">
                  <Lock size={13} aria-hidden="true" /> Filled in from your profile. Change them in Profile Settings.
                </p>
              )}
              <div>
                <Label htmlFor="support-name" required>Full name</Label>
                <input
                  id="support-name"
                  autoComplete="name"
                  className={`${inputClass} ${fromAccount('name') ? '!bg-oc-sunken' : ''}`}
                  value={flow.contact.name}
                  readOnly={fromAccount('name')}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'err-name' : undefined}
                  onChange={(event) => { clearError('name'); updateContact({ name: event.target.value }) }}
                />
                <FieldError id="err-name" message={errors.name} />
              </div>
              <div>
                <Label htmlFor="support-email" required>Email address</Label>
                <input
                  id="support-email"
                  type="email"
                  autoComplete="email"
                  className={`${inputClass} ${fromAccount('email') ? '!bg-oc-sunken' : ''}`}
                  value={flow.contact.email}
                  readOnly={fromAccount('email')}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'err-email' : undefined}
                  onChange={(event) => { clearError('email'); updateContact({ email: event.target.value }) }}
                />
                <FieldError id="err-email" message={errors.email} />
              </div>
              <div>
                <Label htmlFor="support-phone" hint={fromAccount('phone') ? '' : 'Optional'}>Phone number</Label>
                <PhoneField
                  id="support-phone"
                  countries={config.phone_countries}
                  dialCode={flow.contact.dialCode}
                  phone={flow.contact.phone}
                  readOnly={fromAccount('phone')}
                  error={errors.phone}
                  inputClass={inputClass}
                  onChange={({ dialCode, phone }) => { clearError('phone'); updateContact({ dialCode, phone }) }}
                />
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-extrabold text-oc-ink">Priority</legend>
              <div className="grid grid-cols-2 gap-2.5">
                <ChoiceCard name="support-priority" label="Normal" selected={flow.priority === 'NORMAL'} onSelect={() => update({ priority: 'NORMAL' })} />
                {signedIn ? (
                  <ChoiceCard name="support-priority" label="Urgent" selected={flow.priority === 'URGENT'} onSelect={() => { clearError('priority'); update({ priority: 'URGENT' }) }} />
                ) : (
                  <p className="flex items-center rounded-xl border border-dashed border-oc-line px-3 text-xs font-semibold text-oc-muted">
                    Urgent is available after signing in.
                  </p>
                )}
              </div>
              <p className="mt-1.5 text-xs font-medium text-oc-muted">Use Urgent only when you cannot work at all. One urgent request at a time.</p>
              <FieldError id="err-priority" message={errors.priority} />
            </fieldset>
          </div>
        )}

        {step === 6 && ticket && (
          <div className="text-center" role="status">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-oc-mint text-oc-green">
              <CheckCircle2 size={30} aria-hidden="true" />
            </span>
            <p className="mt-4 text-sm font-semibold text-oc-muted">Your ticket reference</p>
            <p className="mt-1 font-mono text-2xl font-extrabold tracking-wide text-oc-ink">{ticket.reference}</p>
            <dl className="mx-auto mt-5 grid max-w-sm grid-cols-1 gap-3 rounded-xl border border-oc-line p-4 text-start sm:grid-cols-3">
              <div><dt className="text-[11px] font-bold uppercase text-oc-faint">Category</dt><dd className="text-sm font-bold text-oc-ink">{ticket.category_label}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase text-oc-faint">Submitted</dt><dd className="text-sm font-bold text-oc-ink">{formatDate(ticket.created_at)}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase text-oc-faint">Status</dt><dd className="text-sm font-bold text-oc-green">{ticket.status_label}</dd></div>
            </dl>
            <p className="mx-auto mt-4 max-w-sm text-[13px] font-medium text-oc-muted">
              {signedIn
                ? 'You can follow it and read our replies under My Support Tickets.'
                : 'Keep this reference. Sign in with the same account to follow your requests under My Support Tickets.'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              {signedIn ? (
                <Link to={`/contact-us/tickets/${encodeURIComponent(ticket.reference)}`} className={`inline-flex h-11 items-center gap-2 rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white hover:bg-oc-deep ${focusRing}`}>
                  <Ticket size={16} aria-hidden="true" /> View ticket
                </Link>
              ) : null}
              <button type="button" onClick={startAgain} className={`inline-flex h-11 items-center rounded-xl border border-[rgba(8,62,43,.25)] px-5 text-sm font-extrabold text-oc-deep hover:bg-oc-mint ${focusRing}`}>
                Submit another request
              </button>
            </div>
          </div>
        )}
      </div>

      {formMessage && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{formMessage}</p>
      )}

      {step < 6 && (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-oc-line pt-4">
          {step > 1 ? (
            <button type="button" onClick={back} disabled={busy} className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-extrabold text-oc-deep hover:bg-oc-mint disabled:opacity-50 ${focusRing}`}>
              <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden="true" /> Back
            </button>
          ) : <span />}
          {step < 5 ? (
            <button type="button" onClick={next} className={`inline-flex h-11 items-center gap-2 rounded-xl bg-oc-green px-6 text-sm font-extrabold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] hover:bg-oc-deep ${focusRing}`}>
              Next <ArrowRight size={16} className="rtl:-scale-x-100" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy || !ticketsAvailable}
              aria-busy={busy}
              className={`inline-flex h-11 items-center gap-2 rounded-xl bg-oc-green px-6 text-sm font-extrabold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {busy ? 'Submitting…' : 'Submit request'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
