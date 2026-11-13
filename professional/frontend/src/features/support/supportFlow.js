/**
 * The guided support form's rules, kept apart from the screens so they can be
 * tested on their own (supportFlow.test.js).
 *
 * Everything the form offers -- account types, categories, issues, the extra
 * fields an issue asks for, phone countries, statuses -- comes from
 * GET /support/config. Nothing here invents a choice; it only applies the
 * server's taxonomy to what the person has picked so far.
 *
 * One state object holds the whole journey (Guided Support Flow brief, §7), so
 * Back never loses what was entered.
 */

export const STEPS = [
  { number: 1, label: 'Account' },
  { number: 2, label: 'Category' },
  { number: 3, label: 'Issue' },
  { number: 4, label: 'Details' },
  { number: 5, label: 'Review' },
  { number: 6, label: 'Done' },
]

export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Older browsers: a v4-shaped id from Math.random (only used to recognise a repeat).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

/** The starting state; a signed-in account's details and type are filled in. */
export function initialFlow(config) {
  const account = config?.account || null
  const country = phoneCountryFor(config, account?.dial_code) || defaultPhoneCountry(config)
  return {
    requestId: newRequestId(),
    currentStep: 1,
    accountType: account?.account_type || null,
    category: null,
    issueType: null,
    // A topic card picked before the account type: used once the type allows it.
    preferredCategory: null,
    subject: '',
    subjectEdited: false,
    details: { description: '', fields: {}, attachment: null },
    contact: {
      name: account?.name || '',
      email: account?.email || '',
      dialCode: account?.dial_code || country?.dial_code || '',
      phone: account?.phone || '',
    },
    priority: 'NORMAL',
  }
}

// --- Taxonomy lookups -------------------------------------------------------

export function categoriesFor(config, accountType) {
  if (!config || !accountType) return []
  const allowed = config.account_type_categories?.[accountType] || []
  return (config.categories || []).filter((category) => allowed.includes(category.key))
}

export function findCategory(config, key) {
  return (config?.categories || []).find((category) => category.key === key) || null
}

export function issuesFor(config, categoryKey) {
  return findCategory(config, categoryKey)?.issues || []
}

export function findIssue(config, categoryKey, issueKey) {
  return issuesFor(config, categoryKey).find((issue) => issue.key === issueKey) || null
}

/** The extra fields the chosen issue asks for, with their labels. */
export function detailFieldsFor(config, categoryKey, issueKey) {
  const issue = findIssue(config, categoryKey, issueKey)
  if (!issue) return []
  const specs = Object.fromEntries((config.detail_fields || []).map((field) => [field.key, field]))
  return issue.fields.map((key) => specs[key]).filter(Boolean)
}

export function labelOf(list, key) {
  return (list || []).find((item) => item.key === key)?.label || ''
}

// --- Moving through the steps -------------------------------------------------

export function chooseAccountType(flow, config, accountType) {
  const stillAllowed = categoriesFor(config, accountType).some((category) => category.key === flow.category)
  const preferred = categoriesFor(config, accountType).some((category) => category.key === flow.preferredCategory)
  const next = {
    ...flow,
    accountType,
    // A category the new type does not offer is dropped, with its issue.
    category: stillAllowed ? flow.category : preferred ? flow.preferredCategory : null,
    issueType: stillAllowed ? flow.issueType : null,
  }
  return next
}

export function chooseCategory(flow, category) {
  if (flow.category === category) return flow
  return { ...flow, category, issueType: null, preferredCategory: null }
}

export function chooseIssue(flow, config, issueType) {
  const issue = findIssue(config, flow.category, issueType)
  return {
    ...flow,
    issueType,
    // The subject follows the issue until the person writes their own.
    subject: flow.subjectEdited ? flow.subject : issue?.label || '',
  }
}

/** A topic card: go straight to the issue list when the account type allows it. */
export function chooseTopic(flow, config, category) {
  if (flow.accountType && categoriesFor(config, flow.accountType).some((item) => item.key === category)) {
    return { ...chooseCategory(flow, category), currentStep: 3 }
  }
  return { ...flow, preferredCategory: category, currentStep: 1 }
}

export function goTo(flow, step) {
  return { ...flow, currentStep: Math.max(1, Math.min(6, step)) }
}

// --- Phone numbers ----------------------------------------------------------------

export function phoneCountryFor(config, dialCode) {
  return (config?.phone_countries || []).find((country) => country.dial_code === dialCode) || null
}

export function defaultPhoneCountry(config) {
  const countries = config?.phone_countries || []
  return countries.find((country) => country.locality === config?.default_country) || countries[0] || null
}

export function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

/** An error message, or '' when the number is valid (or empty: phone is optional). */
export function phoneError(config, dialCode, phone) {
  let digits = phoneDigits(phone)
  if (!digits) return ''
  const country = phoneCountryFor(config, dialCode)
  if (!country) return 'Please choose a country code.'
  const codeDigits = country.dial_code.replace('+', '')
  if (digits.length === country.digits + codeDigits.length && digits.startsWith(codeDigits)) {
    digits = digits.slice(codeDigits.length)
  }
  return new RegExp(country.pattern).test(digits) ? '' : `Please enter a valid ${country.digits}-digit ${country.name} number.`
}

