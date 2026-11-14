/**
 * Start Work OTP input helpers. No imports: unit-tested under Node. The server
 * decides whether a code is right; these only keep what is typed tidy.
 */

export const OTP_LENGTH = 6

/** Digits only, at most six: "48 26-19" -> "482619". */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH)
}

/** The six boxes after typing `value` into box `index` (a paste fills from there). */
export function fillDigits(digits, index, value) {
  const incoming = String(value ?? '').replace(/\D/g, '')
  const next = [...digits]
  if (!incoming) {
    next[index] = ''
    return next
  }
  for (let offset = 0; offset < incoming.length && index + offset < OTP_LENGTH; offset += 1) {
    next[index + offset] = incoming[offset]
  }
  return next
}

export function isComplete(digits) {
  return digits.length === OTP_LENGTH && digits.every((digit) => /^[0-9]$/.test(digit))
}

/** "482619" -> "482 619", easier to read aloud. */
export function groupedCode(code) {
  const value = digitsOnly(code)
  return value.length === OTP_LENGTH ? `${value.slice(0, 3)} ${value.slice(3)}` : value
}
