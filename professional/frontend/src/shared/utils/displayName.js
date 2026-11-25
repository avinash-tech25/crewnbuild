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

const LOWER_WORD = /(^|[\s,.(/-])([a-z])(?=[a-z]+(?![a-zA-Z]*[A-Z]))/g
const CAPITAL_WORD = /(?<![A-Za-z])[A-Z]{5,}(?![A-Za-z])/g

/** A place with each word's first letter in capital ("gachibowli" -> "Gachibowli"). */
export function properPlace(value) {
  return String(value ?? '').replace(LOWER_WORD, (_, before, letter) => before + letter.toUpperCase())
}

/** A person's name the same way, an all-capitals word of five letters or more included. */
export function properName(value) {
  return properPlace(value).replace(CAPITAL_WORD, (word) => word[0] + word.slice(1).toLowerCase())
}

/** Text written wholly in capitals, in normal letters ("TRUSTED COMPANY" -> "Trusted company"). */
export function normalLetters(value) {
  const text = String(value ?? '')
  return /[A-Z]/.test(text) && !/[a-z]/.test(text) && text.trim().length > 4 ? text.trim()[0] + text.trim().slice(1).toLowerCase() : text
}

/** displayName(company_name, name) -> the company name, else the person's name. */
export function displayName(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value && !looksLikePhone(value)) return value
  }
  return ''
}
