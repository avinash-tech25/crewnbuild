import { budgetInWords } from '../utils/amountInWords.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/**
 * The budget typed above it, written out in words. Display only.
 *
 * `budgetInWords` assembles an English phrase — "Forty Two Lakh Rupees" — from
 * hardcoded word lists, one word per digit group. There is no key to look that
 * up by: the phrase is built at runtime out of the number, so the key table
 * cannot hold it and no amount of key lookup would reach it. It goes through
 * `td` instead, which machine-translates the finished phrase for display. The
 * number itself is untouched, and nothing here is stored or sent.
 *
 * This matters more than it looks: the paragraph is an `aria-live` region, so
 * until now a screen reader in Hindi or Arabic announced an English sentence in
 * the middle of the form the moment a budget was typed.
 */
export default function BudgetInWords({ value, country = 'India', className = '' }) {
  const { td } = useLanguage()
  const words = budgetInWords(value, country)
  if (!words) return null
  return (
    <p aria-live="polite" data-testid="budget-in-words" className={`mt-1 text-[11px] font-semibold text-oc-green ${className}`}>
      {td(words)}
    </p>
  )
}
