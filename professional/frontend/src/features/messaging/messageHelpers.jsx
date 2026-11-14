// Whether an account is signed in on this browser (the sockets ask before connecting).
export { hasSignedInUser } from '../../shared/auth/signedInAccount.js'

export function initials(name) {
  // No name yet: the initial of the word this language uses for a person, not a
  // hardcoded Latin "U" that read as an English letter in all seven languages.
  return String(name || translate('ui.shared.user')).slice(0, 2).toUpperCase()
}

export function messageAttachmentType(url) {
  if (!url) return 'TEXT'
  return /\.(png|jpe?g|webp|gif)$/i.test(url) ? 'IMAGE' : 'DOCUMENT'
}

// `t` stays an accepted argument so existing callers are unchanged, but it no
// longer decides whether the label is translated: a caller that forgot it used
// to get the English word in every language. The active language is read
// directly instead, so there is no English fallback left to fall back to.
const MESSAGE_TYPE_LABEL_KEYS = {
  REQUEST: 'dash.common.request',
  QUOTATION: 'dash.common.quotation',
  ASSIGNMENT: 'ui.shared.assignment',
}

export function messageTypeLabel(messageType, t) {
  const key = MESSAGE_TYPE_LABEL_KEYS[messageType]
  return key ? translatorFrom(t)(key) : ''
}

export function parseRequestMessage(message) {
  if (message.messageType !== 'REQUEST') return null
  try {
    const details = JSON.parse(message.body)
    return details?.kind === 'PROJECT_REQUEST' ? details : null
  } catch {
    return null
  }
}

export function requestBodyWithStatus(message, requestId, status) {
  if (message.messageType !== 'REQUEST') return message
  try {
    const details = JSON.parse(message.body)
    if (details?.kind !== 'PROJECT_REQUEST' || details.request_id !== requestId) return message
    const nextBody = JSON.stringify({ ...details, status })
    return { ...message, body: nextBody, content: nextBody }
  } catch {
    return message
  }
}

export function parseAssignmentMessage(message) {
  if (message.messageType !== 'ASSIGNMENT') return null
  try {
    const details = JSON.parse(message.body)
    return details?.kind === 'PROJECT_ASSIGNMENT' ? details : null
  } catch {
    return null
  }
}

export function assignmentBodyWithStatus(message, requestId, status) {
  if (message.messageType !== 'ASSIGNMENT') return message
  try {
    const details = JSON.parse(message.body)
    if (details?.kind !== 'PROJECT_ASSIGNMENT' || details.request_id !== requestId) return message
    const nextBody = JSON.stringify({ ...details, status })
    return { ...message, body: nextBody, content: nextBody }
  } catch {
    return message
  }
}

import { formatMoney as countryFormatMoney } from '../../shared/utils/countryConfig.js'
import { formatDate, formatTime } from '../../shared/utils/formatters.js'
import { translate, translatorFrom } from '../../i18n/translate.js'
import { requestTypeLabel } from '../../shared/utils/roleLabels.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/** Whole units of the project's currency, placed the way the language places it. */
export function formatMoney(value, country = 'India') {
  return countryFormatMoney(value, country, { maximumFractionDigits: 0 })
}

export function formatMessageTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || ''
  // Was pinned to en-IN, so every message in every language was stamped with an
  // English "AM" / "PM". The formatter follows the selected language instead,
  // and knows which languages use a 12-hour clock at all.
  return formatTime(date)
}

// `t` stays accepted for existing callers, but Today / Yesterday no longer
// depend on it: a caller that omitted it used to get the English words in all
// seven languages.
export function dayLabel(value, t) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const translator = translatorFrom(t)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(date, today)) return translator('ui.shared.today')
  if (sameDay(date, yesterday)) return translator('ui.shared.yesterday')
  // The month name came back as "Sep" whatever was selected; this is the
  // month's name in the reader's language, with the same day/month/year shape.
  return formatDate(date, '', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

/**
 * Display name for a stored request type code; the code itself is untouched.
 *
 * This used to lower-case the raw enum when it had no phrase of its own, so a
 * CONTRACTOR_TO_SUPPLIER request was announced as "contractor to supplier" —
 * English word order, English words, in every language. `requestTypeLabel` has
 * a written name for every code in all seven languages, so that is what is
 * shown; the raw code only survives as a last resort for a code nobody has
 * named yet.
 */
export function formatRequestType(value, t) {
  return requestTypeLabel(value, t) || translate('dash.common.request')
}

export function ContactValue({ value, visible }) {
  const { t } = useLanguage()
  return (
    <span className={visible ? '' : 'select-none blur-sm'}>{visible ? value || t('dash.owner.supplierModal.notShared') : value || t('dash.common.lockedUntilAccepted')}</span>
  )
}

export function profileList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}
