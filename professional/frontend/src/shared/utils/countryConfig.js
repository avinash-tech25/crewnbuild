// Centralized per-country configuration for projects.
//
// The PROJECT country controls the project's local configuration: currency,
// languages, and the payment providers available for it. Customer residence
// never determines any of these. Payment providers are preparation only — no
// real integration is wired up yet.
//
// Every `label` below is a GETTER rather than a string. A plain string would be
// resolved once, when this module is first imported, and would then stay in
// whichever language was selected at that moment — a country picker built after
// a language change would still read "India". Reading through a getter looks the
// label up at the moment it is rendered, so it always follows the selection.
// The `id`, `code`, `currency.code` and `currency.symbol` values are NOT
// localised: they are what is stored, sent and matched against.

import { translate } from '../../i18n/translate.js'
import { activeLocale } from './formatters.js'

export const COUNTRY_CONFIG = {
  India: {
    get label() { return translate('country.india') },
    currency: { code: 'INR', symbol: '₹', locale: 'en-IN' },
    languages: ['en', 'hi', 'te', 'ta', 'kn', 'ml'],
    defaultLanguage: 'en',
    rtl: false,
    paymentProviders: [
      { id: 'inr-bank', get label() { return translate('opt.payment.inrBank') }, code: 'INR', available: false },
    ],
  },
}

export function countryConfig(country) {
  return COUNTRY_CONFIG[country] || COUNTRY_CONFIG.India
}

export function countryCurrency(country) {
  return countryConfig(country).currency
}

/**
 * An amount of the project's currency, written the way the selected language
 * writes money.
 *
 * `${symbol}${number}` put the symbol in front unconditionally, which is wrong
 * for Arabic: Arabic writes the amount first and the currency after it, and in a
 * right-to-left paragraph a leading symbol lands on the wrong side of the
 * number entirely. `Intl.NumberFormat` knows each language's own placement, so
 * the currency goes where that language puts it.
 *
 * The currency itself never changes: it is always the PROJECT's currency,
 * looked up from the project's country exactly as before. Only the arrangement
 * follows the reader. Digits stay Latin everywhere, because `activeLocale()`
 * pins Arabic to `-u-nu-latn` so an amount stays comparable with what is stored.
 *
 * The fraction-digit range is the one `toLocaleString` produced before (0 to 3),
 * so no amount gains or loses a digit; `options` lets a caller narrow it, which
 * is how the message cards keep whole rupees.
 */
export function formatMoney(value, country, options = {}) {
  const { code, symbol, locale } = countryCurrency(country)
  const numericValue = Number(value || 0)
  const digits = { minimumFractionDigits: 0, maximumFractionDigits: 3, ...options }
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      ...digits,
    }).format(numericValue)
  } catch {
    // `narrowSymbol` is not understood by every engine; the same format without
    // it is still correctly placed for the language.
    try {
      return new Intl.NumberFormat(activeLocale(), { style: 'currency', currency: code, ...digits }).format(numericValue)
    } catch {
      return `${symbol}${numericValue.toLocaleString(locale, digits)}`
    }
  }
}
