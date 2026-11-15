// The name to show for an account: the first of the given values that is a real name,
// skipping empty ones and any that is really a phone number. A phone number is never a
// name on a card, list, chat or profile; the server refuses one on save (backend
// app/core/display_names.py, the same rule) and migration 0004 corrected old rows, so
// this is the last line of defence, not the rule itself.

const PUNCTUATION = /[\s()+.-]/g
const MIN_DIGITS = 6

/** Only digits once spaces and + - ( ) . are removed, at least six of them. */
export function looksLikePhone(value) {
  const stripped = String(value ?? '').replace(PUNCTUATION, '')
  return stripped.length >= MIN_DIGITS && /^\d+$/.test(stripped)
}

/** displayName(company_name, name) -> the company name, else the person's name. */
export function displayName(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value && !looksLikePhone(value)) return value
  }
  return ''
}
