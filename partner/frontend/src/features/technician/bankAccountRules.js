/**
 * The bank-account form's checks, mirroring the Partner backend's.
 *
 * A convenience only: the server applies the same rules and every refusal it
 * sends is shown as it sends it. No imports, so the unit tests load this under
 * plain Node.
 */

export const BANK_STATUS = {
  UNVERIFIED: { label: 'Not verified', tone: 'bg-slate-100 text-slate-700', note: 'Your bank details have not been verified yet.' },
  PENDING: { label: 'Verification pending', tone: 'bg-amber-50 text-amber-800', note: 'Your bank details are being checked.' },
  VERIFIED: { label: 'Verified', tone: 'bg-emerald-50 text-emerald-800', note: 'Your bank details have been verified.' },
  REJECTED: { label: 'Rejected', tone: 'bg-red-50 text-red-700', note: 'These bank details could not be verified. Please check and update them.' },
}

export const EMPTY_BANK_FORM = { account_holder_name: '', bank_name: '', account_number: '', confirm_account_number: '', ifsc: '' }

const HOLDER = /^[\p{L}]+(?:[ .'-]{1,2}[\p{L}]+)*\.?$/u
const BANK = /^[\p{L}\p{N} .,'&()-]+$/u
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/

const collapse = (value) => (value ?? '').split(/\s+/).filter(Boolean).join(' ')
export const normalizeAccountNumber = (value) => (value ?? '').replace(/ /g, '')
export const normalizeIfsc = (value) => (value ?? '').trim().toUpperCase()

/** "••••••1234" -- the only form in which a saved number is ever shown. */
export function maskAccountNumber(last4) {
  return last4 ? `••••••${last4}` : ''
}

/** { field: message } for every field that fails; empty when the form may be sent. */
export function bankFormProblems(form) {
  const problems = {}
  const holder = collapse(form.account_holder_name)
  if (holder.length < 2 || holder.length > 120 || !HOLDER.test(holder)) {
    problems.account_holder_name = "Enter the account holder's name as it appears on the bank account."
  }
  const bank = collapse(form.bank_name)
  if (bank.length < 2 || bank.length > 120 || !BANK.test(bank) || !/\p{L}/u.test(bank)) {
    problems.bank_name = 'Enter the name of the bank.'
  }
  const number = normalizeAccountNumber(form.account_number)
  if (!/^[0-9]{9,18}$/.test(number) || /^0+$/.test(number)) {
    problems.account_number = 'Enter a valid bank account number (9 to 18 digits).'
  }
  if (!problems.account_number && normalizeAccountNumber(form.confirm_account_number) !== number) {
    problems.confirm_account_number = 'The account numbers do not match.'
  }
  if (!IFSC.test(normalizeIfsc(form.ifsc))) {
    problems.ifsc = 'Enter a valid 11-character IFSC code, e.g. SBIN0001234.'
  }
  return problems
}

/** What is sent: trimmed and normalised the way the server stores it. */
export function bankPayload(form) {
  return {
    account_holder_name: collapse(form.account_holder_name),
    bank_name: collapse(form.bank_name),
    account_number: normalizeAccountNumber(form.account_number),
    confirm_account_number: normalizeAccountNumber(form.confirm_account_number),
    ifsc: normalizeIfsc(form.ifsc),
  }
}
