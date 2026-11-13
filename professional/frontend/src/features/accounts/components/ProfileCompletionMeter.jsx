/**
 * Profile completion, as the API reports it.
 *
 * The percentage and the required-field list are read from
 * `user.profile_completion`, which the API computes from the same field list
 * that decides `profile_complete`. Nothing is measured or stored here, so these
 * helpers can never disagree with the gate that blocks an action.
 */
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

/**
 * The completion percentage for a user, or null when it cannot be known.
 *
 * Exported so anything that needs to react to completion reads the same value
 * - there is one derivation, not two that can disagree. The number itself is
 * computed by the API and travels on the user payload.
 *
 * A session stored before the API sent this field falls back to the boolean it
 * did send, so an older tab shows something truthful rather than nothing.
 */
export function profileCompletionPercent(user) {
  if (!user) return null
  if (Number.isFinite(user?.profile_completion?.percent)) return user.profile_completion.percent
  return user?.profile_complete === true ? 100 : null
}

/**
 * The field keys this role must supply, straight from `profile_completion`, the
 * API's one definition of what a complete profile is. A form asks this which of
 * its labels to mark; nothing here decides what is mandatory.
 *
 * A session stored before the API sent the list yields an empty set, so an older
 * tab simply shows no marks rather than guessing at them.
 */
export function requiredProfileFields(user) {
  const list = user?.profile_completion?.required_fields
  return new Set(Array.isArray(list) ? list.map((entry) => entry?.field).filter(Boolean) : [])
}

/**
 * The mandatory marker itself. Read out as "required" rather than "asterisk".
 *
 * `satisfied` is for a required field that already holds a value: the marker
 * still says the field is required, but in a neutral tone, so a completed value
 * does not read as an outstanding problem. Validation errors are shown by the
 * form's own error messages, never by this mark.
 */
export function RequiredMark({ satisfied = false }) {
  const { t } = useLanguage()
  return <span className={`ml-0.5 font-bold ${satisfied ? 'text-slate-400' : 'text-rose-600'}`} title={t('ui.shared.required')}><span aria-hidden="true">*</span><span className="sr-only">{t('ui.shared.requiredLower')}</span></span>
}