// --- Validation per step ------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Field errors for one step, keyed by field ({} when the step is complete). */
export function stepErrors(flow, config, step = flow.currentStep) {
  const errors = {}
  if (step === 1 && !flow.accountType) errors.accountType = 'Please choose your account type.'
  if (step === 2 && !flow.category) errors.category = 'Please choose an issue category.'
  if (step === 3 && !flow.issueType) errors.issueType = 'Please choose the issue.'
  if (step === 4) {
    const description = flow.details.description.trim()
    const { min_length: min = 10, max_length: max = 2000 } = config?.description || {}
    if (description.length < min) errors.description = `Please describe the issue in at least ${min} characters.`
    else if (description.length > max) errors.description = `Please keep the description under ${max} characters.`
    if (!flow.subject.trim()) errors.subject = 'Please enter a subject.'
    const attachment = flow.details.attachment
    if (attachment) {
      const { content_types: types = [], max_bytes: maxBytes = 0 } = config?.attachment || {}
      if (types.length && !types.includes(attachment.type)) errors.attachment = 'Attach a PDF, JPG, PNG or WEBP file.'
      else if (maxBytes && attachment.size > maxBytes) errors.attachment = `The file must be ${Math.round(maxBytes / 1048576)} MB or smaller.`
    }
    const paymentDate = flow.details.fields.payment_date
    if (paymentDate && paymentDate > new Date().toISOString().slice(0, 10)) errors.payment_date = 'The payment date cannot be in the future.'
  }
  if (step === 5) {
    if (!flow.contact.name.trim()) errors.name = 'Please enter your name.'
    if (!flow.contact.email.trim()) errors.email = 'Please enter your email address.'
    else if (!EMAIL_PATTERN.test(flow.contact.email.trim())) errors.email = 'Please enter a valid email address.'
    const phone = phoneError(config, flow.contact.dialCode, flow.contact.phone)
    if (phone) errors.phone = phone
  }
  return errors
}

// --- Submission -----------------------------------------------------------------

/** The JSON the API takes as `payload`; only the chosen issue's fields go. */
export function buildPayload(flow, config) {
  const allowed = detailFieldsFor(config, flow.category, flow.issueType).map((field) => field.key)
  const details = {}
  for (const key of allowed) {
    const value = String(flow.details.fields[key] || '').trim()
    if (value) details[key] = value
  }
  return {
    client_request_id: flow.requestId,
    account_type: flow.accountType,
    category: flow.category,
    issue_type: flow.issueType,
    subject: flow.subject.trim(),
    description: flow.details.description.trim(),
    details,
    contact: {
      name: flow.contact.name.trim(),
      email: flow.contact.email.trim(),
      dial_code: phoneDigits(flow.contact.phone) ? flow.contact.dialCode : '',
      phone: phoneDigits(flow.contact.phone),
    },
    priority: flow.priority,
  }
}

// Which step holds each server-side field, so a 422 sends the person back to it.
const FIELD_STEPS = {
  account_type: [1, 'accountType'],
  category: [2, 'category'],
  issue_type: [3, 'issueType'],
  description: [4, 'description'],
  subject: [4, 'subject'],
  attachment: [4, 'attachment'],
  name: [5, 'name'],
  email: [5, 'email'],
  dial_code: [5, 'phone'],
  phone: [5, 'phone'],
  priority: [5, 'priority'],
}

/**
 * Read a failed submission: {step, errors, message}. A field error names the
 * step to return to; anything else is a message for the whole form.
 */
export function submissionFailure(error) {
  const status = error?.response?.status
  const detail = error?.response?.data?.detail
  if (status === 422 && Array.isArray(detail) && detail.length) {
    const errors = {}
    let step = 6
    for (const item of detail) {
      const loc = (item.loc || []).filter((part) => part !== 'body' && part !== 'contact')
      const key = loc[0] === 'details' ? loc[1] : loc[0]
      const [fieldStep, field] = FIELD_STEPS[key] || [4, key]
      errors[field] = item.msg
      step = Math.min(step, fieldStep)
    }
    return { step: step === 6 ? null : step, errors, message: '' }
  }
  if (status === 503) return { step: null, errors: {}, message: typeof detail === 'string' ? detail : 'Support requests are not available right now. Please use email instead.' }
  if (status === 429) return { step: null, errors: {}, message: 'Too many support requests. Please try again later.' }
  if (status === 413) return { step: 4, errors: { attachment: 'The file is too large.' }, message: '' }
  if (status === 415) return { step: 4, errors: { attachment: 'Attach a PDF, JPG, PNG or WEBP file.' }, message: '' }
  if (typeof detail === 'string' && status && status < 500) return { step: null, errors: {}, message: detail }
  return { step: null, errors: {}, message: 'We could not submit your request. Please check your connection and try again.' }
}

// --- Search ---------------------------------------------------------------------

function normalise(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ')
}

/**
 * Search the help content the application already has (the Help Center
 * questions and answers, passed in already translated) and the support topics
 * from the server's taxonomy. Every word of the query must appear.
 */
export function searchHelp(query, { faqs = [], config = null } = {}) {
  const words = normalise(query).split(/\s+/).filter((word) => word.length > 1)
  if (!words.length) return []
  const matches = (text) => {
    const haystack = normalise(text)
    return words.every((word) => haystack.includes(word))
  }
  const results = []
  for (const faq of faqs) {
    if (matches(`${faq.question} ${faq.answer}`)) results.push({ kind: 'faq', id: faq.id, title: faq.question, body: faq.answer })
  }
  for (const category of config?.categories || []) {
    if (matches(category.label)) results.push({ kind: 'topic', id: `category:${category.key}`, title: category.label, category: category.key })
    for (const issue of category.issues) {
      if (matches(`${issue.label} ${category.label}`)) {
        results.push({ kind: 'topic', id: `issue:${category.key}:${issue.key}`, title: issue.label, subtitle: category.label, category: category.key, issue: issue.key })
      }
    }
  }
  return results.slice(0, 12)
}
